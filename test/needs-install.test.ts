import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../scripts/discover/needs-install.sh');
const needsInstall = (dir: string) => spawnSync('bash', [SCRIPT, dir]).status === 0;

function fixture(withDep: boolean) {
  const dir = mkdtempSync(path.join(tmpdir(), 'needs-install-'));
  const pkg = { name: 'fx', version: '1.0.0', dependencies: { 'js-yaml': '^4.1.0' } };
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  mkdirSync(path.join(dir, 'node_modules'));
  if (withDep) {
    mkdirSync(path.join(dir, 'node_modules/js-yaml'));
    writeFileSync(
      path.join(dir, 'node_modules/js-yaml/package.json'),
      JSON.stringify({ name: 'js-yaml', version: '4.1.0' }),
    );
  }
  // npm's hidden lockfile, newer than package-lock.json: the old guard read this as
  // "installed". The broken case mirrors Chiba's real 92-byte marker (no packages).
  const hidden = {
    name: 'fx',
    lockfileVersion: 3,
    requires: true,
    packages: withDep ? { 'node_modules/js-yaml': { version: '4.1.0' } } : {},
  };
  writeFileSync(path.join(dir, 'node_modules/.package-lock.json'), JSON.stringify(hidden));
  const old = new Date(Date.now() - 60_000);
  utimesSync(path.join(dir, 'package-lock.json'), old, old);
  return dir;
}

test('a node_modules missing a declared package needs an install (SC-8049)', () => {
  assert.equal(needsInstall(fixture(false)), true);
}, 30_000);

test('a complete node_modules does not', () => {
  assert.equal(needsInstall(fixture(true)), false);
}, 30_000);
