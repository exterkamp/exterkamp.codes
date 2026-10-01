import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AsciiGlobe, buildSpace, SPACE_COLS, SPACE_ROWS } from './ascii-globe';
import { MARKER, unproject } from './globe-renderer';
import { Note } from './notes.service';

const configure = () =>
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });

const redrawGlobe = (fixture: ComponentFixture<AsciiGlobe>) => {
  const pre: HTMLPreElement = fixture.nativeElement.querySelector('pre');
  pre.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true, buttons: 1, clientX: 0 }));
  pre.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, bubbles: true, buttons: 1, clientX: 40 }));
  pre.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true, clientX: 40 }));
};

describe('AsciiGlobe', () => {
  beforeEach(configure);

  it('renders a decorative globe', async () => {
    const fixture = TestBed.createComponent(AsciiGlobe);
    await fixture.whenStable();
    const pre: HTMLPreElement = fixture.nativeElement.querySelector('pre');
    expect(pre.getAttribute('aria-hidden')).toBe('true');
    expect(pre.textContent!.split('\n').length).toBeGreaterThan(10);
  });

  it('colors the globe cell by cell, with one span per cell', async () => {
    const fixture = TestBed.createComponent(AsciiGlobe);
    await fixture.whenStable();
    const spans: HTMLElement[] = [...fixture.nativeElement.querySelectorAll('pre span')];
    expect(spans.length).toBe(61 * 37);
    const colors = new Set(spans.map((s) => s.style.color).filter(Boolean));
    expect(colors.size).toBeGreaterThan(8);
  });

  it('draws the dark space once, static and hidden from screen readers', async () => {
    const fixture = TestBed.createComponent(AsciiGlobe);
    await fixture.whenStable();
    const space: HTMLElement = fixture.nativeElement.querySelector('.space');
    expect(space.getAttribute('aria-hidden')).toBe('true');
    const lines = space.textContent!.split('\n');
    expect(lines.length).toBe(SPACE_ROWS);
    expect(lines.every((l) => l.length === SPACE_COLS)).toBe(true);
    const before = space.innerHTML;
    // The globe spins on, but the space never changes.
    redrawGlobe(fixture);
    expect(space.innerHTML).toBe(before);
    expect(buildSpace().glyphs).toEqual(buildSpace().glyphs);
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
      http.expectOne('/api/notes/rotation').flush(existing);
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

    it('draws each marker on a dark background so its red reads on any terrain', async () => {
      await setup([note(1, 23.4, 0, 'dead center'), note(2, 23.4, 40, 'off to the side')]);
      const marked = [...pre.querySelectorAll<HTMLElement>('span')].filter((s) => s.textContent === MARKER);
      expect(marked.length).toBe(2);
      expect(marked.every((s) => s.style.backgroundColor !== '')).toBe(true);
      const plain = [...pre.querySelectorAll<HTMLElement>('span')].filter((s) => s.textContent !== MARKER);
      expect(plain.every((s) => s.style.backgroundColor === '')).toBe(true);
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
      http.expectOne('/api/notes/rotation').flush('nope', { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(el('pre').textContent.length).toBeGreaterThan(100);
      expect(el('.note-error')).toBeNull();
    });
  });
  describe('rotation', () => {
    // Each frame redraws the whole globe in jsdom, so a minute of spin takes a while.
    const slow = (name: string, fn: () => Promise<void>) => it(name, fn, 120_000);
    const ROTATION = '/api/notes/rotation';
    const SPIN = (2 * Math.PI) / 30;
    const TILT = (23.4 * Math.PI) / 180;
    const STEP = 100;
    let fixture: ComponentFixture<AsciiGlobe>;
    let http: HttpTestingController;
    let pre: HTMLPreElement;
    let now: number;
    let frames: FrameRequestCallback[] = [];
    let angle: number;
    let requests: { request: { params: { get: (k: string) => string | null } }; flush: (b: unknown, o?: object) => void }[];

    const note = (id: number, lat: number, lon: number): Note => ({
      id,
      lat,
      lon,
      text: `note ${id}`,
      created_at: '2026-01-01T00:00:00+00:00',
    });
    const markerCount = () => pre.textContent!.split(MARKER).length - 1;
    const facing = (n: Note, a: number) => {
      const lat = (n.lat * Math.PI) / 180;
      const lon = (n.lon * Math.PI) / 180 + a;
      return Math.sin(lat) * Math.sin(TILT) + Math.cos(lat) * Math.cos(lon) * Math.cos(TILT) > 0;
    };
    const fire = (type: string, init: PointerEventInit = {}) =>
      pre.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, buttons: 1, ...init }));
    /** Advance `ms` of fake time in frames, calling `each` after every frame. Collects any rotation requests made. */
    const run = (ms: number, each: () => void = () => {}) => {
      for (let t = 0; t < ms; t += STEP) {
        now += STEP;
        const pending = frames;
        frames = [];
        pending.forEach((cb) => cb(now));
        requests.push(...(http.match((r) => r.url === ROTATION) as unknown as typeof requests));
        each();
      }
    };
    /** Natural spin only: the angle the globe is at, if nobody touches it. */
    const spin = (ms: number, each: () => void = () => {}) =>
      run(ms, () => {
        angle += (STEP / 1000) * SPIN;
        each();
      });

    const setup = async () => {
      now = 1000;
      frames = [];
      angle = 0;
      requests = [];
      configure();
      fixture = TestBed.createComponent(AsciiGlobe);
      http = TestBed.inject(HttpTestingController);
      await fixture.whenStable();
      pre = fixture.nativeElement.querySelector('pre');
      pre.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect;
      fixture.nativeElement.querySelector('.stage').getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 700, height: 180 }) as DOMRect;
      requests.push(...(http.match((r) => r.url === ROTATION) as unknown as typeof requests));
    };
    const flushLoad = (notes: Note[]) => {
      requests.shift()!.flush(notes);
      fixture.detectChanges();
    };

    beforeEach(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
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
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    });

    slow('makes one request on load and shows its notes at once, even the ones in view', async () => {
      await setup();
      expect(requests.length).toBe(1);
      expect(requests[0].request.params.get('exclude')).toBeNull();
      flushLoad([note(1, 23.4, 0), note(2, 23.4, 180)]);
      expect(markerCount()).toBe(1);
    });

    slow('makes exactly one request per natural date-line crossing, over two full rotations', async () => {
      await setup();
      flushLoad([note(1, 0, 10), note(2, 0, 100), note(3, 0, -100)]);
      let asked = 0;
      // The date line passes the center at 15s and 45s. Answer each request as it comes.
      for (let t = 0; t < 60_000; t += STEP) {
        spin(STEP);
        while (requests.length) {
          asked++;
          expect(requests[0].request.params.get('exclude')).toBe(asked === 1 ? '1,2,3' : '4');
          requests.shift()!.flush(asked === 1 ? [note(4, 0, 50)] : [note(5, 0, 60)]);
        }
      }
      expect(asked).toBe(2);
    });

    slow('asks to skip the set that was just shown', async () => {
      await setup();
      flushLoad([note(1, 0, 10), note(2, 0, 100)]);
      spin(15_100);
      requests.shift()!.flush([note(8, 0, 50), note(9, 0, 60)]);
      spin(30_000);
      expect(requests[0].request.params.get('exclude')).toBe('8,9');
    });

    slow('does not ask when the date line is turned past by hand', async () => {
      await setup();
      flushLoad([note(1, 0, 10)]);
      // 150px is one radian: drag 3.5 radians, slowly, then let go and rest.
      fire('pointerdown', { clientX: 0 });
      for (let i = 1; i <= 35; i++) {
        run(160);
        fire('pointermove', { clientX: i * 15 });
      }
      run(800);
      fire('pointerup');
      run(4000);
      expect(requests.length).toBe(0);
      // And back again.
      fire('pointerdown', { clientX: 600 });
      for (let i = 1; i <= 35; i++) {
        run(160);
        fire('pointermove', { clientX: 600 - i * 15 });
      }
      fire('pointerup');
      run(800);
      expect(requests.length).toBe(0);
    });

    slow('does not ask while a flick coasts past the date line', async () => {
      await setup();
      flushLoad([note(1, 0, 10)]);
      fire('pointerdown', { clientX: 0 });
      for (let i = 1; i <= 5; i++) {
        run(16);
        fire('pointermove', { clientX: i * 100 });
      }
      fire('pointerup');
      // Coasts for several seconds at far above the natural speed, over many date-line crossings.
      run(4000);
      expect(requests.length).toBe(0);
    });

    slow('does not ask while the tab is hidden', async () => {
      await setup();
      flushLoad([note(1, 0, 10)]);
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      spin(20_000);
      expect(requests.length).toBe(0);
    });

    slow('does not ask while the globe is off screen', async () => {
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
          observe() {
            this.cb([{ isIntersecting: false }]);
          }
          disconnect() {}
        },
      );
      await setup();
      flushLoad([note(1, 0, 10)]);
      spin(20_000);
      expect(requests.length).toBe(0);
    });

    slow('does not ask with reduced motion, which has no auto-spin', async () => {
      vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
      await setup();
      flushLoad([note(1, 0, 10)]);
      spin(20_000);
      expect(requests.length).toBe(0);
    });

    slow('keeps the current set when a request fails, and tries again only at the next crossing', async () => {
      await setup();
      // Both are in view when the date line reaches the center, at 15s and again at 45s.
      flushLoad([note(1, 0, 180.5), note(2, 0, 170.5)]);
      expect(markerCount()).toBe(0);
      spin(15_100);
      expect(markerCount()).toBe(2);
      expect(requests.length).toBe(1);
      requests.shift()!.flush('nope', { status: 500, statusText: 'Server Error' });
      expect(markerCount()).toBe(2);
      // No retry before the next crossing.
      spin(14_000);
      expect(requests.length).toBe(0);
      spin(17_000);
      expect(requests.length).toBe(1);
      requests.shift()!.flush([note(3, 0, 20.5)]);
      // The old notes are in view again and have not been taken away; the new one is out of view.
      expect(markerCount()).toBe(2);
    });

    slow('makes no second request while one is still waiting', async () => {
      await setup();
      flushLoad([note(1, 0, 0)]);
      spin(15_100);
      expect(requests.length).toBe(1);
      // The first never answers; the next crossing (30s on) must not pile another on top.
      spin(30_000);
      expect(requests.length).toBe(1);
    });

    slow('changes the markers only as spots cross the edge, across a swap', async () => {
      await setup();
      // Longitudes with a half degree, so no spot sits exactly on the edge at a frame.
      const first = [note(1, 0, 100.5), note(2, 0, 150.5), note(3, 0, -150.5), note(4, 0, 0.5), note(5, 0, -60.5)];
      const second = [note(6, 0, -170.5), note(7, 0, 170.5), note(8, 0, 20.5), note(9, 0, 90.5), note(10, 0, -90.5)];
      flushLoad(first);
      spin(15_100);
      requests.shift()!.flush(second);
      const before = markerCount();
      spin(0);
      expect(markerCount()).toBe(before);

      // Every frame for two full turns: the count moves only when some spot of either set
      // crossed the edge in that frame, and by no more than the spots that crossed.
      let last = markerCount();
      let lastAngle = angle;
      const all = [...first, ...second];
      spin(60_000, () => {
        const crossed = all.filter((n) => facing(n, lastAngle) !== facing(n, angle)).length;
        const count = markerCount();
        expect(Math.abs(count - last), `angle ${angle} count ${count} last ${last}`).toBeLessThanOrEqual(crossed);
        last = count;
        lastAngle = angle;
      });
      // A full turn on, only the second set remains, and every one of its spots in view is marked.
      expect(markerCount()).toBe(second.filter((n) => facing(n, angle)).length);
    });

    slow('shows a new note in view only after its spot has gone out of view and come back', async () => {
      await setup();
      flushLoad([note(1, 0, 0)]);
      spin(15_100);
      // Angle is now just past pi, so the center of the view is lon 180: a note there is in view.
      requests.shift()!.flush([note(2, 0, 180)]);
      expect(markerCount()).toBe(0);
      let shownWhileFacingAfterArrival = false;
      let hidden = false;
      spin(30_000, () => {
        const isFacing = facing(note(2, 0, 180), angle);
        if (!isFacing) hidden = true;
        if (!hidden && markerCount() > 0) shownWhileFacingAfterArrival = true;
      });
      expect(shownWhileFacingAfterArrival).toBe(false);
      expect(hidden).toBe(true);
    });

    slow('never has more than 5 notes from the server, even if it sends more', async () => {
      await setup();
      flushLoad(Array.from({ length: 9 }, (_, i) => note(i + 1, 0, i * 5 - 20)));
      expect(markerCount()).toBe(5);
    });
  });
});
