import { describe, expect, it } from 'vitest';
import {
  assignSlots,
  cellCenter,
  DISC_OVERLAP,
  advancePanels,
  easeRect,
  PanelState,
  layoutPanels,
  nearestEdgePoint,
  nearestInZone,
  PANEL_GAP,
  PANEL_MAX_SPEED,
  PANEL_TAU,
  pinPoint,
  placePanels,
  Rect,
  Slots,
  ZONE_DEGREES,
  ZONE_HIDE_DEGREES,
} from './note-panels';
import { project } from './globe-renderer';
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

describe('placePanels on a narrow stage', () => {
  it('stacks 3 panels without overlap when their markers are close together', () => {
    const size = { width: 190, height: 50 };
    const markers = [{ x: 250, y: 150 }, { x: 190, y: 170 }, { x: 175, y: 190 }];
    const rects = placePanels(markers, [size, size, size], { width: 358, height: 380 });
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const [a, b] = [rects[i], rects[j]];
        expect(a.top + a.height <= b.top || b.top + b.height <= a.top || a.left + a.width <= b.left || b.left + b.width <= a.left).toBe(true);
      }
    }
  });
});

describe('placePanels with markers in a row', () => {
  const size = { width: 100, height: 30 };
  const bounds = { width: 400, height: 300 };
  const coversAny = (markers: { x: number; y: number }[]) => {
    const rects = placePanels(markers, markers.map(() => size), bounds);
    return rects.some((r, i) =>
      markers.some((m, j) => i !== j && m.x >= r.left && m.x <= r.left + r.width && m.y >= r.top && m.y <= r.top + r.height),
    );
  };

  it('never puts a panel on a later marker', () => {
    expect(coversAny([{ x: 100, y: 100 }, { x: 150, y: 100 }])).toBe(false);
  });

  it('never puts a panel on any marker of three in a row', () => {
    expect(coversAny([{ x: 100, y: 100 }, { x: 150, y: 100 }, { x: 200, y: 100 }])).toBe(false);
  });
});

describe('placePanels in a tight stage', () => {
  it('moves above or below rather than cover its own marker when both sides are clamped onto it', () => {
    const m = { x: 100, y: 150 };
    const [r] = placePanels([m], [{ width: 100, height: 40 }], { width: 120, height: 300 }, 14);
    expect(m.x >= r.left && m.x <= r.left + r.width && m.y >= r.top && m.y <= r.top + r.height).toBe(false);
  });
});

describe('placePanels around the globe', () => {
  const size = { width: 100, height: 40 };
  const bounds = { width: 600, height: 400 };
  const disc = { x: 300, y: 200, r: 150 };

  it('puts a panel outside the globe, or barely over it', () => {
    for (const m of [{ x: 300, y: 200 }, { x: 250, y: 150 }, { x: 380, y: 230 }, { x: 330, y: 120 }]) {
      const [r] = placePanels([m], [size], bounds, 14, disc);
      const cx = Math.max(r.left, Math.min(disc.x, r.left + r.width));
      const cy = Math.max(r.top, Math.min(disc.y, r.top + r.height));
      expect(disc.r - Math.hypot(cx - disc.x, cy - disc.y)).toBeLessThanOrEqual(DISC_OVERLAP + 0.5);
    }
  });

  it('keeps one panel off the marker and line of another', () => {
    const markers = [{ x: 330, y: 200 }, { x: 345, y: 215 }, { x: 320, y: 185 }];
    const rects = placePanels(markers, [size, size, size], bounds, 14, disc);
    rects.forEach((r, i) => {
      markers.forEach((m, j) => {
        if (i === j) return;
        const from = nearestEdgePoint(rects[j], m);
        const hit = Array.from({ length: 17 }, (_, t) => ({
          x: from.x + ((m.x - from.x) * t) / 16,
          y: from.y + ((m.y - from.y) * t) / 16,
        })).some((p) => p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height);
        expect(hit).toBe(false);
      });
    });
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

describe('panel constants', () => {
  it('keeps panels about 28px from their pins and barely over the globe', () => {
    expect(PANEL_GAP).toBe(28);
    expect(DISC_OVERLAP).toBe(4);
  });
});

describe('easeRect', () => {
  const at = (left: number, top: number): Rect => ({ left, top, width: 10, height: 10 });
  const run = (from: Rect, to: Rect, seconds: number, fps: number) => {
    let r = from;
    for (let i = 0; i < seconds * fps; i++) r = easeRect(r, to, 1 / fps);
    return r;
  };

  it('starts at the target, and moves part of the way toward it', () => {
    expect(easeRect(undefined, at(50, 60), 0.016)).toEqual(at(50, 60));
    const r = easeRect(at(0, 0), at(10, 10), PANEL_TAU);
    expect(r.left).toBeCloseTo(10 * (1 - Math.exp(-1)), 0);
    expect(r.top).toBeCloseTo(r.left);
  });

  it('looks the same at any frame rate', () => {
    expect(run(at(0, 0), at(30, 0), 0.2, 120).left).toBeCloseTo(run(at(0, 0), at(30, 0), 0.2, 30).left, 0);
  });

  it('catches up with a pin that has fallen behind within about 300ms', () => {
    expect(30 - run(at(0, 0), at(30, 0), 0.3, 60).left).toBeLessThan(2.5);
  });

  it('keeps up with a target moving steadily far faster than PANEL_MAX_SPEED', () => {
    const fps = 60;
    const speed = 400;
    let r = at(0, 0);
    let target = at(0, 0);
    let worst = 0;
    for (let i = 0; i < fps * 3; i++) {
      const next = at(target.left + speed / fps, 0);
      r = easeRect(r, next, 1 / fps, PANEL_TAU, Math.hypot(next.left - target.left, 0));
      target = next;
      if (i > fps) worst = Math.max(worst, target.left - r.left);
    }
    // Easing alone trails a steady target by speed * tau; the allowance must not add to that.
    expect(worst).toBeLessThan(speed * PANEL_TAU * 1.1);
    // Without the allowance the cap would leave it hundreds of pixels behind.
    let slow = at(0, 0);
    for (let i = 0; i < fps * 3; i++) slow = easeRect(slow, at((i + 1) * (speed / fps), 0), 1 / fps);
    expect(3 * speed - slow.left).toBeGreaterThan(300);
  });

  it('never moves faster than PANEL_MAX_SPEED, however far it has to go', () => {
    const r = easeRect(at(0, 0), at(500, 500), 1 / 60);
    expect(Math.hypot(r.left, r.top)).toBeLessThanOrEqual(PANEL_MAX_SPEED / 60 + 1e-9);
    expect(PANEL_MAX_SPEED / 60).toBeLessThanOrEqual(3);
  });
});

describe('advancePanels', () => {
  const rect = (left: number, top: number): Rect => ({ left, top, width: 10, height: 10 });
  const prev = new Map<number, PanelState>([[1, { rect: rect(0, 0), target: rect(0, 0), key: 'a' }]]);

  it('sits on the target with snap, and glides without it', () => {
    expect(advancePanels(prev, [1], [{ rect: rect(100, 0), key: 'a' }], 0.016, true).get(1)!.rect.left).toBe(100);
    expect(advancePanels(prev, [1], [{ rect: rect(100, 0), key: 'b' }], 0.016).get(1)!.rect.left).toBeLessThan(5);
  });

  it('lets a panel follow its target, but not jump when its spot changes', () => {
    const follow = advancePanels(prev, [1], [{ rect: rect(100, 0), key: 'a' }], 0.016).get(1)!.rect.left;
    const jump = advancePanels(prev, [1], [{ rect: rect(100, 0), key: 'b' }], 0.016).get(1)!.rect.left;
    expect(follow).toBeGreaterThan(jump);
  });

  it('only keeps the panels it is given, and starts new ones on their targets', () => {
    const next = advancePanels(prev, [2], [{ rect: rect(7, 8), key: 'a' }], 0.016);
    expect([...next.keys()]).toEqual([2]);
    expect(next.get(2)!.rect).toEqual(rect(7, 8));
  });
});

describe('pinPoint', () => {
  it('is continuous, unlike the character cell center', () => {
    const box = { left: 10, top: 20, width: 610, height: 370 };
    expect(pinPoint({ x: 0, y: 0 }, box)).toEqual({ x: 315, y: 205 });
    expect(pinPoint({ x: 0.001, y: -0.001 }, box).y).toBeGreaterThan(205);
  });
});

// The demo notes from backend/app/demo_notes.py.
const DEMO: [number, number][] = [
  [64.84, -147.72], [37.77, -122.42], [40.71, -74.01], [19.43, -99.13], [-12.05, -77.04], [-34.6, -58.38],
  [-54.8, -68.3], [64.15, -21.94], [51.51, -0.13], [51.5, -0.1], [48.86, 2.35], [41.9, 12.5], [30.04, 31.24],
  [6.52, 3.38], [-1.29, 36.82], [-33.92, 18.42], [55.75, 37.62], [28.61, 77.21], [35.68, 139.69], [35.66, 139.7],
  [1.35, 103.82], [-33.87, 151.21], [-41.29, 174.78], [-17.71, 178.07], [-16.5, -179.5], [65.6, 179.9],
  [64.4, -179.9], [-77.85, 166.67], [-90, 0], [-67.6, 62.87],
];

/** Runs the panel pipeline (as the component does) over one full turn of the globe, frame by frame. */
function simulate(box: { left: number; top: number; width: number; height: number }, stage: { width: number; height: number }, fps = 60) {
  const notes = DEMO.map(([lat, lon], i) => note(i + 1, lon, lat));
  const tilt = (23.4 * Math.PI) / 180;
  const size = { width: 150, height: 56 };
  const disc = { x: box.left + box.width / 2, y: box.top + box.height / 2, r: Math.min(box.width, box.height) / 2 };
  let slots: Slots = [null, null, null];
  let state = new Map<number, PanelState>();
  const frames: { id: number; rect: Rect; target: Rect; pin: { x: number; y: number }; first: boolean }[][] = [];
  for (let f = 0; f < fps * 30; f++) {
    const angle = (f / (fps * 30)) * 2 * Math.PI;
    slots = assignSlots(slots, nearestInZone(notes, angle, tilt, slots));
    // Panels already showing are placed first, as the component does.
    const shown = slots.filter((n): n is Note => !!n).sort((a, b) => Number(state.has(b.id)) - Number(state.has(a.id)));
    const pins = shown.map((n) => pinPoint(project(n, angle, tilt), box));
    const targets = layoutPanels(pins, shown.map(() => size), stage, PANEL_GAP, disc, shown.map((n) => state.get(n.id)?.key));
    const next = advancePanels(state, shown.map((n) => n.id), targets, 1 / fps);
    frames.push(
      shown.map((n, i) => ({ id: n.id, rect: next.get(n.id)!.rect, target: targets[i].rect, pin: pins[i], first: !state.has(n.id) })),
    );
    state = next;
  }
  return { frames, disc };
}

describe('panels over a full rotation of the demo notes', () => {
  const box = { left: 167, top: 20, width: 366, height: 370 };
  const stage = { width: 700, height: 410 };

  it('never move more than a few pixels between frames, apart from first appearing', () => {
    const { frames } = simulate(box, stage);
    const last = new Map<number, Rect>();
    let worst = 0;
    let moves = 0;
    for (const frame of frames) {
      const seen = new Map<number, Rect>();
      for (const { id, rect, first } of frame) {
        const before = last.get(id);
        if (before && !first) {
          worst = Math.max(worst, Math.abs(rect.top - before.top));
          moves++;
        }
        seen.set(id, rect);
      }
      last.clear();
      seen.forEach((r, id) => last.set(id, r));
    }
    expect(moves).toBeGreaterThan(100);
    expect(worst).toBeLessThanOrEqual(3);
  });

  const apart = (r: Rect, o: Rect) =>
    r.left + r.width <= o.left || o.left + o.width <= r.left || r.top + r.height <= o.top || o.top + o.height <= r.top;
  const reach = (r: Rect, d: { x: number; y: number; r: number }) =>
    d.r - Math.hypot(Math.max(r.left, Math.min(d.x, r.left + r.width)) - d.x, Math.max(r.top, Math.min(d.y, r.top + r.height)) - d.y);

  it('aim at spots that keep clear of each other and their pins, and barely touch the globe', () => {
    const { frames, disc } = simulate(box, stage);
    for (const frame of frames) {
      frame.forEach(({ target: t, pin }, i) => {
        expect(pin.x >= t.left && pin.x <= t.left + t.width && pin.y >= t.top && pin.y <= t.top + t.height).toBe(false);
        expect(t.left).toBeGreaterThanOrEqual(0);
        expect(t.left + t.width).toBeLessThanOrEqual(stage.width);
        expect(reach(t, disc)).toBeLessThanOrEqual(DISC_OVERLAP + 0.5);
        for (const { target: o } of frame.slice(i + 1)) expect(apart(t, o)).toBe(true);
      });
    }
  });

  it('only cross paths while gliding to a new spot', () => {
    const { frames } = simulate(box, stage);
    const crossing = frames.filter((f) => f.some(({ rect: r }, i) => f.slice(i + 1).some(({ rect: o }) => !apart(r, o))));
    // Seconds-long glides only happen when a crowd of three pins forces a panel to the far side of the globe.
    expect(crossing.length / frames.length).toBeLessThan(0.13);
  });

  it('rarely pass over their own pins while gliding', () => {
    const { frames } = simulate(box, stage);
    const covering = frames.filter((f) =>
      f.some(({ rect: r, pin }) => pin.x >= r.left && pin.x <= r.left + r.width && pin.y >= r.top && pin.y <= r.top + r.height),
    );
    // Only when a crowd of three pins forces a panel to the far side of the globe, which takes seconds at the speed limit.
    expect(covering.length / frames.length).toBeLessThan(0.04);
    // And never for long at a time: no single episode of covering lasts more than a second (the longest measured is 0.67s).
    let run = 0;
    let longest = 0;
    for (const f of frames) {
      run = f.some(({ rect: r, pin }) => pin.x >= r.left && pin.x <= r.left + r.width && pin.y >= r.top && pin.y <= r.top + r.height) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(60);
  });
});
