import { describe, expect, it } from 'vitest';
import { assignSlots, cellCenter, nearestVisible } from './note-panels';
import { Note } from './notes.service';

const TILT = 0;
const note = (id: number, lon: number, lat = 0): Note => ({ id, lat, lon, text: `n${id}`, created_at: '' });

describe('nearestVisible', () => {
  it('picks the visible notes closest to the center, nearest first', () => {
    const notes = [note(1, 50), note(2, 10), note(3, 180), note(4, -30), note(5, 70)];
    expect(nearestVisible(notes, 0, TILT).map((n) => n.id)).toEqual([2, 4, 1]);
  });

  it('follows the globe as it turns', () => {
    const notes = [note(1, 0), note(2, 90)];
    // Turning by +90° (eastward) brings the note at -90° to the front.
    expect(nearestVisible(notes, -Math.PI / 2, TILT)[0].id).toBe(2);
  });

  it('skips notes on the far side', () => {
    expect(nearestVisible([note(1, 170)], 0, TILT)).toEqual([]);
  });
});

describe('assignSlots', () => {
  it('puts newcomers in the slot nearest their horizontal position', () => {
    const left = note(1, -60);
    const mid = note(2, 0);
    const right = note(3, 60);
    expect(assignSlots([null, null, null], [mid, right, left], 0, TILT)).toEqual([left, mid, right]);
  });

  it('keeps a note in its slot while it stays in the top 3, whatever the order', () => {
    const a = note(1, 10);
    const b = note(2, -10);
    const first = assignSlots([null, null, null], [a, b], 0, TILT);
    const again = assignSlots(first, [b, a], 0, TILT);
    expect(again).toEqual(first);
  });

  it('frees the slot of a note that leaves and reuses it for the newcomer', () => {
    const a = note(1, -60);
    const b = note(2, 0);
    const c = note(3, 60);
    const d = note(4, -50);
    const before = assignSlots([null, null, null], [a, b, c], 0, TILT);
    expect(before).toEqual([a, b, c]);
    expect(assignSlots(before, [b, c, d], 0, TILT)).toEqual([d, b, c]);
    expect(assignSlots(before, [b], 0, TILT)).toEqual([null, b, null]);
  });
});

describe('cellCenter', () => {
  it('maps a cell to the pixel at its center, offset by the globe position', () => {
    const box = { left: 10, top: 20, width: 610, height: 370 };
    expect(cellCenter({ col: 0, row: 0 }, 61, 37, box)).toEqual({ x: 15, y: 25 });
    expect(cellCenter({ col: 30, row: 18 }, 61, 37, box)).toEqual({ x: 315, y: 205 });
  });
});
