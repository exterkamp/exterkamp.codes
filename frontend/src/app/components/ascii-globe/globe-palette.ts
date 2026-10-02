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
/** The brighter stars of a constellation: dimmer than ordinary stars, so the figures stay in the background. */
export const CONSTELLATION_STAR_COLOR: Rgb = [140, 153, 196];
/** The dotted lines joining them: dimmer still. */
export const CONSTELLATION_LINE_COLOR: Rgb = [66, 78, 116];
/** The page the space fades into. */
export const PAGE_COLOR: Rgb = [255, 255, 255];
/** The ramp characters at the faint edge of the fade: light enough to be barely there against white. */
export const FADE_INK: Rgb = [205, 208, 218];

/** The space's fade is drawn in this many background steps: 0 is the bare page, the last is solid space. */
export const TINT_STEPS = 7;

/** Brightness is rounded to this many steps, so neighboring cells of one terrain share a color and a frame needs few distinct styles. */
export const LIGHT_LEVELS = 8;

/** The darkest a shaded cell gets, as a fraction of its lit color, so the night side still reads against the space. */
export const NIGHT_FLOOR = 0.45;

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

/** The color of a lit cell: the terrain's color, darkened for the shaded side but never below NIGHT_FLOOR. The brightest level is the full color. */
export function cellRgb(code: number): Rgb | null {
  if (code === MARKER_CELL) return MARKER_COLOR;
  const cell = decodeCell(code);
  return cell && shade(TERRAIN_COLORS[cell.terrain], NIGHT_FLOOR + ((1 - NIGHT_FLOOR) * (cell.level + 1)) / LIGHT_LEVELS);
}

export function css(color: Rgb): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

/** The tint step of a level in [0, 1]. Only level 1 is the last step (solid); the rest spread evenly over the others. */
export function tintStep(level: number): number {
  if (level >= 1) return TINT_STEPS - 1;
  return Math.max(0, Math.min(TINT_STEPS - 2, Math.floor(level * (TINT_STEPS - 1))));
}

function mix(from: Rgb, to: Rgb, t: number): Rgb {
  return [0, 1, 2].map((k) => Math.round(from[k] + (to[k] - from[k]) * t)) as unknown as Rgb;
}

/** The background of a tint step: the page white at 0, blending to exactly SPACE_COLOR at the last step. */
export function tintColor(step: number): Rgb {
  return mix(PAGE_COLOR, SPACE_COLOR, step / (TINT_STEPS - 1));
}

/** The color of fade characters on a tint step: faint at 0, blending to the star color. */
export function inkColor(step: number): Rgb {
  return mix(FADE_INK, STAR_COLOR, step / (TINT_STEPS - 1));
}
