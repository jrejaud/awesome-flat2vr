import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { waybackSnapshot } from '../scripts/discover/sources.mjs';

afterEach(() => vi.unstubAllGlobals());
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

test('waybackSnapshot returns the closest capture over https, or null', async () => {
  vi.stubGlobal(
    'fetch',
    reply({
      archived_snapshots: { closest: { available: true, url: 'http://web.archive.org/web/2026/https://x.dev/r' } },
    }),
  );
  assert.equal(await waybackSnapshot('https://x.dev/r'), 'https://web.archive.org/web/2026/https://x.dev/r');
  vi.stubGlobal('fetch', reply({ archived_snapshots: {} }));
  assert.equal(await waybackSnapshot('https://x.dev/r'), null);
  vi.stubGlobal('fetch', reply({}, 503));
  assert.equal(await waybackSnapshot('https://x.dev/r'), null);
});
