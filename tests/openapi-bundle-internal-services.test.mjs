import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

import {
  BUNDLE_EXCLUDED_SERVICES,
  excludeInternalServices,
} from '../scripts/openapi-exclude-internal-services.mjs';
import { loadUnifiedOpenApiSpec } from './_lib/openapi-spec-cache.mjs';

// Internal services (MarketingService: signed-in agency members only, under
// MARKETING_DEPLOY) keep their per-service spec in docs/api but never reach the
// public unified bundle. That bundle is copied to public/openapi.{yaml,json},
// backs the Mintlify API reference, and has a guarded scanner byte budget.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = resolve(root, 'docs/api');
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options']);

const FIXTURE = [
  'openapi: 3.1.0',
  'paths:',
  '    /api/climate/v1/a:',
  '        get:',
  '            tags:',
  '                - ClimateService',
  '',
  '    /api/marketing/v1/b:',
  '        get:',
  '            tags:',
  '                - MarketingService',
  '            responses:',
  '                "200":',
  '                    $ref: \'#/components/schemas/worldmonitor_marketing_v1_B\'',
  '    /api/military/v1/c:',
  '        get: {}',
  'components:',
  '    schemas:',
  '        worldmonitor_climate_v1_A:',
  '            type: object',
  '        worldmonitor_marketing_v1_B:',
  '            type: object',
  '            description: B.',
  '        worldmonitor_military_v1_C:',
  '            type: object',
  '',
].join('\n');

describe('internal services stay out of the public unified bundle', () => {
  it('declares MarketingService as bundle-excluded', () => {
    assert.deepEqual(
      BUNDLE_EXCLUDED_SERVICES.map((s) => s.service),
      ['MarketingService'],
    );
  });

  it('removes excluded path and schema blocks and nothing else', () => {
    const { text, removedPaths, removedSchemas } = excludeInternalServices(FIXTURE);
    assert.deepEqual(removedPaths, ['/api/marketing/v1/b']);
    assert.deepEqual(removedSchemas, ['worldmonitor_marketing_v1_B']);
    assert.ok(!/marketing/i.test(text), text);
    assert.match(text, /\/api\/climate\/v1\/a:/);
    assert.match(text, /\/api\/military\/v1\/c:\n {8}get: \{\}/);
    assert.match(text, /worldmonitor_climate_v1_A:\n {12}type: object\n {8}worldmonitor_military_v1_C:/);
  });

  it('is idempotent', () => {
    const once = excludeInternalServices(FIXTURE).text;
    const twice = excludeInternalServices(once);
    assert.equal(twice.text, once);
    assert.deepEqual(twice.removedPaths, []);
    assert.deepEqual(twice.removedSchemas, []);
  });

  it('fails closed when a kept operation still references an excluded schema', () => {
    const leaky = FIXTURE.replace(
      '        get: {}',
      "        get:\n            $ref: '#/components/schemas/worldmonitor_marketing_v1_B'",
    );
    assert.throws(() => excludeInternalServices(leaky), /still references/);
  });

  it('the generated unified bundle carries no excluded path, schema or tag', () => {
    const bundle = loadUnifiedOpenApiSpec();
    for (const { service, pathPrefix, schemaPrefix } of BUNDLE_EXCLUDED_SERVICES) {
      const paths = Object.keys(bundle.paths ?? {}).filter((p) => p.startsWith(pathPrefix));
      assert.deepEqual(paths, [], `${service} paths leaked into the bundle`);
      const schemas = Object.keys(bundle.components?.schemas ?? {}).filter((n) => n.startsWith(schemaPrefix));
      assert.deepEqual(schemas, [], `${service} schemas leaked into the bundle`);
      for (const pathItem of Object.values(bundle.paths ?? {})) {
        for (const [method, op] of Object.entries(pathItem ?? {})) {
          if (!HTTP_METHODS.has(method)) continue;
          assert.ok(!(op?.tags ?? []).includes(service), `${service} tag leaked into the bundle`);
        }
      }
    }
  });

  it('keeps the per-service MarketingService spec with all four operations', () => {
    const spec = loadYaml(readFileSync(resolve(apiDir, 'MarketingService.openapi.yaml'), 'utf8'));
    const ops = Object.entries(spec.paths ?? {}).flatMap(([p, item]) =>
      Object.keys(item).filter((m) => HTTP_METHODS.has(m)).map((m) => `${m.toUpperCase()} ${p}`));
    assert.deepEqual(ops.sort(), [
      'GET /api/marketing/v1/get-demand-trends',
      'GET /api/marketing/v1/list-calendar-events',
      'GET /api/marketing/v1/list-weather-alerts',
      'POST /api/marketing/v1/search-local-mentions',
    ]);
  });
});
