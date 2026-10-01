import { createSpace, density, level, NOISE_AMPLITUDE, RAMP, rampChar, seededRandom, SpaceOptions, STAR_GLYPHS } from './space';

const options: SpaceOptions = {
  cols: 60,
  rows: 40,
  fadeTop: 8,
  fadeSide: 12,
  seed: 7,
  starChance: 0.05,
  clear: { col: 30, row: 22, rx: 15, ry: 9 },
};

const rowMean = (levels: Float32Array, cols: number, row: number, from: number, to: number) => {
  let sum = 0;
  for (let c = from; c < to; c++) sum += levels[row * cols + c];
  return sum / (to - from);
};
const colMean = (levels: Float32Array, cols: number, col: number, from: number, to: number) => {
  let sum = 0;
  for (let r = from; r < to; r++) sum += levels[r * cols + col];
  return sum / (to - from);
};

// A larger grid with the real fade widths, so the averages are smooth.
const wide: SpaceOptions = { ...options, cols: 93, rows: 60, fadeTop: 12, fadeSide: 16 };

describe('space fade', () => {
  it('gives the same levels every time, all within [0, 1]', () => {
    const a = createSpace(options);
    const b = createSpace({ ...options });
    expect(Array.from(b.levels)).toEqual(Array.from(a.levels));
    expect(b.glyphs).toEqual(a.glyphs);
    expect(a.levels.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(Array.from(createSpace({ ...options, seed: 8 }).levels)).not.toEqual(Array.from(a.levels));
  });

  it('rises from the top edge row by row, from below 0.2 to above 0.8', () => {
    const { levels, cols } = createSpace(wide);
    const means = Array.from({ length: wide.fadeTop }, (_, r) => rowMean(levels, cols, r, wide.fadeSide, cols - wide.fadeSide));
    expect(means[0]).toBeLessThan(0.2);
    expect(means[wide.fadeTop - 1]).toBeGreaterThan(0.8);
    means.slice(1).forEach((m, i) => expect(m).toBeGreaterThanOrEqual(means[i]));
  });

  it('rises from the left and right edges column by column', () => {
    const { levels, cols, rows } = createSpace(wide);
    for (const fromRight of [false, true]) {
      const means = Array.from({ length: wide.fadeSide }, (_, c) =>
        colMean(levels, cols, fromRight ? cols - 1 - c : c, wide.fadeTop, rows),
      );
      expect(means[0]).toBeLessThan(0.2);
      expect(means[wide.fadeSide - 1]).toBeGreaterThan(0.8);
      means.slice(1).forEach((m, i) => expect(m).toBeGreaterThanOrEqual(means[i]));
    }
  });

  it('is grain, not a repeating pattern: a row is not periodic with period 4 or 8', () => {
    const { levels, cols } = createSpace(wide);
    const row = 3;
    for (const period of [4, 8]) {
      let repeats = 0;
      for (let c = 0; c + period < cols; c++) if (levels[row * cols + c] === levels[row * cols + c + period]) repeats++;
      expect(repeats).toBeLessThan((cols - period) / 2);
    }
  });

  it('is solid beyond the fade, and has no fade at the bottom edge', () => {
    const { levels, cols, rows } = createSpace(options);
    for (let r = options.fadeTop; r < rows; r++) {
      for (let c = options.fadeSide; c < cols - options.fadeSide; c++) expect(levels[r * cols + c]).toBe(1);
    }
    expect(levels[(rows - 1) * cols + 30]).toBe(1);
  });

  it('has a density of 1 away from every edge, and noise only moves a level by half the amplitude', () => {
    expect(density(30, 20, 60, 40, 8, 12)).toBe(1);
    expect(density(0, 20, 60, 40, 8, 12)).toBeLessThan(0.1);
    expect(level(0.5, 0)).toBeCloseTo(0.5 - NOISE_AMPLITUDE / 2);
    expect(level(0.5, 0.5)).toBe(0.5);
    expect(level(1, 0)).toBe(1);
    expect(level(0.02, 0)).toBe(0);
  });
});

// How much ink each ramp character puts in a cell, on a 0-10 scale.
const INK: Record<string, number> = { '.': 1, ',': 2, ':': 3, ';': 4, '+': 5, '*': 6, '#': 8, '%': 9 };

describe('space ramp', () => {
  it('goes from faint to dense', () => {
    const inks = [...RAMP].map((ch) => INK[ch]);
    expect(inks.every((n) => n !== undefined)).toBe(true);
    inks.slice(1).forEach((n, i) => expect(n).toBeGreaterThan(inks[i]));
  });

  it('maps higher levels to denser characters, using at least 6 characters across the fade', () => {
    let last = 0;
    for (let l = 0; l <= 1; l += 0.01) {
      const ink = INK[rampChar(l)];
      expect(ink).toBeGreaterThanOrEqual(last);
      last = ink;
    }
    const { levels } = createSpace(wide);
    expect(new Set(Array.from(levels).filter((l) => l < 1).map(rampChar)).size).toBeGreaterThanOrEqual(6);
    expect(rampChar(0)).toBe(RAMP[0]);
    expect(rampChar(1)).toBe(RAMP[RAMP.length - 1]);
  });
});

describe('space stars', () => {
  it('are placed from a fixed seed: same seed, same stars; another seed, other stars', () => {
    const a = createSpace(options);
    expect(createSpace(options).glyphs).toEqual(a.glyphs);
    expect(createSpace({ ...options, seed: 8 }).glyphs).not.toEqual(a.glyphs);
    expect(a.glyphs.filter((g) => g !== ' ').length).toBeGreaterThan(20);
  });

  it('only use the star characters, only sit on dark cells, and stay out of the globe', () => {
    const { glyphs, levels, cols } = createSpace(options);
    glyphs.forEach((glyph, i) => {
      if (glyph === ' ') return;
      expect(STAR_GLYPHS).toContain(glyph);
      expect(levels[i]).toBe(1);
      const c = i % cols;
      const r = Math.floor(i / cols);
      const { col, row, rx, ry } = options.clear;
      expect(Math.hypot((c + 0.5 - col) / rx, (r + 0.5 - row) / ry)).toBeGreaterThan(1);
    });
  });

  it('keep their places when the globe clearing moves', () => {
    const a = createSpace(options);
    const b = createSpace({ ...options, clear: { ...options.clear, rx: 1, ry: 1 } });
    a.glyphs.forEach((glyph, i) => {
      if (glyph !== ' ') expect(b.glyphs[i]).toBe(glyph);
    });
  });

  it('stay exactly where they were with the old dither, in the solid interior', () => {
    // The old rule: draw two numbers per cell from the seed; a star where the roll is low, outside the globe.
    const random = seededRandom(options.seed);
    const { glyphs, cols, rows } = createSpace(options);
    const { col, row, rx, ry } = options.clear;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const roll = random();
        const glyph = STAR_GLYPHS[Math.floor(random() * STAR_GLYPHS.length)];
        const interior = r >= options.fadeTop && c >= options.fadeSide && c < cols - options.fadeSide;
        const inGlobe = Math.hypot((c + 0.5 - col) / rx, (r + 0.5 - row) / ry) <= 1;
        if (interior) expect(glyphs[r * cols + c]).toBe(!inGlobe && roll < options.starChance ? glyph : ' ');
      }
    }
  });

  it('draws the seeded random numbers the same every time', () => {
    const a = seededRandom(3);
    const b = seededRandom(3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
