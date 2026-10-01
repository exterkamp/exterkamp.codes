import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { cellRgb, css, MARKER_CELL, NO_CELL, SPACE_COLOR, STAR_COLOR } from './globe-palette';
import { createGlobe, markerCell, project, Spot, unproject } from './globe-renderer';
import { assignSlots, cellCenter, advancePanels, layoutPanels, nearestEdgePoint, nearestInZone, PANEL_COUNT, PANEL_GAP, pinPoint, PanelState, sameSlots, Slots } from './note-panels';
import { MAX_NOTE_LENGTH, Note, NotesService } from './notes.service';
import { createSpace, Space } from './space';

const COLS = 61;
// Monospace glyphs are about 0.6 as wide as they are tall; this keeps the globe round.
const ROWS = Math.round(COLS * 0.6);
/** Dark space around the globe, in character cells. The top and sides dither into the white page; the bottom is a hard edge. */
export const SPACE_PAD = { top: 6, side: 8, bottom: 2 };
/** Cells over which the dark space dithers from white to solid. */
export const SPACE_FADE = { top: 6, side: 8 };
export const SPACE_COLS = COLS + 2 * SPACE_PAD.side;
export const SPACE_ROWS = ROWS + SPACE_PAD.top + SPACE_PAD.bottom;
/** Fixed seed and density for the stars, so they are the same on every frame and every visit. */
const STAR_SEED = 20;
const STAR_CHANCE = 0.035;

export function buildSpace(): Space {
  return createSpace({
    cols: SPACE_COLS,
    rows: SPACE_ROWS,
    fadeTop: SPACE_FADE.top,
    fadeSide: SPACE_FADE.side,
    seed: STAR_SEED,
    starChance: STAR_CHANCE,
    clear: { col: SPACE_COLS / 2, row: SPACE_PAD.top + ROWS / 2, rx: COLS / 2, ry: ROWS / 2 },
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

  protected readonly maxLength = MAX_NOTE_LENGTH;
  private notes: Note[] = [];
  private redraw = () => {};
  private nextTempId = -1;
  /** Where each shown panel is now (eased toward its target), and which spot it took, by note id. */
  private panelPositions = new Map<number, PanelState>();
  private lastPanelTime = 0;

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
    this.setNotes([...this.notes, temp]);
    this.notesService.add({ ...spot, text }).subscribe({
      next: (saved) => this.setNotes(this.notes.map((n) => (n.id === temp.id ? saved : n))),
      error: (err: HttpErrorResponse) => {
        this.setNotes(this.notes.filter((n) => n.id !== temp.id));
        this.error.set(
          err.status === 429 ? 'Too many notes, try again in a bit.' : "Couldn't save that note, sorry.",
        );
      },
    });
  }

  /** Picks the notes for the panels, then sets each panel beside its marker with a line between them. */
  private updatePanels(angle: number) {
    const slots = assignSlots(this.activeSlots, nearestInZone(this.notes, angle, TILT, this.activeSlots));
    if (!sameSlots(slots, this.activeSlots)) {
      this.activeSlots = slots;
      this.slots.set(slots);
      this.shown.update((shown) => shown.map((n, i) => slots[i] ?? n));
    }

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
      .sort((a, b) => Number(b.active) - Number(a.active) || Number(this.panelPositions.has(b.id)) - Number(this.panelPositions.has(a.id)));
    // Panels are placed by where the dot truly is, not the character cell it is drawn in, whose
    // position steps a whole row at a time. Only the line ends on the drawn cell.
    const pins = items.map((item) => pinPoint(project(item.note!, angle, TILT), box));
    const targets = layoutPanels(
      pins,
      items.map((item) => ({ width: panels[item.i].offsetWidth, height: panels[item.i].offsetHeight })),
      { width: stageRect.width, height: stageRect.height },
      PANEL_GAP,
      { x: box.left + box.width / 2, y: box.top + box.height / 2, r: Math.min(box.width, box.height) / 2 },
      items.map((item) => this.panelPositions.get(item.id)?.key),
    );
    const now = performance.now();
    const dt = Math.min(now - this.lastPanelTime, 100) / 1000;
    this.lastPanelTime = now;
    // With reduced motion, panels stay exactly on their targets instead of easing.
    const snap = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
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

  /** Draws the dark space once. It is static: the same grid and the same stars on every frame. */
  private drawSpace(el: HTMLElement) {
    const space = buildSpace();
    const fragment = document.createDocumentFragment();
    for (let r = 0; r < space.rows; r++) {
      let run = '';
      let runDark = false;
      const flush = () => {
        if (!run) return;
        if (runDark) {
          const span = document.createElement('span');
          span.style.backgroundColor = css(SPACE_COLOR);
          span.style.color = css(STAR_COLOR);
          span.textContent = run;
          fragment.appendChild(span);
        } else {
          fragment.appendChild(document.createTextNode(run));
        }
        run = '';
      };
      for (let c = 0; c < space.cols; c++) {
        const i = r * space.cols + c;
        const isDark = space.dark[i] === 1;
        if (isDark !== runDark) {
          flush();
          runDark = isDark;
        }
        run += isDark ? space.glyphs[i] : ' ';
      }
      flush();
      if (r < space.rows - 1) fragment.appendChild(document.createTextNode('\n'));
    }
    el.replaceChildren(fragment);
  }

  private setNotes(notes: Note[]) {
    this.notes = notes;
    this.redraw();
  }

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.notesService.list().subscribe({
      next: (notes) => this.setNotes([...notes, ...this.notes.filter((n) => n.id < 0)]),
      // The globe works fine without notes.
      error: () => {},
    });

    afterNextRender(() => {
      const el = this.pre().nativeElement;
      this.drawSpace(this.spaceEl().nativeElement);
      const render = createGlobe({ cols: COLS, rows: ROWS, tilt: TILT, light: LIGHT });
      // One span per cell, made once. A frame only touches the cells whose character or color changed.
      const cells = this.buildCells(el);
      const shownChars: string[] = [];
      const shownCodes = new Uint8Array(COLS * ROWS).fill(NO_CELL);
      const colorOf = new Map<number, string>();
      const draw = () => {
        const frame = render(angle, this.notes);
        for (let i = 0; i < cells.length; i++) {
          const char = frame.text[i + Math.floor(i / COLS)];
          const code = frame.colors[i];
          if (shownChars[i] !== char) {
            cells[i].textContent = char;
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
            cells[i].style.backgroundColor = code === MARKER_CELL ? css(SPACE_COLOR) : '';
            shownCodes[i] = code;
          }
        }
        this.updatePanels(angle);
      };
      this.redraw = draw;

      let angle = 0;
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
