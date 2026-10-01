import { describe, expect, it } from 'vitest';
import {
  assignSlots,
  cellCenter,
  nearestEdgePoint,
  nearestInZone,
  placePanels,
  ZONE_DEGREES,
  ZONE_HIDE_DEGREES,
} from './note-panels';
import { Note } from './notes.service';

const TILT = 0;
const note = (id: number, lon: number, lat = 0): Note => ({ id, lat, lon, text: `n${id}`, created_at: '' });

describe('nearestInZone', () => {
  it('picks the notes in the zone closest to the center, nearest first', () => {
    const notes = [note(1, 50), note(2, 10), note(3, 180), note(4, -30), note(5, 70), note(6, 5)];
    expect(nearestInZone(notes, 0, TILT).map((n) => n.id)).toEqual([6, 2, 4]);
  });

  it('follows the globe as it turns', () => {
    const notes = [note(1, 0), note(2, 90)];
    // Turning by -90° brings the note at +90° to the front.
    expect(nearestInZone(notes, -Math.PI / 2, TILT).map((n) => n.id)).toEqual([2]);
  });

  it('skips notes on the visible side but outside the zone, and on the far side', () => {
    expect(nearestInZone([note(1, 75), note(2, -80), note(3, 170), note(4, 0, 75)], 0, TILT)).toEqual([]);
  });

  it('includes a note right at the zone threshold, and not just past it', () => {
    expect(nearestInZone([note(1, ZONE_DEGREES)], 0, TILT)).toHaveLength(1);
    expect(nearestInZone([note(1, ZONE_DEGREES + 0.5)], 0, TILT)).toHaveLength(0);
    expect(nearestInZone([note(1, 0, ZONE_DEGREES + 0.5)], 0, TILT)).toHaveLength(0);
  });

  it('keeps a shown note until the wider hide threshold', () => {
    const n = note(1, (ZONE_DEGREES + ZONE_HIDE_DEGREES) / 2);
    expect(nearestInZone([n], 0, TILT)).toEqual([]);
    expect(nearestInZone([n], 0, TILT, [n])).toEqual([n]);
    const far = note(2, ZONE_HIDE_DEGREES + 1);
    expect(nearestInZone([far], 0, TILT, [far])).toEqual([]);
  });
});

describe('assignSlots', () => {
  it('fills free slots with newcomers', () => {
    const [a, b] = [note(1, 0), note(2, 10)];
    expect(assignSlots([null, null, null], [a, b])).toEqual([a, b, null]);
  });

  it('keeps a note in its slot whatever the order', () => {
    const [a, b] = [note(1, 10), note(2, -10)];
    const first = assignSlots([null, null, null], [a, b]);
    expect(assignSlots(first, [b, a])).toEqual(first);
  });

  it('frees the slot of a note that leaves and reuses it for the newcomer', () => {
    const [a, b, c, d] = [note(1, 0), note(2, 1), note(3, 2), note(4, 3)];
    const before = assignSlots([null, null, null], [a, b, c]);
    expect(assignSlots(before, [b, c, d])).toEqual([d, b, c]);
    expect(assignSlots(before, [b])).toEqual([null, b, null]);
  });
});

describe('placePanels', () => {
  const size = { width: 100, height: 40 };
  const bounds = { width: 400, height: 300 };

  it('puts the panel to the right of its marker, centered vertically', () => {
    const [r] = placePanels([{ x: 100, y: 150 }], [size], bounds, 10);
    expect(r).toEqual({ ...size, left: 110, top: 130 });
  });

  it('flips to the left when there is no room on the right', () => {
    const [r] = placePanels([{ x: 350, y: 150 }], [size], bounds, 10);
    expect(r).toEqual({ ...size, left: 240, top: 130 });
  });

  it('goes above or below when neither side has room', () => {
    const narrow = { width: 120, height: 300 };
    const [r] = placePanels([{ x: 60, y: 150 }], [size], narrow, 10);
    expect(r.top + r.height).toBeLessThanOrEqual(140);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.left + r.width).toBeLessThanOrEqual(120);
  });

  it('clamps inside the bounds', () => {
    const [r] = placePanels([{ x: 20, y: 5 }], [size], bounds, 10);
    expect(r.top).toBe(0);
    for (const m of [{ x: 0, y: 0 }, { x: 400, y: 300 }]) {
      const [c] = placePanels([m], [size], bounds, 10);
      expect(c.left).toBeGreaterThanOrEqual(0);
      expect(c.top).toBeGreaterThanOrEqual(0);
      expect(c.left + c.width).toBeLessThanOrEqual(400);
      expect(c.top + c.height).toBeLessThanOrEqual(300);
    }
  });

  it('never covers its own marker', () => {
    const m = { x: 200, y: 150 };
    const [r] = placePanels([m], [size], bounds, 10);
    expect(m.x < r.left || m.x > r.left + r.width || m.y < r.top || m.y > r.top + r.height).toBe(true);
  });

  it('keeps panels from overlapping when markers are close together', () => {
    const markers = [{ x: 150, y: 140 }, { x: 160, y: 150 }, { x: 170, y: 160 }];
    const rects = placePanels(markers, [size, size, size], bounds, 10);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const apart =
          a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top;
        expect(apart).toBe(true);
      }
    }
  });
});

describe('nearestEdgePoint', () => {
  const rect = { left: 100, top: 100, width: 50, height: 20 };
  it('is the closest point on the rectangle', () => {
    expect(nearestEdgePoint(rect, { x: 80, y: 110 })).toEqual({ x: 100, y: 110 });
    expect(nearestEdgePoint(rect, { x: 200, y: 50 })).toEqual({ x: 150, y: 100 });
  });
});

describe('cellCenter', () => {
  it('maps a cell to the pixel at its center, offset by the globe position', () => {
    const box = { left: 10, top: 20, width: 610, height: 370 };
    expect(cellCenter({ col: 0, row: 0 }, 61, 37, box)).toEqual({ x: 15, y: 25 });
    expect(cellCenter({ col: 30, row: 18 }, 61, 37, box)).toEqual({ x: 315, y: 205 });
  });
});
