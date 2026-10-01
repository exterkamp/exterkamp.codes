import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { cellRgb, css, inkColor, MARKER_CELL, NO_CELL, SPACE_COLOR, STAR_COLOR, TINT_STEPS, tintColor, tintStep } from './globe-palette';
import { createGlobe, markerCell, project, Spot, unproject } from './globe-renderer';
import { assignSlots, cellCenter, advancePanels, layoutLanes, LANES, nearestEdgePoint, nearestInZone, PANEL_COUNT, PANEL_GAP, pinPoint, PanelState, placementRank, sameSlots, Slots } from './note-panels';
import { MAX_NOTE_LENGTH, Note, NotesService } from './notes.service';
import { COAST_EPSILON, DateLineWatcher, MIN_REQUEST_GAP_MS, NoteRotation } from './note-rotation';
import { createSpace, rampChar, Space } from './space';

const COLS = 61;
// Monospace glyphs are about 0.6 as wide as they are tall; this keeps the globe round.
const ROWS = Math.round(COLS * 0.6);
/** Rows of dark space above and below the globe. Each edge fades over its own rows: from the white page at the top, back to it at the bottom. */
export const SPACE_FADE = { top: 12, bottom: 12 };
export const SPACE_ROWS = ROWS + SPACE_FADE.top + SPACE_FADE.bottom;
/** Fixed seed and density for the stars, so they are the same on every frame and every visit. */
const STAR_SEED = 20;
const STAR_CHANCE = 0.035;
/** How long (ms) the window width must hold still before the space is rebuilt for it. */
export const RESIZE_DEBOUNCE_MS = 150;

/** How many character cells of the given width cover the viewport (one more than fits is fine: the band clips it). */
export function spaceCols(viewportWidth: number, charWidth: number): number {
  return Math.max(COLS, Math.ceil(viewportWidth / charWidth));
}

/** The space for a band `cols` cells wide, with the globe in the middle of it. */
export function buildSpace(cols: number): Space {
  return createSpace({
    cols,
    rows: SPACE_ROWS,
    fadeTop: SPACE_FADE.top,
    fadeBottom: SPACE_FADE.bottom,
    seed: STAR_SEED,
    starChance: STAR_CHANCE,
    centerCol: Math.floor(cols / 2),
    clear: { col: cols / 2, row: SPACE_FADE.top + ROWS / 2, rx: COLS / 2, ry: ROWS / 2 },
  });
}

const TILT = (23.4 * Math.PI) / 180;
const LIGHT = [-0.5, 0.4, 0.8] as const;
/** Radians per second: one full turn every ~30s. */
const SPIN_SPEED = (2 * Math.PI) / 30;
/** Seconds for a flick's extra speed to fall by a factor of e on the way back to SPIN_SPEED. */
const MOMENTUM_DECAY = 1;
/** Seconds over which drag speed is smoothed; also how long a pause before release kills a flick. */
const VELOCITY_SMOOTHING = 0.1;
/** Cap on flick speed (radians per second) so a jumpy pointer can't make it unreadably fast. */
const MAX_SPEED = 4 * Math.PI;
/** Pixels the pointer may wander during a press and still count as a click rather than a drag. */
const CLICK_SLOP = 5;
/** A press held longer than this (ms) is a drag, or a hold, not a click. */
const CLICK_MAX_MS = 500;
/** How long (ms) a note whose panel had no clear spot waits before it is tried again. */
const BLOCKED_RETRY_MS = 400;

@Component({
  selector: 'app-ascii-globe',
  templateUrl: './ascii-globe.html',
  styleUrl: './ascii-globe.scss',
})
export class AsciiGlobe {
  private readonly pre = viewChild.required<ElementRef<HTMLPreElement>>('globe');
  private readonly spaceEl = viewChild.required<ElementRef<HTMLElement>>('space');
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly noteInput = viewChild<ElementRef<HTMLInputElement>>('noteInput');
  private readonly notesService = inject(NotesService);
  private readonly injector = inject(Injector);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private spaceCols = 0;
  private spaceNodes: Node[] = [];

  protected readonly maxLength = MAX_NOTE_LENGTH;
  /** The notes on the globe: this rotation's set from the server, plus the visitor's own. */
  private readonly rotation = new NoteRotation();
  /** Whether a note's spot is on the visible side at the globe's current angle. */
  private facing = (_note: Note) => false;
  private readonly dateLine = new DateLineWatcher();
  private requestPending = false;
  private lastRequest = -Infinity;
  private loaded = false;
  private redraw = () => {};
  private nextTempId = -1;
  /** Where each shown panel is now (eased toward its target), and which spot it took, by note id. */
  private panelPositions = new Map<number, PanelState>();
  private lastPanelTime = 0;
  /** Notes whose panel had no clear spot, and when (ms) they may be tried again, so they don't flicker on and off. */
  private blockedUntil = new Map<number, number>();

  /** Where the visitor clicked, while the note form is open. */
  protected readonly pending = signal<Spot | null>(null);
  private activeSlots: Slots = Array(PANEL_COUNT).fill(null);
  /** The note in each panel slot, or null when the slot is empty (and fading out). */
  protected readonly slots = signal<Slots>(this.activeSlots);
  /** The last note each slot held, so a panel keeps its text while it fades out. */
  protected readonly shown = signal<Slots>(this.activeSlots);
  protected readonly error = signal('');

  protected cancel() {
    this.pending.set(null);
  }

  protected save(text: string) {
    const spot = this.pending();
    text = text.trim();
    if (!spot || !text) return;
    this.pending.set(null);
    this.error.set('');

    // Show it right away; the server's copy replaces it once saved.
    const temp: Note = { id: this.nextTempId--, ...spot, text, created_at: new Date().toISOString() };
    this.rotation.addOwn(temp);
    this.redraw();
    this.notesService.add({ ...spot, text }).subscribe({
      next: (saved) => {
        this.rotation.replace(temp.id, saved);
        this.redraw();
      },
      error: (err: HttpErrorResponse) => {
        this.rotation.remove(temp.id);
        this.redraw();
        this.error.set(
          err.status === 429 ? 'Too many notes, try again in a bit.' : "Couldn't save that note, sorry.",
        );
      },
    });
  }

  private setSlots(slots: Slots) {
    if (sameSlots(slots, this.activeSlots)) return;
    this.activeSlots = slots;
    this.slots.set(slots);
    this.shown.update((shown) => shown.map((n, i) => slots[i] ?? n));
    // Render now, so a slot that took a new note has the new text (and size) before panels are placed, not a frame later.
    this.changeDetector.detectChanges();
  }

  /** Picks the notes for the panels, then sets each panel beside its marker with a line between them. */
  private updatePanels(angle: number) {
    const now = performance.now();
    const candidates = this.rotation.current().filter((n) => (this.blockedUntil.get(n.id) ?? 0) <= now);
    this.setSlots(assignSlots(this.activeSlots, nearestInZone(candidates, angle, TILT, this.activeSlots)));
    const slots = this.activeSlots;

    const stage = this.stage().nativeElement;
    const stageRect = stage.getBoundingClientRect();
    const globeRect = this.pre().nativeElement.getBoundingClientRect();
    const box = {
      left: globeRect.left - stageRect.left,
      top: globeRect.top - stageRect.top,
      width: globeRect.width,
      height: globeRect.height,
    };
    const panels = stage.querySelectorAll<HTMLElement>('.panel');
    const links = stage.querySelectorAll<SVGGElement>('.link');
    // Active panels first, so a fading one never pushes a live one aside, and panels already
    // showing before newcomers, so a newcomer fits around them instead of shoving them. Panels
    // fading out keep following their dot until they are gone.
    const items = this.shown()
      .map((note, i) => ({ i, note, active: !!slots[i], end: note && markerCell(note, angle, TILT, COLS, ROWS) }))
      .flatMap((item) => (item.end && item.note ? [{ ...item, id: item.note.id, end: cellCenter(item.end, COLS, ROWS, box) }] : []))
      .sort((a, b) => Number(b.active) - Number(a.active) || placementRank(this.panelPositions, a.id) - placementRank(this.panelPositions, b.id));
    // Panels are placed by where the dot truly is, not the character cell it is drawn in, whose
    // position steps a whole row at a time. Only the line ends on the drawn cell.
    const pins = items.map((item) => pinPoint(project(item.note!, angle, TILT), box));
    const laneTops = LANES.map((lane) => box.top + lane.top * box.height);
    const targets = layoutLanes(
      items.map((item, n) => ({ pin: pins[n], size: { width: panels[item.i].offsetWidth, height: panels[item.i].offsetHeight }, lat: item.note!.lat })),
      laneTops,
      { width: stageRect.width },
      items.map((item) => this.panelPositions.get(item.id)),
      PANEL_GAP,
      now / 1000,
    );
    const dt = Math.min(now - this.lastPanelTime, 100) / 1000;
    this.lastPanelTime = now;
    // With reduced motion, panels stay exactly on their targets instead of easing.
    const snap = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // A panel with no clear spot stops being shown, and is not tried again for a moment.
    const blocked = items.filter((item, n) => item.active && targets[n].blocked);
    if (blocked.length) {
      blocked.forEach((item) => this.blockedUntil.set(item.id, now + BLOCKED_RETRY_MS));
      this.setSlots(this.activeSlots.map((n) => (n && blocked.some((b) => b.id === n.id) ? null : n)));
    }
    this.panelPositions = advancePanels(this.panelPositions, items.map((item) => item.id), targets, dt, snap);
    const rects = items.map((item) => this.panelPositions.get(item.id)!.rect);
    items.forEach(({ i, end }, n) => {
      const rect = rects[n];
      const start = nearestEdgePoint(rect, end);
      panels[i].style.transform = `translate(${rect.left}px, ${rect.top}px)`;
      const [line, dot] = [links[i].firstElementChild!, links[i].lastElementChild!];
      line.setAttribute('x1', String(start.x));
      line.setAttribute('y1', String(start.y));
      line.setAttribute('x2', String(end.x));
      line.setAttribute('y2', String(end.y));
      dot.setAttribute('cx', String(end.x));
      dot.setAttribute('cy', String(end.y));
    });
  }

  /** Fills the globe element with a span for each cell, and a newline after each row but the last. */
  private buildCells(el: HTMLElement): HTMLSpanElement[] {
    const cells: HTMLSpanElement[] = [];
    const fragment = document.createDocumentFragment();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('span');
        cell.textContent = ' ';
        cells.push(cell);
        fragment.appendChild(cell);
      }
      if (r < ROWS - 1) fragment.appendChild(document.createTextNode('\n'));
    }
    el.replaceChildren(fragment);
    return cells;
  }

  /** The width the band should cover: the page, without a vertical scrollbar. */
  protected viewportWidth(): number {
    return document.documentElement.clientWidth;
  }

  /**
   * Draws the dark space as a band as wide as the page. It is static: the same grain and stars on every frame, so it
   * is only rebuilt when the page width changes. The top and bottom fades are spans per run of cells; the solid middle
   * is one element with a CSS background, holding only the stars.
   */
  private drawSpace(el: HTMLElement) {
    const width = this.viewportWidth();
    // The stage is centered, so the band reaches the page's left edge by stepping back by the stage's own offset.
    el.style.left = `${-el.parentElement!.getBoundingClientRect().left}px`;
    el.style.width = `${width}px`;
    const probe = document.createElement('span');
    probe.textContent = 'M'.repeat(100);
    el.replaceChildren(probe);
    const charWidth = probe.getBoundingClientRect().width / 100;
    const cols = spaceCols(width, charWidth || 7);
    if (cols === this.spaceCols) {
      el.replaceChildren(...this.spaceNodes);
      return;
    }
    this.spaceCols = cols;
    const space = buildSpace(cols);
    const styles = Array.from({ length: TINT_STEPS }, (_, step) => ({
      background: step === 0 ? '' : css(tintColor(step)),
      color: css(step === TINT_STEPS - 1 ? STAR_COLOR : inkColor(step)),
    }));
    const fade = (from: number, to: number, className: string) => {
      const block = document.createElement('div');
      block.className = className;
      for (let r = from; r < to; r++) {
        // Neighboring cells on one tint step share a span.
        let run = '';
        let runStep = 0;
        const flush = () => {
          if (!run) return;
          const span = document.createElement('span');
          span.style.backgroundColor = styles[runStep].background;
          span.style.color = styles[runStep].color;
          span.textContent = run;
          block.appendChild(span);
          run = '';
        };
        for (let c = 0; c < space.cols; c++) {
          const i = r * space.cols + c;
          const level = space.levels[i];
          const step = tintStep(level);
          if (step !== runStep) {
            flush();
            runStep = step;
          }
          run += level >= 1 ? space.glyphs[i] : rampChar(level);
        }
        flush();
        if (r < to - 1) block.appendChild(document.createTextNode('\n'));
      }
      return block;
    };
    const solid = document.createElement('div');
    solid.className = 'solid';
    solid.style.backgroundColor = styles[TINT_STEPS - 1].background;
    solid.style.color = styles[TINT_STEPS - 1].color;
    const lines: string[] = [];
    for (let r = SPACE_FADE.top; r < space.rows - SPACE_FADE.bottom; r++) {
      lines.push(space.glyphs.slice(r * space.cols, (r + 1) * space.cols).join(''));
    }
    solid.textContent = lines.join('\n');
    this.spaceNodes = [fade(0, SPACE_FADE.top, 'fade-top'), solid, fade(space.rows - SPACE_FADE.bottom, space.rows, 'fade-bottom')];
    el.replaceChildren(...this.spaceNodes);
  }

  /**
   * Asks for the next set of notes. A slow or failed request changes nothing and is not retried:
   * the next date-line crossing asks again.
   */
  private requestSet() {
    const now = performance.now();
    if (this.requestPending || now - this.lastRequest < MIN_REQUEST_GAP_MS) return;
    this.requestPending = true;
    this.lastRequest = now;
    this.notesService
      .rotation(this.rotation.currentIds())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (notes) => {
          this.requestPending = false;
          this.rotation.setServerNotes(notes, this.facing, !this.loaded);
          this.loaded = true;
          this.redraw();
        },
        // The globe works fine without notes.
        error: () => {
          this.requestPending = false;
        },
      });
  }

  constructor() {
    const destroyRef = this.destroyRef;
    this.requestSet();

    afterNextRender(() => {
      const el = this.pre().nativeElement;
      this.drawSpace(this.spaceEl().nativeElement);
      // Only a settled width rebuilds the space, never an animation frame.
      let resizeTimer = 0;
      const onResize = () => {
        clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => this.drawSpace(this.spaceEl().nativeElement), RESIZE_DEBOUNCE_MS);
      };
      window.addEventListener('resize', onResize);
      destroyRef.onDestroy(() => {
        clearTimeout(resizeTimer);
        window.removeEventListener('resize', onResize);
      });
      const render = createGlobe({ cols: COLS, rows: ROWS, tilt: TILT, light: LIGHT });
      // One span per cell, made once. A frame only touches the cells whose character or color changed.
      const cells = this.buildCells(el);
      // Setting a text node's data is much cheaper than replacing a span's children.
      const texts = cells.map((cell) => cell.firstChild as Text);
      const shownChars = new Uint8Array(COLS * ROWS);
      const shownCodes = new Uint8Array(COLS * ROWS).fill(NO_CELL);
      const colorOf = new Map<number, string>();
      const draw = () => {
        // A note appears or goes only as its spot crosses the globe's edge.
        this.rotation.update(this.facing);
        const frame = render(angle, this.rotation.markers());
        for (let i = 0; i < cells.length; i++) {
          const char = frame.chars[i + Math.floor(i / COLS)];
          const code = frame.colors[i];
          if (shownChars[i] !== char) {
            texts[i].data = String.fromCharCode(char);
            shownChars[i] = char;
          }
          if (shownCodes[i] !== code) {
            let color = colorOf.get(code);
            if (color === undefined) {
              const rgb = cellRgb(code);
              color = rgb ? css(rgb) : '';
              colorOf.set(code, color);
            }
            cells[i].style.color = color;
            // Only markers have a background, so only touch it when a cell becomes or stops being one.
            if (code === MARKER_CELL) cells[i].style.backgroundColor = css(SPACE_COLOR);
            else if (shownCodes[i] === MARKER_CELL) cells[i].style.backgroundColor = '';
            shownCodes[i] = code;
          }
        }
        this.updatePanels(angle);
      };
      this.redraw = draw;

      let angle = 0;
      this.facing = (note) => project(note, angle, TILT).z > 0;
      let dragging = false;
      let dragPointer: number | undefined;
      let dragX = 0;
      let dragRadius = 1;
      let dragTime = 0;
      let downX = 0;
      let downY = 0;
      let downTime = 0;
      let moved = false;
      // Radians per second. Smoothed from the pointer while dragging; after release it
      // decays back toward SPIN_SPEED so a flick coasts instead of snapping back.
      let velocity = SPIN_SPEED;
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
        dragTime = performance.now();
        downX = e.clientX;
        downY = e.clientY;
        downTime = dragTime;
        moved = false;
        velocity = 0;
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
        const now = performance.now();
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_SLOP) moved = true;
        const delta = (e.clientX - dragX) / dragRadius;
        angle += delta;
        const dt = (now - dragTime) / 1000;
        if (dt > 0) {
          const alpha = 1 - Math.exp(-dt / VELOCITY_SMOOTHING);
          velocity += (delta / dt - velocity) * alpha;
          velocity = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, velocity));
          dragTime = now;
        }
        dragX = e.clientX;
        draw();
      };
      const endDrag = () => {
        // Holding still before letting go is not a flick.
        if (dragging && performance.now() - dragTime > VELOCITY_SMOOTHING * 1000) velocity = 0;
        dragging = false;
        dragPointer = undefined;
        el.classList.remove('dragging');
      };
      // A press that barely moved is a click: open the note form for the spot under it.
      const onUp = (e: PointerEvent) => {
        if (dragging && e.pointerId === dragPointer && !moved && performance.now() - downTime <= CLICK_MAX_MS) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = 1 - ((e.clientY - rect.top) / rect.height) * 2;
            const spot = unproject(x, y, angle, TILT);
            if (spot) {
              this.error.set('');
              this.pending.set(spot);
              afterNextRender(() => this.noteInput()?.nativeElement.focus(), { injector: this.injector });
            }
          }
        }
        onEnd(e);
      };
      const onEnd = (e: PointerEvent) => {
        if (e.pointerId === dragPointer) endDrag();
      };

      const listeners: [EventTarget, string, EventListener][] = [
        [el, 'pointerdown', onDown as EventListener],
        [el, 'pointermove', onMove as EventListener],
        // Pointer capture normally routes these to `el`, but listen on window too in
        // case capture failed or was released.
        [window, 'pointerup', onUp as EventListener],
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
          velocity = SPIN_SPEED + (velocity - SPIN_SPEED) * Math.exp(-dt / MOMENTUM_DECAY);
          angle += dt * velocity;
          // Only the globe's own spin, not a drag or a flick's coast, counts toward a new set.
          const natural = Math.abs(velocity - SPIN_SPEED) < COAST_EPSILON;
          if (natural && !document.hidden && this.dateLine.advance(dt * SPIN_SPEED)) this.requestSet();
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
