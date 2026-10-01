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
export const PANEL_GAP = 14;

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

export interface Disc {
  x: number;
  y: number;
  r: number;
}

/** How far into the globe's disc a panel may reach, in pixels. */
export const DISC_OVERLAP = 10;

/** How far a rectangle reaches into a disc (0 when it is clear of it). */
const intrusion = (rect: Rect, disc: Disc) => {
  const x = Math.max(rect.left, Math.min(disc.x, rect.left + rect.width));
  const y = Math.max(rect.top, Math.min(disc.y, rect.top + rect.height));
  return Math.max(0, disc.r - Math.hypot(x - disc.x, y - disc.y));
};

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

/**
 * Places a panel beside each marker, inside `bounds` (whose top-left is the origin). Panels are
 * placed in order. Each tries spots next to its marker and, when given the globe's `disc`, spots
 * just outside the globe in the marker's direction, shifted up or down in turn, and takes the
 * cheapest: no overlap with other panels, no line or marker of another panel running under it, no
 * more than a sliver over the globe, then the least displacement.
 */
export function placePanels(
  markers: readonly { x: number; y: number }[],
  sizes: readonly { width: number; height: number }[],
  bounds: { width: number; height: number },
  gap = PANEL_GAP,
  disc?: Disc,
): Rect[] {
  const placed: Rect[] = [];
  const lines: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
  markers.forEach((m, i) => {
    const { width: w, height: h } = sizes[i];
    // Beside the marker first, then the same sides shifted up and down by whole panel heights,
    // so a crowd of panels can stack instead of overlapping.
    const shifts = [0, -1, 1, -2, 2, -3, 3].map((k) => k * (h + 4));
    const sides = [m.x + gap, m.x - gap - w];
    const candidates = [
      ...shifts.flatMap((dy) => sides.map((left) => ({ left, top: m.y - h / 2 + dy, dy }))),
      { left: m.x - w / 2, top: m.y - gap - h, dy: 0 },
      { left: m.x - w / 2, top: m.y + gap, dy: 0 },
    ];
    if (disc) {
      // Just outside the globe, on the side the marker is on, level with the marker or stacked above/below.
      const sign = m.x >= disc.x ? 1 : -1;
      for (const dy of shifts) {
        const top = m.y - h / 2 + dy;
        // The rectangle's corner nearest the globe's center sits on this row; find the globe's edge there.
        const row = Math.max(top, Math.min(disc.y, top + h));
        const half = Math.sqrt(Math.max(0, disc.r * disc.r - (row - disc.y) ** 2));
        const edge = disc.x + sign * (half - DISC_OVERLAP / 2);
        candidates.push({ left: sign > 0 ? edge : edge - w, top, dy });
      }
    }
    let best: Rect | null = null;
    let bestCost = Infinity;
    for (const c of candidates) {
      // Clamp into bounds (the panel is pinned to the left/top edge if it is bigger than the bounds).
      const rect = {
        width: w,
        height: h,
        left: Math.max(0, Math.min(c.left, bounds.width - w)),
        top: Math.max(0, Math.min(c.top, bounds.height - h)),
      };
      const line = { from: nearestEdgePoint(rect, m), to: m };
      let cost = 0;
      // No panel may sit on any other note's marker, placed yet or not.
      markers.forEach((other, j) => {
        if (j !== i && inside(rect, other, 2)) cost += 1e5;
      });
      placed.forEach((p, j) => {
        const area = overlap(rect, p);
        if (area > 0) cost += 1e5 + area * 10;
        // Neither panel may sit on the other's line, or on the other's marker.
        if (segmentHits(rect, lines[j].from, lines[j].to)) cost += 1e4;
        if (segmentHits(p, line.from, line.to)) cost += 1e4;
      });
      if (inside(rect, m)) cost += 1e6;
      if (disc) cost += Math.max(0, intrusion(rect, disc) - DISC_OVERLAP) * 50 + intrusion(rect, disc) * 2;
      // Displacement from the ideal spot, and a preference for staying level with the marker.
      cost += Math.hypot(rect.left - c.left, rect.top - c.top) + Math.abs(c.dy) * 0.5;
      if (cost < bestCost) {
        best = rect;
        bestCost = cost;
      }
    }
    placed.push(best!);
    lines.push({ from: nearestEdgePoint(best!, m), to: m });
  });
  return placed;
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
