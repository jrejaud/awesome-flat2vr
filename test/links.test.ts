import { afterEach, describe, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { deadLinks, fetchRetry, linkAlive } from '../scripts/discover/sources.mjs';

describe('link liveness', () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (status: number) => vi.fn(async () => new Response('{}', { status }));

  test('a GitHub repo the API 404s is dead; one it returns is alive', async () => {
    vi.stubGlobal('fetch', respond(404));
    assert.deepEqual(await deadLinks({ download_url: 'https://github.com/gone/repo/releases' }), [
      'https://github.com/gone/repo/releases',
    ]);
    vi.stubGlobal('fetch', respond(200));
    assert.equal(await linkAlive('https://github.com/live/repo'), true);
  });

  test('bot walls and network errors are not treated as dead', async () => {
    vi.stubGlobal('fetch', respond(403));
    assert.equal(await linkAlive('https://www.patreon.com/posts/x'), true);
    vi.stubGlobal('fetch', respond(410));
    assert.equal(await linkAlive('https://example.com/x'), false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    assert.equal(await linkAlive('https://example.com/x'), true);
  });

  test('fetchRetry retries network failures, then succeeds', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (++n < 3) throw new TypeError('fetch failed');
        return new Response('ok');
      }),
    );
    const res = await fetchRetry('https://x.dev', {}, { tries: 3, delayMs: 1 });
    assert.equal(await res.text(), 'ok');
    assert.equal(n, 3);
  });
});
