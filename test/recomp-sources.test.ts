import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildIndex, matchExisting, repoKey } from '../scripts/discover/core.mjs';
import { parseSeeds } from '../scripts/discover/sources.mjs';

test('seed list: comments stripped, URLs normalised to owner/repo, duplicates dropped', () => {
  const text = `# header\nhttps://github.com/ShinyWindow/Shipwright-VR   # OoT\n\nhttps://github.com/shinywindow/shipwright-vr/releases\nnot a url\n`;
  assert.deepEqual(parseSeeds(text), ['shinywindow/shipwright-vr']);
});

test('a multi-port hub repo never identifies an entry', () => {
  assert.equal(repoKey('https://github.com/RaYRoD-TV/MVRH/releases'), null);
  const index = buildIndex([
    { slug: 'banjo-kazooie-vr', name: 'Banjo-Kazooie VR', download_url: 'https://github.com/RaYRoD-TV/MVRH/releases' },
  ]);
  const mk64 = { title: 'Mario Kart 64 VR', urls: ['https://github.com/RaYRoD-TV/MVRH/releases'] };
  assert.equal(matchExisting(index, mk64), null, 'MK64 from the same hub is not a duplicate of Banjo');
  assert.equal(matchExisting(index, { title: 'Banjo-Kazooie VR', urls: [] }), 'banjo-kazooie-vr');
});
