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

export const bitmapLand: Land = (() => {
  const raw = atob(LAND_BITS);
  const rowBytes = LAND_WIDTH / 8;
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

/**
 * Builds a renderer for a fixed grid size. The per-cell ray/sphere hits and
 * lighting only depend on the grid, so they are computed once; each frame only
 * needs to spin the sphere and look up land.
 *
 * `angle` (radians) is how far the globe has turned from facing the prime
 * meridian. Increasing it spins the globe eastward, like Earth, so features
 * drift left to right.
 */
export function createGlobe(options: GlobeOptions, land: Land = bitmapLand): (angle: number) => string {
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

  return (angle) => {
    let out = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = cells[r * cols + c];
        if (!cell) {
          out += ' ';
          continue;
        }
        // Undo the tilt (rotate about x) to get into the globe's own frame.
        const gy = cell.y * cosTilt + cell.z * sinTilt;
        const gz = -cell.y * sinTilt + cell.z * cosTilt;
        const lat = Math.asin(Math.max(-1, Math.min(1, gy)));
        const lon = Math.atan2(cell.x, gz) - angle;
        if (land.isLand(lat, lon)) {
          out += LAND_RAMP[Math.min(LAND_RAMP.length - 1, Math.floor(cell.light * LAND_RAMP.length))];
        } else {
          out += OCEAN;
        }
      }
      if (r < rows - 1) out += '\n';
    }
    return out;
  };
}
