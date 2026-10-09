#!/usr/bin/env node
// Fill in a port's game images and YouTube reviews.
//   node scripts/enrich.mjs [slug ...] [--force] [--no-reviews]
// With no slugs, enriches every ports/*.yml that is missing an image or reviews.
// Images: Steam store header for each game, else the top review's YouTube thumbnail,
// else the GitHub social card of the port's repo. Reviews: yt-dlp YouTube search.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import { ROOT } from './lib.mjs';
import { toYaml } from './discover/core.mjs';

const UA = { 'user-agent': 'awesome-flat2vr-enrich/1.0 (+https://github.com/jrejaud/awesome-flat2vr)' };

export const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[™®©:'’!.,\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
export const slugify = (s) =>
  norm(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function getJson(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// Pick the Steam app whose name matches the game: exact (normalized) first, then a
// name that starts with the game title. Returns { id, name } or null.
export function pickSteamApp(game, items) {
  const want = norm(game);
  const year = /\((\d{4})\)/.exec(game)?.[1];
  const cands = items.map((i) => ({ id: i.id, name: i.name, n: norm(i.name) }));
  const exact = cands.filter((c) => c.n === want);
  if (exact.length) return exact[0];
  if (year) {
    const withYear = cands.find((c) => c.name.includes(year) && c.n.startsWith(want));
    if (withYear) return withYear;
  }
  // Only accept a longer title when the extra words are an edition of the same game.
  const edition =
    /^(remastered|classic|enhanced|definitive|complete|anniversary|gold|goty|game of the year|deluxe|biohazard|\d+th anniversary.*|\d{4}|edition| )+$/;
  return cands.find((c) => c.n.startsWith(`${want} `) && edition.test(c.n.slice(want.length + 1))) ?? null;
}

async function steamApp(game) {
  const q = encodeURIComponent(game.replace(/\(.*?\)/g, '').trim());
  const data = await retry(() => getJson(`https://store.steampowered.com/api/storesearch/?term=${q}&l=english&cc=US`));
  return pickSteamApp(game, data.items ?? []);
}

async function retry(fn, n = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= n) throw e;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

async function steamHeader(id) {
  const d = await retry(() => getJson(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic`));
  const app = d?.[id]?.data;
  if (!app) throw new Error(`no Steam app ${id}`);
  return { name: app.name, url: app.header_image };
}

async function download(url, dest) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 2000) throw new Error(`image too small (${buf.length} B): ${url}`);
  mkdirSync(join(dest, '..'), { recursive: true });
  writeFileSync(dest, buf);
}

// Keep a review only if its title names VR and the game (or the port), and it isn't a Short.
export function isReview(v, entry, game) {
  const t = norm(v.title);
  const compact = t.replace(/\s+/g, '');
  if ((v.duration ?? 0) < 120) return false;
  if (/\bnews\b|roundup|weekly|top \d+|\d+ best|update &/.test(t)) return false;
  const port = norm(entry.name).replace(/\s+/g, '');
  if (port.length > 4 && compact.includes(port)) return true;
  if (!/\bvr\b|virtual reality/.test(t)) return false;
  const words = norm(game)
    .split(' ')
    .filter((w) => w.length > 2 && w !== 'vr');
  if (!words.length || !words.every((w) => t.includes(w))) return false;
  if (entry.platform === 'standalone') return /quest|sidequest|pico|standalone/.test(t);
  return true;
}

function searchYouTube(query, n = 10) {
  const out = execFileSync('yt-dlp', ['--flat-playlist', '--dump-json', '--no-warnings', `ytsearch${n}:${query}`], {
    encoding: 'utf8',
    timeout: 90_000,
  });
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((v) => ({
      id: v.id,
      title: v.title,
      channel: v.channel ?? v.uploader,
      duration: v.duration,
      views: v.view_count ?? 0,
    }));
}

export function findReviews(entry, max = 2) {
  const found = new Map();
  for (const game of entry.games) {
    const queries = [`${entry.name} ${game}`, `${game} VR ${entry.platform === 'standalone' ? 'Quest' : 'mod'}`];
    for (const q of queries) {
      for (const v of searchYouTube(q)) if (isReview(v, entry, game) && !found.has(v.id)) found.set(v.id, v);
    }
  }
  return [...found.values()]
    .sort((a, b) => b.views - a.views)
    .slice(0, max)
    .map((v) => ({ title: v.title, channel: v.channel, url: `https://www.youtube.com/watch?v=${v.id}` }));
}

// Mutates and returns `entry`: adds `images` (one per game) and `reviews`. Writes
// image files under <root>/images/<slug>/.
export async function enrich(
  entry,
  slug,
  { root = ROOT, force = false, reviews = true, steam = {}, log = () => {} } = {},
) {
  if (reviews && (force || !entry.reviews?.length)) {
    try {
      const r = findReviews(entry);
      if (r.length) entry.reviews = r;
    } catch (e) {
      log(`  reviews: ${e.message.split('\n')[0]}`);
    }
  }
  const have = new Map((force ? [] : (entry.images ?? [])).map((i) => [i.game, i]));
  const images = [];
  for (const game of entry.games) {
    if (have.has(game) && existsSync(join(root, have.get(game).file))) {
      images.push(have.get(game));
      continue;
    }
    const file = `images/${slug}/${slugify(game) || 'game'}.jpg`;
    let img = null;
    try {
      const app = steam[game] ? { id: steam[game] } : await steamApp(game);
      if (app) {
        const h = await steamHeader(app.id);
        app.name = h.name;
        await retry(() => download(h.url, join(root, file)));
        img = {
          game,
          file,
          credit: `${app.name} store art`,
          source_url: `https://store.steampowered.com/app/${app.id}/`,
        };
      }
    } catch (e) {
      log(`  steam ${game}: ${e.message}`);
    }
    const rv = entry.reviews?.[0];
    if (!img && rv) {
      const id = new URL(rv.url).searchParams.get('v');
      try {
        await download(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, join(root, file));
        img = { game, file, credit: rv.channel, source_url: rv.url };
      } catch (e) {
        log(`  youtube thumb ${game}: ${e.message}`);
      }
    }
    const gh = /^https:\/\/github\.com\/([^/]+\/[^/]+)/.exec(entry.source_url ?? '');
    if (!img && gh) {
      try {
        await download(`https://opengraph.githubassets.com/1/${gh[1]}`, join(root, file.replace(/\.jpg$/, '.png')));
        img = { game, file: file.replace(/\.jpg$/, '.png'), credit: gh[1], source_url: `https://github.com/${gh[1]}` };
      } catch (e) {
        log(`  github card ${game}: ${e.message}`);
      }
    }
    if (img) images.push(img);
    else log(`  no image found for ${game}`);
  }
  if (images.length) entry.images = images;
  return entry;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const reviews = !args.includes('--no-reviews');
  const steam = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--steam') {
      const [g, id] = args[i + 1].split('=');
      steam[g] = Number(id);
      args.splice(i, 2);
      i--;
    }
  }
  const slugs = args.filter((a) => !a.startsWith('--'));
  const files = slugs.length
    ? slugs.map((s) => `${s}.yml`)
    : readdirSync(join(ROOT, 'ports')).filter((f) => f.endsWith('.yml'));
  let missing = 0;
  for (const f of files) {
    const path = join(ROOT, 'ports', f);
    const entry = yaml.load(readFileSync(path, 'utf8'), { schema: yaml.JSON_SCHEMA });
    const done = entry.images?.length === entry.games.length && (!reviews || entry.reviews?.length);
    if (done && !force && !slugs.length) continue;
    const slug = f.replace(/\.yml$/, '');
    console.log(`→ ${slug}`);
    await enrich(entry, slug, { force, reviews, steam, log: console.log });
    console.log(`  images ${entry.images?.length ?? 0}/${entry.games.length}, reviews ${entry.reviews?.length ?? 0}`);
    if ((entry.images?.length ?? 0) < entry.games.length) missing++;
    writeFileSync(path, toYaml(entry));
  }
  if (missing) {
    console.error(`${missing} port(s) still missing an image`);
    process.exit(1);
  }
}
