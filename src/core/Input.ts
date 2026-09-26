/** Keyboard/mouse state using KeyboardEvent.code so it works with Korean IME layouts. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  mouseX = 0;
  mouseY = 0;
  locked = false;
  /** When false, gameplay input is ignored (menus open). */
  enabled = true;
  sensitivity = 1;
  invertY = false;
  onLockChange?: (locked: boolean, byUser: boolean) => void;
  /** Pointer lock refused (sandboxed iframe, browser policy): fall back to free mouse look. */
  lockUnavailable = false;
  private selfUnlock = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Tab', 'Space', 'AltLeft', 'AltRight', 'F1'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
      const code = `Mouse${e.button}`;
      this.down.add(code);
      this.pressed.add(code);
    });
    window.addEventListener('mouseup', (e) => {
      const code = `Mouse${e.button}`;
      this.down.delete(code);
      this.released.add(code);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (this.locked || (this.lockUnavailable && this.enabled)) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    window.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockerror', () => (this.lockUnavailable = true));
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (was === this.locked) return;
      const byUser = !this.locked && !this.selfUnlock;
      this.selfUnlock = false;
      this.onLockChange?.(this.locked, byUser);
    });
  }

  requestLock() {
    if (!this.locked) {
      if (!this.canvas.requestPointerLock) {
        this.lockUnavailable = true;
        return;
      }
      try {
        const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        p?.catch?.((e: Error) => {
          // user-gesture errors are transient; anything else means lock is not allowed here
          if (!/gesture|activation/i.test(String(e?.message ?? e))) this.lockUnavailable = true;
        });
      } catch {
        this.lockUnavailable = true;
      }
    }
  }

  exitLock() {
    if (document.pointerLockElement) {
      this.selfUnlock = true;
      document.exitPointerLock();
    }
  }

  isDown(code: string) {
    return this.enabled && this.down.has(code);
  }
  wasPressed(code: string) {
    return this.enabled && this.pressed.has(code);
  }
  wasReleased(code: string) {
    return this.enabled && this.released.has(code);
  }
  /** Menu keys work even when gameplay input is disabled. */
  menuPressed(code: string) {
    return this.pressed.has(code);
  }

  /** Simulate a key press (used by the debug/test API). */
  simulate(code: string, down: boolean) {
    if (down) {
      this.down.add(code);
      this.pressed.add(code);
    } else {
      this.down.delete(code);
      this.released.add(code);
    }
  }

  /** Forget keys pressed this frame (e.g. the key that closed a menu). */
  clearPressed() {
    this.pressed.clear();
    this.down.delete('KeyF');
    this.down.delete('Space');
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
