import { bitmapLand, createGlobe, Land } from './globe-renderer';

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
