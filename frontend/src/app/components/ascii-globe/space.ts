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

export interface Space {
  cols: number;
  rows: number;
  /** How dark each cell is in [0, 1], row by row: 0 is the page's white, 1 is solid space. */
  levels: Float32Array;
  /** The star in each cell, or ' '. Only cells at level 1 have one: the solid interior, and fade cells the noise pushed all the way up. */
  glyphs: string[];
}

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
    }
  }
  return { cols, rows, levels, glyphs };
}
