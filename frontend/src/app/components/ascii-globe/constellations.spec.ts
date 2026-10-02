import { CONSTELLATIONS, placeConstellations, PlacedConstellation, rasterizeLine, slopeChar } from './constellations';
import { HEADLINE_ROWS, SPACE_FADE, SPACE_ROWS, buildSpace, spaceCols } from './ascii-globe';

const ROWS = 37;
const GLOBE = { rx: 61 / 2, ry: ROWS / 2 };

const place = (width: number): { cols: number; figures: PlacedConstellation[] } => {
  const cols = spaceCols(width, 7.2);
  return {
    cols,
    figures: placeConstellations({
      cols,
      rows: SPACE_ROWS,
      fadeTop: SPACE_FADE.top,
      fadeBottom: SPACE_FADE.bottom,
      centerCol: Math.floor(cols / 2),
      rowOffset: HEADLINE_ROWS,
      clear: { col: cols / 2, row: SPACE_FADE.top + HEADLINE_ROWS + ROWS / 2, ...GLOBE },
    }),
  };
};

const cellsOf = (f: PlacedConstellation) => [...f.stars, ...f.lines];

describe('constellation data', () => {
  it('has the five named figures, with edges only between a figure\'s own stars', () => {
    expect(CONSTELLATIONS.map((c) => c.name)).toEqual(['Cassiopeia', 'Orion', 'Big Dipper', 'Cygnus', 'Southern Cross']);
    for (const c of CONSTELLATIONS) {
      expect(c.stars.length).toBeGreaterThanOrEqual(4);
      for (const [a, b] of c.edges) {
        expect(a).not.toBe(b);
        expect(c.stars[a]).toBeDefined();
        expect(c.stars[b]).toBeDefined();
      }
    }
  });

  it('draws every edge from its own two stars, and no line cell lies off all its figure\'s edges', () => {
    const { figures } = place(1920);
    for (const f of figures) {
      const source = CONSTELLATIONS.find((c) => c.name === f.name)!;
      const own = source.edges.flatMap(([a, b]) => rasterizeLine(f.stars[a], f.stars[b]));
      expect(f.lines).toEqual(own);
    }
  });
});

describe('constellation placement', () => {
  for (const width of [1024, 1440, 1920]) {
    it(`keeps every figure off the globe, the fade rows and the others at ${width}px`, () => {
      const { cols, figures } = place(width);
      const seen = new Map<string, string>();
      for (const f of figures) {
        for (const p of cellsOf(f)) {
          expect(p.col).toBeGreaterThanOrEqual(0);
          expect(p.col).toBeLessThan(cols);
          expect(p.row).toBeGreaterThanOrEqual(SPACE_FADE.top);
          expect(p.row).toBeLessThan(SPACE_ROWS - SPACE_FADE.bottom);
          const inGlobe = Math.hypot((p.col + 0.5 - cols / 2) / GLOBE.rx, (p.row + 0.5 - (SPACE_FADE.top + HEADLINE_ROWS + ROWS / 2)) / GLOBE.ry) <= 1;
          expect(inGlobe).toBe(false);
          // Nothing is drawn in the rows the headline takes.
          expect(p.row < SPACE_FADE.top || p.row >= SPACE_FADE.top + HEADLINE_ROWS).toBe(true);
          const key = `${p.col},${p.row}`;
          // No cell is used by two figures.
          expect(seen.has(key) && seen.get(key) !== f.name).toBe(false);
          seen.set(key, f.name);
        }
      }
    });
  }

  it('shows all five at 1440px and 1920px, and at least three at 1024px', () => {
    expect(place(1440).figures.length).toBe(5);
    expect(place(1920).figures.length).toBe(5);
    expect(place(1024).figures.length).toBeGreaterThanOrEqual(3);
  });

  it('skips figures that do not fit a narrow band, and moves none when it widens', () => {
    expect(place(390).figures.length).toBeLessThan(3);
    const narrow = place(1024).figures;
    const wide = place(1920).figures;
    const key = (f: PlacedConstellation, cols: number) => f.stars.map((s) => `${s.col - Math.floor(cols / 2)},${s.row}`).join(' ');
    for (const f of narrow) {
      const same = wide.find((w) => w.name === f.name)!;
      expect(key(same, place(1920).cols)).toBe(key(f, place(1024).cols));
    }
  });

  it('puts the figures in the space as stars and line characters', () => {
    const space = buildSpace(spaceCols(1440, 7.2));
    expect(space.constellations.length).toBe(5);
    const stars = space.marks.filter((m) => m.kind === 'constellation-star');
    const lines = space.marks.filter((m) => m.kind === 'constellation-line');
    expect(stars.length).toBe(CONSTELLATIONS.reduce((n, c) => n + c.stars.length, 0));
    expect(stars.every((m) => m.char === '*' && space.glyphs[m.row * space.cols + m.col] === '*')).toBe(true);
    expect(lines.length).toBeGreaterThan(20);
    expect(lines.every((m) => '.-|/\\'.includes(m.char))).toBe(true);
  });
});

describe('line rasterization', () => {
  it('picks the character by the slope as it looks on screen', () => {
    expect(slopeChar(10, 0)).toBe('-');
    expect(slopeChar(0, 10)).toBe('|');
    expect(slopeChar(3, 10)).toBe('|');
    expect(slopeChar(10, 5)).toBe('\\');
    expect(slopeChar(10, -5)).toBe('/');
    expect(slopeChar(-10, 5)).toBe('/');
  });

  it('fills the cells between two stars, leaving out the stars, alternating the line character and a dot', () => {
    const cells = rasterizeLine({ col: 0, row: 0 }, { col: 8, row: 0 });
    expect(cells.map((c) => c.col)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(cells.every((c) => c.row === 0)).toBe(true);
    expect(cells.map((c) => c.char).join('')).toBe('-.-.-.-');
    expect(rasterizeLine({ col: 0, row: 0 }, { col: 0, row: 5 }).map((c) => c.char).join('')).toBe('|.|.');
    expect(rasterizeLine({ col: 0, row: 0 }, { col: 1, row: 1 })).toEqual([]);
  });

  it('runs the same both ways around, one cell per step along the longer axis', () => {
    const a = rasterizeLine({ col: 2, row: 1 }, { col: 14, row: 7 });
    expect(a.length).toBe(11);
    const cols = a.map((c) => c.col);
    expect(cols).toEqual([...cols].sort((x, y) => x - y));
  });
});
