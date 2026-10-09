#!/usr/bin/env node
// Daily Flat2VR discovery: version bumps for indexed GitHub ports + new ports from
// Tate's release-report gists, GitHub, SideQuest and Reddit, proposed as one rolling PR.
//
//   node scripts/discover/run.mjs [--dry-run] [--pr] [--notify]
//        [--sources gists,github,sidequest,reddit] [--max-extract N] [--no-bumps]
//
// --dry-run   discover + extract, print what would change, write nothing (state included)
// --pr        rebuild branch bot/discovery from origin/main (+ the open PR's pending entries),
//             commit, force-push, open/update the PR. Without it, files are written to the
//             working tree only.
// --notify    tg-fyi a summary when something was added or bumped (silent otherwise)
// Env: FLAT2VR_STATE (seen-state dir, default ~/.local/state/flat2vr-bot),
//      FLAT2VR_HC_URL (Healthchecks ping URL; /start, success and /fail are sent).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import { loadPorts, ROOT } from '../lib.mjs';
import {
  applyBump,
  buildIndex,
  entryKeys,
  finalizeEntry,
  githubRepo,
  isVersionBump,
  matchExisting,
  toYaml,
  uniqueSlug,
} from './core.mjs';
import { COLLECTORS, candidateRepo, deadLinks, latestRelease, repoContext } from './sources.mjs';
import { extract } from './extract.mjs';

const BRANCH = 'bot/discovery';
// Verdicts worth another look on a later run (a transient failure, or a model miss the gate caught).
const RETRY = new Set(['error', 'invalid']);
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const DRY = flag('--dry-run');
const PR = flag('--pr') && !DRY;
const SOURCES = opt('--sources', 'gists,github,sidequest,reddit').split(',').filter(Boolean);
const MAX_EXTRACT = Number(opt('--max-extract', '25'));
const STATE_DIR = process.env.FLAT2VR_STATE || join(homedir(), '.local/state/flat2vr-bot');
const SEEN_FILE = join(STATE_DIR, 'seen.json');
const TODAY = new Date().toISOString().slice(0, 10);
const HC = process.env.FLAT2VR_HC_URL;

const sh = (cmd, a, o = {}) => execFileSync(cmd, a, { cwd: ROOT, encoding: 'utf8', ...o }).trim();
const git = (...a) => sh('git', a);
const log = (...m) => console.log(...m);

async function ping(suffix = '', body = '') {
  if (!HC || DRY) return;
  try {
    await fetch(`${HC}${suffix}`, { method: 'POST', body });
  } catch (e) {
    console.error(`healthchecks ping failed: ${e.message}`);
  }
}

function loadSeen() {
  try {
    return JSON.parse(readFileSync(SEEN_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveSeen(seen) {
  if (DRY) return;
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 1));
}

// Branch = origin/main + every ports/ file the still-open bot PR changes, so pending
// entries are deduped against and carried forward instead of re-proposed or dropped.
function prepareBranch() {
  git('fetch', 'origin', '--prune');
  const remoteBranch = git('ls-remote', '--heads', 'origin', BRANCH);
  let carried = [];
  if (remoteBranch) {
    const open = JSON.parse(sh('gh', ['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number']));
    git('fetch', 'origin', `${BRANCH}:refs/remotes/origin/${BRANCH}`);
    if (open.length)
      carried = git('diff', '--name-only', '--diff-filter=AM', `origin/main...origin/${BRANCH}`, '--', 'ports/')
        .split('\n')
        .filter(Boolean);
  }
  git('checkout', '--force', '-B', BRANCH, 'origin/main');
  for (const f of git('ls-files', '--others', '--exclude-standard', 'ports/').split('\n').filter(Boolean))
    rmSync(join(ROOT, f));
  if (carried.length) git('checkout', `origin/${BRANCH}`, '--', ...carried);
  return carried;
}

// Entries carried from the open PR are re-checked daily: a repo deleted since it was
// proposed is dropped from the PR instead of failing its link check forever.
async function pruneCarried(carried, changes) {
  for (const f of carried) {
    let d;
    try {
      d = yaml.load(readFileSync(join(ROOT, f), 'utf8'), { schema: yaml.JSON_SCHEMA });
    } catch {
      continue;
    }
    let dead;
    try {
      dead = await deadLinks(d);
    } catch {
      continue; // unknown is not dead
    }
    if (!dead.length) continue;
    let onMain = true;
    try {
      git('cat-file', '-e', `origin/main:${f}`);
    } catch {
      onMain = false;
    }
    if (onMain) git('checkout', 'origin/main', '--', f);
    else rmSync(join(ROOT, f));
    changes.pruned.push({ file: f, dead });
    log(`prune ${f}: dead link ${dead.join(' ')}`);
  }
}

async function versionBumps(ports, changes) {
  for (const p of ports) {
    const repo = githubRepo(p.download_url) ?? githubRepo(p.source_url);
    if (!repo || p.status === 'abandoned') continue;
    let rel;
    try {
      rel = await latestRelease(repo);
    } catch (e) {
      changes.warnings.push(`bump check ${p.slug}: ${e.message}`);
      continue;
    }
    if (!isVersionBump(p, rel)) continue;
    const file = join(ROOT, 'ports', `${p.slug}.yml`);
    const next = applyBump(readFileSync(file, 'utf8'), {
      version: rel.tag,
      version_date: rel.date || TODAY,
      last_checked: TODAY,
    });
    if (!DRY) writeFileSync(file, next);
    changes.bumped.push({ slug: p.slug, name: p.name, from: p.version, to: rel.tag, url: rel.url });
    log(`bump  ${p.slug}: ${p.version} -> ${rel.tag}`);
  }
}

async function discover(ports, changes) {
  const seen = loadSeen();
  const index = buildIndex(ports);
  const taken = new Set(ports.map((p) => p.slug));
  const names = ports.map((p) => p.name);
  const candidates = [];
  for (const s of SOURCES) {
    try {
      const got = await COLLECTORS[s]();
      log(`source ${s}: ${got.length} candidates`);
      candidates.push(...got);
    } catch (e) {
      changes.warnings.push(`source ${s}: ${e.message}`);
      console.error(`source ${s} failed: ${e.message}`);
    }
  }

  let extracted = 0;
  const runKeys = new Set();
  for (const c of candidates) {
    const prior = seen[c.id];
    if (prior && (!RETRY.has(prior.result) || (prior.attempts ?? 1) >= 3)) continue;
    const dup = matchExisting(index, c);
    if (dup) {
      seen[c.id] = { result: 'duplicate', of: dup, at: TODAY };
      continue;
    }
    const repo = candidateRepo(c);
    if (repo && runKeys.has(repo)) continue;
    if (extracted >= MAX_EXTRACT) {
      changes.deferred++;
      continue;
    }
    try {
      if (repo) {
        const ctx = await repoContext(repo);
        if (c.needsRelease && !ctx?.release) continue; // re-check tomorrow; no model call spent
        if (ctx) {
          c.text += `\n\n--- Linked repository facts (from the GitHub API) ---\n${ctx.text}`;
          c.urls = [...new Set([...c.urls, ...ctx.urls])];
        }
        runKeys.add(repo);
      }
      extracted++;
      const out = extract(c, names, { date: TODAY });
      if (!out.is_port || out.duplicate_of) {
        seen[c.id] = {
          result: out.duplicate_of ? 'duplicate' : 'rejected',
          of: out.duplicate_of,
          reason: out.reason,
          at: TODAY,
        };
        log(`skip  ${c.title}: ${out.duplicate_of ? `duplicate of ${out.duplicate_of}` : out.reason}`);
        continue;
      }
      const { entry, error } = finalizeEntry(out.entry, c, { date: TODAY });
      if (error) {
        seen[c.id] = { result: 'invalid', reason: error, attempts: (prior?.attempts ?? 0) + 1, at: TODAY };
        log(`drop  ${c.title}: ${error}`);
        continue;
      }
      const dead = await deadLinks(entry);
      if (dead.length) {
        seen[c.id] = {
          result: 'invalid',
          reason: `dead link: ${dead.join(' ')}`,
          attempts: (prior?.attempts ?? 0) + 1,
          at: TODAY,
        };
        log(`drop  ${c.title}: dead link ${dead.join(' ')}`);
        continue;
      }
      const clash = [...entryKeys(entry)].find((k) => index.has(k));
      if (clash) {
        seen[c.id] = { result: 'duplicate', of: index.get(clash), at: TODAY };
        continue;
      }
      const slug = uniqueSlug(entry.name, taken);
      taken.add(slug);
      for (const k of entryKeys(entry)) index.set(k, slug);
      names.push(entry.name);
      if (!DRY) writeFileSync(join(ROOT, 'ports', `${slug}.yml`), toYaml(entry));
      changes.added.push({
        slug,
        name: entry.name,
        games: entry.games,
        via: entry.discovered_via,
        url: entry.download_url,
      });
      seen[c.id] = { result: 'added', slug, at: TODAY };
      log(`add   ${slug}: ${entry.name} (${entry.games.join(', ')}) via ${c.source}`);
      if (DRY) log(toYaml(entry));
    } catch (e) {
      seen[c.id] = {
        result: 'error',
        reason: e.message.slice(0, 300),
        attempts: (prior?.attempts ?? 0) + 1,
        at: TODAY,
      };
      changes.warnings.push(`${c.id}: ${e.message.split('\n')[0]}`);
    } finally {
      saveSeen(seen);
    }
  }
  changes.extracted = extracted;
}

function prBody() {
  const rows = git('diff', '--name-status', 'origin/main', '--', 'ports/')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [st, f] = l.split('\t');
      const d = yaml.load(readFileSync(join(ROOT, f), 'utf8'), { schema: yaml.JSON_SCHEMA });
      return st === 'A'
        ? `| added | [${d.name}](${d.download_url}) | ${d.games.join(', ')} | ${d.version} | ${d.discovered_via} |`
        : `| updated | [${d.name}](${d.download_url}) | ${d.games.join(', ')} | ${d.version} | ${d.discovered_via} |`;
    });
  return [
    'Automated daily discovery run (Elliott Tate release reports, GitHub, SideQuest, Reddit).',
    'Every entry is `added_by: bot` and credits the source in `discovered_via`. Please spot-check before merging.',
    '',
    '| change | port | game(s) | version | discovered via |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    `Last run: ${TODAY}. Entries pending in this PR are carried forward by each run until it is merged or closed.`,
  ].join('\n');
}

function publish() {
  sh('npm', ['run', '-s', 'build']);
  sh('npm', ['run', '-s', 'validate']);
  git('add', 'ports', 'README.md', 'data');
  if (!git('status', '--porcelain', '--', 'ports', 'README.md', 'data')) return null;
  git(
    '-c',
    'user.name=flat2vr-bot',
    '-c',
    'user.email=bot@alastor.space',
    'commit',
    '-m',
    `bot: discovery run ${TODAY}`,
  );
  git('push', '--force', 'origin', `${BRANCH}:${BRANCH}`);
  const open = JSON.parse(sh('gh', ['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'url']));
  const body = prBody();
  if (open.length) {
    sh('gh', ['pr', 'edit', open[0].url, '--body', body]);
    return open[0].url;
  }
  return sh('gh', [
    'pr',
    'create',
    '--head',
    BRANCH,
    '--base',
    'main',
    '--title',
    'Bot: new and updated Flat2VR ports',
    '--body',
    body,
  ]);
}

function notify(changes, prUrl) {
  if (!changes.added.length && !changes.bumped.length) return;
  const lines = [
    ...changes.added.map((a) => `+ ${a.name} (${a.games.join(', ')})`),
    ...changes.bumped.map((b) => `↑ ${b.name} ${b.from} → ${b.to}`),
  ];
  if (prUrl) lines.push('', `Review: ${prUrl}`);
  if (changes.warnings.length) lines.push(`(${changes.warnings.length} source warning(s) — see the run log)`);
  const title = `Flat2VR index: ${changes.added.length} new, ${changes.bumped.length} updated`;
  try {
    sh('tg-fyi', ['flat2vr-bot', title, lines.join('\n')]);
  } catch (e) {
    console.error(`tg-fyi failed: ${e.message}`);
  }
}

async function main() {
  await ping('/start');
  const changes = { added: [], bumped: [], pruned: [], warnings: [], deferred: 0, extracted: 0 };
  const carried = PR ? prepareBranch() : [];
  if (carried.length) await pruneCarried(carried, changes);
  const { ports, errors } = loadPorts();
  if (errors.length) throw new Error(`index invalid before run: ${errors.join('; ')}`);
  if (!flag('--no-bumps')) await versionBumps(ports, changes);
  await discover(ports, changes);

  let prUrl = null;
  if (PR) prUrl = publish();
  else if (!DRY && (changes.added.length || changes.bumped.length)) sh('npm', ['run', '-s', 'build']);

  const summary = {
    at: new Date().toISOString(),
    dry: DRY,
    added: changes.added.map((a) => a.slug),
    bumped: changes.bumped.map((b) => b.slug),
    pruned: changes.pruned.map((p) => p.file),
    carried: carried.length,
    extracted: changes.extracted,
    deferred: changes.deferred,
    warnings: changes.warnings,
    pr: prUrl,
  };
  if (!DRY) {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(join(STATE_DIR, 'runs.jsonl'), `${JSON.stringify(summary)}\n`);
  }
  log(JSON.stringify(summary, null, 2));
  if (flag('--notify')) notify(changes, prUrl);
  // A source that failed is a failed run (Linear comment via the cron card), but whatever
  // the other sources found is already published above.
  if (changes.warnings.some((w) => w.startsWith('source '))) {
    await ping('/fail', changes.warnings.join('\n'));
    process.exitCode = 2;
  } else await ping('', JSON.stringify(summary));
}

if (!existsSync(join(ROOT, 'ports'))) throw new Error(`no ports/ under ${ROOT}`);
main().catch(async (e) => {
  console.error(e.stack ?? e.message);
  await ping('/fail', e.message);
  process.exit(1);
});
