import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AsciiGlobe } from './ascii-globe';
import { MARKER, unproject } from './globe-renderer';
import { Note } from './notes.service';

const configure = () =>
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });

describe('AsciiGlobe', () => {
  beforeEach(configure);

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
      configure();
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

  describe('notes', () => {
    let fixture: ComponentFixture<AsciiGlobe>;
    let http: HttpTestingController;
    let pre: HTMLPreElement;
    const el = (selector: string) => fixture.nativeElement.querySelector(selector);
    const fire = (type: string, init: PointerEventInit = {}) =>
      pre.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, buttons: 1, ...init }));
    // jsdom has no layout: a 300x180 box puts the globe's center at (150, 90) and its edge 150px away.
    const CENTER = { clientX: 150, clientY: 90 };
    const click = (at: { clientX: number; clientY: number } = CENTER) => {
      fire('pointerdown', at);
      fire('pointerup', at);
      fixture.detectChanges();
    };
    const note = (id: number, lat: number, lon: number, text: string): Note => ({
      id,
      lat,
      lon,
      text,
      created_at: '2026-01-01T00:00:00+00:00',
    });
    const markerCount = () => pre.textContent!.split(MARKER).length - 1;

    /** The globe never turns here (no animation frames run), so angle stays 0. */
    const setup = async (existing: Note[] = []) => {
      fixture = TestBed.createComponent(AsciiGlobe);
      http = TestBed.inject(HttpTestingController);
      await fixture.whenStable();
      pre = el('pre');
      pre.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect;
      el('.stage').getBoundingClientRect = () => ({ left: 0, top: 0, width: 700, height: 180 }) as DOMRect;
      http.expectOne('/api/notes').flush(existing);
      fixture.detectChanges();
    };

    beforeEach(() => {
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          observe() {}
          disconnect() {}
        },
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const panelTexts = () =>
      [...fixture.nativeElement.querySelectorAll('.panel.active')].map((p: Element) => p.textContent!.trim());

    it('loads saved notes, marks the visible ones and shows the 3 nearest the center in panels', async () => {
      // At angle 0 the center of the globe is (lat 23.4, lon 0).
      await setup([
        note(1, 23.4, 0, 'dead center'),
        note(2, 23.4, 40, 'off to the side'),
        note(3, 23.4, 180, 'on the far side'),
        note(4, 23.4, -20, 'a bit left'),
        note(5, 23.4, 60, 'further right'),
      ]);
      expect(markerCount()).toBe(4);
      expect(panelTexts().sort()).toEqual(['a bit left', 'dead center', 'off to the side']);
    });

    it('shows no panel for a visible note outside the front quarter, but keeps its dot', async () => {
      await setup([note(1, 23.4, 0, 'dead center'), note(2, 23.4, 75, 'near the edge')]);
      expect(markerCount()).toBe(2);
      expect(panelTexts()).toEqual(['dead center']);
    });

    it('places an active panel beside its marker, inside the stage', async () => {
      await setup([note(1, 23.4, 0, 'dead center')]);
      const panel: HTMLElement = el('.panel.active');
      expect(panel.style.transform).toMatch(/^translate\(/);
      expect(getComputedStyle(el('.panels')).pointerEvents).toBe('none');
    });

    it('draws a line from each active panel to the center of its marker cell', async () => {
      await setup([note(1, 23.4, 0, 'dead center')]);
      const line: SVGLineElement = el('.link.active line');
      // 61 columns and 37 rows over 300x180 px: the center cell (30, 18) is centered at ...
      expect(Number(line.getAttribute('x2'))).toBeCloseTo(((30 + 0.5) / 61) * 300);
      expect(Number(line.getAttribute('y2'))).toBeCloseTo(((18 + 0.5) / 37) * 180);
      expect(Number(el('.link.active circle').getAttribute('cx'))).toBeCloseTo(Number(line.getAttribute('x2')));
    });

    it('shows note text as plain text, never HTML', async () => {
      await setup([note(1, 23.4, 0, '<img src=x onerror=alert(1)>')]);
      expect(panelTexts()).toEqual(['<img src=x onerror=alert(1)>']);
      expect(el('.panel img')).toBeNull();
    });

    it('leaves clicks and drags to the globe', async () => {
      await setup([note(1, 23.4, 0, 'dead center')]);
      expect(getComputedStyle(el('.links')).pointerEvents).toBe('none');
    });

    it('opens a prompt for the spot under a click', async () => {
      await setup();
      expect(el('form')).toBeNull();
      click();
      expect(el('form')).not.toBeNull();
      expect(el('input').maxLength).toBe(140);
      expect(el('form label').textContent).toContain('23.4°, 0.0°');
    });

    it('does not open the prompt after a drag, or for a click off the globe', async () => {
      await setup();
      fire('pointerdown', CENTER);
      fire('pointermove', { clientX: 170, clientY: 90 });
      fire('pointermove', { clientX: 150, clientY: 90 }); // back where it started, but it was a drag
      fire('pointerup', CENTER);
      fixture.detectChanges();
      expect(el('form')).toBeNull();

      click({ clientX: 2, clientY: 2 }); // the square's corner is dark background
      expect(el('form')).toBeNull();
    });

    it('treats a few pixels of jitter as a click', async () => {
      await setup();
      fire('pointerdown', CENTER);
      fire('pointermove', { clientX: 152, clientY: 91 });
      fire('pointerup', { clientX: 152, clientY: 91 });
      fixture.detectChanges();
      expect(el('form')).not.toBeNull();
    });

    it('shows a saved note right away and posts it to the backend', async () => {
      await setup();
      click({ clientX: 150, clientY: 60 });
      const input: HTMLInputElement = el('input');
      input.value = '  hello world ';
      el('form').dispatchEvent(new Event('submit', { cancelable: true }));
      fixture.detectChanges();

      expect(el('form')).toBeNull();
      expect(markerCount()).toBe(1);
      expect(panelTexts()).toEqual(['hello world']);

      const spot = unproject(0, 1 / 3, 0, (23.4 * Math.PI) / 180)!;
      const req = http.expectOne('/api/notes');
      expect(req.request.method).toBe('POST');
      expect(req.request.body.text).toBe('hello world');
      expect(req.request.body.lat).toBeCloseTo(spot.lat);
      expect(req.request.body.lon).toBeCloseTo(spot.lon);
      req.flush(note(7, spot.lat, spot.lon, 'hello world'));
      fixture.detectChanges();
      expect(markerCount()).toBe(1);
      expect(panelTexts()).toEqual(['hello world']);
    });

    it('does not post an empty note, and can be cancelled', async () => {
      await setup();
      click();
      el('input').value = '   ';
      el('form').dispatchEvent(new Event('submit', { cancelable: true }));
      http.expectNone('/api/notes');

      el('form button[type=button]').click();
      fixture.detectChanges();
      expect(el('form')).toBeNull();
    });

    it('takes a note back and says why if the backend refuses it', async () => {
      await setup();
      click();
      el('input').value = 'too much';
      el('form').dispatchEvent(new Event('submit', { cancelable: true }));
      expect(markerCount()).toBe(1);

      http.expectOne('/api/notes').flush({ detail: 'slow down' }, { status: 429, statusText: 'Too Many Requests' });
      fixture.detectChanges();
      expect(markerCount()).toBe(0);
      expect(el('.note-error').textContent).toContain('Too many notes');
    });

    it('still works if notes cannot be loaded', async () => {
      fixture = TestBed.createComponent(AsciiGlobe);
      http = TestBed.inject(HttpTestingController);
      await fixture.whenStable();
      http.expectOne('/api/notes').flush('nope', { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(el('pre').textContent.length).toBeGreaterThan(100);
      expect(el('.note-error')).toBeNull();
    });
  });
});
