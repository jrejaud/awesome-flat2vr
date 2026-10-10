// Reachability check for the URLs in a port entry. I/O only — logic/extraction lives in core.mjs.
// A link counts as reachable on any non-error HTTP response, including the 401/403/405/429 that
// bot-hostile hosts (Steam, Patreon, some CDNs) throw at an automated GET — same leniency the
// repo's lychee link-check already uses. Dead = DNS/connection failure, timeout, 404, 410, or 5xx.

const REACHABLE_EXTRA = new Set([401, 403, 405, 429]);

export async function checkUrl(url, { timeoutMs = 15000 } = {}) {
  const attempt = async (method) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'user-agent': 'awesome-flat2vr-pr-bot/1.0 (+https://github.com/jrejaud/awesome-flat2vr)' },
      });
      return res.status;
    } finally {
      clearTimeout(t);
    }
  };
  try {
    let status = await attempt('HEAD').catch(() => 0);
    if (status === 0 || status === 405 || status >= 500) {
      // many hosts don't implement HEAD well — retry with GET before judging
      const getStatus = await attempt('GET').catch(() => 0);
      if (getStatus) status = getStatus;
    }
    const ok = (status >= 200 && status < 400) || REACHABLE_EXTRA.has(status);
    return { ok, status: status || 'connection failed' };
  } catch (e) {
    return { ok: false, status: e?.name === 'AbortError' ? 'timeout' : 'connection failed' };
  }
}

export async function checkUrls(urls, opts) {
  const results = [];
  // modest concurrency, order preserved
  const pool = 4;
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const idx = i++;
      const { field, url } = urls[idx];
      const r = await checkUrl(url, opts);
      results[idx] = { field, url, ...r };
    }
  }
  await Promise.all(Array.from({ length: Math.min(pool, urls.length) }, worker));
  return results;
}
