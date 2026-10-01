import { bayer, createSpace, density, seededRandom, SpaceOptions, STAR_GLYPHS } from './space';

const options: SpaceOptions = {
  cols: 60,
  rows: 40,
  fadeTop: 8,
  fadeSide: 12,
  seed: 7,
  starChance: 0.05,
  clear: { col: 30, row: 22, rx: 15, ry: 9 },
};

const darkInRow = (dark: Uint8Array, cols: number, row: number, from = 0, to = cols) => {
  let n = 0;
  for (let c = from; c < to; c++) n += dark[row * cols + c];
  return n;
};
const darkInCol = (dark: Uint8Array, cols: number, rows: number, col: number, from = 0, to = rows) => {
  let n = 0;
  for (let r = from; r < to; r++) n += dark[r * cols + col];
  return n;
};

describe('space dither', () => {
  it('is the same every time', () => {
    const a = createSpace(options);
    const b = createSpace({ ...options });
    expect(Array.from(b.dark)).toEqual(Array.from(a.dark));
    expect(b.glyphs).toEqual(a.glyphs);
  });

  it('uses a fixed threshold pattern whose values are all distinct within a 4x4 tile', () => {
    const seen = new Set<number>();
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) seen.add(bayer(c, r));
    expect(seen.size).toBe(16);
    expect(bayer(5, 9)).toBe(bayer(1, 1));
  });

  it('is nearly white at the top edge and solid dark inside, rising row by row', () => {
    const { dark, cols } = createSpace(options);
    const sideFree = [options.fadeSide, cols - options.fadeSide] as const;
    const counts = Array.from({ length: options.fadeTop + 4 }, (_, r) => darkInRow(dark, cols, r, ...sideFree));
    const width = sideFree[1] - sideFree[0];
    expect(counts[0]).toBeLessThan(width * 0.3);
    expect(counts[options.fadeTop]).toBe(width);
    // The 4x4 pattern makes single rows uneven, so compare bands of 4 rows, which the pattern tiles exactly.
    const band = (from: number) => counts.slice(from, from + 4).reduce((a, b) => a + b, 0);
    expect(band(0)).toBeLessThan(band(4));
    expect(band(4)).toBeLessThan(4 * width);
    expect(band(8)).toBe(4 * width);
  });

  it('is nearly white at the left and right edges and solid dark inside, rising column by column', () => {
    const { dark, cols, rows } = createSpace(options);
    const rowsFree = [options.fadeTop, rows] as const;
    const height = rowsFree[1] - rowsFree[0];
    const left = Array.from({ length: options.fadeSide + 4 }, (_, c) => darkInCol(dark, cols, rows, c, ...rowsFree));
    const right = Array.from({ length: options.fadeSide + 4 }, (_, c) => darkInCol(dark, cols, rows, cols - 1 - c, ...rowsFree));
    for (const counts of [left, right]) {
      expect(counts[0]).toBeLessThan(height * 0.3);
      expect(counts[options.fadeSide]).toBe(height);
      expect(counts[options.fadeSide + 3]).toBe(height);
      const band = (from: number) => counts.slice(from, from + 4).reduce((a, b) => a + b, 0);
      expect(band(0)).toBeLessThan(band(4));
      expect(band(4)).toBeLessThan(band(8));
      expect(band(8)).toBeLessThan(4 * height);
      expect(band(12)).toBe(4 * height);
    }
  });

  it('has no fade at the bottom edge', () => {
    const { dark, cols, rows } = createSpace(options);
    expect(darkInRow(dark, cols, rows - 1, options.fadeSide, cols - options.fadeSide)).toBe(cols - 2 * options.fadeSide);
  });

  it('has a density of 1 away from every edge', () => {
    expect(density(30, 20, 60, 40, 8, 12)).toBe(1);
    expect(density(0, 20, 60, 40, 8, 12)).toBeLessThan(0.1);
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
    const { glyphs, dark, cols } = createSpace(options);
    glyphs.forEach((glyph, i) => {
      if (glyph === ' ') return;
      expect(STAR_GLYPHS).toContain(glyph);
      expect(dark[i]).toBe(1);
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

  it('draws the seeded random numbers the same every time', () => {
    const a = seededRandom(3);
    const b = seededRandom(3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
