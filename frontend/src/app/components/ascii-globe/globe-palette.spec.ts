import {
  cellCode,
  cellRgb,
  decodeCell,
  DESERT_COLOR,
  ICE_COLOR,
  LIGHT_LEVELS,
  NIGHT_FLOOR,
  MARKER_CELL,
  MARKER_COLOR,
  NO_CELL,
  OCEAN_COLOR,
  Rgb,
  shade,
  SPACE_COLOR,
  STAR_COLOR,
  Terrain,
  TERRAIN_COLORS,
  VEGETATION_COLOR,
  FADE_INK,
  DARK_INK,
  inkColor,
  PAGE_COLOR,
  TINT_STEPS,
  tintColor,
  tintStep,
} from './globe-palette';

export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colors. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('palette', () => {
  it('has one named color per terrain, blue ocean, green land, tan desert and white ice', () => {
    expect(TERRAIN_COLORS[Terrain.Ocean]).toBe(OCEAN_COLOR);
    expect(TERRAIN_COLORS[Terrain.Vegetation]).toBe(VEGETATION_COLOR);
    expect(TERRAIN_COLORS[Terrain.Desert]).toBe(DESERT_COLOR);
    expect(TERRAIN_COLORS[Terrain.Ice]).toBe(ICE_COLOR);
    const [or, og, ob] = OCEAN_COLOR;
    expect(ob).toBeGreaterThan(Math.max(or, og));
    const [vr, vg, vb] = VEGETATION_COLOR;
    expect(vg).toBeGreaterThan(Math.max(vr, vb));
    const [dr, dg, db] = DESERT_COLOR;
    expect(dr).toBeGreaterThan(dg);
    expect(dg).toBeGreaterThan(db);
    expect(Math.min(...ICE_COLOR)).toBeGreaterThan(230);
  });

  it('keeps the four terrain colors, the stars and the markers readable on the dark space (3:1)', () => {
    for (const color of [...Object.values(TERRAIN_COLORS), STAR_COLOR, MARKER_COLOR]) {
      expect(contrast(color, SPACE_COLOR)).toBeGreaterThanOrEqual(3);
    }
  });

  it('derives lit and shaded variants from the light value', () => {
    expect(shade(OCEAN_COLOR, 1)).toEqual([...OCEAN_COLOR]);
    expect(shade(OCEAN_COLOR, 0.5)).toEqual(OCEAN_COLOR.map((v) => Math.round(v / 2)));
    // The brightest level is the full color, and each level down is darker.
    for (const terrain of [Terrain.Ocean, Terrain.Vegetation, Terrain.Desert, Terrain.Ice]) {
      expect(cellRgb(cellCode(terrain, 1))).toEqual([...TERRAIN_COLORS[terrain]]);
      let previous = Infinity;
      for (let level = LIGHT_LEVELS - 1; level >= 0; level--) {
        const lum = luminance(cellRgb(cellCode(terrain, (level + 0.5) / LIGHT_LEVELS))!);
        expect(lum).toBeLessThan(previous);
        previous = lum;
      }
    }
  });

  it('keeps even the darkest night-side cell of every terrain visible against the space (1.8:1)', () => {
    expect(NIGHT_FLOOR).toBeGreaterThan(0);
    for (const terrain of [Terrain.Ocean, Terrain.Vegetation, Terrain.Desert, Terrain.Ice]) {
      expect(contrast(cellRgb(cellCode(terrain, 0))!, SPACE_COLOR)).toBeGreaterThanOrEqual(1.8);
    }
  });

  it('round-trips terrain and brightness through the cell code', () => {
    expect(decodeCell(cellCode(Terrain.Desert, 0.5))).toEqual({ terrain: Terrain.Desert, level: 4 });
    expect(decodeCell(cellCode(Terrain.Ice, 0))).toEqual({ terrain: Terrain.Ice, level: 0 });
    expect(decodeCell(cellCode(Terrain.Ocean, 5))).toEqual({ terrain: Terrain.Ocean, level: LIGHT_LEVELS - 1 });
    expect(decodeCell(NO_CELL)).toBeNull();
    expect(decodeCell(MARKER_CELL)).toBeNull();
    expect(cellRgb(MARKER_CELL)).toBe(MARKER_COLOR);
    expect(cellRgb(NO_CELL)).toBeNull();
  });
});

describe('space tint', () => {
  const luminance = (c: Rgb) => {
    const [r, g, b] = c.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  it('has at least 6 steps, from the page white to exactly the space color', () => {
    expect(TINT_STEPS).toBeGreaterThanOrEqual(6);
    expect(tintColor(0)).toEqual(PAGE_COLOR);
    expect(tintColor(TINT_STEPS - 1)).toEqual(SPACE_COLOR);
  });

  it('gets darker with every step', () => {
    for (let s = 1; s < TINT_STEPS; s++) expect(luminance(tintColor(s))).toBeLessThan(luminance(tintColor(s - 1)));
  });

  it('maps level 0 to the bare page and only level 1 to solid, never going back', () => {
    expect(tintStep(0)).toBe(0);
    expect(tintStep(0.15)).toBe(0);
    expect(tintStep(1)).toBe(TINT_STEPS - 1);
    expect(tintStep(0.999)).toBeLessThan(TINT_STEPS - 1);
    let last = 0;
    for (let l = 0; l <= 1; l += 0.01) {
      expect(tintStep(l)).toBeGreaterThanOrEqual(last);
      last = tintStep(l);
    }
    expect(new Set([0, 0.2, 0.4, 0.6, 0.8, 1].map(tintStep)).size).toBe(6);
  });

  it('keeps the outer ink faint against white: contrast of at most 1.6:1', () => {
    const contrast = 1.05 / (luminance(inkColor(tintStep(0.15))) + 0.05);
    expect(contrast).toBeLessThanOrEqual(1.6);
    expect(inkColor(0)).toEqual(FADE_INK);
    expect(inkColor(TINT_STEPS - 1)).toEqual(STAR_COLOR);
  });

  it('starts the fade ink light gray at the page and darkens it to almost black next to the solid space', () => {
    expect(inkColor(TINT_STEPS - 2)).toEqual(DARK_INK);
    expect(luminance(DARK_INK)).toBeLessThan(0.02);
    for (let s = 1; s < TINT_STEPS - 1; s++) expect(luminance(inkColor(s))).toBeLessThan(luminance(inkColor(s - 1)));
  });
});
