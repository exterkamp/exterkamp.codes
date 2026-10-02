import { describe, expect, it } from 'vitest';
import {
  assignSlots,
  cellCenter,
  LANE_HOLD,
  LANE_HYSTERESIS,
  LANES,
  laneFor,
  layoutLanes,
  MAX_LINE,
  MAX_STEP_X,
  advancePanels,
  easeRect,
  PanelState,
  placementRank,
  nearestEdgePoint,
  nearestInZone,
  outsidePlacement,
  PANEL_GAP,
  PANEL_MAX_SPEED,
  PANEL_TAU,
  pinPoint,
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

describe('laneFor', () => {
  it('puts a latitude in the lane whose band holds it', () => {
    expect(LANES.map((l) => l.name)).toEqual(['north', 'middle', 'south']);
    expect([80, 30.1, 30].map((lat) => laneFor(lat))).toEqual([0, 0, 0]);
    expect([29.9, 0, -29.9, -30].map((lat) => laneFor(lat))).toEqual([1, 1, 1, 1]);
    expect([-30.1, -90].map((lat) => laneFor(lat))).toEqual([2, 2]);
  });

  it('keeps the previous lane within the hysteresis of its band, and lets go beyond it', () => {
    expect(laneFor(27, 0)).toBe(0);
    expect(laneFor(30 - LANE_HYSTERESIS - 0.1, 0)).toBe(1);
    expect(laneFor(32, 1)).toBe(1);
    expect(laneFor(30 + LANE_HYSTERESIS + 0.1, 1)).toBe(0);
    expect(laneFor(-33, 1)).toBe(1);
    expect(laneFor(-36, 1)).toBe(2);
  });
});

describe('layoutLanes', () => {
  const size = { width: 100, height: 40 };
  const tops = [10, 110, 210];
  const bounds = { width: 700 };
  const one = (x: number, y: number, lat: number) => ({ pin: { x, y }, size, lat });

  it('puts each panel at its lane height, PANEL_GAP to the right of its pin', () => {
    const [n, m, s] = layoutLanes([one(300, 60, 60), one(300, 130, 0), one(300, 250, -60)], tops, bounds);
    expect([n.rect.top, m.rect.top, s.rect.top]).toEqual(tops);
    expect(n.rect.left).toBe(300 + PANEL_GAP);
    expect(n.lane).toBe(0);
  });

  it('keeps its side while that side has room, and switches only when it has none', () => {
    const state = (side: 1 | -1) => [{ home: 1, lane: 1, side }];
    expect(layoutLanes([one(300, 130, 0)], tops, bounds, state(-1))[0].rect.left).toBe(300 - PANEL_GAP - 100);
    expect(layoutLanes([one(300, 130, 0)], tops, bounds, state(1))[0].rect.left).toBe(328);
    expect(layoutLanes([one(650, 130, 0)], tops, bounds, state(1))[0].side).toBe(-1);
    expect(layoutLanes([one(50, 130, 0)], tops, bounds, state(-1))[0].side).toBe(1);
    expect(layoutLanes([one(650, 130, 0)], tops, bounds)[0].side).toBe(-1);
  });

  it('puts two panels in one lane on either side of their pins when they do not overlap', () => {
    const [a, b] = layoutLanes([one(100, 130, 0), one(400, 130, 5)], tops, bounds);
    expect([a.lane, b.lane]).toEqual([1, 1]);
  });

  it('moves a panel that would overlap another to the neighboring lane', () => {
    const [a, b] = layoutLanes([one(300, 130, 0), one(340, 200, 5)], tops, bounds, [undefined, { side: 1 as const }]);
    expect(a.lane).toBe(1);
    expect(b.home).toBe(1);
    expect(b.lane).not.toBe(1);
    expect(Math.abs(b.lane - 1)).toBe(1);
  });

  it('keeps the neighbor lane until home has room to spare, then goes home', () => {
    const state = [undefined, { home: 1, lane: 0, side: 1 as const, since: -10 }];
    const crowded = layoutLanes([one(300, 130, 0), one(340, 100, 0)], tops, bounds, state);
    expect(crowded[1].lane).toBe(0);
    const clear = layoutLanes([one(300, 130, 0), one(500, 100, 0)], tops, bounds, state);
    expect(clear[1].lane).toBe(1);
  });

  it('holds a neighbor lane for LANE_HOLD seconds after the last move, even when home is clear', () => {
    const state = (since: number) => [undefined, { home: 1, lane: 0, side: 1 as const, since }];
    const items = [one(300, 130, 0), one(500, 100, 0)];
    expect(layoutLanes(items, tops, bounds, state(0), PANEL_GAP, 1)[1].lane).toBe(0);
    expect(layoutLanes(items, tops, bounds, state(0), PANEL_GAP, LANE_HOLD - 0.1)[1].lane).toBe(0);
    expect(layoutLanes(items, tops, bounds, state(0), PANEL_GAP, LANE_HOLD + 0.1)[1].lane).toBe(1);
  });

  it('never puts a panel on any shown pin, nor a line under another panel', () => {
    // The second pin sits where the first panel would be.
    const [a, b] = layoutLanes([one(300, 130, 0), one(350, 130, 0)], tops, bounds);
    for (const [r, pins] of [[a.rect, [{ x: 300, y: 130 }, { x: 350, y: 130 }]], [b.rect, [{ x: 300, y: 130 }, { x: 350, y: 130 }]]] as const)
      for (const p of pins) expect(p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height).toBe(false);
  });

  it('does not move back into a lane it just left, unless that is the only way out', () => {
    // The panel left lane 0 a second ago; lane 0 is now clear and its own lane 1 is crowded.
    const state = [undefined, { home: 1, lane: 1, side: 1 as const, since: 0, left: [{ lane: 0, at: 0 }] }];
    const items = [one(300, 130, 0), one(340, 100, 0)];
    const [, b] = layoutLanes(items, tops, bounds, state, PANEL_GAP, 1);
    expect(b.lane).not.toBe(0);
  });

  describe('lines under panels', () => {
    // A pin below the lane-1 panel, whose panel sits in lane 0 on its right: its line runs down through
    // the lane-1 panel for a pin at (300, 130), whose panel is at x 328..428.
    const low = one(380, 190, 0);
    const high = one(300, 130, 0);
    const stay = { home: 1, lane: 0, side: 1 as const, since: 0 };
    const crosses = (r: { left: number; top: number; width: number; height: number }, pin: { x: number; y: number }, other: typeof r) => {
      const from = nearestEdgePoint(r, pin);
      for (let t = 0; t <= 1; t += 0.01) {
        const x = from.x + (pin.x - from.x) * t;
        const y = from.y + (pin.y - from.y) * t;
        if (x >= other.left && x <= other.left + other.width && y >= other.top && y <= other.top + other.height) return true;
      }
      return false;
    };

    it('moves a later panel whose line would run under an earlier panel', () => {
      const [a, b] = layoutLanes([high, low], tops, bounds, [undefined, stay]);
      expect(a.lane).toBe(1);
      expect(b.lane).not.toBe(0);
      expect(crosses(b.rect, low.pin, a.rect)).toBe(false);
      expect(crosses(a.rect, high.pin, b.rect)).toBe(false);
    });

    it('moves a later panel that would cover the line of an earlier panel', () => {
      const [f, g] = layoutLanes([low, high], tops, bounds, [stay]);
      expect(f.lane).toBe(0);
      // It may take the other side of its pin instead of another lane, which spares it a vertical move.
      expect(g.key).not.toBe('1:1');
      expect(crosses(f.rect, low.pin, g.rect)).toBe(false);
      expect(crosses(g.rect, high.pin, f.rect)).toBe(false);
    });
  });

  it('sends a panel to a lane that keeps its line short', () => {
    const [p] = layoutLanes([one(300, 330, 0)], tops, bounds);
    expect(p.lane).toBe(2);
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
  it('keeps panels about 28px from their pins', () => {
    expect(PANEL_GAP).toBe(28);
  });

  it('has lanes ordered north to south, with room for a panel between each pair of tops', () => {
    for (let i = 1; i < LANES.length; i++) {
      expect(LANES[i].minLat).toBeLessThan(LANES[i - 1].minLat);
      expect(LANES[i].top).toBeGreaterThan(LANES[i - 1].top);
    }
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
    const speed = 800;
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
    expect(PANEL_MAX_SPEED / 60).toBeLessThanOrEqual(6);
  });
});

describe('advancePanels', () => {
  const rect = (left: number, top: number): Rect => ({ left, top, width: 10, height: 10 });
  const prev = new Map<number, PanelState>([[1, { rect: rect(0, 0), target: rect(0, 0), key: 'a' }]]);

  it('sits on the target with snap, and glides without it', () => {
    expect(advancePanels(prev, [1], [{ rect: rect(100, 0), key: 'a' }], 0.016, true).get(1)!.rect.left).toBe(100);
    expect(advancePanels(prev, [1], [{ rect: rect(100, 0), key: 'b' }], 0.016).get(1)!.rect.left).toBeLessThan(8);
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

/** Panel texts as in backend/app/demo_notes.py; only their lengths matter. */
const DEMO_TEXT = DEMO.map((_, i) => 'x'.repeat(30 + ((i * 7) % 18)));

type Frame = { id: number; rect: Rect; target: Rect; pin: { x: number; y: number }; lane: number; key: string; first: boolean };

/** Runs the panel pipeline (as the component does) over one full turn of the globe, frame by frame. */
function simulate(
  box: { left: number; top: number; width: number; height: number },
  stage: { width: number },
  panelMaxWidth: number,
  fps = 60,
  notes: Note[] = DEMO.map(([lat, lon], i) => ({ ...note(i + 1, lon, lat), text: DEMO_TEXT[i] })),
  turns = 1,
) {
  const tilt = (23.4 * Math.PI) / 180;
  const sizeOf = (n: Note) => {
    const perLine = Math.floor((panelMaxWidth - 22) / 7.5);
    const lines = Math.ceil(n.text.length / perLine);
    return { width: Math.min(panelMaxWidth, 22 + Math.min(n.text.length, perLine) * 7.5), height: 18 + lines * 20 };
  };
  const laneTops = LANES.map((l) => box.top + l.top * box.height);
  let slots: Slots = [null, null, null];
  let state = new Map<number, PanelState>();
  const cooling = new Map<number, number>();
  const frames: Frame[][] = [];
  for (let f = 0; f < fps * 30 * turns; f++) {
    const angle = (f / (fps * 30)) * 2 * Math.PI;
    slots = assignSlots(slots, nearestInZone(notes.filter((n) => (cooling.get(n.id) ?? 0) <= f), angle, tilt, slots));
    // Panels already showing are placed first, as the component does.
    const shown = slots.filter((n): n is Note => !!n).sort((a, b) => placementRank(state, a.id) - placementRank(state, b.id));
    const pins = shown.map((n) => pinPoint(project(n, angle, tilt), box));
    const targets = layoutLanes(
      shown.map((n, i) => ({ pin: pins[i], size: sizeOf(n), lat: n.lat })),
      laneTops,
      stage,
      shown.map((n) => state.get(n.id)),
      PANEL_GAP,
      f / fps,
    );
    // A panel with no clear spot is dropped, as in the component, and tried again after a moment.
    shown.forEach((n, i) => {
      if (!targets[i].blocked) return;
      cooling.set(n.id, f + 0.4 * fps);
      slots = slots.map((s) => (s === n ? null : s));
    });
    const next = advancePanels(state, shown.map((n) => n.id), targets, 1 / fps);
    frames.push(
      shown.flatMap((n, i) => targets[i].blocked ? [] : [{ id: n.id, rect: next.get(n.id)!.rect, target: targets[i].rect, pin: pins[i], lane: targets[i].lane, key: targets[i].key, first: !state.has(n.id) }]),
    );
    state = next;
  }
  return { frames, laneTops };
}

const contains = (r: Rect, p: { x: number; y: number }) => p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height;
const apart = (r: Rect, o: Rect) =>
  r.left + r.width <= o.left || o.left + o.width <= r.left || r.top + r.height <= o.top || o.top + o.height <= r.top;

/** Per-frame step of every panel that stays shown (not counting the frame it appears), split by whether its lane and side held. */
function steps(frames: Frame[][]) {
  const last = new Map<number, Frame>();
  const out: { dx: number; dy: number; kept: boolean; settled: boolean }[] = [];
  for (const frame of frames) {
    const seen = new Map<number, Frame>();
    for (const f of frame) {
      const before = last.get(f.id);
      if (before && !f.first) out.push({ dx: Math.abs(f.rect.left - before.rect.left), dy: Math.abs(f.rect.top - before.rect.top), kept: before.key === f.key, settled: before.rect.top === before.target.top });
      seen.set(f.id, f);
    }
    last.clear();
    seen.forEach((f, id) => last.set(id, f));
  }
  return out;
}

describe.each([
  ['1024px', { left: 131, top: 0, width: 441, height: 444 }, { width: 704 }, 192],
  ['390px', { left: 9, top: 0, width: 340, height: 342 }, { width: 358 }, 143],
])('panels over a full rotation of the demo notes at %s', (_name, box, stage, maxWidth) => {
  const { frames, laneTops } = simulate(box, stage, maxWidth);

  it('keep their lane height, and never move vertically while in one lane', () => {
    const all = steps(frames);
    expect(all.length).toBeGreaterThan(100);
    for (const f of frames.flat()) expect(laneTops).toContain(f.target.top);
    for (const s of all.filter((s) => s.kept && s.settled)) expect(s.dy).toBe(0);
  });

  it('never move more than MAX_STEP_X in a frame, or jump more than 40px, apart from first appearing', () => {
    for (const s of steps(frames)) {
      expect(s.dx).toBeLessThanOrEqual(MAX_STEP_X);
      expect(Math.hypot(s.dx, s.dy)).toBeLessThanOrEqual(40);
    }
  });

  it('glide to another lane or side at no more than a few pixels a frame', () => {
    for (const s of steps(frames).filter((s) => !s.kept)) expect(Math.hypot(s.dx, s.dy)).toBeLessThanOrEqual(PANEL_MAX_SPEED / 60 + MAX_STEP_X);
  });

  it('change lane rarely', () => {
    const changes = steps(frames).filter((s) => !s.kept).length;
    expect(changes / frames.flat().length).toBeLessThan(0.1);
  });

  it('stay within MAX_LINE of their pins', () => {
    for (const f of frames.flat()) {
      const edge = nearestEdgePoint(f.target, f.pin);
      expect(Math.hypot(edge.x - f.pin.x, edge.y - f.pin.y)).toBeLessThanOrEqual(MAX_LINE);
    }
  });

  it('aim at spots inside the stage that clear every shown pin and each other', () => {
    for (const frame of frames) {
      frame.forEach((f, i) => {
        expect(f.target.left).toBeGreaterThanOrEqual(0);
        expect(f.target.left + f.target.width).toBeLessThanOrEqual(stage.width);
        for (const o of frame) expect(contains(f.target, o.pin)).toBe(false);
        for (const o of frame.slice(i + 1)) expect(apart(f.target, o.target)).toBe(true);
      });
    }
  });

  it('only cross paths or pass over their own pins while gliding to a new lane or side', () => {
    const rects = frames.filter((f) => f.some((a, i) => f.slice(i + 1).some((b) => !apart(a.rect, b.rect))));
    const own = frames.filter((f) => f.some((a) => contains(a.rect, a.pin)));
    expect(rects.length / frames.length).toBeLessThan(0.15);
    expect(own.length / frames.length).toBeLessThan(0.15);
  });
});

/** Every lane change of every panel, as the time (s) it happened and the lanes it went from and to, while the panel stayed shown. */
function laneChanges(frames: Frame[][], fps: number) {
  const last = new Map<number, number>();
  const out: { id: number; at: number; from: number; to: number }[] = [];
  frames.forEach((frame, f) => {
    const ids = new Set(frame.map((x) => x.id));
    for (const id of last.keys()) if (!ids.has(id)) last.delete(id);
    for (const x of frame) {
      const was = last.get(x.id);
      if (was !== undefined && was !== x.lane) out.push({ id: x.id, at: f / fps, from: was, to: x.lane });
      last.set(x.id, x.lane);
    }
  });
  return out;
}

/** A seeded random set of notes. */
function randomNotes(seed: number, count: number): Note[] {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  return Array.from({ length: count }, (_, i) => ({
    ...note(i + 1, rand() * 360 - 180, Math.asin(rand() * 2 - 1) * (180 / Math.PI)),
    text: 'x'.repeat(20 + Math.floor(rand() * 100)),
  }));
}

describe.each([
  ['1024px', { left: 131, top: 0, width: 441, height: 444 }, { width: 704 }, 192],
  ['390px', { left: 9, top: 0, width: 340, height: 342 }, { width: 358 }, 143],
])('lane stability over several turns at %s', (_name, box, stage, maxWidth) => {
  const fps = 30;
  const sets: [string, Note[]][] = [
    ['the demo notes', DEMO.map(([lat, lon], i) => ({ ...note(i + 1, lon, lat), text: DEMO_TEXT[i] }))],
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((seed): [string, Note[]] => [`random set ${seed}`, randomNotes(seed, 6 + seed)]),
  ];

  it.each(sets)('never flaps back to a lane within the hold window, over %s', (_n, notes) => {
    const { frames } = simulate(box, stage, maxWidth, fps, notes, 4);
    const changes = laneChanges(frames, fps);
    const flaps = changes.filter((c, i) => changes.slice(0, i).some((p) => p.id === c.id && p.to === c.from && p.from === c.to && c.at - p.at < LANE_HOLD - 2));
    expect(flaps).toEqual([]);
  });

  it.each(sets)('changes lane at most twice per panel appearance (out of a crowd and back), over %s', (_n, notes) => {
    const { frames } = simulate(box, stage, maxWidth, fps, notes, 4);
    // An appearance is a run of consecutive frames with the panel shown.
    const lanes = new Map<number, { lane: number; changes: number }>();
    let most = 0;
    for (const frame of frames) {
      for (const id of [...lanes.keys()]) if (!frame.some((x) => x.id === id)) lanes.delete(id);
      for (const x of frame) {
        const was = lanes.get(x.id);
        const changes = (was?.changes ?? 0) + (was && was.lane !== x.lane ? 1 : 0);
        lanes.set(x.id, { lane: x.lane, changes });
        most = Math.max(most, changes);
      }
    }
    expect(most).toBeLessThanOrEqual(2);
  });
});

describe('panels with reduced motion', () => {
  it('sit exactly on their targets', () => {
    const prev = new Map<number, PanelState>([[1, { rect: { left: 0, top: 0, width: 10, height: 10 }, target: { left: 0, top: 0, width: 10, height: 10 }, key: '1:1' }]]);
    const rect = { left: 90, top: 5, width: 10, height: 10 };
    expect(advancePanels(prev, [1], [{ rect, key: '1:1' }], 0.016, true).get(1)!.rect).toEqual(rect);
  });
});

describe('outsidePlacement', () => {
  const box = { left: 20, top: 100, width: 300, height: 180 };
  const size = { width: 100, height: 40 };

  it('goes above the globe for a pin in its top half, centered on the pin, and below for the bottom half', () => {
    const up = outsidePlacement({ x: 170, y: 150 }, size, box, { width: 340 });
    expect(up.left).toBe(120);
    expect(up.top + up.height).toBeLessThan(box.top);
    const down = outsidePlacement({ x: 170, y: 250 }, size, box, { width: 340 });
    expect(down.top).toBeGreaterThan(box.top + box.height);
  });

  it('stays inside the stage sideways', () => {
    expect(outsidePlacement({ x: 5, y: 150 }, size, box, { width: 340 }).left).toBe(0);
    expect(outsidePlacement({ x: 335, y: 150 }, size, box, { width: 340 }).left).toBe(240);
  });
});
