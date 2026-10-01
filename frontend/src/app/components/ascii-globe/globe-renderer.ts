import { LAND_BITS, LAND_HEIGHT, LAND_WIDTH } from './land-data';

export interface Land {
  /** True if the given latitude/longitude (radians) is land. */
  isLand(lat: number, lon: number): boolean;
}

export interface GlobeOptions {
  /** Character columns. Odd values put a cell exactly at the globe's center. */
  cols: number;
  /** Character rows. Should be about cols * (char width / char height) so the globe is round. */
  rows: number;
  /** Axial tilt in radians; positive tips the north pole toward the viewer. */
  tilt: number;
  /** Direction toward the light in view space (x right, y up, z toward viewer). */
  light: readonly [number, number, number];
}

const LAND_RAMP = ':-=+*#%@';
const OCEAN = '.';
/** Floor on brightness so the night side stays visible and the globe keeps its round silhouette. */
const AMBIENT = 0.3;
/** Drawn over the globe where a note is attached. */
export const MARKER = 'X';

/** A spot on the globe, in degrees. */
export interface Spot {
  lat: number;
  lon: number;
}

export const bitmapLand: Land = (() => {
  const raw = atob(LAND_BITS);
  const rowBytes = Math.ceil(LAND_WIDTH / 8);
  return {
    isLand(lat, lon) {
      const col = Math.floor(((lon + Math.PI) / (2 * Math.PI)) * LAND_WIDTH);
      const row = Math.floor(((Math.PI / 2 - lat) / Math.PI) * LAND_HEIGHT);
      const x = ((col % LAND_WIDTH) + LAND_WIDTH) % LAND_WIDTH;
      const y = Math.min(LAND_HEIGHT - 1, Math.max(0, row));
      return ((raw.charCodeAt(y * rowBytes + (x >> 3)) >> (7 - (x & 7))) & 1) === 1;
    },
  };
})();

interface Cell {
  /** Position in view space, on the unit sphere. */
  x: number;
  y: number;
  z: number;
  /** Diffuse brightness in [0, 1]. */
  light: number;
}

/** Where a spot on the globe is in view space (x right, y up, z toward the viewer; z > 0 is the visible side). */
export function project(spot: Spot, angle: number, tilt: number): { x: number; y: number; z: number } {
  const lat = (spot.lat * Math.PI) / 180;
  const lon = (spot.lon * Math.PI) / 180 + angle;
  const gx = Math.cos(lat) * Math.sin(lon);
  const gy = Math.sin(lat);
  const gz = Math.cos(lat) * Math.cos(lon);
  const sinTilt = Math.sin(tilt);
  const cosTilt = Math.cos(tilt);
  return { x: gx, y: gy * cosTilt - gz * sinTilt, z: gy * sinTilt + gz * cosTilt };
}

/**
 * The latitude/longitude (degrees) under a point on the globe's disc, or null if the point is
 * off the globe. `x` and `y` are in view space, scaled so the globe's edge is at distance 1
 * (x right, y up). This is the inverse of how `createGlobe` places each cell.
 */
export function unproject(x: number, y: number, angle: number, tilt: number): Spot | null {
  const d2 = x * x + y * y;
  if (d2 > 1) return null;
  const z = Math.sqrt(1 - d2);
  const gy = y * Math.cos(tilt) + z * Math.sin(tilt);
  const gz = -y * Math.sin(tilt) + z * Math.cos(tilt);
  const lat = Math.asin(Math.max(-1, Math.min(1, gy)));
  let lon = Math.atan2(x, gz) - angle;
  lon = ((((lon + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/**
 * Builds a renderer for a fixed grid size. The per-cell ray/sphere hits and
 * lighting only depend on the grid, so they are computed once; each frame only
 * needs to spin the sphere and look up land.
 *
 * `angle` (radians) is how far the globe has turned from facing the prime
 * meridian. Increasing it spins the globe eastward, like Earth, so features
 * drift left to right. Any `markers` on the visible side are drawn over the land.
 */
export function createGlobe(
  options: GlobeOptions,
  land: Land = bitmapLand,
): (angle: number, markers?: readonly Spot[]) => string {
  const { cols, rows, tilt, light } = options;
  const lightLen = Math.hypot(...light);
  const [lx, ly, lz] = light.map((v) => v / lightLen);
  const sinTilt = Math.sin(tilt);
  const cosTilt = Math.cos(tilt);

  const cells: (Cell | null)[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5 - cols / 2) / (cols / 2);
      const y = -(r + 0.5 - rows / 2) / (rows / 2);
      const d2 = x * x + y * y;
      if (d2 > 1) {
        cells.push(null);
        continue;
      }
      const z = Math.sqrt(1 - d2);
      cells.push({ x, y, z, light: AMBIENT + (1 - AMBIENT) * Math.max(0, x * lx + y * ly + z * lz) });
    }
  }

  return (angle, markers = []) => {
    const grid: string[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = cells[r * cols + c];
        if (!cell) {
          grid.push(' ');
          continue;
        }
        // Undo the tilt (rotate about x) to get into the globe's own frame.
        const gy = cell.y * cosTilt + cell.z * sinTilt;
        const gz = -cell.y * sinTilt + cell.z * cosTilt;
        const lat = Math.asin(Math.max(-1, Math.min(1, gy)));
        const lon = Math.atan2(cell.x, gz) - angle;
        if (land.isLand(lat, lon)) {
          grid.push(LAND_RAMP[Math.min(LAND_RAMP.length - 1, Math.floor(cell.light * LAND_RAMP.length))]);
        } else {
          grid.push(OCEAN);
        }
      }
    }
    for (const marker of markers) {
      const p = project(marker, angle, tilt);
      if (p.z <= 0) continue;
      const c = Math.floor((p.x * cols) / 2 + cols / 2);
      const r = Math.floor((-p.y * rows) / 2 + rows / 2);
      if (cells[r * cols + c]) grid[r * cols + c] = MARKER;
    }
    let out = '';
    for (let r = 0; r < rows; r++) {
      out += grid.slice(r * cols, (r + 1) * cols).join('');
      if (r < rows - 1) out += '\n';
    }
    return out;
  };
}
