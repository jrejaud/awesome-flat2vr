import { test } from 'vitest';
import assert from 'node:assert/strict';
import { finalizeEntry } from '../scripts/discover/core.mjs';

const candidate = {
  source_url: 'https://www.youtube.com/watch?v=2SnBrsATbdg',
  urls: [
    'https://www.youtube.com/watch?v=2SnBrsATbdg',
    'https://discord.gg/qQn7RTSQvV',
    'https://store.steampowered.com/app/1',
  ],
};
const base = {
  name: 'PZVR',
  games: ['Project Zomboid'],
  category: 'mod',
  authors: [{ name: 'axizt' }],
  platform: 'pcvr',
  status: 'alpha',
  version: 'unversioned',
  version_date: '2026-10-09',
  source_url: 'https://www.youtube.com/watch?v=2SnBrsATbdg',
  license: 'unknown',
  required_files: 'Project Zomboid',
  known_bugs: [],
};

test('video and chat links are never accepted as a download page', () => {
  for (const url of ['https://www.youtube.com/watch?v=2SnBrsATbdg', 'https://discord.gg/qQn7RTSQvV']) {
    assert.match(finalizeEntry({ ...base, download_url: url }, candidate).error!, /not a download page/);
  }
  assert.match(
    finalizeEntry(base, candidate).error!,
    /not a download page/,
    'fallback to a video source_url is refused too',
  );
  assert.equal(
    finalizeEntry({ ...base, download_url: 'https://store.steampowered.com/app/1' }, candidate).error,
    undefined,
  );
});
