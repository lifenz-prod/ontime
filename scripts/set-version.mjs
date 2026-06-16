#!/usr/bin/env node
/**
 * Sets the version across every package.json that matters for a release.
 *
 * Usage:
 *   node scripts/set-version.mjs 3.19.0          # stable
 *   node scripts/set-version.mjs 3.19.0-beta.0   # beta / prerelease
 *
 * The root package.json is the source of truth for the in-app version
 * (apps/client and apps/server generate ONTIME_VERSION.js from it via their
 * `addversion` hook). apps/cli drives the published npm version and
 * apps/electron drives the desktop build version, so all three must move
 * together. client/server are updated too for tidiness.
 *
 * This script only edits files; it does not commit or tag.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// SemVer 2.0.0 (optionally with a -prerelease identifier, no build metadata)
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const version = process.argv[2];
if (!version || !SEMVER.test(version)) {
  console.error(`Invalid or missing version: "${version ?? ''}"`);
  console.error('Usage: node scripts/set-version.mjs <semver>  e.g. 3.19.0 or 3.19.0-beta.0');
  process.exit(1);
}

const targets = [
  'package.json',
  'apps/cli/package.json',
  'apps/electron/package.json',
  'apps/client/package.json',
  'apps/server/package.json',
];

for (const rel of targets) {
  const path = join(ROOT, rel);
  const raw = readFileSync(path, 'utf8');
  const versionField = /("version":\s*")[^"]+(")/;
  if (!versionField.test(raw)) {
    console.error(`Could not find a "version" field in ${rel}`);
    process.exit(1);
  }
  // Replace only the top-level "version" field, preserving all formatting.
  writeFileSync(path, raw.replace(versionField, `$1${version}$2`));
  console.log(`  ${rel} -> ${version}`);
}

const isPrerelease = version.includes('-');
console.log(`\nSet version to ${version} (${isPrerelease ? 'prerelease/beta' : 'stable'}).`);
console.log('Next:');
console.log(`  git commit -am "release: v${version}"`);
console.log(`  git tag v${version}`);
console.log('  git push && git push --tags');
