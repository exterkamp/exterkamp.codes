import { cellCode, MARKER_CELL, NO_CELL, Terrain } from './globe-palette';
import { LAND_BITS, LAND_HEIGHT, LAND_WIDTH } from './land-data';
import { TERRAIN_BITS, TERRAIN_HEIGHT, TERRAIN_WIDTH } from './terrain-data';

export interface Land {
  /** True if the given latitude/longitude (radians) is land. */
  isLand(lat: number, lon: number): boolean;
}

export interface TerrainMap {
  /** What covers the given latitude/longitude (radians). Only meaningful where `Land` says land. */
  terrainAt(lat: number, lon: number): Terrain;
}

/** One rendered frame. */
export interface GlobeFrame {
  /** The characters, with a newline after every row but the last. Built on first use. */
  readonly text: string;
  /** The same characters as char codes, with a newline after every row (the last one included). */
  chars: Uint8Array;
  /** A color code (see globe-palette) for each cell, row by row, with no newlines. */
  colors: Uint8Array;
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
const OCEAN_CODE = OCEAN.charCodeAt(0);
const SPACE_CODE = ' '.charCodeAt(0);
const NEWLINE_CODE = '\n'.charCodeAt(0);
/** Floor on brightness so the night side stays visible and the globe keeps its round silhouette. */
const AMBIENT = 0.3;
/** Drawn over the globe where a note is attached. */
export const MARKER = 'X';
const MARKER_CODE = MARKER.charCodeAt(0);

/** A spot on the globe, in degrees. */
export interface Spot {
  lat: number;
  lon: number;
}

export const bitmapLand: Land = (() => {
  const raw = Uint8Array.from(atob(LAND_BITS), (ch) => ch.charCodeAt(0));
  const rowBytes = Math.ceil(LAND_WIDTH / 8);
  return {
    isLand(lat, lon) {
      const col = Math.floor(((lon + Math.PI) / (2 * Math.PI)) * LAND_WIDTH);
      const row = Math.floor(((Math.PI / 2 - lat) / Math.PI) * LAND_HEIGHT);
      const x = ((col % LAND_WIDTH) + LAND_WIDTH) % LAND_WIDTH;
      const y = Math.min(LAND_HEIGHT - 1, Math.max(0, row));
      return ((raw[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) === 1;
    },
  };
})();

export const bitmapTerrain: TerrainMap = (() => {
  const raw = Uint8Array.from(atob(TERRAIN_BITS), (ch) => ch.charCodeAt(0));
  const rowBytes = Math.ceil(TERRAIN_WIDTH / 4);
  return {
    terrainAt(lat, lon) {
      const col = Math.floor(((lon + Math.PI) / (2 * Math.PI)) * TERRAIN_WIDTH);
      const row = Math.floor(((Math.PI / 2 - lat) / Math.PI) * TERRAIN_HEIGHT);
      const x = ((col % TERRAIN_WIDTH) + TERRAIN_WIDTH) % TERRAIN_WIDTH;
      const y = Math.min(TERRAIN_HEIGHT - 1, Math.max(0, row));
      // The bitmap stores 0 = vegetation, 1 = desert, 2 = ice, which are Terrain's values less ocean's 0.
      return 1 + ((raw[y * rowBytes + (x >> 2)] >> (6 - 2 * (x & 3))) & 3);
    },
  };
})();

interface Cell {
  /** Latitude (radians) of the globe's surface under this cell. Spinning only changes longitude. */
  lat: number;
  /** Longitude (radians) under this cell when the globe is at angle 0. */
  lon: number;
  /** Diffuse brightness in [0, 1]. */
  light: number;
  /** The shading character used if this cell is land. */
  landChar: number;
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
 * The character cell a spot is drawn in, or null if it is on the far side of the globe.
 * Matches where `createGlobe` places markers.
 */
export function markerCell(
  spot: Spot,
  angle: number,
  tilt: number,
  cols: number,
  rows: number,
): { col: number; row: number } | null {
  const p = project(spot, angle, tilt);
  if (p.z <= 0) return null;
  return {
    col: Math.floor((p.x * cols) / 2 + cols / 2),
    row: Math.floor((-p.y * rows) / 2 + rows / 2),
  };
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
  terrain: TerrainMap = bitmapTerrain,
): (angle: number, markers?: readonly Spot[]) => GlobeFrame {
  const { cols, rows, tilt, light } = options;
  const lightLen = Math.hypot(...light);
  const [lx, ly, lz] = light.map((v) => v / lightLen);
  const sinTilt = Math.sin(tilt);
  const cosTilt = Math.cos(tilt);

  // Everything that does not depend on the spin is worked out once, so a frame is mostly lookups.
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
      const brightness = AMBIENT + (1 - AMBIENT) * Math.max(0, x * lx + y * ly + z * lz);
      // Undo the tilt (rotate about x) to get into the globe's own frame.
      const gy = y * cosTilt + z * sinTilt;
      const gz = -y * sinTilt + z * cosTilt;
      cells.push({
        lat: Math.asin(Math.max(-1, Math.min(1, gy))),
        lon: Math.atan2(x, gz),
        light: brightness,
        landChar: LAND_RAMP.charCodeAt(Math.min(LAND_RAMP.length - 1, Math.floor(brightness * LAND_RAMP.length))),
      });
    }
  }

  const rowLength = cols + 1;
  return (angle, markers = []) => {
    // Characters with a newline after every row; the last one is dropped from `text`.
    const chars = new Uint8Array(rows * rowLength);
    const colors = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = cells[r * cols + c];
        const at = r * rowLength + c;
        if (!cell) {
          chars[at] = SPACE_CODE;
          continue;
        }
        const lon = cell.lon - angle;
        if (land.isLand(cell.lat, lon)) {
          chars[at] = cell.landChar;
          colors[r * cols + c] = cellCode(terrain.terrainAt(cell.lat, lon), cell.light);
        } else {
          chars[at] = OCEAN_CODE;
          colors[r * cols + c] = cellCode(Terrain.Ocean, cell.light);
        }
      }
      chars[r * rowLength + cols] = NEWLINE_CODE;
    }
    for (const marker of markers) {
      const cell = markerCell(marker, angle, tilt, cols, rows);
      if (cell && cells[cell.row * cols + cell.col]) {
        chars[cell.row * rowLength + cell.col] = MARKER_CODE;
        colors[cell.row * cols + cell.col] = MARKER_CELL;
      }
    }
    let text: string | undefined;
    return {
      get text() {
        return (text ??= String.fromCharCode(...chars.subarray(0, chars.length - 1)));
      },
      chars,
      colors,
    };
  };
}
