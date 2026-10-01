/** Surface kinds, as stored in the baked terrain bitmap (plus ocean, which comes from the land bitmap). */
export enum Terrain {
  Ocean = 0,
  Vegetation = 1,
  Desert = 2,
  Ice = 3,
}

export type Rgb = readonly [number, number, number];

/** The fully lit color of each kind of surface. Everything else is derived from these. */
export const OCEAN_COLOR: Rgb = [38, 118, 235];
export const VEGETATION_COLOR: Rgb = [52, 190, 78];
export const DESERT_COLOR: Rgb = [226, 186, 112];
export const ICE_COLOR: Rgb = [244, 248, 255];

export const TERRAIN_COLORS: Record<Terrain, Rgb> = {
  [Terrain.Ocean]: OCEAN_COLOR,
  [Terrain.Vegetation]: VEGETATION_COLOR,
  [Terrain.Desert]: DESERT_COLOR,
  [Terrain.Ice]: ICE_COLOR,
};

/** Notes, their markers, lines and panel outlines. */
export const MARKER_COLOR: Rgb = [241, 16, 16];
/** The dark ASCII space behind the globe. */
export const SPACE_COLOR: Rgb = [8, 10, 24];
/** Stars on the dark space. */
export const STAR_COLOR: Rgb = [214, 220, 238];

/** Brightness is rounded to this many steps, so neighboring cells of one terrain share a color and a frame needs few distinct styles. */
export const LIGHT_LEVELS = 8;

/** A cell off the globe: nothing is drawn. */
export const NO_CELL = 0;
/** A note marker. Drawn on a dark background so its red reads on any terrain. */
export const MARKER_CELL = 255;

/** The code for a lit cell of the given terrain; `light` is the diffuse brightness in [0, 1]. */
export function cellCode(terrain: Terrain, light: number): number {
  const level = Math.max(0, Math.min(LIGHT_LEVELS - 1, Math.floor(light * LIGHT_LEVELS)));
  return 1 + terrain * LIGHT_LEVELS + level;
}

/** Splits a cell code back into its terrain and brightness level (0 = darkest), or null for NO_CELL and markers. */
export function decodeCell(code: number): { terrain: Terrain; level: number } | null {
  if (code === NO_CELL || code === MARKER_CELL) return null;
  return { terrain: Math.floor((code - 1) / LIGHT_LEVELS), level: (code - 1) % LIGHT_LEVELS };
}

/** A color scaled by brightness in [0, 1]: the lit color at 1, a darker version of it below. */
export function shade(color: Rgb, light: number): Rgb {
  return [Math.round(color[0] * light), Math.round(color[1] * light), Math.round(color[2] * light)];
}

/** The color of a lit cell: the terrain's color, darkened for the shaded side. The brightest level is the full color. */
export function cellRgb(code: number): Rgb | null {
  if (code === MARKER_CELL) return MARKER_COLOR;
  const cell = decodeCell(code);
  return cell && shade(TERRAIN_COLORS[cell.terrain], (cell.level + 1) / LIGHT_LEVELS);
}

export function css(color: Rgb): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}
