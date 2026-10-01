import { project } from './globe-renderer';
import { Note } from './notes.service';

/** Most notes shown in panels at once. */
export const PANEL_COUNT = 3;

export type Slots = (Note | null)[];

/** A note's panel is shown while its location is within this many degrees of the point facing the viewer. */
export const ZONE_DEGREES = 60;
/** Once shown, a panel stays until its note is this far from the center, so it doesn't flicker at the edge. */
export const ZONE_HIDE_DEGREES = 65;
/** Gap in pixels between a marker and its panel. */
export const PANEL_GAP = 28;
/** Seconds for a panel to close all but a factor of 1/e of the distance to its target spot. */
export const PANEL_TAU = 0.1;
/** Fastest a panel may move (pixels per second), so a change of spot is a glide, never a jump. A pin itself moves far slower. */
export const PANEL_MAX_SPEED = 360;

// On the unit sphere, z is the cosine of the angle from the point facing the viewer.
const withinDegrees = (z: number, degrees: number) => z >= Math.cos((degrees * Math.PI) / 180) - 1e-9;

/**
 * The notes to show in panels: at most `count` of those inside the zone, nearest the center first.
 * Notes in `shown` already have a panel, so they get the wider hide threshold.
 */
export function nearestInZone(
  notes: readonly Note[],
  angle: number,
  tilt: number,
  shown: readonly (Note | null)[] = [],
  count = PANEL_COUNT,
): Note[] {
  return notes
    .map((note) => ({ note, p: project(note, angle, tilt) }))
    .filter(({ note, p }) => withinDegrees(p.z, shown.some((n) => n?.id === note.id) ? ZONE_HIDE_DEGREES : ZONE_DEGREES))
    .sort((a, b) => a.p.x * a.p.x + a.p.y * a.p.y - (b.p.x * b.p.x + b.p.y * b.p.y))
    .slice(0, count)
    .map(({ note }) => note);
}

/** A note that already has a slot keeps it, so panels don't swap places; newcomers take a free one. */
export function assignSlots(previous: Slots, nearest: readonly Note[]): Slots {
  const slots: Slots = previous.map((note) => nearest.find((n) => n.id === note?.id) ?? null);
  for (const note of nearest) {
    if (slots.includes(note)) continue;
    const free = slots.indexOf(null);
    if (free >= 0) slots[free] = note;
  }
  return slots;
}

export const sameSlots = (a: Slots, b: Slots) => a.length === b.length && a.every((n, i) => n === b[i]);

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

const inside = (rect: Rect, p: { x: number; y: number }, pad = 0) =>
  p.x >= rect.left - pad && p.x <= rect.left + rect.width + pad && p.y >= rect.top - pad && p.y <= rect.top + rect.height + pad;

/** Whether the segment a-b touches the rectangle (grown by `pad`), by clipping it against the four sides. */
const segmentHits = (rect: Rect, a: { x: number; y: number }, b: { x: number; y: number }, pad = 1) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - (rect.left - pad)],
    [dx, rect.left + rect.width + pad - a.x],
    [-dy, a.y - (rect.top - pad)],
    [dy, rect.top + rect.height + pad - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else if (p < 0) {
      t0 = Math.max(t0, q / p);
    } else {
      t1 = Math.min(t1, q / p);
    }
  }
  return t0 <= t1;
};

/** A lane's latitude band runs from `minLat` up to the next lane's `minLat` (the first lane runs to the north pole). */
export interface Lane {
  name: string;
  /** Southern edge of the band, in degrees of latitude. */
  minLat: number;
  /** Panel top edge, as a fraction of the globe's height measured from its top. */
  top: number;
}

/** Lanes from north to south. A note's panel sits in the lane whose band holds the note's latitude. */
export const LANES: readonly Lane[] = [
  { name: 'north', minLat: 30, top: 0.04 },
  { name: 'middle', minLat: -30, top: 0.33 },
  { name: 'south', minLat: -90, top: 0.62 },
];
/** A note this many degrees past its lane's band edge still keeps that lane. */
export const LANE_HYSTERESIS = 5;
/** Longest allowed line from a panel to its pin, in pixels. */
export const MAX_LINE = 160;
/** Most a panel may move horizontally in one frame at 60fps while keeping to its lane, in pixels. */
export const MAX_STEP_X = 12;
/** Space kept between panels, and around pins, in pixels. */
const PANEL_MARGIN = 4;
/** Extra room a lane needs before a panel moves back to it from a neighbor, so it doesn't flap. */
const RETURN_MARGIN = 12;
/** Seconds a panel stays in a neighboring lane before it may go back home, so it doesn't flap between two. */
export const LANE_HOLD = 2;

/** The lane for a latitude. `previous`, the lane the note was in, is kept while the latitude is within the hysteresis of its band. */
export function laneFor(lat: number, previous?: number, lanes: readonly Lane[] = LANES): number {
  if (previous !== undefined && lanes[previous]) {
    const north = previous === 0 ? Infinity : lanes[previous - 1].minLat;
    if (lat >= lanes[previous].minLat - LANE_HYSTERESIS && lat < north + LANE_HYSTERESIS) return previous;
  }
  const i = lanes.findIndex((l) => lat >= l.minLat);
  return i < 0 ? lanes.length - 1 : i;
}

export interface LaneInput {
  /** Where the pin is, in stage pixels. */
  pin: { x: number; y: number };
  size: { width: number; height: number };
  /** Latitude of the note, in degrees. */
  lat: number;
}

export interface LaneState {
  /** The lane the note's latitude belongs in. */
  home: number;
  /** The lane the panel is in now: home, or a neighbor while another panel holds home. */
  lane: number;
  /** Which side of its pin the panel is on: 1 right, -1 left. */
  side: 1 | -1;
  /** Seconds (on the caller's clock) when the panel last changed lane or side. */
  since: number;
}

export interface LanePlacement extends LaneState {
  rect: Rect;
  /** Changes when the panel changes lane or side, so easing glides instead of following. */
  key: string;
  /** True when no lane or side is clear: the panel should not be shown, and does not hold its place against the others. */
  blocked: boolean;
}

/**
 * Puts each panel in its latitude's lane, `gap` pixels to one side of its pin. Its height is the
 * lane's `laneTops` entry and never otherwise changes; it only follows its pin sideways. A panel
 * keeps its side until the other is the only one with room. Panels are placed in order. When
 * a panel would overlap one already placed, sit on another panel's pin, run its line under
 * another, or be too far from its pin, it takes a neighboring lane, and goes home once that is
 * clear with some room to spare. A panel with no clear lane or side comes back `blocked`.
 */
export function layoutLanes(
  items: readonly LaneInput[],
  laneTops: readonly number[],
  bounds: { width: number },
  previous: readonly (Partial<LaneState> | undefined)[] = [],
  gap = PANEL_GAP,
  now = 0,
): LanePlacement[] {
  const placed: LanePlacement[] = [];
  const lines: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
  items.forEach((item, i) => {
    const { pin, size } = item;
    const before = previous[i];
    const home = laneFor(item.lat, before?.home);
    const beforeLane = before?.lane;
    const fits = (side: 1 | -1) => {
      const left = side > 0 ? pin.x + gap : pin.x - gap - size.width;
      return left >= 0 && left + size.width <= bounds.width;
    };
    const leftFor = (side: 1 | -1) => Math.max(0, Math.min(side > 0 ? pin.x + gap : pin.x - gap - size.width, bounds.width - size.width));
    let side: 1 | -1 = before?.side ?? (pin.x < bounds.width / 2 ? 1 : -1);
    if (!fits(side) && fits(-side as 1 | -1)) side = -side as 1 | -1;
    const rectIn = (lane: number, s: 1 | -1): Rect => ({ left: leftFor(s), top: laneTops[lane], width: size.width, height: size.height });
    // How many rules a panel in this lane and side would break, with `pad` pixels of room around it.
    const trouble = (lane: number, s: 1 | -1, pad: number) => {
      const rect = rectIn(lane, s);
      const line = { from: nearestEdgePoint(rect, pin), to: pin };
      let n = Math.hypot(line.from.x - pin.x, line.from.y - pin.y) > MAX_LINE ? 1 : 0;
      items.forEach((other, j) => {
        if (inside(rect, other.pin, pad)) n++;
        const p = placed[j];
        if (!p || p.blocked || j === i) return;
        if (overlap({ ...rect, left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad }, p.rect) > 0) n++;
        if (segmentHits(rect, lines[j].from, lines[j].to)) n++;
        if (segmentHits(p.rect, line.from, line.to)) n++;
      });
      return n;
    };
    const nearHome = laneTops.map((_, l) => l).sort((a, b) => Math.abs(a - home) - Math.abs(b - home) || a - b);
    const current = beforeLane ?? home;
    const away = current !== home;
    const other = -side as 1 | -1;
    let lane = current;
    if (away && now - (before?.since ?? -Infinity) >= LANE_HOLD && trouble(home, side, RETURN_MARGIN) === 0) {
      lane = home;
    } else if (trouble(current, side, before ? 0 : PANEL_MARGIN) > 0) {
      // Look for a clear lane, with some room around the panel; then, if that fails, with none.
      // Failing that the panel may take the other side of its pin (a glide, since its key changes).
      let found: { lane: number; side: 1 | -1 } | undefined;
      for (const pad of [PANEL_MARGIN, 0]) {
        for (const s of fits(other) ? [side, other] : [side]) {
          const l = nearHome.find((l) => trouble(l, s, pad) === 0);
          if (l !== undefined) found ??= { lane: l, side: s };
        }
        if (found) break;
      }
      if (found) {
        lane = found.lane;
        side = found.side;
      } else {
        // Nowhere is clear: the lane with the least trouble, nearest home. It comes back blocked.
        lane = nearHome.reduce((best, l) => (trouble(l, side, 0) < trouble(best, side, 0) ? l : best), home);
      }
    }
    const rect = rectIn(lane, side);
    const since = before && before.lane === lane && before.side === side && before.since !== undefined ? before.since : now;
    placed.push({ rect, key: `${lane}:${side}`, home, lane, side, since, blocked: trouble(lane, side, 0) > 0 });
    lines.push({ from: nearestEdgePoint(rect, pin), to: pin });
  });
  return placed;
}

/**
 * Moves a panel from where it was toward `target`, closing 1 - e^(-dt/tau) of the distance, so
 * the motion looks the same at any frame rate. A move to a new spot is never faster than
 * `PANEL_MAX_SPEED`, but `allowance` (how far the target itself moved this frame) is added to
 * that limit, so a panel can keep up with a pin that is moving fast and only a jump is slowed.
 * With no previous position it starts at the target.
 */
export function easeRect(previous: Rect | undefined, target: Rect, dt: number, tau = PANEL_TAU, allowance = 0): Rect {
  if (!previous) return target;
  const k = 1 - Math.exp(-Math.max(0, dt) / tau);
  const dx = (target.left - previous.left) * k;
  const dy = (target.top - previous.top) * k;
  const cap = Math.min(1, (PANEL_MAX_SPEED * Math.max(0, dt) + Math.max(0, allowance)) / (Math.hypot(dx, dy) || 1));
  return { ...target, left: previous.left + dx * cap, top: previous.top + dy * cap };
}

export type PanelState = { rect: Rect; target: Rect; key: string } & Partial<LaneState>;

/**
 * One frame of easing for every panel: each moves from where it was toward its new target
 * (or sits on it with `snap`), and the result is the map to pass in next frame. Panels whose
 * spot changed (a different key) get no allowance, so a change of spot is still a glide.
 */
export function advancePanels(
  previous: ReadonlyMap<number, PanelState>,
  ids: readonly number[],
  targets: readonly ({ rect: Rect; key: string } & Partial<LaneState>)[],
  dt: number,
  snap = false,
): Map<number, PanelState> {
  const next = new Map<number, PanelState>();
  ids.forEach((id, n) => {
    const before = previous.get(id);
    const t = targets[n];
    const allowance = before && before.key === t.key ? Math.hypot(t.rect.left - before.target.left, t.rect.top - before.target.top) : 0;
    next.set(id, { ...t, rect: easeRect(snap ? undefined : before?.rect, t.rect, dt, PANEL_TAU, allowance), target: t.rect });
  });
  return next;
}

/**
 * Where a panel was placed last frame in `previous`, which is in placement order: panels already
 * showing come in the order they were placed, then newcomers. Placing them in that same order every
 * frame means a panel placed later never takes a lane from one placed earlier, which would flap.
 */
export function placementRank(previous: ReadonlyMap<number, unknown>, id: number): number {
  const rank = [...previous.keys()].indexOf(id);
  return rank < 0 ? Infinity : rank;
}

/** Where a spot at view-space (x right, y up) is, in the same pixels as `cellCenter`, but not snapped to a character cell. */
export function pinPoint(
  p: { x: number; y: number },
  box: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  return { x: box.left + ((p.x + 1) / 2) * box.width, y: box.top + ((1 - p.y) / 2) * box.height };
}

/** The point on a panel's outline nearest a marker, where its line starts. */
export function nearestEdgePoint(rect: Rect, p: { x: number; y: number }): { x: number; y: number } {
  const x = Math.max(rect.left, Math.min(p.x, rect.left + rect.width));
  const y = Math.max(rect.top, Math.min(p.y, rect.top + rect.height));
  if (x !== p.x || y !== p.y) return { x, y };
  // Marker inside the rect (only when pinned by clamping): leave from the closest side.
  const d = [p.x - rect.left, rect.left + rect.width - p.x, p.y - rect.top, rect.top + rect.height - p.y];
  const i = d.indexOf(Math.min(...d));
  return [{ x: rect.left, y: p.y }, { x: rect.left + rect.width, y: p.y }, { x: p.x, y: rect.top }, { x: p.x, y: rect.top + rect.height }][i];
}

/**
 * Pixel position of a character cell's center, given the globe's rendered size and where its
 * top-left corner sits in the coordinate space the lines are drawn in.
 */
export function cellCenter(
  cell: { col: number; row: number },
  cols: number,
  rows: number,
  box: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: box.left + ((cell.col + 0.5) / cols) * box.width,
    y: box.top + ((cell.row + 0.5) / rows) * box.height,
  };
}
