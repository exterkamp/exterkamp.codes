import { GLITTER_SECONDS, MAX_ANIMATED, TWINKLE_SECONDS, cellRandom, createSpace, density, level, NOISE_AMPLITUDE, RAMP, rampChar, SpaceOptions, STAR_GLYPHS } from './space';

const options: SpaceOptions = {
  cols: 60,
  rows: 40,
  fadeTop: 8,
  fadeBottom: 8,
  centerCol: 30,
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
const wide: SpaceOptions = { ...options, cols: 93, rows: 60, fadeTop: 12, fadeBottom: 12, centerCol: 46 };

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
    const means = Array.from({ length: wide.fadeTop }, (_, r) => rowMean(levels, cols, r, 0, cols));
    expect(means[0]).toBeLessThan(0.2);
    expect(means[wide.fadeTop - 1]).toBeGreaterThan(0.8);
    means.slice(1).forEach((m, i) => expect(m).toBeGreaterThanOrEqual(means[i]));
  });

  it('falls at the bottom edge row by row, mirroring the top, from above 0.8 to below 0.2', () => {
    const { levels, cols, rows } = createSpace(wide);
    const bottom = Array.from({ length: wide.fadeBottom }, (_, r) => rowMean(levels, cols, rows - wide.fadeBottom + r, 0, cols));
    expect(bottom[0]).toBeGreaterThan(0.8);
    expect(bottom[wide.fadeBottom - 1]).toBeLessThan(0.2);
    bottom.slice(1).forEach((m, i) => expect(m).toBeLessThanOrEqual(bottom[i]));
    // The same ramp as the top, read from the other end.
    const top = Array.from({ length: wide.fadeTop }, (_, r) => rowMean(levels, cols, r, 0, cols));
    top.forEach((m, r) => expect(Math.abs(m - bottom[wide.fadeBottom - 1 - r])).toBeLessThan(0.1));
  });

  it('never fades at the sides: every column, including the first and last, is solid in the solid rows', () => {
    const { levels, cols, rows } = createSpace(wide);
    for (let r = wide.fadeTop; r < rows - wide.fadeBottom; r++) {
      for (let c = 0; c < cols; c++) expect(levels[r * cols + c]).toBe(1);
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

  it('is solid between the two fades', () => {
    const { levels, cols, rows } = createSpace(options);
    for (let r = options.fadeTop; r < rows - options.fadeBottom; r++) {
      for (let c = 0; c < cols; c++) expect(levels[r * cols + c]).toBe(1);
    }
  });

  it('gives a bit of everything near the top edge and nearly nothing there at the very first row', () => {
    expect(density(0, 40, 8, 8)).toBeLessThan(0.1);
    expect(density(39, 40, 8, 8)).toBeLessThan(0.1);
  });

  it('has a density of 1 away from every edge, and noise only moves a level by half the amplitude', () => {
    expect(density(20, 40, 8, 8)).toBe(1);
    expect(density(0, 40, 8, 8)).toBeLessThan(0.1);
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

  it('keep their places relative to the center column when the width changes', () => {
    const narrow = createSpace({ ...wide, cols: 61, centerCol: 30, clear: { ...wide.clear, col: 30.5 } });
    const broad = createSpace({ ...wide, cols: 121, centerCol: 60, clear: { ...wide.clear, col: 60.5 } });
    let stars = 0;
    for (let r = 0; r < wide.rows; r++) {
      for (let dc = -30; dc <= 30; dc++) {
        const a = narrow.glyphs[r * 61 + 30 + dc];
        const b = broad.glyphs[r * 121 + 60 + dc];
        // The globe clearing is centered on both, so it is the same place too.
        expect(b).toBe(a);
        if (a !== ' ') stars++;
      }
    }
    expect(stars).toBeGreaterThan(20);
  });

  it('draws the seeded random numbers the same every time, in [0, 1)', () => {
    expect(cellRandom(3, 4, -5, 0)).toBe(cellRandom(3, 4, -5, 0));
    expect(cellRandom(3, 4, -5, 0)).not.toBe(cellRandom(3, 4, -5, 1));
    for (let i = 0; i < 1000; i++) {
      const v = cellRandom(3, i, i - 500, 0);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('star motion', () => {
  const big: SpaceOptions = { ...options, cols: 267, rows: 61, fadeTop: 12, fadeBottom: 12, centerCol: 133, starChance: 0.035, clear: { col: 133.5, row: 30.5, rx: 30.5, ry: 18.5 } };
  const motion = (space: ReturnType<typeof createSpace>) => space.marks.filter((m) => m.kind === 'twinkle' || m.kind === 'glitter');

  it('is the same on every build, and the same cell keeps its motion when the band is resized', () => {
    const a = createSpace(big);
    expect(createSpace({ ...big }).marks).toEqual(a.marks);
    const narrow = createSpace({ ...big, cols: 201, centerCol: 100 });
    const key = (m: { row: number; col: number }, center: number) => `${m.row},${m.col - center}`;
    const wide = new Map(motion(a).map((m) => [key(m, 133), m]));
    // A star's duration and delay never change with the width. (Cells near the globe's outline may differ, since the clear ellipse moves with the center.)
    const shared = motion(narrow).filter((m) => wide.has(key(m, 100)));
    expect(shared.length).toBeGreaterThan(10);
    for (const m of shared) expect(wide.get(key(m, 100))).toEqual({ ...m, col: wide.get(key(m, 100))!.col });
  });

  it('moves about 15% of the stars as twinkles and about 3% as glitters', () => {
    const space = createSpace({ ...big, starChance: 0.2 });
    const twinkles = space.marks.filter((m) => m.kind === 'twinkle').length;
    const glitters = space.marks.filter((m) => m.kind === 'glitter').length;
    const normal = createSpace(big);
    const normalStars = normal.glyphs.filter((g) => g !== ' ').length - normal.marks.filter((m) => m.kind.startsWith('constellation')).length;
    const n = (k: string) => normal.marks.filter((m) => m.kind === k).length;
    expect(n('twinkle') / normalStars).toBeGreaterThan(0.1);
    expect(n('twinkle') / normalStars).toBeLessThan(0.2);
    expect(n('glitter') / normalStars).toBeGreaterThan(0.01);
    expect(n('glitter') / normalStars).toBeLessThan(0.06);
    expect(twinkles + glitters).toBeLessThanOrEqual(MAX_ANIMATED);
  });

  it('gives twinkles 3 to 9 seconds, glitters 6 to 14, and a start offset inside the cycle', () => {
    const space = createSpace(big);
    for (const m of motion(space)) {
      const range = m.kind === 'twinkle' ? TWINKLE_SECONDS : GLITTER_SECONDS;
      expect(m.duration!).toBeGreaterThanOrEqual(range.min);
      expect(m.duration!).toBeLessThanOrEqual(range.max);
      expect(m.delay!).toBeGreaterThanOrEqual(0);
      expect(m.delay!).toBeLessThan(m.duration!);
      expect(STAR_GLYPHS.includes(m.char)).toBe(true);
    }
    expect(new Set(motion(space).map((m) => m.duration)).size).toBeGreaterThan(motion(space).length / 2);
  });

  it('never animates more than the cap, and only in the interior', () => {
    const space = createSpace({ ...big, starChance: 0.5 });
    expect(motion(space).length).toBeLessThanOrEqual(MAX_ANIMATED);
    expect(space.marks.every((m) => m.row >= big.fadeTop && m.row < big.rows - big.fadeBottom)).toBe(true);
  });
});
