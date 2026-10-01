import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AsciiGlobe } from './ascii-globe';

describe('AsciiGlobe', () => {
  it('renders a decorative globe', async () => {
    const fixture = TestBed.createComponent(AsciiGlobe);
    await fixture.whenStable();
    const pre: HTMLPreElement = fixture.nativeElement.querySelector('pre');
    expect(pre.getAttribute('aria-hidden')).toBe('true');
    expect(pre.textContent!.split('\n').length).toBeGreaterThan(10);
  });

  describe('dragging', () => {
    let pre: HTMLPreElement;
    // Real PointerEvents with a numeric pointerId, like a browser sends, so the
    // pointerId filtering in the component is actually exercised.
    const fire = (type: string, init: PointerEventInit & { target?: EventTarget } = {}) =>
      (init.target ?? pre).dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, buttons: 1, ...init }));

    beforeEach(async () => {
      const fixture = TestBed.createComponent(AsciiGlobe);
      await fixture.whenStable();
      pre = fixture.nativeElement.querySelector('pre');
    });

    it('turns when dragged horizontally, and only while the pointer is down', () => {
      fire('pointermove', { clientX: 10 }); // not pressed: ignored
      const before = pre.textContent;
      fire('pointerdown', { clientX: 0 });
      fire('pointermove', { clientX: 30 });
      const dragged = pre.textContent;
      expect(dragged).not.toBe(before);

      fire('pointerup', { clientX: 30 });
      fire('pointermove', { clientX: 60 });
      expect(pre.textContent).toBe(dragged);
    });

    it('ignores other pointers while dragging (e.g. a second finger)', () => {
      fire('pointerdown', { clientX: 0 });
      const before = pre.textContent;

      fire('pointermove', { pointerId: 2, clientX: 60 });
      expect(pre.textContent).toBe(before);

      fire('pointerup', { pointerId: 2, target: window });
      fire('pointercancel', { pointerId: 2, target: window });
      expect(pre.classList).toContain('dragging');

      fire('pointerdown', { pointerId: 2, clientX: 0 }); // can't start a second drag
      fire('pointerup', { pointerId: 1, target: window });
      expect(pre.classList).not.toContain('dragging');
    });

    it('ends the drag when released outside the globe', () => {
      fire('pointerdown');
      expect(pre.classList).toContain('dragging');
      fire('pointerup', { target: window });
      expect(pre.classList).not.toContain('dragging');
    });

    it('recovers if the release was missed', () => {
      fire('pointerdown', { clientX: 0 });
      fire('pointermove', { clientX: 30, buttons: 0 }); // moved with no button held
      expect(pre.classList).not.toContain('dragging');
      const frozen = pre.textContent;
      fire('pointermove', { clientX: 90 });
      expect(pre.textContent).toBe(frozen);
    });

    it('ignores non-primary buttons and ends on context menu or blur', () => {
      fire('pointerdown', { button: 2 });
      expect(pre.classList).not.toContain('dragging');

      fire('pointerdown');
      fire('contextmenu');
      expect(pre.classList).not.toContain('dragging');

      fire('pointerdown');
      fire('blur', { target: window });
      expect(pre.classList).not.toContain('dragging');
    });
  });

  describe('momentum', () => {
    let pre: HTMLPreElement;
    let now: number;
    // Angular schedules its own frames too, so keep every pending callback.
    let frames: FrameRequestCallback[] = [];
    const fire = (type: string, init: PointerEventInit = {}) =>
      pre.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, buttons: 1, ...init }));
    /** Advance fake time by `ms` in 16ms frames, running the animation loop. */
    const run = (ms: number) => {
      for (let t = 0; t < ms; t += 16) {
        now += 16;
        const pending = frames;
        frames = [];
        pending.forEach((cb) => cb(now));
      }
    };
    /** Drag `dx` px in 5 moves `stepMs` apart, wait `restMs`, then release. Then coast for `coastMs`. */
    const dragAndRelease = (dx: number, stepMs: number, restMs: number, coastMs: number) => {
      fire('pointerdown', { clientX: 0 });
      for (let i = 1; i <= 5; i++) {
        run(stepMs);
        fire('pointermove', { clientX: (dx * i) / 5 });
      }
      run(restMs);
      fire('pointerup');
      run(coastMs);
      return pre.textContent;
    };

    /** A fresh globe at angle 0, with fake time and animation frames. */
    const setup = async () => {
      now = 1000;
      frames = [];
      const fixture = TestBed.createComponent(AsciiGlobe);
      await fixture.whenStable();
      pre = fixture.nativeElement.querySelector('pre');
      // jsdom has no layout; give the globe a 300px width so 150px is one radian.
      pre.getBoundingClientRect = () => ({ width: 300 }) as DOMRect;
    };

    beforeEach(() => {
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
      vi.stubGlobal('cancelAnimationFrame', () => {});
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          observe() {}
          disconnect() {}
        },
      );
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    // Same distance dragged, so any difference afterwards is down to release velocity.
    it('coasts after a fast flick instead of snapping back to the auto-spin', async () => {
      await setup();
      const fast = dragAndRelease(-150, 16, 0, 320);
      TestBed.resetTestingModule();
      await setup();
      const slow = dragAndRelease(-150, 160, 0, 320);
      expect(fast).not.toBe(slow);
    });

    it('does not carry momentum if the pointer rested before release', async () => {
      await setup();
      const fastThenRest = dragAndRelease(-150, 16, 496, 320);
      TestBed.resetTestingModule();
      await setup();
      const slowThenRest = dragAndRelease(-150, 160, 496, 320);
      expect(fastThenRest).toBe(slowThenRest);
    });
  });
});
