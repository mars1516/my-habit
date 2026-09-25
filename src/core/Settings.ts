export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  quality: Quality;
  sensitivity: number;
  invertY: boolean;
  volume: number;
  music: number;
  showFps: boolean;
  bloom: boolean;
}

const KEY = 'etheria-settings-v1';

export function loadSettings(): Settings {
  const defaults: Settings = { quality: 'medium', sensitivity: 1, invertY: false, volume: 0.8, music: 0.5, showFps: false, bloom: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return defaults;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
