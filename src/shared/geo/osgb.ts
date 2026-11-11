import type { LatLon } from './distance';

/**
 * Ordnance Survey National Grid eastings and northings to WGS84.
 *
 * Code-Point Open gives each postcode as a grid reference on OSGB36. The map
 * and every other coordinate in the app are WGS84. Two steps convert one to
 * the other, both from Ordnance Survey's *A guide to coordinate systems in
 * Great Britain*:
 *
 * 1. **Inverse Transverse Mercator** on the Airy 1830 ellipsoid, with the
 *    National Grid's true origin and scale (guide, Annex C). Exact to well
 *    under a millimetre.
 * 2. **A seven-parameter Helmert transform** from OSGB36 to WGS84 (guide,
 *    §6.6). OS quotes it as accurate to about 5 m across Great Britain,
 *    rising towards the edges.
 *
 * The centimetre-grade alternative, OSTN15, is a 15 MB grid. A postcode
 * centre stands for an area of several streets, so a few metres is ample and
 * the grid is not worth carrying. ADR 0019 §5.
 */

// Airy 1830, the ellipsoid OSGB36 is defined on.
const AIRY_A = 6_377_563.396;
const AIRY_B = 6_356_256.909;

// GRS80, which WGS84 matches to well under a millimetre.
const WGS84_A = 6_378_137;
const WGS84_B = 6_356_752.314_140_3;

// National Grid projection.
const F0 = 0.999_601_271_7;
const LAT0 = (49 * Math.PI) / 180;
const LON0 = (-2 * Math.PI) / 180;
const E0 = 400_000;
const N0 = -100_000;

/**
 * OSGB36 → WGS84. The guide publishes WGS84 → OSGB36; these are its negation,
 * as the guide says to use for the reverse direction.
 */
const HELMERT = {
  tx: 446.448,
  ty: -125.157,
  tz: 542.06,
  /** Parts per million. */
  s: -20.4894,
  /** Arc-seconds. */
  rx: 0.1502,
  ry: 0.247,
  rz: 0.8421,
};

const SECONDS_TO_RADIANS = Math.PI / (180 * 3600);

/** Meridional arc from the true origin, guide equation C3. */
function meridionalArc(lat: number): number {
  const n = (AIRY_A - AIRY_B) / (AIRY_A + AIRY_B);
  const n2 = n * n;
  const n3 = n2 * n;
  const d = lat - LAT0;
  const s = lat + LAT0;
  return (
    AIRY_B *
    F0 *
    ((1 + n + (5 / 4) * n2 + (5 / 4) * n3) * d -
      (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(d) * Math.cos(s) +
      ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * d) * Math.cos(2 * s) -
      (35 / 24) * n3 * Math.sin(3 * d) * Math.cos(3 * s))
  );
}

/** Grid reference → latitude and longitude on OSGB36, in degrees. */
export function gridToOsgb36(easting: number, northing: number): LatLon {
  const e2 = 1 - (AIRY_B * AIRY_B) / (AIRY_A * AIRY_A);

  // Guide C.6: iterate the latitude until the arc matches the northing.
  let lat = (northing - N0) / (AIRY_A * F0) + LAT0;
  let arc = meridionalArc(lat);
  for (let i = 0; i < 20 && Math.abs(northing - N0 - arc) >= 0.000_01; i += 1) {
    lat += (northing - N0 - arc) / (AIRY_A * F0);
    arc = meridionalArc(lat);
  }

  const sin = Math.sin(lat);
  const cos = Math.cos(lat);
  const tan = Math.tan(lat);
  const tan2 = tan * tan;
  const tan4 = tan2 * tan2;
  const tan6 = tan4 * tan2;
  const sec = 1 / cos;

  const nu = (AIRY_A * F0) / Math.sqrt(1 - e2 * sin * sin);
  const rho = (AIRY_A * F0 * (1 - e2)) / (1 - e2 * sin * sin) ** 1.5;
  const eta2 = nu / rho - 1;

  const vii = tan / (2 * rho * nu);
  const viii = (tan / (24 * rho * nu ** 3)) * (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2);
  const ix = (tan / (720 * rho * nu ** 5)) * (61 + 90 * tan2 + 45 * tan4);
  const x = sec / nu;
  const xi = (sec / (6 * nu ** 3)) * (nu / rho + 2 * tan2);
  const xii = (sec / (120 * nu ** 5)) * (5 + 28 * tan2 + 24 * tan4);
  const xiia = (sec / (5040 * nu ** 7)) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan6);

  const de = easting - E0;
  const latitude = lat - vii * de ** 2 + viii * de ** 4 - ix * de ** 6;
  const longitude = LON0 + x * de - xi * de ** 3 + xii * de ** 5 - xiia * de ** 7;

  return { lat: (latitude * 180) / Math.PI, lon: (longitude * 180) / Math.PI };
}

interface Cartesian {
  x: number;
  y: number;
  z: number;
}

function toCartesian(point: LatLon, a: number, b: number): Cartesian {
  const lat = (point.lat * Math.PI) / 180;
  const lon = (point.lon * Math.PI) / 180;
  const e2 = 1 - (b * b) / (a * a);
  const nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return {
    x: nu * Math.cos(lat) * Math.cos(lon),
    y: nu * Math.cos(lat) * Math.sin(lon),
    z: (1 - e2) * nu * Math.sin(lat),
  };
}

function fromCartesian(point: Cartesian, a: number, b: number): LatLon {
  const e2 = 1 - (b * b) / (a * a);
  const p = Math.hypot(point.x, point.y);
  let lat = Math.atan2(point.z, p * (1 - e2));
  for (let i = 0; i < 10; i += 1) {
    const nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    const next = Math.atan2(point.z + e2 * nu * Math.sin(lat), p);
    if (Math.abs(next - lat) < 1e-12) {
      lat = next;
      break;
    }
    lat = next;
  }
  return {
    lat: (lat * 180) / Math.PI,
    lon: (Math.atan2(point.y, point.x) * 180) / Math.PI,
  };
}

function helmert(point: Cartesian): Cartesian {
  const s = 1 + HELMERT.s / 1e6;
  const rx = HELMERT.rx * SECONDS_TO_RADIANS;
  const ry = HELMERT.ry * SECONDS_TO_RADIANS;
  const rz = HELMERT.rz * SECONDS_TO_RADIANS;
  return {
    x: HELMERT.tx + s * point.x - rz * point.y + ry * point.z,
    y: HELMERT.ty + rz * point.x + s * point.y - rx * point.z,
    z: HELMERT.tz - ry * point.x + rx * point.y + s * point.z,
  };
}

/** OSGB36 latitude and longitude → WGS84. */
export function osgb36ToWgs84(point: LatLon): LatLon {
  return fromCartesian(helmert(toCartesian(point, AIRY_A, AIRY_B)), WGS84_A, WGS84_B);
}

/** National Grid eastings and northings → WGS84 latitude and longitude. */
export function gridToWgs84(easting: number, northing: number): LatLon {
  return osgb36ToWgs84(gridToOsgb36(easting, northing));
}
