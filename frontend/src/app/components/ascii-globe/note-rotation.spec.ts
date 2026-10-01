import { describe, expect, it } from 'vitest';
import { DateLineWatcher, MAX_EXCLUDE, NoteRotation } from './note-rotation';
import { Note } from './notes.service';

const note = (id: number): Note => ({ id, lat: 0, lon: id, text: `n${id}`, created_at: '' });
const ids = (notes: Note[]) => notes.map((n) => n.id);

describe('DateLineWatcher', () => {
  it('fires once per turn of natural spin, first when the date line reaches the center', () => {
    const w = new DateLineWatcher();
    const step = (2 * Math.PI) / 3000;
    const crossings: number[] = [];
    for (let i = 1; i <= 6000; i++) if (w.advance(step)) crossings.push(i);
    expect(crossings.length).toBe(2);
    // Half a turn in, then a full turn later (give or take a step of rounding).
    expect(crossings[0]).toBeGreaterThanOrEqual(1500);
    expect(crossings[0]).toBeLessThanOrEqual(1501);
    expect(crossings[1] - crossings[0]).toBe(3000);
  });

  it('counts only what it is told, so turning by hand never fires it', () => {
    const w = new DateLineWatcher();
    expect(w.advance(0)).toBe(false);
    expect(w.advance(1)).toBe(false);
  });
});

describe('NoteRotation', () => {
  const never = () => false;
  const always = () => true;

  it('shows the first set at once, in view or not', () => {
    const r = new NoteRotation();
    r.setServerNotes([note(1), note(2)], always, true);
    expect(ids(r.markers())).toEqual([1, 2]);
    expect(ids(r.current())).toEqual([1, 2]);
  });

  it('keeps old notes in view until they rotate out, and holds new ones in view until they have been out', () => {
    const r = new NoteRotation();
    const inView = new Set([1, 2, 4]);
    const facing = (n: Note) => inView.has(n.id);
    r.setServerNotes([note(1), note(2), note(3)], facing, true);
    r.setServerNotes([note(4), note(5)], facing);
    // 1 and 2 are in view: still drawn, but not in the current set. 3 was out of view: gone.
    // 4 is in view: waiting. 5 is out of view: ready for its entrance.
    expect(ids(r.markers())).toEqual([1, 2, 5]);
    expect(ids(r.current())).toEqual([5]);

    inView.delete(1);
    r.update(facing);
    expect(ids(r.markers())).toEqual([2, 5]);
    inView.add(5);
    r.update(facing);
    expect(ids(r.markers())).toEqual([2, 5]);

    inView.delete(4);
    r.update(facing);
    // 4 is armed now but out of view, so it is drawn only as it comes back in.
    expect(ids(r.markers())).toEqual([2, 4, 5]);
    expect(ids(r.current())).toEqual([4, 5]);
  });

  it('keeps a note that is in both sets as it was', () => {
    const r = new NoteRotation();
    r.setServerNotes([note(1)], always, true);
    r.setServerNotes([note(1), note(2)], always);
    expect(ids(r.markers())).toEqual([1]);
    expect(ids(r.current())).toEqual([1]);
  });

  it('ignores all but the first 5 notes of a set', () => {
    const r = new NoteRotation();
    r.setServerNotes([1, 2, 3, 4, 5, 6, 7].map(note), never, true);
    expect(ids(r.markers())).toEqual([1, 2, 3, 4, 5]);
  });

  it('shows the visitor\'s own note at once, and drops it at the next swap like the rest', () => {
    const r = new NoteRotation();
    r.setServerNotes([note(1)], never, true);
    r.addOwn(note(-1));
    expect(ids(r.markers())).toEqual([1, -1]);
    expect(r.currentIds()).toEqual([1]);

    r.replace(-1, note(50));
    expect(ids(r.markers())).toEqual([1, 50]);
    expect(r.currentIds()).toEqual([1]);

    let inView = true;
    r.setServerNotes([note(2)], () => inView);
    // Everything old is in view, so it stays until it rotates out; 2 waits for its entrance.
    expect(ids(r.markers())).toEqual([1, 50]);
    expect(ids(r.current())).toEqual([]);
    inView = false;
    r.update(() => inView);
    expect(ids(r.markers())).toEqual([2]);
  });

  it('forgets a note taken back, and does not double up if the server also sends the saved copy', () => {
    const r = new NoteRotation();
    r.addOwn(note(-1));
    r.remove(-1);
    expect(r.markers()).toEqual([]);

    r.addOwn(note(-2));
    r.setServerNotes([note(7)], never);
    r.replace(-2, note(7));
    expect(ids(r.markers())).toEqual([7]);
  });

  it('reports at most 10 ids to skip', () => {
    const r = new NoteRotation();
    r.setServerNotes([note(1), note(2)], never, true);
    expect(r.currentIds().length).toBeLessThanOrEqual(MAX_EXCLUDE);
  });
});
