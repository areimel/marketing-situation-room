import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MARKETING_CATEGORIES } from '../shared/marketing/types.ts';
import { milesBetween, pointInServiceArea, polygonTouchesServiceArea } from '../shared/marketing/geo.ts';
import { isMarketingDeploy } from '../shared/marketing/deploy-flag.ts';
import { MARKETING_DEPLOY } from '../src/config/marketing.ts';
import { createRequire } from 'node:module';
const { isMarketingDeploy: isMarketingDeployCjs } = createRequire(import.meta.url)('../scripts/lib/marketing-deploy-flag.cjs');

const loc = { id: 'l1', label: 'HQ', address: '1 Main', city: 'Austin', stateCode: 'TX', lat: 30.2672, lon: -97.7431, serviceRadiusMiles: 25 };

// GeoJSON rings are [lon, lat]; each square is closed (first vertex repeated).
const square = (lat: number, lon: number, half: number) => [[
  [lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half],
]];
const poly = (rings: number[][][]) => JSON.stringify({ type: 'Polygon', coordinates: rings });
const feature = (rings: number[][][]) => JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings } });
const collection = (rings: number[][][]) => JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings } }] });
const multi = (rings: number[][][]) => JSON.stringify({ type: 'MultiPolygon', coordinates: [rings] });

const aroundAustin = square(30.2672, -97.7431, 0.1);
// Centre ~13.8 mi north of Austin, half-size 0.05 deg (~3.5 mi): nearest edge ~10 mi away, no vertex inside the square.
const nearAustin = square(30.4672, -97.7431, 0.05);
const overSanAntonio = square(29.4241, -98.4936, 0.05);

describe('marketing shared contracts', () => {
  it('keeps the 15 categories in contract order', () => {
    assert.equal(MARKETING_CATEGORIES.length, 15);
    assert.equal(MARKETING_CATEGORIES[0], 'hvac');
    assert.equal(MARKETING_CATEGORIES.at(-1), 'other');
  });
  it('measures NYC→LA within 5 miles of 2445', () => {
    assert.ok(Math.abs(milesBetween(40.7128, -74.006, 34.0522, -118.2437) - 2445) < 5);
  });
  it('includes a point inside the radius and excludes one outside', () => {
    assert.equal(pointInServiceArea(loc, 30.3, -97.75), true);     // ~2 mi
    assert.equal(pointInServiceArea(loc, 29.4241, -98.4936), false); // San Antonio ~74 mi
  });
  it('never throws on bad coordinates or radius (Review Focus 3)', () => {
    assert.ok(Number.isNaN(milesBetween(Number.NaN, 0, 0, 0)));
    assert.equal(pointInServiceArea({ ...loc, lat: Number.NaN }, 30.3, -97.75), false);
    assert.equal(pointInServiceArea({ ...loc, lat: 91 }, 30.3, -97.75), false);
    assert.equal(pointInServiceArea({ ...loc, lon: -181 }, 30.3, -97.75), false);
    assert.equal(pointInServiceArea({ ...loc, serviceRadiusMiles: 0 }, 30.2672, -97.7431), false);
    assert.equal(pointInServiceArea({ ...loc, serviceRadiusMiles: -5 }, 30.2672, -97.7431), false);
    assert.equal(pointInServiceArea(loc, Number.POSITIVE_INFINITY, 0), false);
  });
  it('reads the deploy flag as false by default and true only for "1"', () => {
    assert.equal(isMarketingDeploy({}), false);
    assert.equal(isMarketingDeploy({ MARKETING_DEPLOY: '0' }), false);
    assert.equal(isMarketingDeploy({ MARKETING_DEPLOY: 'true' }), false);
    assert.equal(isMarketingDeploy({ MARKETING_DEPLOY: '1' }), true);
    assert.equal(MARKETING_DEPLOY, false); // node import: import.meta.env is undefined
  });
  it('keeps the relay CJS deploy flag in sync with the shared one (R11)', () => {
    for (const v of [undefined, '', '0', '1', 'true', ' 1']) {
      assert.equal(isMarketingDeployCjs({ MARKETING_DEPLOY: v }), isMarketingDeploy({ MARKETING_DEPLOY: v }));
    }
  });
  it('detects polygons touching the service area (R10)', () => {
    assert.equal(polygonTouchesServiceArea(loc, poly(aroundAustin)), true);
    assert.equal(polygonTouchesServiceArea({ ...loc, serviceRadiusMiles: 1 }, poly(square(30.2672, -97.7431, 0.5))), true); // centre inside, edges ~35 mi away
    assert.equal(polygonTouchesServiceArea(loc, poly(nearAustin)), true);
    assert.equal(polygonTouchesServiceArea({ ...loc, serviceRadiusMiles: 5 }, poly(nearAustin)), false);
    assert.equal(polygonTouchesServiceArea(loc, poly(overSanAntonio)), false);
    assert.equal(polygonTouchesServiceArea(loc, feature(aroundAustin)), true);
    assert.equal(polygonTouchesServiceArea(loc, feature(overSanAntonio)), false);
    assert.equal(polygonTouchesServiceArea(loc, collection(nearAustin)), true);
    assert.equal(polygonTouchesServiceArea(loc, collection(overSanAntonio)), false);
    assert.equal(polygonTouchesServiceArea(loc, multi(aroundAustin)), true);
    assert.equal(polygonTouchesServiceArea(loc, multi(overSanAntonio)), false);
    assert.equal(polygonTouchesServiceArea(loc, ''), false);
    assert.equal(polygonTouchesServiceArea(loc, 'not json'), false);
    assert.equal(polygonTouchesServiceArea(loc, 'null'), false);
    assert.equal(polygonTouchesServiceArea(loc, '{"type":"Point","coordinates":[0,0]}'), false);
    assert.equal(polygonTouchesServiceArea(loc, '{"type":"Polygon","coordinates":[]}'), false);
    assert.equal(polygonTouchesServiceArea(loc, '{"type":"Polygon","coordinates":[[]]}'), false);
    assert.equal(polygonTouchesServiceArea(loc, '{"type":"Polygon","coordinates":[[["x","y"],null]]}'), false);
    assert.equal(polygonTouchesServiceArea({ ...loc, lat: Number.NaN }, poly(aroundAustin)), false);
    assert.equal(polygonTouchesServiceArea({ ...loc, serviceRadiusMiles: 0 }, poly(aroundAustin)), false);
  });
});
