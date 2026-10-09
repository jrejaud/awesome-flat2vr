import { test } from 'vitest';
import assert from 'node:assert/strict';
import { finalizeEntry } from '../scripts/discover/core.mjs';

const base = {
  name: 'Banjo-Kazooie VR',
  games: ['Banjo-Kazooie'],
  category: 'mod',
  authors: [{ name: 'RaYRoD-TV' }],
  platform: 'pcvr',
  status: 'beta',
  version: '3',
  download_url: 'https://github.com/RaYRoD-TV/MVRH/releases',
  source_url: 'https://github.com/RaYRoD-TV/MVRH',
  license: 'unknown',
  required_files: 'Banjo-Kazooie ROM you own',
  known_bugs: [],
};
const candidate = {
  source_url: 'https://github.com/RaYRoD-TV/MVRH',
  date: '',
  urls: ['https://github.com/RaYRoD-TV/MVRH', 'https://github.com/RaYRoD-TV/MVRH/releases'],
};

test('an entry whose source gives no release date is dated to when it was seen', () => {
  const { entry, error } = finalizeEntry(base, candidate, { date: '2026-10-09' });
  assert.equal(error, undefined);
  assert.equal(entry!.version_date, '2026-10-09');
  assert.equal(
    finalizeEntry(base, { ...candidate, date: '2026-10-01' }, { date: '2026-10-09' }).entry!.version_date,
    '2026-10-01',
  );
});
