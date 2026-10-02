import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AsciiGlobe, buildSpace, RESIZE_DEBOUNCE_MS, SPACE_FADE, SPACE_ROWS, spaceCols } from './ascii-globe';
import { CONSTELLATION_LINE_COLOR, CONSTELLATION_STAR_COLOR, css, SPACE_COLOR, STAR_COLOR } from './globe-palette';
import { MARKER, unproject } from './globe-renderer';
import { MAX_ANIMATED, RAMP, STAR_GLYPHS } from './space';
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

  /** The text of each of the space's three blocks, as lines. */
  const spaceBlocks = (space: HTMLElement) => {
    const block = (name: string) => space.querySelector<HTMLElement>(`.${name}`)!;
    return {
      top: block('fade-top'),
      solid: block('solid'),
      bottom: block('fade-bottom'),
      lines: (name: string) => block(name).textContent!.split('\n'),
    };
  };

  it('sizes the grid from the viewport width', () => {
    expect(spaceCols(1440, 7.2)).toBe(200);
    expect(spaceCols(1920, 7.2)).toBe(267);
    expect(spaceCols(390, 4.2)).toBe(93);
    // Never narrower than the globe.
    expect(spaceCols(100, 7.2)).toBe(61);
    expect(buildSpace(200).cols).toBe(200);
    expect(buildSpace(200).rows).toBe(SPACE_ROWS);
    expect(SPACE_ROWS).toBe(37 + 12 + 12);
  });

  it('draws the dark space once, static and hidden from screen readers', async () => {
    const fixture = TestBed.createComponent(AsciiGlobe);
    await fixture.whenStable();
    const space: HTMLElement = fixture.nativeElement.querySelector('.space');
    expect(space.getAttribute('aria-hidden')).toBe('true');
    const { lines } = spaceBlocks(space);
    const cols = spaceCols(0, 7);
    expect(lines('fade-top').length).toBe(SPACE_FADE.top);
    expect(lines('solid').length).toBe(37);
    expect(lines('fade-bottom').length).toBe(SPACE_FADE.bottom);
    for (const name of ['fade-top', 'solid', 'fade-bottom']) expect(lines(name).every((l) => l.length === cols)).toBe(true);
    const before = space.innerHTML;
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(space, { subtree: true, childList: true, attributes: true, characterData: true });
    // The globe spins on, but the space never changes.
    redrawGlobe(fixture);
    await new Promise((resolve) => setTimeout(resolve, 50));
    observer.disconnect();
    expect(changes.length).toBe(0);
    expect(space.innerHTML).toBe(before);
    expect(buildSpace(120).glyphs).toEqual(buildSpace(120).glyphs);
    expect(Array.from(buildSpace(120).levels)).toEqual(Array.from(buildSpace(120).levels));
  });

  it('draws the fades with ramp characters on tinted cells, and the interior as one solid block', async () => {
    const fixture = TestBed.createComponent(AsciiGlobe);
    await fixture.whenStable();
    const space: HTMLElement = fixture.nativeElement.querySelector('.space');
    const { top, solid, bottom, lines } = spaceBlocks(space);
    // The first and last rows are nearly all fade: ramp characters, mostly never blank.
    const ramp = (line: string) => [...line].filter((ch) => RAMP.includes(ch)).length / line.length;
    expect(ramp(lines('fade-top')[0])).toBeGreaterThan(0.5);
    expect(ramp(lines('fade-bottom')[SPACE_FADE.bottom - 1])).toBeGreaterThan(0.5);

    const probe = document.createElement('i');
    probe.style.backgroundColor = css(SPACE_COLOR);
    const spanBackgrounds = (block: HTMLElement) =>
      new Set([...block.querySelectorAll('span')].map((s) => (s as HTMLElement).style.backgroundColor));
    for (const block of [top, bottom]) {
      const backgrounds = spanBackgrounds(block);
      // Several tint steps between the page white (no background) and solid space.
      expect(backgrounds.has('')).toBe(true);
      expect(backgrounds.size).toBeGreaterThan(4);
    }
    // The interior is a single element with the space color, holding no cells.
    expect(solid.style.backgroundColor).toBe(probe.style.backgroundColor);
    expect(solid.querySelectorAll('*:not(span)').length).toBe(0);
    expect(solid.querySelectorAll('span').length).toBeLessThan(1000);
    expect(solid.textContent!.replace(/[\n ]/g, '').length).toBeGreaterThan(0);
  });

  it('stays within about 8,000 nodes at 1920px wide, and builds quickly', () => {
    const start = performance.now();
    const space = buildSpace(spaceCols(1920, 7.2));
    expect(performance.now() - start).toBeLessThan(30);
    // Fade rows are runs of spans, at most one per cell; the interior is one node.
    let nodes = 1;
    for (let r = 0; r < space.rows; r++) {
      if (r >= SPACE_FADE.top && r < space.rows - SPACE_FADE.bottom) continue;
      let last = -1;
      for (let c = 0; c < space.cols; c++) {
        const i = r * space.cols + c;
        const key = space.levels[i] >= 1 ? 6 : Math.min(5, Math.floor(space.levels[i] * 6));
        if (key !== last) nodes++;
        last = key;
      }
    }
    expect(nodes).toBeLessThan(8000);
  });

  it('rebuilds only after the width settles, and never while the globe spins', async () => {
    const fixture = TestBed.createComponent(AsciiGlobe);
    await fixture.whenStable();
    const space: HTMLElement = fixture.nativeElement.querySelector('.space');
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(space, { subtree: true, childList: true, attributes: true, characterData: true });
    vi.spyOn(fixture.componentInstance as unknown as { viewportWidth(): number }, 'viewportWidth').mockReturnValue(1000);
    // A burst of resizes is one rebuild, once the width holds still.
    for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, RESIZE_DEBOUNCE_MS / 2));
    expect(changes.length).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, RESIZE_DEBOUNCE_MS));
    observer.disconnect();
    expect(changes.length).toBeGreaterThan(0);
    expect(space.querySelector('.solid')!.textContent!.split('\n')[0].length).toBe(spaceCols(1000, 7));
    expect(RESIZE_DEBOUNCE_MS).toBeGreaterThanOrEqual(100);
  });

  it('leaves the page no wider than the viewport, and the band does not take clicks', async () => {
    const fixture = TestBed.createComponent(AsciiGlobe);
    await fixture.whenStable();
    const space: HTMLElement = fixture.nativeElement.querySelector('.space');
    const root = document.documentElement;
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    expect(space.style.width).toBe(`${root.clientWidth}px`);
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

  describe('space animation', () => {
    /** The component's stylesheet text, as Angular put it in the page. */
    const styleText = () =>
      Array.from(document.querySelectorAll('style'))
        .map((el) => el.textContent ?? '')
        .join('\n');

    /** The text between the braces that follow `start`. */
    const block = (css: string, start: number) => {
      let depth = 0;
      for (let i = css.indexOf('{', start); i < css.length; i++) {
        if (css[i] === '{') depth++;
        if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i);
      }
      return '';
    };

    it('animates only the character of a star, never its size or position', async () => {
      const fixture = TestBed.createComponent(AsciiGlobe);
      await fixture.whenStable();
      const css = styleText();
      const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => ({ name: m[1], at: m.index! }));
      expect(names.map((n) => n.name.replace(/^.*star-/, 'star-'))).toEqual(['star-twinkle']);
      const body = block(css, names[0].at);
      const props = [...body.matchAll(/([\w-]+)\s*:\s*['"]/g)].map((m) => m[1]);
      expect(props.length).toBeGreaterThan(0);
      for (const prop of props) expect(prop).toBe('content');
      expect(body).not.toMatch(/transform|scale|font-size/);
      // It steps through every glyph from faint to bright and back, and the glyphs are the ones in STAR_GLYPHS.
      // The stylesheet compiler may write a glyph as a CSS escape such as "\273b".
      const seen = [...body.matchAll(/content:\s*(['"])(?:\\([0-9a-f]+)|(.))\1/g)].map((m) => (m[2] ? String.fromCodePoint(parseInt(m[2], 16)) : m[3]));
      expect(new Set(seen)).toEqual(new Set(STAR_GLYPHS));
    });

    it('draws the stars and constellations as spans, with seeded durations, and keeps them under the animation cap', async () => {
      const fixture = TestBed.createComponent(AsciiGlobe);
      await fixture.whenStable();
      const space: HTMLElement = fixture.nativeElement.querySelector('.space');
      const moving = [...space.querySelectorAll<HTMLElement>('.twinkle')];
      expect(moving.length).toBeLessThanOrEqual(MAX_ANIMATED);
      for (const el of moving) {
        expect(el.style.getPropertyValue('--dur')).toMatch(/^\d+(\.\d+)?s$/);
        expect(el.style.getPropertyValue('--delay')).toMatch(/^\d+(\.\d+)?s$/);
        expect(STAR_GLYPHS).toContain(el.dataset['char']);
      }
      expect(getComputedStyle(space).pointerEvents).toBe('none');
      expect(space.querySelectorAll('*').length).toBeLessThan(8000);
    });

    it('draws constellations in colors dimmer than the stars', () => {
      const luminance = ([r, g, b]: readonly number[]) => {
        const lin = (v: number) => ((v / 255) ** 2.2);
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      };
      const contrast = (fg: readonly number[]) => (luminance(fg) + 0.05) / (luminance(SPACE_COLOR) + 0.05);
      expect(contrast(CONSTELLATION_LINE_COLOR)).toBeLessThan(contrast(CONSTELLATION_STAR_COLOR));
      expect(contrast(CONSTELLATION_STAR_COLOR)).toBeLessThan(contrast(STAR_COLOR));
    });

    it('stops every animation in the space under reduced motion, and the stars are still drawn', async () => {
      const fixture = TestBed.createComponent(AsciiGlobe);
      await fixture.whenStable();
      const css = styleText();
      const media = css.indexOf('@media (prefers-reduced-motion: reduce)');
      expect(media).toBeGreaterThan(-1);
      const rules = block(css, media);
      expect(rules).toMatch(/\.space[^{]*\*::before\s*\{\s*animation:\s*none\s*!important/);
      // Nothing is removed from the page: the stars are drawn either way.
      const space: HTMLElement = fixture.nativeElement.querySelector('.space');
      expect(space.querySelectorAll('.twinkle').length).toBeGreaterThan(0);
    });

    it('pauses when the globe is off screen and resumes when it is back', async () => {
      let notify: IntersectionObserverCallback = () => {};
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(cb: IntersectionObserverCallback) {
            notify = cb;
          }
          observe() {}
          disconnect() {}
        },
      );
      const fixture = TestBed.createComponent(AsciiGlobe);
      await fixture.whenStable();
      const space: HTMLElement = fixture.nativeElement.querySelector('.space');
      expect(space.classList.contains('paused')).toBe(false);
      notify([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
      expect(space.classList.contains('paused')).toBe(true);
      notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      expect(space.classList.contains('paused')).toBe(false);
      vi.unstubAllGlobals();
    });

    it('has a rule that pauses every animation in the space while paused', async () => {
      const fixture = TestBed.createComponent(AsciiGlobe);
      await fixture.whenStable();
      const css = styleText();
      const at = css.search(/\.space\.paused[^{]*\*::before\s*\{/);
      expect(at).toBeGreaterThan(-1);
      expect(block(css, at)).toMatch(/animation-play-state:\s*paused/);
    });
  });
});
