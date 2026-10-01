import { bitmapLand, createGlobe, Land, MARKER, project, unproject } from './globe-renderer';

const options = { cols: 41, rows: 25, tilt: (23.4 * Math.PI) / 180, light: [-0.5, 0.4, 0.8] } as const;
const deg = (d: number) => (d * Math.PI) / 180;

describe('bitmapLand', () => {
  it('knows some landmarks', () => {
    expect(bitmapLand.isLand(deg(39), deg(-98))).toBe(true); // Kansas
    expect(bitmapLand.isLand(deg(-25), deg(135))).toBe(true); // Australia
    expect(bitmapLand.isLand(deg(0), deg(-30))).toBe(false); // mid-Atlantic
    expect(bitmapLand.isLand(deg(0), deg(-170))).toBe(false); // Pacific
  });

  it('wraps longitude', () => {
    expect(bitmapLand.isLand(deg(39), deg(-98 + 360))).toBe(true);
  });
});

describe('createGlobe', () => {
  const allLand: Land = { isLand: () => true };
  const allOcean: Land = { isLand: () => false };

  it('renders a grid of the requested size', () => {
    const lines = createGlobe(options)(0).split('\n');
    expect(lines).toHaveLength(options.rows);
    lines.forEach((line) => expect(line).toHaveLength(options.cols));
  });

  it('leaves the corners blank and is round', () => {
    const lines = createGlobe(options, allLand)(0).split('\n');
    expect(lines[0][0]).toBe(' ');
    expect(lines[0][options.cols - 1]).toBe(' ');
    expect(lines[options.rows - 1][0]).toBe(' ');
    // The middle row is nearly full width, and the top row is much narrower.
    const width = (line: string) => line.trim().length;
    expect(width(lines[12])).toBeGreaterThan(options.cols - 3);
    expect(width(lines[0])).toBeLessThan(options.cols / 2);
  });

  it('shades land by light, brightest toward the light', () => {
    const lines = createGlobe(options, allLand)(0).split('\n');
    const ramp = ':-=+*#%@';
    const bright = ramp.indexOf(lines[8][14]); // up and to the left, toward the light
    const dark = ramp.indexOf(lines[16][28]); // down and to the right, away from it
    expect(bright).toBeGreaterThan(dark);
  });

  it('draws only blank or dot for an ocean-only world', () => {
    const out = createGlobe(options, allOcean)(0);
    expect(out.replaceAll('\n', '')).toMatch(/^[ .]+$/);
  });

  it('faces the Sahara at angle 0 and the Pacific at angle π', () => {
    const render = createGlobe(options);
    const center = (angle: number) => render(angle).split('\n')[12][20];
    expect(center(0)).not.toMatch(/[ .]/); // 23°N, 0°E
    expect(center(Math.PI)).toMatch(/[ .]/); // 23°N, 180°
  });

  it('spins eastward: features move left to right', () => {
    const render = createGlobe(options);
    const row = (angle: number) => render(angle).split('\n')[12];
    // Africa is under the center at angle 0; after a small spin it should sit right of center.
    const landCols = (s: string) => [...s].flatMap((ch, i) => (/[ .]/.test(ch) ? [] : [i]));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(landCols(row(0.3)))).toBeGreaterThan(mean(landCols(row(0))));
  });
});

describe('unproject', () => {
  const { tilt } = options;

  it('finds the point facing the viewer at the center', () => {
    const spot = unproject(0, 0, 0, 0)!;
    expect(spot.lat).toBeCloseTo(0);
    expect(spot.lon).toBeCloseTo(0);
  });

  it('accounts for tilt and spin', () => {
    // The tilt brings the north pole toward the viewer, so the center is north of the equator.
    expect(unproject(0, 0, 0, tilt)!.lat).toBeCloseTo(23.4);
    // Spinning eastward moves what faces us west.
    expect(unproject(0, 0, deg(30), 0)!.lon).toBeCloseTo(-30);
    // Right of center is east of the central meridian.
    expect(unproject(0.5, 0, 0, 0)!.lon).toBeGreaterThan(0);
  });

  it('is null outside the globe', () => {
    expect(unproject(0.8, 0.8, 0, tilt)).toBeNull();
    expect(unproject(1.2, 0, 0, tilt)).toBeNull();
  });

  it('wraps longitude into [-180, 180]', () => {
    const spot = unproject(0, 0, deg(-200), 0)!;
    expect(spot.lon).toBeCloseTo(-160);
  });

  it('is the inverse of project', () => {
    for (const angle of [0, 1, -2.5, 4]) {
      for (const [x, y] of [[0.1, 0.2], [-0.6, 0.3], [0.5, -0.7]]) {
        const spot = unproject(x, y, angle, tilt)!;
        const p = project(spot, angle, tilt);
        expect(p.x).toBeCloseTo(x);
        expect(p.y).toBeCloseTo(y);
        expect(p.z).toBeGreaterThan(0);
      }
    }
  });
});

describe('markers', () => {
  const allOcean: Land = { isLand: () => false };

  it('draws a marker in the cell that unproject says is under it', () => {
    const render = createGlobe(options, allOcean);
    const angle = 0.7;
    // A cell a bit off-center, converted the way the component converts a click.
    const c = 28;
    const r = 7;
    const x = (c + 0.5 - options.cols / 2) / (options.cols / 2);
    const y = -(r + 0.5 - options.rows / 2) / (options.rows / 2);
    const spot = unproject(x, y, angle, options.tilt)!;
    const lines = render(angle, [spot]).split('\n');
    expect(lines[r][c]).toBe(MARKER);
    expect(lines.join('').split(MARKER)).toHaveLength(2);
  });

  it('hides markers on the far side', () => {
    const render = createGlobe(options, allOcean);
    const spot = unproject(0, 0, 0, options.tilt)!;
    expect(render(0, [spot])).toContain(MARKER);
    expect(render(Math.PI, [spot])).not.toContain(MARKER);
  });
});
