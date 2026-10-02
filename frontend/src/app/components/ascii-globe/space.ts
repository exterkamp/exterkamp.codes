import { LineCell, placeConstellations, PlacedConstellation } from './constellations';

/** The dark ASCII space behind the globe: a full-width band of cells that fades in from the white page at the top and out at the bottom, with a few stars. */

export interface SpaceOptions {
  cols: number;
  rows: number;
  /** Rows over which the top edge fades from nearly white to solid dark. */
  fadeTop: number;
  /** Rows over which the bottom edge fades from solid dark to nearly white: the mirror of the top. */
  fadeBottom: number;
  /** Seed for star placement and grain; the same seed always gives the same cells. */
  seed: number;
  /** Chance that a dark cell holds a star. */
  starChance: number;
  /** Cells are keyed by their row and their column relative to this one (usually the middle), so changing `cols` never shuffles the cells near the center. */
  centerCol: number;
  /** Cells inside this ellipse (the globe's outline, in cells) get no stars, since the globe is drawn over them. */
  clear: { col: number; row: number; rx: number; ry: number };
}

/** A cell of the solid interior that is drawn on its own, so CSS can color or animate it. */
export interface SpaceMark {
  row: number;
  col: number;
  char: string;
  kind: 'twinkle' | 'glitter' | 'constellation-star' | 'constellation-line';
  /** Seconds one animation cycle lasts (twinkle and glitter only). */
  duration?: number;
  /** Seconds into the cycle where this star starts, so no two share a rhythm (twinkle and glitter only). */
  delay?: number;
}

export interface Space {
  cols: number;
  rows: number;
  /** How dark each cell is in [0, 1], row by row: 0 is the page's white, 1 is solid space. */
  levels: Float32Array;
  /** The star in each cell, or ' '. Only cells at level 1 have one: the solid interior, and fade cells the noise pushed all the way up. */
  glyphs: string[];
  /** The interior's cells that animate or belong to a constellation, by row then column. `glyphs` holds their characters too. */
  marks: SpaceMark[];
  /** The figures that fit this width. */
  constellations: PlacedConstellation[];
}

/** Share of stars that twinkle, and that glitter. The rest stay still. */
export const TWINKLE_SHARE = 0.15;
export const GLITTER_SHARE = 0.03;
/** Seconds one cycle lasts: a twinkle fades dim and bright over it, a glitter flashes once in it. */
export const TWINKLE_SECONDS = { min: 3, max: 9 };
export const GLITTER_SECONDS = { min: 6, max: 14 };
/** Most elements that animate at once. */
export const MAX_ANIMATED = 200;

export const STAR_GLYPHS = ".'*+";

/** Characters from faint to dense. The fade is drawn with these, denser ones at higher levels. */
export const RAMP = '.,:;+*#%';

/** How far the seeded noise can push a cell's level either way (it spans this much in total). */
export const NOISE_AMPLITUDE = 0.5;

/** The ramp character for a level in [0, 1]. */
export function rampChar(level: number): string {
  return RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(level * RAMP.length)))];
}

/** How dark a cell should be before noise, in (0, 1]: low at the top and bottom edges, 1 once `fade` rows in. The sides never fade. */
export function density(row: number, rows: number, fadeTop: number, fadeBottom: number): number {
  return Math.min(1, (row + 0.5) / fadeTop, (rows - row - 0.5) / fadeBottom);
}

/** The level of a cell: its density pushed up or down by `noise` in [0, 1), kept in [0, 1]. Solid cells (density 1) stay solid. */
export function level(densityValue: number, noise: number): number {
  if (densityValue >= 1) return 1;
  return Math.max(0, Math.min(1, densityValue + (noise - 0.5) * NOISE_AMPLITUDE));
}

/** A seeded number in [0, 1) for one cell and one stream: the same inputs always give the same number, whatever else is drawn. */
export function cellRandom(seed: number, row: number, col: number, stream: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(row + 0x1000, 0xc2b2ae35) ^ Math.imul(col + 0x100000, 0x27d4eb2f) ^ Math.imul(stream + 1, 0x165667b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function createSpace(options: SpaceOptions): Space {
  const { cols, rows, fadeTop, fadeBottom, starChance, clear, seed, centerCol } = options;
  const levels = new Float32Array(cols * rows);
  const glyphs: string[] = new Array(cols * rows).fill(' ');
  const motion = new Map<number, SpaceMark>();
  const moving: { rank: number; mark: SpaceMark }[] = [];
  for (let r = 0; r < rows; r++) {
    const rowDensity = density(r, rows, fadeTop, fadeBottom);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const dc = c - centerCol;
      // Cells are keyed by position from the center column, so a wider or narrower band keeps the same cells near the globe.
      levels[i] = level(rowDensity, cellRandom(seed, r, dc, 0));
      if (levels[i] < 1) continue;
      const inGlobe = Math.hypot((c + 0.5 - clear.col) / clear.rx, (r + 0.5 - clear.row) / clear.ry) <= 1;
      if (!inGlobe && cellRandom(seed, r, dc, 1) < starChance) glyphs[i] = STAR_GLYPHS[Math.floor(cellRandom(seed, r, dc, 2) * STAR_GLYPHS.length)];
      if (glyphs[i] === ' ' || r < fadeTop || r >= rows - fadeBottom) continue;
      // Which stars move, and how, comes from the cell's own hash, so it is the same on every load and at every width.
      const pick = cellRandom(seed, r, dc, 3);
      const kind = pick < TWINKLE_SHARE ? 'twinkle' : pick < TWINKLE_SHARE + GLITTER_SHARE ? 'glitter' : null;
      if (!kind) continue;
      const range = kind === 'twinkle' ? TWINKLE_SECONDS : GLITTER_SECONDS;
      const duration = range.min + cellRandom(seed, r, dc, 4) * (range.max - range.min);
      moving.push({ rank: cellRandom(seed, r, dc, 6), mark: { row: r, col: c, char: glyphs[i], kind, duration, delay: cellRandom(seed, r, dc, 5) * duration } });
    }
  }
  // Over the cap, the stars that keep moving are picked by their own hash rather than by position, so no part of the sky goes still first.
  if (moving.length > MAX_ANIMATED) moving.sort((a, b) => a.rank - b.rank).length = MAX_ANIMATED;
  for (const { mark } of moving) motion.set(mark.row * cols + mark.col, mark);
  const constellations = placeConstellations({ cols, rows, fadeTop, fadeBottom, centerCol, clear });
  const draw = (cell: LineCell, kind: SpaceMark['kind']) => {
    const i = cell.row * cols + cell.col;
    glyphs[i] = cell.char;
    motion.set(i, { row: cell.row, col: cell.col, char: cell.char, kind });
  };
  // A figure replaces whatever star was in its cell.
  for (const figure of constellations) {
    for (const line of figure.lines) draw(line, 'constellation-line');
    for (const star of figure.stars) draw({ ...star, char: '*' }, 'constellation-star');
  }
  const marks = [...motion.values()].sort((a, b) => a.row - b.row || a.col - b.col);
  return { cols, rows, levels, glyphs, marks, constellations };
}
