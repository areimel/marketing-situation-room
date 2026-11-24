import type { MarketingClientLocation } from './types';

const EARTH_RADIUS_MILES = 3958.8;
const DEG = Math.PI / 180;
const MILES_PER_DEGREE = EARTH_RADIUS_MILES * DEG;

/** Great-circle distance in miles (haversine). NaN in, NaN out. */
export function milesBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * DEG;
  const dLon = (bLon - aLon) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isValidCoordinate(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function isValidServiceArea(loc: MarketingClientLocation): boolean {
  return isValidCoordinate(loc.lat, loc.lon) && Number.isFinite(loc.serviceRadiusMiles) && loc.serviceRadiusMiles > 0;
}

/** True when (lat, lon) lies within the location's service radius. Never throws. */
export function pointInServiceArea(loc: MarketingClientLocation, lat: number, lon: number): boolean {
  if (!isValidServiceArea(loc) || !isValidCoordinate(lat, lon)) return false;
  return milesBetween(loc.lat, loc.lon, lat, lon) <= loc.serviceRadiusMiles;
}

type Ring = Array<[number, number]>;

function readRing(raw: unknown): Ring {
  if (!Array.isArray(raw)) return [];
  const ring: Ring = [];
  for (const vertex of raw) {
    if (!Array.isArray(vertex)) continue;
    const [lon, lat] = vertex as unknown[];
    if (typeof lon === 'number' && typeof lat === 'number' && isValidCoordinate(lat, lon)) ring.push([lon, lat]);
  }
  return ring;
}

function readPolygon(raw: unknown): Ring[] {
  return Array.isArray(raw) ? raw.map(readRing).filter((ring) => ring.length > 0) : [];
}

function collectRings(geo: unknown, out: Ring[]): void {
  if (!geo || typeof geo !== 'object') return;
  const g = geo as { type?: unknown; coordinates?: unknown; geometry?: unknown; features?: unknown };
  switch (g.type) {
    case 'Polygon':
      out.push(...readPolygon(g.coordinates));
      return;
    case 'MultiPolygon':
      if (Array.isArray(g.coordinates)) for (const p of g.coordinates) out.push(...readPolygon(p));
      return;
    case 'Feature':
      collectRings(g.geometry, out);
      return;
    case 'FeatureCollection':
      if (Array.isArray(g.features)) for (const f of g.features) collectRings(f, out);
      return;
    default:
      return;
  }
}

/** Distance in projected units from the origin to segment (ax,ay)-(bx,by). */
function distanceToSegment(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * True when a GeoJSON Polygon / MultiPolygon / Feature / FeatureCollection
 * touches the location's service area: the centre is inside any ring
 * (even-odd), or any ring vertex or edge lies within the service radius.
 * Uses an equirectangular projection scaled at the centre latitude.
 * Returns false (never throws) on malformed or unsupported input.
 */
export function polygonTouchesServiceArea(loc: MarketingClientLocation, geojson: string): boolean {
  if (!isValidServiceArea(loc)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    return false;
  }
  const rings: Ring[] = [];
  collectRings(parsed, rings);
  if (rings.length === 0) return false;

  const xScale = Math.cos(loc.lat * DEG) * MILES_PER_DEGREE;
  const project = ([lon, lat]: [number, number]): [number, number] => {
    let dLon = lon - loc.lon;
    if (dLon > 180) dLon -= 360;
    else if (dLon < -180) dLon += 360;
    return [dLon * xScale, (lat - loc.lat) * MILES_PER_DEGREE];
  };

  for (const ring of rings) {
    const pts = ring.map(project);
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!;
      const [xj, yj] = pts[j]!;
      if (distanceToSegment(xj, yj, xi, yi) <= loc.serviceRadiusMiles) return true;
      if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
