import { Note } from './notes.service';

/** Most notes the server sends for one rotation. Any more are ignored. */
export const MAX_SET = 5;
/** Most ids sent to the server as "skip these". */
export const MAX_EXCLUDE = 10;
/** Shortest time (ms) between rotation requests, in case something goes wrong. */
export const MIN_REQUEST_GAP_MS = 10_000;
/** A flick has worn off once the globe's speed is this close (radians per second) to the natural speed. */
export const COAST_EPSILON = 0.02;

interface Entry {
  note: Note;
  /** Whether the note may be drawn. A note whose spot is in view when it arrives waits until the spot has been out of view. */
  armed: boolean;
  /** Not in the current set any more, but kept until its spot rotates out of view. */
  leaving: boolean;
  /** Added by this visitor: shown right away, and swapped out like the rest at the next set. */
  own: boolean;
}

/**
 * The notes on the globe: the current set from the server plus the visitor's own. A note only
 * appears or disappears in the frame its spot crosses the edge of the globe, so nothing pops.
 * `facing` says whether a note's spot is on the visible side right now.
 */
export class NoteRotation {
  private entries: Entry[] = [];

  /** Notes to draw as markers. */
  markers(): Note[] {
    return this.entries.filter((e) => e.armed).map((e) => e.note);
  }

  /** Notes in the current set that may get a panel: not on their way out. */
  current(): Note[] {
    return this.entries.filter((e) => e.armed && !e.leaving).map((e) => e.note);
  }

  /** Ids of the server's notes in the current set, to ask for a different one next. */
  currentIds(): number[] {
    return this.entries.filter((e) => !e.own && !e.leaving && e.note.id > 0).map((e) => e.note.id).slice(0, MAX_EXCLUDE);
  }

  /**
   * Swaps in a new set. Old notes still in view stay until they rotate out, and new notes whose
   * spot is in view wait until it has rotated out and back in (unless `first`: nothing to pop yet).
   */
  setServerNotes(incoming: readonly Note[], facing: (n: Note) => boolean, first = false) {
    const next = incoming.slice(0, MAX_SET);
    const ids = new Set(next.map((n) => n.id));
    const kept: Entry[] = [];
    for (const e of this.entries) {
      if (ids.has(e.note.id)) {
        kept.push({ ...e, leaving: false, own: false });
      } else if (e.armed && facing(e.note)) {
        kept.push({ ...e, leaving: true });
      }
    }
    for (const note of next) {
      if (!kept.some((e) => e.note.id === note.id)) {
        kept.push({ note, armed: first || !facing(note), leaving: false, own: false });
      }
    }
    this.entries = kept;
  }

  addOwn(note: Note) {
    this.entries.push({ note, armed: true, leaving: false, own: true });
  }

  /** Swaps a note for its saved copy (the server gave it an id), keeping its state. */
  replace(id: number, saved: Note) {
    const existing = this.entries.find((e) => e.note.id === saved.id);
    this.entries = this.entries.flatMap((e) => (e.note.id !== id ? [e] : existing ? [] : [{ ...e, note: saved }]));
  }

  remove(id: number) {
    this.entries = this.entries.filter((e) => e.note.id !== id);
  }

  /** Call every frame, with the globe at its new angle. */
  update(facing: (n: Note) => boolean) {
    this.entries = this.entries.flatMap((e) => {
      const f = facing(e.note);
      if (e.leaving && !f) return [];
      return !e.armed && !f ? [{ ...e, armed: true }] : [e];
    });
  }
}

/**
 * Notices when the globe's own spin carries the date line (the 180 degree meridian) past the
 * center of the view. Only natural spin counts: turning by hand never moves it.
 */
export class DateLineWatcher {
  private natural = 0;

  /** Adds a natural turn of `step` radians. True if that carried the date line past the center. */
  advance(step: number): boolean {
    const before = Math.floor((this.natural + Math.PI) / (2 * Math.PI));
    this.natural += step;
    return Math.floor((this.natural + Math.PI) / (2 * Math.PI)) > before;
  }
}
