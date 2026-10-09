import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finalizeEntry } from '../scripts/discover/core.mjs';
import { loadPorts, ROOT } from '../scripts/lib.mjs';

test('a GitHub release-asset link is rewritten to the repo /releases/latest page', () => {
  const candidate = { source_url: 'https://github.com/Nibre/MotherVR', urls: ['https://github.com/Nibre/MotherVR'] };
  const raw = {
    name: 'MotherVR',
    games: ['Alien: Isolation'],
    category: 'mod',
    authors: [{ name: 'Nibre' }],
    platform: 'pcvr',
    status: 'stable',
    version: '0.8.1',
    version_date: '2020-01-01',
    download_url: 'https://github.com/Nibre/MotherVR/releases/download/0.8.1/MotherVR.0.8.1.zip',
    source_url: 'https://github.com/Nibre/MotherVR',
    license: 'unknown',
    required_files: 'Alien: Isolation (PC)',
    known_bugs: [],
  };
  const { entry, error } = finalizeEntry(raw, candidate, { date: '2026-10-09' });
  assert.equal(error, undefined);
  assert.equal(entry!.download_url, 'https://github.com/Nibre/MotherVR/releases/latest');
});

test('validator rejects two entries for one repo, but not a hub repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'f2v-dupes-'));
  const src = join(ROOT, 'test/fixtures/valid');
  const file = readFileSync(join(src, 'nomaivr.yml'), 'utf8');
  const ports = join(dir, 'ports');
  mkdirSync(ports);
  writeFileSync(join(ports, 'a.yml'), file);
  writeFileSync(join(ports, 'b.yml'), file.replace(/^name: .*$/m, 'name: Other Name'));
  const { errors } = loadPorts(ports, src);
  assert.ok(
    errors.some((e) => /same download repo as ports\/a\.yml/.test(e)),
    errors.join('\n'),
  );

  const hub = (n: string) =>
    file
      .replace(/^name: .*$/m, `name: ${n}`)
      .replace(/^download_url: .*$/m, 'download_url: https://github.com/RaYRoD-TV/MVRH/releases');
  writeFileSync(join(ports, 'a.yml'), hub('Hub One'));
  writeFileSync(join(ports, 'b.yml'), hub('Hub Two'));
  assert.ok(!loadPorts(ports, src).errors.some((e) => /same download repo/.test(e)));
  rmSync(dir, { recursive: true, force: true });
});
