import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { events } from '../core/Events';

type Wave = OscillatorType;

/** Fully procedural audio: sound effects, ambience and a generative score. */
export class AudioSys {
  ac: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rainGain!: GainNode;
  private noteTimer = 0;
  private padTimer = 0;
  private birdTimer = 3;
  private cricketTimer = 1;
  private drumTimer = 0;
  private step = 0;
  private lastPlayed = new Map<string, number>();

  constructor() {
    const unlock = () => {
      this.init();
      if (this.ac?.state === 'suspended') this.ac.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    events.on('sound', (s) => this.play(s.name, s.volume ?? 0.5, s.pos));
  }

  private init() {
    if (this.ac) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    this.ac = ac;
    this.master = ac.createGain();
    this.master.connect(ac.destination);
    this.sfx = ac.createGain();
    this.music = ac.createGain();
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.setVolume(ctx.settings.volume, ctx.settings.music);
    // reverb
    this.reverb = ac.createConvolver();
    const len = ac.sampleRate * 2.8;
    const ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb.buffer = ir;
    this.reverbSend = ac.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);
    // noise
    this.noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // wind loop
    const wind = ac.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    this.windFilter = ac.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.6;
    this.windGain = ac.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.sfx);
    wind.start();
    // rain loop
    const rain = ac.createBufferSource();
    rain.buffer = this.noiseBuf;
    rain.loop = true;
    const rf = ac.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 1400;
    this.rainGain = ac.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rf).connect(this.rainGain).connect(this.sfx);
    rain.start();
  }

  setVolume(sfx: number, music: number) {
    if (!this.ac) return;
    this.sfx.gain.value = sfx;
    this.music.gain.value = music * 0.55;
  }

  // ---- primitives -----------------------------------------------------------
  private out(vol: number, pos?: THREE.Vector3) {
    const ac = this.ac!;
    const g = ac.createGain();
    let v = vol;
    let pan = 0;
    if (pos && ctx.camera) {
      const d = pos.distanceTo(ctx.camera.position);
      v *= Math.max(0, 1 - d / 70) ** 1.5;
      const rel = pos.clone().applyMatrix4(ctx.camera.matrixWorldInverse);
      pan = Math.max(-0.8, Math.min(0.8, rel.x / (Math.abs(rel.z) + 4)));
    }
    g.gain.value = v;
    const p = ac.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.sfx);
    return { g, v, p };
  }

  private tone(freq: number, dur: number, vol: number, opts: { type?: Wave; to?: number; attack?: number; pos?: THREE.Vector3; delay?: number; reverb?: number; dest?: AudioNode } = {}) {
    const ac = this.ac!;
    const t = ac.currentTime + (opts.delay ?? 0);
    const o = ac.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + dur);
    const env = ac.createGain();
    const a = opts.attack ?? 0.005;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + a);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(env);
    if (opts.dest) {
      const lvl = ac.createGain();
      lvl.gain.value = vol;
      env.connect(lvl).connect(opts.dest);
    } else {
      const { g } = this.out(vol, opts.pos);
      env.connect(g);
      if (opts.reverb) {
        const s = ac.createGain();
        s.gain.value = opts.reverb * vol;
        env.connect(s).connect(this.reverbSend);
      }
    }
    o.start(t);
    o.stop(t + dur + 0.05);
    return env;
  }

  private noise(dur: number, vol: number, opts: { type?: BiquadFilterType; freq?: number; to?: number; q?: number; attack?: number; pos?: THREE.Vector3; delay?: number; reverb?: number } = {}) {
    const ac = this.ac!;
    const t = ac.currentTime + (opts.delay ?? 0);
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ac.createBiquadFilter();
    f.type = opts.type ?? 'lowpass';
    f.frequency.setValueAtTime(opts.freq ?? 1000, t);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    f.Q.value = opts.q ?? 1;
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + (opts.attack ?? 0.01));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(env);
    const { g } = this.out(vol, opts.pos);
    env.connect(g);
    if (opts.reverb) {
      const s = ac.createGain();
      s.gain.value = opts.reverb * vol;
      env.connect(s).connect(this.reverbSend);
    }
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private chord(freqs: number[], gap: number, dur: number, vol: number, type: Wave = 'triangle') {
    freqs.forEach((f, i) => this.tone(f, dur, vol, { type, delay: i * gap, attack: 0.01, reverb: 0.6 }));
  }

  // ---- sound effects -------------------------------------------------------
  play(name: string, vol = 0.5, pos?: THREE.Vector3) {
    if (!this.ac || this.ac.state !== 'running') return;
    const now = this.ac.currentTime;
    const last = this.lastPlayed.get(name) ?? 0;
    if (now - last < 0.035) return;
    this.lastPlayed.set(name, now);
    const r = Math.random();
    switch (name) {
      case 'step': {
        const snow = ctx.player && ctx.terrain.heightAt(ctx.player.pos.x, ctx.player.pos.z) > 110;
        this.noise(0.09, vol * 0.5, { type: 'bandpass', freq: snow ? 2400 : 700 + r * 300, q: 1.2, pos });
        break;
      }
      case 'jump':
        this.noise(0.18, vol * 0.4, { type: 'bandpass', freq: 800, to: 1600, pos });
        break;
      case 'land':
        this.noise(0.2, vol * 0.7, { freq: 500, to: 150, pos });
        break;
      case 'dodge':
        this.noise(0.25, vol * 0.6, { type: 'bandpass', freq: 1200, to: 400, q: 0.8, pos });
        break;
      case 'glide':
        this.noise(0.5, vol * 0.5, { type: 'bandpass', freq: 500, to: 1500, attack: 0.1 });
        this.tone(660, 0.4, vol * 0.15, { to: 990, reverb: 0.5 });
        break;
      case 'splash':
        this.noise(0.6, vol, { freq: 2200, to: 300, pos, reverb: 0.3 });
        break;
      case 'ignite':
        this.noise(0.5, vol * 0.8, { type: 'bandpass', freq: 300, to: 1600, q: 0.7, attack: 0.05, pos });
        break;
      case 'sizzle':
        this.noise(0.7, vol * 0.6, { type: 'highpass', freq: 3000, to: 5000, pos });
        break;
      case 'crackle':
        for (let i = 0; i < 6; i++) this.noise(0.03, vol * (0.3 + Math.random() * 0.5), { type: 'highpass', freq: 1500 + Math.random() * 2500, delay: Math.random() * 0.55 });
        this.noise(0.6, vol * 0.25, { freq: 500, attack: 0.2 });
        break;
      case 'rustle':
        this.noise(0.4, vol * 0.5, { type: 'highpass', freq: 2500, attack: 0.05, pos });
        break;
      case 'thunder':
        this.noise(0.12, vol, { type: 'highpass', freq: 2000, pos });
        this.noise(2.4, vol * 1.2, { freq: 400, to: 60, attack: 0.05, delay: 0.05, reverb: 0.6 });
        break;
      case 'cast_fire':
        this.noise(0.3, vol * 0.8, { type: 'bandpass', freq: 600, to: 2000, q: 0.8, pos });
        this.tone(220, 0.2, vol * 0.2, { type: 'sawtooth', to: 440, pos });
        break;
      case 'cast_ice':
        this.tone(1800 + r * 400, 0.25, vol * 0.25, { type: 'triangle', to: 2600, pos, reverb: 0.5 });
        this.noise(0.15, vol * 0.4, { type: 'highpass', freq: 4000, pos });
        break;
      case 'cast_wind':
        this.noise(0.45, vol * 0.9, { type: 'bandpass', freq: 300, to: 2400, q: 1.5, pos });
        break;
      case 'cast_lightning':
        this.noise(0.18, vol * 0.8, { type: 'highpass', freq: 3000, pos });
        this.tone(90, 0.2, vol * 0.4, { type: 'square', to: 50, pos });
        break;
      case 'cast_kinesis':
        this.tone(300, 0.5, vol * 0.3, { type: 'sine', to: 600, attack: 0.05, reverb: 0.6 });
        this.tone(303, 0.5, vol * 0.3, { type: 'sine', to: 606, attack: 0.05 });
        break;
      case 'skill_fire':
        this.noise(0.6, vol, { type: 'bandpass', freq: 200, to: 1500, q: 0.6, pos });
        break;
      case 'skill_ice':
        this.chord([1320, 1760, 2090], 0.04, 0.5, vol * 0.18, 'sine');
        this.noise(0.4, vol * 0.5, { type: 'highpass', freq: 3500 });
        break;
      case 'skill_wind':
        this.noise(1.0, vol, { type: 'bandpass', freq: 200, to: 3000, q: 1.2, attack: 0.1 });
        break;
      case 'skill_lightning':
        this.tone(1200, 0.5, vol * 0.12, { type: 'sawtooth', to: 200 });
        break;
      case 'skill_kinesis':
        this.tone(120, 0.6, vol * 0.5, { type: 'sine', to: 60, reverb: 0.5 });
        this.noise(0.5, vol * 0.5, { freq: 800, to: 200 });
        break;
      case 'fire_hit':
        this.noise(0.35, vol, { freq: 1200, to: 200, pos });
        break;
      case 'ice_hit':
        this.tone(2400 + r * 800, 0.15, vol * 0.25, { type: 'triangle', pos });
        this.noise(0.12, vol * 0.5, { type: 'highpass', freq: 5000, pos });
        break;
      case 'explode':
        this.noise(1.4, vol * 1.3, { freq: 1200, to: 50, pos, reverb: 0.5 });
        this.tone(70, 0.8, vol * 0.8, { to: 30, pos });
        break;
      case 'freeze':
        this.noise(0.5, vol * 0.7, { type: 'highpass', freq: 2500, to: 6000, pos });
        this.tone(900, 0.4, vol * 0.2, { type: 'triangle', to: 1800, pos, reverb: 0.4 });
        break;
      case 'shatter':
        for (let i = 0; i < 5; i++) this.tone(2000 + Math.random() * 3000, 0.2, vol * 0.15, { type: 'triangle', delay: i * 0.03, pos });
        this.noise(0.3, vol * 0.6, { type: 'highpass', freq: 3000, pos });
        break;
      case 'hit':
        this.noise(0.15, vol, { freq: 900, to: 200 });
        this.tone(160, 0.2, vol * 0.5, { type: 'square', to: 80 });
        break;
      case 'enemy_hit':
        this.noise(0.1, vol * 0.8, { type: 'bandpass', freq: 1800, q: 2, pos });
        this.tone(420 + r * 200, 0.08, vol * 0.25, { type: 'square', to: 200, pos });
        break;
      case 'enemy_die':
        for (let i = 0; i < 6; i++) this.noise(0.05, vol * 0.5, { type: 'bandpass', freq: 1500 + Math.random() * 1500, q: 3, delay: i * 0.06, pos });
        break;
      case 'swing':
        this.noise(0.2, vol * 0.6, { type: 'bandpass', freq: 600, to: 1800, q: 1, pos });
        break;
      case 'block':
        this.tone(900, 0.15, vol * 0.4, { type: 'square', to: 500, pos });
        break;
      case 'bow':
        this.tone(200, 0.12, vol * 0.5, { type: 'triangle', to: 90, pos });
        break;
      case 'alert':
        this.tone(700, 0.12, vol * 0.3, { type: 'square', pos });
        this.tone(1000, 0.15, vol * 0.3, { type: 'square', delay: 0.1, pos });
        break;
      case 'slam':
        this.noise(0.9, vol * 1.2, { freq: 600, to: 40, pos, reverb: 0.4 });
        this.tone(55, 0.6, vol, { to: 30, pos });
        break;
      case 'summon':
        this.tone(110, 1.2, vol * 0.4, { type: 'sawtooth', to: 55, reverb: 0.6 });
        break;
      case 'boss':
        this.tone(55, 2.5, vol * 0.7, { type: 'sawtooth', attack: 0.3, reverb: 0.8 });
        this.tone(82, 2.5, vol * 0.5, { type: 'sawtooth', attack: 0.3 });
        break;
      case 'pickup':
        this.tone(880, 0.12, vol * 0.3, { type: 'triangle' });
        this.tone(1320, 0.18, vol * 0.3, { type: 'triangle', delay: 0.07, reverb: 0.3 });
        break;
      case 'seed':
      case 'wisp':
        this.chord([1046, 1318, 1568, 2093], 0.07, 0.5, vol * 0.25, 'sine');
        break;
      case 'chest':
        this.noise(0.4, vol * 0.4, { freq: 600, to: 300 });
        this.chord([523, 659, 784, 1046], 0.1, 0.8, vol * 0.25);
        break;
      case 'appear':
        this.chord([784, 988, 1175, 1568], 0.08, 0.9, vol * 0.2, 'sine');
        break;
      case 'charge':
        this.tone(220, 0.9, vol * 0.25, { type: 'sine', to: 440, attack: 0.2, reverb: 0.4 });
        this.noise(0.8, vol * 0.3, { type: 'bandpass', freq: 400, to: 2400, q: 2, attack: 0.3 });
        break;
      case 'chargeLevel':
        this.chord([660, 990, 1320], 0.03, 0.45, vol * 0.2, 'sine');
        this.noise(0.25, vol * 0.4, { type: 'highpass', freq: 3000 });
        break;
      case 'surge':
        this.noise(0.9, vol, { type: 'bandpass', freq: 300, to: 2600, q: 0.9, attack: 0.05 });
        this.tone(110, 0.7, vol * 0.4, { type: 'sawtooth', to: 330, reverb: 0.3 });
        break;
      case 'surgeFire':
        this.noise(0.3, vol * 0.8, { type: 'lowpass', freq: 900, to: 300, q: 0.7 });
        break;
      case 'surgeIce':
        this.tone(1760 + r * 600, 0.25, vol * 0.12, { type: 'sine', reverb: 0.5 });
        this.noise(0.12, vol * 0.4, { type: 'highpass', freq: 4000 });
        break;
      case 'surgeZap':
        this.tone(900 + r * 900, 0.08, vol * 0.08, { type: 'square', to: 200 });
        break;
      case 'sandevistan':
        this.tone(880, 1.2, vol * 0.2, { type: 'triangle', to: 110, reverb: 0.8 });
        this.tone(55, 1.4, vol * 0.5, { type: 'sine', attack: 0.05 });
        break;
      case 'discover':
      case 'beacon':
        this.chord([392, 523, 659, 784, 1046], 0.12, 1.8, vol * 0.22);
        break;
      case 'skill_unlock':
        this.chord([262, 330, 392, 523, 659, 784, 1046], 0.09, 2.2, vol * 0.2);
        break;
      case 'quest':
        this.chord([587, 740, 880], 0.08, 0.7, vol * 0.2);
        break;
      case 'fanfare':
        this.chord([523, 659, 784, 1046, 784, 1046], 0.12, 1.2, vol * 0.2);
        break;
      case 'solve':
        this.chord([659, 784, 988, 1318], 0.1, 1.0, vol * 0.22, 'sine');
        break;
      case 'heal':
      case 'eat':
        this.tone(660, 0.3, vol * 0.25, { type: 'sine', to: 990, reverb: 0.4 });
        break;
      case 'cook':
        this.noise(0.8, vol * 0.4, { type: 'highpass', freq: 2500, attack: 0.1 });
        this.chord([523, 784], 0.15, 0.6, vol * 0.2);
        break;
      case 'buy':
        this.tone(1568, 0.1, vol * 0.3, { type: 'triangle' });
        this.tone(2093, 0.2, vol * 0.3, { type: 'triangle', delay: 0.08 });
        break;
      case 'door':
      case 'seal':
        this.noise(1.6, vol * 0.8, { freq: 300, to: 80, attack: 0.2, reverb: 0.5 });
        this.chord([196, 262, 392], 0.2, 1.8, vol * 0.2, 'sine');
        break;
      case 'windmill':
        this.noise(0.4, vol * 0.3, { type: 'bandpass', freq: 400, q: 2, pos });
        break;
      case 'crystal':
        this.chord([1760, 2217, 2637], 0.03, 0.8, vol * 0.2, 'sine');
        break;
      case 'fuse':
        this.noise(1.2, vol * 0.4, { type: 'highpass', freq: 4000, pos });
        break;
      case 'break':
        this.noise(0.35, vol, { type: 'bandpass', freq: 600, q: 0.8, pos });
        break;
      case 'rockbreak':
        this.noise(1.0, vol * 1.2, { freq: 900, to: 60, pos, reverb: 0.4 });
        break;
      case 'click':
        this.tone(400, 0.08, vol * 0.4, { type: 'square', pos });
        break;
      case 'unclick':
        this.tone(300, 0.08, vol * 0.3, { type: 'square', pos });
        break;
      case 'tornado':
        this.noise(5, vol, { type: 'bandpass', freq: 200, to: 800, q: 1, attack: 0.5 });
        break;
      case 'burst':
        this.tone(130, 1.2, vol * 0.4, { type: 'sawtooth', to: 520, attack: 0.1, reverb: 0.7 });
        this.noise(1.2, vol * 0.6, { type: 'bandpass', freq: 300, to: 3000, attack: 0.2 });
        break;
      case 'select':
        this.tone(1200, 0.06, vol * 0.25, { type: 'triangle' });
        break;
      case 'throw':
        this.noise(0.3, vol * 0.7, { type: 'bandpass', freq: 500, to: 1500 });
        break;
      case 'teleport':
        this.tone(300, 0.8, vol * 0.3, { type: 'sine', to: 1800, reverb: 0.7 });
        break;
      case 'ui_click':
        this.tone(1500, 0.04, vol * 0.25, { type: 'triangle' });
        break;
      case 'ui_open':
        this.tone(900, 0.08, vol * 0.2, { type: 'sine', to: 1300 });
        break;
      case 'ui_close':
        this.tone(1100, 0.08, vol * 0.2, { type: 'sine', to: 700 });
        break;
      case 'error':
        this.tone(200, 0.15, vol * 0.3, { type: 'square', to: 150 });
        break;
      default:
        break;
    }
  }

  // ---- ambience & music ----------------------------------------------------
  update(dt: number) {
    if (!this.ac || this.ac.state !== 'running' || !ctx.player) return;
    const p = ctx.player;
    const ground = ctx.terrain.heightAt(p.pos.x, p.pos.z);
    const alt = Math.max(0, p.pos.y - ground);
    const speed = p.vel.length();
    const windLevel = 0.03 + Math.min(0.25, alt / 150) + (p.state === 'glide' ? 0.12 + speed * 0.01 : 0) + (ctx.weather.storm ? 0.12 : 0) + p.pos.y / 1500;
    this.windGain.gain.setTargetAtTime(windLevel, this.ac.currentTime, 0.5);
    this.windFilter.frequency.setTargetAtTime(300 + windLevel * 1200 + Math.sin(ctx.time * 0.3) * 100, this.ac.currentTime, 0.5);
    this.rainGain.gain.setTargetAtTime(ctx.weather.intensity * 0.25, this.ac.currentTime, 0.5);

    const night = ctx.sky.night > 0.5;
    // birds by day, crickets by night
    if (!ctx.weather.raining) {
      this.birdTimer -= dt;
      if (!night && this.birdTimer <= 0 && alt < 30) {
        this.birdTimer = 2 + Math.random() * 6;
        const base = 2200 + Math.random() * 1600;
        const n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) this.tone(base * (1 + Math.random() * 0.15), 0.07, 0.05, { type: 'sine', to: base * 1.3, delay: i * 0.11, reverb: 0.3 });
      }
      this.cricketTimer -= dt;
      if (night && this.cricketTimer <= 0) {
        this.cricketTimer = 0.4 + Math.random() * 1.2;
        const f = 4200 + Math.random() * 600;
        for (let i = 0; i < 3; i++) this.tone(f, 0.03, 0.025, { type: 'sine', delay: i * 0.05 });
      }
    }

    // generative score
    const combat = ctx.enemies?.anyAlert(35) ?? false;
    const boss = !!ctx.enemies?.boss;
    this.noteTimer -= dt;
    this.padTimer -= dt;
    const scale = night ? [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3] : [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3];
    if (this.padTimer <= 0) {
      this.padTimer = combat ? 4 : 9;
      const root = scale[Math.floor(Math.random() * 3)] / 2;
      for (const m of [1, 1.5, 2]) this.tone(root * m, this.padTimer + 1.5, 0.05, { type: 'sine', attack: 1.5, dest: this.musicBus(0.5) });
    }
    if (this.noteTimer <= 0) {
      this.noteTimer = combat ? 0.28 : night ? 1.2 + Math.random() * 2.2 : 0.7 + Math.random() * 1.6;
      if (!combat && Math.random() < 0.25) return;
      const f = scale[Math.floor(Math.random() * scale.length)] * (combat ? 0.5 : 1);
      const bus = this.musicBus(0.9);
      this.tone(f, combat ? 0.35 : 1.8, 0.1, { type: combat ? 'sawtooth' : 'triangle', attack: 0.008, dest: bus });
      if (!combat && Math.random() < 0.3) this.tone(f * 1.5, 1.4, 0.06, { type: 'sine', delay: 0.18, dest: bus });
    }
    if (combat || boss) {
      this.drumTimer -= dt;
      if (this.drumTimer <= 0) {
        this.drumTimer = boss ? 0.42 : 0.56;
        this.step++;
        const bus = this.musicBus(1);
        this.tone(boss ? 60 : 70, 0.25, 0.4, { type: 'sine', to: 35, dest: bus });
        if (this.step % 2 === 1) this.tone(180, 0.08, 0.12, { type: 'square', to: 90, dest: bus });
      }
    }
  }

  private musicBus(vol: number) {
    const ac = this.ac!;
    const g = ac.createGain();
    g.gain.value = vol;
    g.connect(this.music);
    const s = ac.createGain();
    s.gain.value = 0.5;
    g.connect(s).connect(this.reverbSend);
    return g;
  }
}
