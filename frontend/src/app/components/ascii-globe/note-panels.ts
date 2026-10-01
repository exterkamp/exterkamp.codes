import { project } from './globe-renderer';
import { Note } from './notes.service';

/** Most notes shown in panels at once. */
export const PANEL_COUNT = 3;

export type Slots = (Note | null)[];

/** The visible notes closest to the front-center of the globe, nearest first. */
export function nearestVisible(notes: readonly Note[], angle: number, tilt: number, count = PANEL_COUNT): Note[] {
  return notes
    .map((note) => ({ note, p: project(note, angle, tilt) }))
    .filter(({ p }) => p.z > 0)
    .sort((a, b) => a.p.x * a.p.x + a.p.y * a.p.y - (b.p.x * b.p.x + b.p.y * b.p.y))
    .slice(0, count)
    .map(({ note }) => note);
}

/** Horizontal position (view space, -1 to 1) of a panel slot's center. */
const slotX = (slot: number, slots: number) => (slots === 1 ? 0 : ((slot / (slots - 1)) * 2 - 1) * 0.66);

/**
 * Decides which panel slot each of the nearest notes uses. A note that already has a slot
 * keeps it, so panels don't jump around as the ordering changes. A newcomer takes the free
 * slot closest to its marker's horizontal position, which keeps the lines from crossing.
 */
export function assignSlots(previous: Slots, nearest: readonly Note[], angle: number, tilt: number): Slots {
  const slots: Slots = previous.map((note) => nearest.find((n) => n.id === note?.id) ?? null);
  for (const note of nearest) {
    if (slots.includes(note)) continue;
    const x = project(note, angle, tilt).x;
    let best = -1;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] || (best >= 0 && Math.abs(slotX(i, slots.length) - x) >= Math.abs(slotX(best, slots.length) - x))) continue;
      best = i;
    }
    if (best >= 0) slots[best] = note;
  }
  return slots;
}

export const sameSlots = (a: Slots, b: Slots) => a.length === b.length && a.every((n, i) => n === b[i]);

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
