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

/**
 * Places a panel beside each marker, inside `bounds` (whose top-left is the origin). Panels are
 * placed in order. Each tries the right of its marker, then the left, each shifted up or down in
 * turn, then above and below, and takes the cheapest spot: least overlap, then least displacement.
 */
export function placePanels(
  markers: readonly { x: number; y: number }[],
  sizes: readonly { width: number; height: number }[],
  bounds: { width: number; height: number },
  gap = PANEL_GAP,
): Rect[] {
  const placed: Rect[] = [];
  markers.forEach((m, i) => {
    const { width: w, height: h } = sizes[i];
    // Beside the marker first, then the same sides shifted up and down by whole panel heights,
    // so a crowd of panels can stack instead of overlapping.
    const shifts = [0, -1, 1, -2, 2].map((k) => k * (h + 4));
    const sides = [m.x + gap, m.x - gap - w];
    const candidates = [
      ...shifts.flatMap((dy) => sides.map((left) => ({ left, top: m.y - h / 2 + dy, dy }))),
      { left: m.x - w / 2, top: m.y - gap - h, dy: 0 },
      { left: m.x - w / 2, top: m.y + gap, dy: 0 },
    ];
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
      const covers = m.x >= rect.left && m.x <= rect.left + w && m.y >= rect.top && m.y <= rect.top + h;
      const cost =
        placed.reduce((sum, p) => sum + overlap(rect, p), 0) * 10 +
        (covers ? 1e6 : 0) +
        Math.hypot(rect.left - c.left, rect.top - c.top) +
        // Prefer staying level with the marker.
        Math.abs(c.dy) * 0.5;
      if (cost < bestCost) {
        best = rect;
        bestCost = cost;
      }
    }
    placed.push(best!);
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
