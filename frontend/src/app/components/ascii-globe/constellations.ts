/** Five named constellations drawn as faint connected-dot figures in the dark space, beside the globe. */

export interface Point {
  col: number;
  row: number;
}

export interface Constellation {
  name: string;
  /** Where the figure's top-left corner goes: columns from the center column, and the absolute row in the space. */
  origin: { dc: number; row: number };
  /** Star positions in cells, relative to the origin. */
  stars: readonly [number, number][];
  /** Pairs of indexes into `stars`. An edge only ever joins two of this figure's own stars. */
  edges: readonly [number, number][];
}

/** A line character with where it goes. */
export interface LineCell extends Point {
  char: string;
}

export interface PlacedConstellation {
  name: string;
  stars: Point[];
  lines: LineCell[];
}

/** Where the figures go. Offsets from the center column never depend on the band's width, so resizing never moves a figure; one that no longer fits is skipped. */
export const CONSTELLATIONS: readonly Constellation[] = [
  {
    name: 'Cassiopeia',
    origin: { dc: -62, row: 15 },
    stars: [[0, 0], [5, 4], [10, 1], [15, 5], [20, 2]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  {
    name: 'Orion',
    origin: { dc: -52, row: 29 },
    // Betelgeuse, Bellatrix, the belt (3), Saiph, Rigel.
    stars: [[1, 0], [13, 1], [5, 6], [8, 5], [11, 5], [3, 12], [14, 11]],
    edges: [[0, 1], [0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]],
  },
  {
    name: 'Big Dipper',
    origin: { dc: 36, row: 15 },
    // Alkaid, Mizar, Alioth, Megrez, Phecda, Merak, Dubhe.
    stars: [[0, 5], [6, 4], [11, 2], [16, 3], [17, 8], [24, 8], [25, 3]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]],
  },
  {
    name: 'Cygnus',
    origin: { dc: 38, row: 31 },
    // Deneb, Sadr, Albireo, and the two wing tips.
    stars: [[7, 0], [7, 6], [7, 13], [0, 8], [14, 4]],
    edges: [[0, 1], [1, 2], [3, 1], [1, 4]],
  },
  {
    name: 'Southern Cross',
    origin: { dc: 70, row: 20 },
    // Gacrux, Acrux, Delta and Beta Crucis.
    stars: [[5, 0], [5, 10], [0, 4], [11, 5]],
    edges: [[0, 1], [2, 3]],
  },
];

/** How tall a cell is compared with its width; it keeps a line's slope true to how it looks. */
const CELL_ASPECT = 1 / 0.6;

/** The character for a line segment of this size: `-`, `|`, `/` or `\`, by how steep it looks on screen. */
export function slopeChar(dCol: number, dRow: number): string {
  const degrees = (Math.atan2(Math.abs(dRow) * CELL_ASPECT, Math.abs(dCol)) * 180) / Math.PI;
  if (degrees < 22.5) return '-';
  if (degrees > 67.5) return '|';
  return dCol * dRow > 0 ? '\\' : '/';
}

/**
 * The cells between two stars (not the stars themselves), by Bresenham's line. The cells alternate between the
 * slope character and a `.`, so the line reads as dotted.
 */
export function rasterizeLine(from: Point, to: Point): LineCell[] {
  const dCol = to.col - from.col;
  const dRow = to.row - from.row;
  const steps = Math.max(Math.abs(dCol), Math.abs(dRow));
  const char = slopeChar(dCol, dRow);
  const cells: LineCell[] = [];
  for (let s = 1; s < steps; s++) {
    cells.push({ col: from.col + Math.round((dCol * s) / steps), row: from.row + Math.round((dRow * s) / steps), char: s % 2 === 1 ? char : '.' });
  }
  return cells;
}

export interface PlacementOptions {
  cols: number;
  rows: number;
  fadeTop: number;
  fadeBottom: number;
  centerCol: number;
  /** The globe's outline in cells. Figures keep a margin of cells away from it. */
  clear: { col: number; row: number; rx: number; ry: number };
}

/** Cells of space kept between a figure and the globe's outline. */
export const GLOBE_MARGIN = 2;

/** The figures that fit: every cell inside the solid rows and the band, and outside the globe's clear zone. */
export function placeConstellations(options: PlacementOptions): PlacedConstellation[] {
  const { cols, rows, fadeTop, fadeBottom, centerCol, clear } = options;
  const placed: PlacedConstellation[] = [];
  for (const figure of CONSTELLATIONS) {
    const stars: Point[] = figure.stars.map(([x, y]) => ({ col: centerCol + figure.origin.dc + x, row: figure.origin.row + y }));
    const lines = figure.edges.flatMap(([a, b]) => rasterizeLine(stars[a], stars[b]));
    const fits = [...stars, ...lines].every(
      (p) =>
        p.col >= 0 &&
        p.col < cols &&
        p.row >= fadeTop &&
        p.row < rows - fadeBottom &&
        Math.hypot((p.col + 0.5 - clear.col) / (clear.rx + GLOBE_MARGIN), (p.row + 0.5 - clear.row) / (clear.ry + GLOBE_MARGIN)) > 1,
    );
    if (fits) placed.push({ name: figure.name, stars, lines });
  }
  return placed;
}
