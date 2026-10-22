#!/usr/bin/env node
/**
 * Remove internal services from the public unified OpenAPI bundle.
 *
 * docs/api/worldmonitor.openapi.yaml is copied to public/openapi.{yaml,json}
 * and backs the Mintlify API reference, and the served JSON has a guarded
 * scanner byte budget (tests/openapi-json-dedup.test.mjs). An internal service
 * (one that only signed-in members of a private deployment may call) keeps its
 * per-service spec in docs/api, so codegen contracts still see it, but it is
 * not part of the public API surface and must not reach the bundle.
 *
 * Runs at the end of `make generate`, after every injector: the injectors
 * cross-check per-service contracts against the bundle and need the excluded
 * service present while they run. Formatting-preserving: it deletes whole
 * generated blocks (a `paths` entry at 4-space indent, a `components.schemas`
 * entry at 8-space indent) and never re-serializes the document. Idempotent.
 * Fails closed when a kept block still references an excluded schema.
 *
 * `--check` exits non-zero without writing when the bundle would change.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/main-module.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = resolve(root, 'docs/api/worldmonitor.openapi.yaml');

export const BUNDLE_EXCLUDED_SERVICES = Object.freeze([
  // Internal agency marketing RPCs: gated to signed-in members under
  // MARKETING_DEPLOY, never part of the public WorldMonitor API.
  Object.freeze({
    service: 'MarketingService',
    pathPrefix: '/api/marketing/',
    schemaPrefix: 'worldmonitor_marketing_',
  }),
]);

/**
 * True when a per-service spec file (`<Service>.openapi.{json,yaml}`) belongs
 * in the public unified bundle. Injectors that patch the bundle per service and
 * contract tests that compare the bundle with the per-service specs use this.
 */
export function isBundledServiceSpecFile(file) {
  const service = basename(file).replace(/\.openapi\.(?:json|yaml)$/u, '');
  return !BUNDLE_EXCLUDED_SERVICES.some((excluded) => excluded.service === service);
}

const indentOf = (line) => line.length - line.trimStart().length;

function sectionRange(lines, header, indent, from = 0, to = lines.length) {
  const start = lines.findIndex((line, i) => i >= from && i < to && line === `${' '.repeat(indent)}${header}:`);
  if (start === -1) return null;
  let end = start + 1;
  while (end < to && (!lines[end].trim() || indentOf(lines[end]) > indent)) end++;
  return { start, end };
}

/** Delete child blocks at `indent` inside [start, end) whose key starts with one of `prefixes`. */
function dropChildBlocks(lines, range, indent, prefixes, removed) {
  const kept = [];
  for (let i = range.start; i < range.end;) {
    const line = lines[i];
    const isChildKey = line.trim() && indentOf(line) === indent;
    const key = isChildKey ? line.trim().replace(/:$/, '').replace(/^['"]|['"]$/g, '') : null;
    if (key && prefixes.some((p) => key.startsWith(p))) {
      removed.push(key);
      i++;
      while (i < range.end && (!lines[i].trim() || indentOf(lines[i]) > indent)) i++;
      continue;
    }
    kept.push(line);
    i++;
  }
  return kept;
}

export function excludeInternalServices(text, services = BUNDLE_EXCLUDED_SERVICES) {
  let lines = text.split('\n');
  const removedPaths = [];
  const removedSchemas = [];

  const paths = sectionRange(lines, 'paths', 0);
  if (paths) {
    const body = { start: paths.start + 1, end: paths.end };
    const kept = dropChildBlocks(lines, body, 4, services.map((s) => s.pathPrefix), removedPaths);
    lines = [...lines.slice(0, body.start), ...kept, ...lines.slice(body.end)];
  }

  const components = sectionRange(lines, 'components', 0);
  const schemas = components && sectionRange(lines, 'schemas', 4, components.start + 1, components.end);
  if (schemas) {
    const body = { start: schemas.start + 1, end: schemas.end };
    const kept = dropChildBlocks(lines, body, 8, services.map((s) => s.schemaPrefix), removedSchemas);
    lines = [...lines.slice(0, body.start), ...kept, ...lines.slice(body.end)];
  }

  const out = lines.join('\n');
  for (const { service, schemaPrefix } of services) {
    if (out.includes(`#/components/schemas/${schemaPrefix}`)) {
      throw new Error(`openapi-exclude-internal-services: bundle still references a ${service} schema (${schemaPrefix}*)`);
    }
    if (new RegExp(`^\\s+- ${service}$`, 'm').test(out)) {
      throw new Error(`openapi-exclude-internal-services: bundle still references the ${service} tag`);
    }
  }
  return { text: out, removedPaths, removedSchemas };
}

function main() {
  const check = process.argv.includes('--check');
  const before = readFileSync(bundlePath, 'utf8');
  const { text, removedPaths, removedSchemas } = excludeInternalServices(before);
  if (text === before) return;
  if (check) {
    console.error(
      `openapi-exclude-internal-services: bundle carries ${removedPaths.length} internal paths and ${removedSchemas.length} internal schemas; run make generate`,
    );
    process.exit(1);
  }
  writeFileSync(bundlePath, text);
  console.log(
    `openapi-exclude-internal-services: removed ${removedPaths.length} internal paths and ${removedSchemas.length} internal schemas from worldmonitor.openapi.yaml`,
  );
}

if (isMainModule(import.meta.url, process.argv[1])) main();
