import { afterNextRender, Component, DestroyRef, ElementRef, inject, viewChild } from '@angular/core';
import { createGlobe } from './globe-renderer';

const COLS = 61;
// Monospace glyphs are about 0.6 as wide as they are tall; this keeps the globe round.
const ROWS = Math.round(COLS * 0.6);
const TILT = (23.4 * Math.PI) / 180;
const LIGHT = [-0.5, 0.4, 0.8] as const;
/** Radians per second: one full turn every ~30s. */
const SPIN_SPEED = (2 * Math.PI) / 30;

@Component({
  selector: 'app-ascii-globe',
  templateUrl: './ascii-globe.html',
  styleUrl: './ascii-globe.scss',
})
export class AsciiGlobe {
  private readonly pre = viewChild.required<ElementRef<HTMLPreElement>>('globe');

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const el = this.pre().nativeElement;
      const render = createGlobe({ cols: COLS, rows: ROWS, tilt: TILT, light: LIGHT });
      const draw = () => (el.textContent = render(angle));

      let angle = 0;
      let dragging = false;
      let dragPointer: number | undefined;
      let dragX = 0;
      let dragRadius = 1;
      draw();

      // Dragging turns the globe so the surface under the cursor follows it:
      // moving the cursor `dx` pixels turns the globe by `dx / radius` radians.
      const onDown = (e: PointerEvent) => {
        // Left button / first touch only. Other buttons (e.g. a right-click that
        // opens the context menu) never deliver a matching pointerup.
        if (dragging || e.button > 0) return;
        dragging = true;
        dragPointer = e.pointerId;
        dragX = e.clientX;
        dragRadius = Math.max(1, el.getBoundingClientRect().width / 2);
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Not every environment supports pointer capture.
        }
        el.classList.add('dragging');
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging || e.pointerId !== dragPointer) return;
        // Self-heal: if no button is held, we missed the release (lost focus,
        // context menu, released over another window), so end the drag now.
        if (e.buttons === 0) return endDrag();
        angle += (e.clientX - dragX) / dragRadius;
        dragX = e.clientX;
        draw();
      };
      const endDrag = () => {
        dragging = false;
        dragPointer = undefined;
        el.classList.remove('dragging');
      };
      const onEnd = (e: PointerEvent) => {
        if (e.pointerId === dragPointer) endDrag();
      };

      const listeners: [EventTarget, string, EventListener][] = [
        [el, 'pointerdown', onDown as EventListener],
        [el, 'pointermove', onMove as EventListener],
        // Pointer capture normally routes these to `el`, but listen on window too in
        // case capture failed or was released.
        [window, 'pointerup', onEnd as EventListener],
        [window, 'pointercancel', onEnd as EventListener],
        [el, 'lostpointercapture', onEnd as EventListener],
        [el, 'contextmenu', endDrag],
        [window, 'blur', endDrag],
      ];
      for (const [target, type, fn] of listeners) target.addEventListener(type, fn);
      destroyRef.onDestroy(() => {
        for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
      });

      let frame = 0;
      let last = 0;

      const tick = (now: number) => {
        // Clamp the step so resuming after a long pause doesn't jump.
        const dt = Math.min(now - last, 100) / 1000;
        last = now;
        if (!dragging) {
          angle += dt * SPIN_SPEED;
          draw();
        }
        frame = requestAnimationFrame(tick);
      };
      const start = () => {
        if (frame) return;
        last = performance.now();
        frame = requestAnimationFrame(tick);
      };
      const stop = () => {
        cancelAnimationFrame(frame);
        frame = 0;
      };

      // Auto-spin only while the globe is on screen and the user hasn't asked for reduced
      // motion. With reduced motion the user can still turn it by hand. Both inputs can
      // change while the page is open, so react to each.
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      let onScreen = true;
      const update = () => {
        if (onScreen && !reducedMotion?.matches) {
          start();
        } else {
          stop();
        }
      };

      const observer = new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        update();
      });
      observer.observe(el);
      reducedMotion?.addEventListener('change', update);
      update();

      destroyRef.onDestroy(() => {
        observer.disconnect();
        reducedMotion?.removeEventListener('change', update);
        stop();
      });
    });
  }
}
