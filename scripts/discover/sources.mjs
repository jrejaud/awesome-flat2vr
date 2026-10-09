// Discovery sources. Each collector returns candidates:
//   { id, source, source_url, title, date, text, urls }
// `id` is stable across runs (it is what the seen-state remembers); `urls` is every link the
// source material carries, which is also the set the model is allowed to cite.
import { execFileSync } from 'node:child_process';
import { extractUrls, githubRepo } from './core.mjs';

const UA = 'awesome-flat2vr-discovery-bot (+https://github.com/jrejaud/awesome-flat2vr)';

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}
const GH_TOKEN = githubToken();

// Network-level failures ("fetch failed": resets, DNS blips) are retried; HTTP errors are not.
export async function fetchRetry(url, init, { tries = 3, delayMs = 2000 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
}

export async function gh(path, { allow404 = false } = {}) {
  const res = await fetchRetry(`https://api.github.com/${path.replace(/^\//, '')}`, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/vnd.github+json',
      ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {}),
    },
  });
  if (allow404 && res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status}`);
  return res.json();
}

// Newest release of a repo, prereleases included when there is no full release.
// False only for a link that is provably gone: a GitHub repo the API 404s, or a page
// answering 404/410. Bot walls (403 from Patreon/Nexus) and network errors count as alive,
// so a flaky host never deletes a real entry.
export async function linkAlive(url) {
  const repo = githubRepo(url);
  if (repo) return (await gh(`repos/${repo}`, { allow404: true })) !== null;
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
    return res.status !== 404 && res.status !== 410;
  } catch {
    return true;
  }
}

export async function deadLinks(entry) {
  const urls = [entry.download_url, entry.source_url, entry.homepage].filter(Boolean);
  const dead = [];
  for (const u of urls) if (!(await linkAlive(u))) dead.push(u);
  return dead;
}

export async function latestRelease(repo) {
  const rel = await gh(`repos/${repo}/releases/latest`, { allow404: true });
  const r = rel ?? (await gh(`repos/${repo}/releases?per_page=1`, { allow404: true }))?.[0];
  if (!r) return null;
  return { tag: r.tag_name, date: (r.published_at ?? r.created_at ?? '').slice(0, 10), url: r.html_url, body: r.body };
}

// Repo facts handed to the model so version/date/license come from GitHub, not a guess.
export async function repoContext(repo) {
  const meta = await gh(`repos/${repo}`, { allow404: true });
  if (!meta) return null;
  const release = await latestRelease(repo);
  let readme = '';
  const rd = await gh(`repos/${repo}/readme`, { allow404: true });
  if (rd?.content) readme = Buffer.from(rd.content, 'base64').toString('utf8').slice(0, 3000);
  const text = [
    `GitHub repo: ${meta.html_url}`,
    `Description: ${meta.description ?? ''}`,
    `Owner: ${meta.owner.login} (${meta.owner.html_url})`,
    `License (SPDX): ${meta.license?.spdx_id ?? 'none declared'}`,
    `Archived: ${meta.archived}  Fork: ${meta.fork}  Stars: ${meta.stargazers_count}`,
    `Homepage: ${meta.homepage ?? ''}`,
    release
      ? `Latest release: tag ${release.tag}, published ${release.date}, ${release.url}\nRelease notes: ${(release.body ?? '').slice(0, 1200)}`
      : 'Latest release: none',
    `README excerpt:\n${readme}`,
  ].join('\n');
  const urls = [meta.html_url, `${meta.html_url}/releases`, `${meta.html_url}/releases/latest`, meta.owner.html_url];
  if (meta.homepage) urls.push(meta.homepage);
  if (release?.url) urls.push(release.url);
  return { meta, release, text, urls: [...urls, ...extractUrls(readme)] };
}

// ---- Elliott Tate's Flat2VR release-report gists --------------------------------------
// Each report embeds `const releases = [ { date, title, author, status, tags, summary, source, … } ]`.
export function parseTateReleases(html) {
  const start = html.indexOf('const releases = [');
  if (start < 0) return [];
  const end = html.indexOf('\n    ];', start);
  const body = html.slice(start, end > 0 ? end : undefined);
  const out = [];
  for (const block of body.split(/\n\s*\},?\s*\n\s*\{/)) {
    const str = (k) => {
      const m = new RegExp(`\\b${k}:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(block);
      return m ? m[1].replace(/\\"/g, '"') : '';
    };
    const tags = /\btags:\s*\[([^\]]*)\]/.exec(block)?.[1] ?? '';
    const highlights = /\bhighlights:\s*\[([^\]]*)\]/.exec(block)?.[1] ?? '';
    const r = {
      date: str('date'),
      title: str('title'),
      author: str('author'),
      status: str('status'),
      tags: [...tags.matchAll(/"([^"]*)"/g)].map((m) => m[1]),
      summary: str('summary'),
      highlights: [...highlights.matchAll(/"([^"]*)"/g)].map((m) => m[1]),
      source: str('source'),
    };
    if (r.title && r.date) out.push(r);
  }
  return out;
}

export async function tateGists({ user = 'elliotttate', extraIds = [] } = {}) {
  const list = await gh(`users/${user}/gists?per_page=100`);
  const ids = new Set([...list.filter((g) => /flat2vr/i.test(g.description ?? '')).map((g) => g.id), ...extraIds]);
  const out = [];
  for (const id of ids) {
    const gist = await gh(`gists/${id}`);
    for (const file of Object.values(gist.files)) {
      if (!/\.html?$/i.test(file.filename)) continue;
      const html = file.truncated
        ? await (await fetch(file.raw_url, { headers: { 'User-Agent': UA } })).text()
        : file.content;
      for (const r of parseTateReleases(html)) {
        out.push({
          id: `gist:${id}:${r.title.toLowerCase()}`,
          source: 'tate-gist',
          source_url: gist.html_url,
          title: r.title,
          date: r.date,
          text: [
            `Flat2VR release report entry (${gist.description})`,
            `Title: ${r.title}`,
            `Author: ${r.author}`,
            `Released: ${r.date}  Status: ${r.status}`,
            `Tags: ${r.tags.join(', ')}`,
            `Summary: ${r.summary}`,
            `Highlights: ${r.highlights.join(' / ')}`,
            `Source: ${r.source}`,
          ].join('\n'),
          urls: r.source ? [r.source] : [],
        });
      }
    }
  }
  return out;
}

// ---- GitHub: new repos that look like flat-to-VR ports ---------------------------------
const GH_QUERIES = [
  'flat2vr',
  'topic:flat2vr',
  'topic:vr-mod',
  'topic:uevr',
  '"vr mod" in:name,description',
  '"vr port" in:name,description',
  'org:Team-Beef-Studios',
  'user:DrBeef',
];

export async function githubSearch({ sinceDays = 30 } = {}) {
  const since = new Date(Date.now() - sinceDays * 864e5).toISOString().slice(0, 10);
  const seen = new Set();
  const out = [];
  for (const q of GH_QUERIES) {
    const res = await gh(
      `search/repositories?q=${encodeURIComponent(`${q} pushed:>=${since} fork:false archived:false`)}&sort=updated&per_page=30`,
    );
    for (const r of res.items ?? []) {
      if (seen.has(r.full_name)) continue;
      seen.add(r.full_name);
      out.push({
        id: `github:${r.full_name.toLowerCase()}`,
        source: 'github',
        source_url: r.html_url,
        title: r.name,
        date: r.pushed_at.slice(0, 10),
        text: `GitHub repository ${r.full_name}: ${r.description ?? ''}`,
        urls: [r.html_url],
        needsRelease: true,
      });
    }
  }
  return out;
}

// ---- SideQuest ------------------------------------------------------------------------
// The API answers 403 without a browser Origin/Referer. Scraper-generated listings
// (packagename com.sidequest.scraper.*) are store mirrors, never ports.
const SQ_HEADERS = {
  Origin: 'https://sidequestvr.com',
  Referer: 'https://sidequestvr.com/',
  'User-Agent': 'Mozilla/5.0',
};
const SQ_TERMS = ['port', 'vr mod', 'source port', 'xr', 'team beef', 'quest port'];

export async function sidequest({ sinceDays = 14 } = {}) {
  const cutoff = Date.now() - sinceDays * 864e5;
  const seen = new Set();
  const out = [];
  for (const term of SQ_TERMS) {
    const url = `https://api.sidequestvr.com/search-apps?search=${encodeURIComponent(term)}&limit=50&skip=0&sortOn=created&descending=true`;
    const res = await fetch(url, {
      headers: SQ_HEADERS,
    });
    if (!res.ok) throw new Error(`SideQuest search ${term}: HTTP ${res.status}`);
    const { data = [] } = await res.json();
    for (const app of data) {
      if (seen.has(app.apps_id) || /^com\.sidequest\.scraper\./.test(app.packagename ?? '')) continue;
      if (Number(app.created) < cutoff) continue;
      seen.add(app.apps_id);
      const page = `https://sidequestvr.com/app/${app.apps_id}`;
      // v2/apps carries what search omits: uploader, version, linked GitHub repo, links.
      const d = await (
        await fetch(`https://api.sidequestvr.com/v2/apps/${app.apps_id}`, { headers: SQ_HEADERS })
      ).json();
      const repo = d.github_name && d.github_repo ? `https://github.com/${d.github_name}/${d.github_repo}` : '';
      const links = (Array.isArray(d.urls) ? d.urls : [])
        .map((u) => u?.link_url ?? u?.url ?? u)
        .filter((u) => typeof u === 'string');
      const text = [
        `SideQuest app "${d.name ?? app.name}" (${page})`,
        `Uploaded by SideQuest user: ${d.user_name ?? 'unknown'}`,
        `Package: ${app.packagename}  Version: ${d.versionname ?? ''}  Updated: ${d.updated ? new Date(Number(d.updated)).toISOString().slice(0, 10) : ''}`,
        `Price: ${d.price ?? ''}  License: ${d.license ?? ''}`,
        `Summary: ${d.summary ?? app.summary ?? ''}`,
        `Description: ${(d.description ?? '').slice(0, 2500)}`,
        `Website: ${d.website ?? ''}  GitHub: ${repo}`,
        `Links: ${links.join(' ')}`,
      ].join('\n');
      out.push({
        id: `sidequest:${app.apps_id}`,
        source: 'sidequest',
        source_url: page,
        title: app.name,
        date: new Date(Number(app.created)).toISOString().slice(0, 10),
        text,
        urls: [page, ...(repo ? [repo] : []), ...extractUrls(text)],
      });
    }
  }
  return out;
}

// ---- Reddit (via the `reddit` CLI, which reads through the private Redlib) --------------
const SUBS = ['flat2vr', 'OculusQuest', 'virtualreality', 'PCVR'];
const RELEASE_HINT =
  /\b(release[sd]?|out now|available|launch(ed)?|v?\d+\.\d+|alpha|beta|update[sd]?|mod|port|uevr|6dof|download)\b/i;

export async function reddit({ limit = 50, bin = process.env.REDDIT_BIN || 'reddit' } = {}) {
  const out = [];
  for (const sub of SUBS) {
    let posts;
    try {
      posts = JSON.parse(
        execFileSync(bin, ['new', sub, '--limit', String(limit), '--json'], { encoding: 'utf8', timeout: 120e3 }),
      );
    } catch (e) {
      throw new Error(`reddit new ${sub}: ${e.message.split('\n')[0]}`, { cause: e });
    }
    for (const p of posts) {
      const text = `${p.title}\n${p.selftext ?? ''}`;
      if (!RELEASE_HINT.test(text)) continue;
      if (sub !== 'flat2vr' && !/\b(mod|port|uevr|flat2vr|vr version)\b/i.test(text)) continue;
      const urls = [...new Set([p.url, p.link, ...extractUrls(p.selftext ?? '')].filter(Boolean))];
      if (urls.length < 2 && !(p.selftext ?? '').trim()) continue;
      out.push({
        id: `reddit:${p.id}`,
        source: `reddit r/${p.subreddit}`,
        source_url: p.url,
        title: p.title,
        date: p.created.slice(0, 10),
        text: `Reddit post in r/${p.subreddit} by u/${p.author} on ${p.created.slice(0, 10)}\nTitle: ${p.title}\nLinked URL: ${p.link ?? ''}\nBody:\n${(p.selftext ?? '').slice(0, 3000)}`,
        urls,
      });
    }
  }
  return out;
}

// ---- Steam: free VR mods published as their own store app (Half-Life 2: VR Mod) ---------
// Store search is fuzzy, so a hit only becomes a candidate when appdetails says it is a
// `mod` of a base game, or its name says VR mod/port.
const STEAM_TERMS = ['VR Mod', 'VR Port', 'VR Edition', 'VR Conversion', 'Flat2VR'];

export async function steam() {
  const ids = new Map();
  for (const term of STEAM_TERMS) {
    const res = await fetchRetry(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=us&l=en`,
      { headers: { 'User-Agent': UA } },
    );
    if (!res.ok) throw new Error(`Steam search ${term}: HTTP ${res.status}`);
    for (const i of (await res.json()).items ?? []) ids.set(i.id, i.name);
  }
  const out = [];
  for (const [id, name] of ids) {
    const res = await fetchRetry(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=us&l=en`, {
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) continue;
    const a = (await res.json())?.[id]?.data;
    if (!a) continue;
    if (!(a.type === 'mod' || a.fullgame || /\bVR (mod|port)\b/i.test(name))) continue;
    const page = `https://store.steampowered.com/app/${id}`;
    const text = [
      `Steam store app "${a.name}" (${page}), type: ${a.type}`,
      a.fullgame ? `Requires base game: ${a.fullgame.name} (app ${a.fullgame.appid})` : '',
      `Developers: ${(a.developers ?? []).join(', ')}  Publishers: ${(a.publishers ?? []).join(', ')}`,
      `Release date: ${a.release_date?.date ?? ''}  Price: ${a.is_free ? 'free' : (a.price_overview?.final_formatted ?? '')}`,
      `Categories: ${(a.categories ?? []).map((c) => c.description).join(', ')}`,
      `Website: ${a.website ?? ''}`,
      `Description: ${(a.short_description ?? '').slice(0, 1500)}`,
    ].join('\n');
    out.push({
      id: `steam:${id}`,
      source: 'steam',
      source_url: page,
      title: a.name,
      date: '',
      text,
      urls: [page, ...(a.website ? [a.website] : [])],
    });
  }
  return out;
}

// ---- Flat2VR Discord, read through Jordan's Beeper bridge -------------------------------
// Only these channels are bridged (the per-port channels are not); #general is too chatty.
// Read-only: the bot never posts to Discord.
const DISCORD_CHANNELS = {
  '#announcements': '!FHmAv8i9OMpDG7wI6snR:beeper.local',
  '#videos': '!DJveiF0EhmDFyZrI4HQd:beeper.local',
  '#xrshowcase': '!YOmCer3brPDXzgiLWpPF:beeper.local',
  '#x-news': '!ignhehyffudywk3gi70R:beeper.local',
};
const stripHtml = (s) =>
  String(s ?? '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>[^<]*<\/a>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&');

export async function discord({ limit = 100, bin = process.env.BEEPER_BIN || 'beeper', sinceDays = 7 } = {}) {
  const cutoff = new Date(Date.now() - sinceDays * 864e5).toISOString();
  const out = [];
  for (const [name, chat] of Object.entries(DISCORD_CHANNELS)) {
    let msgs;
    try {
      msgs = JSON.parse(
        execFileSync(bin, ['messages', 'list', '--chat', chat, '--limit', String(limit), '--json'], {
          encoding: 'utf8',
          timeout: 120e3,
          maxBuffer: 32 << 20,
        }),
      ).data;
    } catch (e) {
      throw new Error(`beeper ${name}: ${e.message.split('\n')[0]}`, { cause: e });
    }
    for (const m of msgs ?? []) {
      if (m.isDeleted || m.timestamp < cutoff) continue;
      const body = stripHtml(m.text);
      const links = (m.links ?? []).map((l) => `${l.url} — ${l.title ?? ''}: ${(l.summary ?? '').slice(0, 600)}`);
      const text = `${body}\n${links.join('\n')}`;
      if (!RELEASE_HINT.test(text) || !(m.links?.length || extractUrls(body).length)) continue;
      out.push({
        id: `discord:${chat}:${m.id}`,
        source: `Flat2VR Discord ${name}`,
        source_url: `https://discord.gg/flat2vr`,
        title: body.slice(0, 80),
        date: m.timestamp.slice(0, 10),
        text: `Flat2VR Discord ${name}, posted by ${m.senderName} on ${m.timestamp.slice(0, 10)}:\n${text}`,
        urls: [
          ...new Set([...(m.links ?? []).map((l) => l.url), ...extractUrls(body), ...extractUrls(links.join(' '))]),
        ],
      });
    }
  }
  return out;
}

// ---- YouTube: VR creators covering new Flat2VR mods ---------------------------------------
// Search gives truncated descriptions, so each hit is re-read with `youtube video` for the
// full description, which is where creators put the mod's download link.
const YT_QUERIES = ['flat2vr', 'VR mod release', 'UEVR mod', 'flat to VR mod', 'Quest standalone port'];

export async function youtube({ bin = process.env.YOUTUBE_BIN || 'youtube', sinceDays = 7, limit = 15 } = {}) {
  const after = new Date(Date.now() - sinceDays * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
  const run = (a) => JSON.parse(execFileSync(bin, a, { encoding: 'utf8', timeout: 120e3, maxBuffer: 16 << 20 }));
  const ids = new Set();
  for (const q of YT_QUERIES) {
    let res;
    try {
      res = run(['search-videos', q, '--limit', String(limit), '--order', 'date', '--published-after', after]);
    } catch (e) {
      throw new Error(`youtube search ${q}: ${e.message.split('\n')[0]}`, { cause: e });
    }
    for (const it of res.items ?? []) if (it.id?.videoId) ids.add(it.id.videoId);
  }
  const out = [];
  for (const id of ids) {
    let v;
    try {
      v = run(['video', id]);
    } catch {
      continue;
    }
    const sn = v.items?.[0]?.snippet ?? v.snippet ?? v;
    const url = `https://www.youtube.com/watch?v=${id}`;
    const desc = String(sn.description ?? '');
    if (!extractUrls(desc).length) continue; // no link to the mod itself, nothing to index
    out.push({
      id: `youtube:${id}`,
      source: 'youtube',
      source_url: url,
      title: sn.title ?? id,
      date: String(sn.publishedAt ?? '').slice(0, 10),
      text: `YouTube video "${sn.title}" by ${sn.channelTitle} (${url}), published ${String(sn.publishedAt ?? '').slice(0, 10)}\nDescription:\n${desc.slice(0, 3000)}`,
      urls: extractUrls(desc),
    });
  }
  return out;
}

export const COLLECTORS = { gists: tateGists, github: githubSearch, steam, sidequest, discord, youtube, reddit };

// GitHub repo a candidate points at, for enrichment and dedupe.
export const candidateRepo = (c) => c.urls.map(githubRepo).find(Boolean) ?? null;
