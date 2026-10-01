/** The dark ASCII space behind the globe: a grid of cells that fade from the white page to solid dark, with a few stars. */

export interface SpaceOptions {
  cols: number;
  rows: number;
  /** Rows over which the top edge fades from nearly white to solid dark. */
  fadeTop: number;
  /** Columns over which each side edge does the same. */
  fadeSide: number;
  /** Seed for star placement; the same seed always gives the same stars. */
  seed: number;
  /** Chance that a dark cell holds a star. */
  starChance: number;
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

/** How dark a cell should be before noise, in (0, 1]: low at the top and side edges, 1 once `fade` cells in. */
export function density(col: number, row: number, cols: number, rows: number, fadeTop: number, fadeSide: number): number {
  const edge = Math.min((row + 0.5) / fadeTop, (col + 0.5) / fadeSide, (cols - col - 0.5) / fadeSide);
  return Math.min(1, edge);
}

/** The level of a cell: its density pushed up or down by `noise` in [0, 1), kept in [0, 1]. Solid cells (density 1) stay solid. */
export function level(densityValue: number, noise: number): number {
  if (densityValue >= 1) return 1;
  return Math.max(0, Math.min(1, densityValue + (noise - 0.5) * NOISE_AMPLITUDE));
}

/** A small seeded random number generator (mulberry32) returning values in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSpace(options: SpaceOptions): Space {
  const { cols, rows, fadeTop, fadeSide, starChance, clear } = options;
  const random = seededRandom(options.seed);
  // The grain has its own stream, so stars never move when the fade changes.
  const grain = seededRandom(options.seed + 0x9e3779b9);
  const levels = new Float32Array(cols * rows);
  const glyphs: string[] = new Array(cols * rows).fill(' ');
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      levels[i] = level(density(c, r, cols, rows, fadeTop, fadeSide), grain());
      // Draw both numbers for every cell so a star never moves when the fade or the clearing changes.
      const roll = random();
      const glyph = STAR_GLYPHS[Math.floor(random() * STAR_GLYPHS.length)];
      const inGlobe = Math.hypot((c + 0.5 - clear.col) / clear.rx, (r + 0.5 - clear.row) / clear.ry) <= 1;
      if (levels[i] === 1 && !inGlobe && roll < starChance) glyphs[i] = glyph;
    }
  }
  return { cols, rows, levels, glyphs };
}
