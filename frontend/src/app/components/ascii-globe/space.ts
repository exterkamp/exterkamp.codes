/** The dark ASCII space behind the globe: a grid of dark and white cells, with a few stars. */

export interface SpaceOptions {
  cols: number;
  rows: number;
  /** Rows over which the top edge dithers from nearly white to solid dark. */
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
  /** 1 where a cell is dark, 0 where it is left white, row by row. */
  dark: Uint8Array;
  /** The star in each cell, or ' '. Only dark cells have one. */
  glyphs: string[];
}

export const STAR_GLYPHS = ".'*+";

// 4x4 ordered-dither (Bayer) matrix: a fixed threshold pattern, so the dither is the same every time.
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** The threshold in (0, 1) a cell's density must beat to be dark. */
export function bayer(col: number, row: number): number {
  return (BAYER[row & 3][col & 3] + 0.5) / 16;
}

/** How dark a cell should be, in (0, 1]: low at the top and side edges, 1 once `fade` cells in. */
export function density(col: number, row: number, cols: number, rows: number, fadeTop: number, fadeSide: number): number {
  const edge = Math.min((row + 0.5) / fadeTop, (col + 0.5) / fadeSide, (cols - col - 0.5) / fadeSide);
  return Math.min(1, edge);
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
  const dark = new Uint8Array(cols * rows);
  const glyphs: string[] = new Array(cols * rows).fill(' ');
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      dark[i] = density(c, r, cols, rows, fadeTop, fadeSide) > bayer(c, r) ? 1 : 0;
      // Draw both numbers for every cell so a star never moves when the dither or the clearing changes.
      const roll = random();
      const glyph = STAR_GLYPHS[Math.floor(random() * STAR_GLYPHS.length)];
      const inGlobe = Math.hypot((c + 0.5 - clear.col) / clear.rx, (r + 0.5 - clear.row) / clear.ry) <= 1;
      if (dark[i] && !inGlobe && roll < starChance) glyphs[i] = glyph;
    }
  }
  return { cols, rows, dark, glyphs };
}
