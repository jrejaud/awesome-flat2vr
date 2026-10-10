#!/usr/bin/env node
// AI pull-request reviewer. Runs in the pr-ai-review workflow (pull_request_target) after the
// PR's data files have been checked out onto the trusted base tree. Two layers:
//   1. static  — the data-only safety gate, schema validation, and link reachability
//   2. AI      — a judgment call on whether the entry is a genuine, accurate port
// The static layer caps the AI: it can never approve over a failed static check, only tighten.
// On approve it enables auto-merge; otherwise it posts actionable change requests. Never pings a
// human except for PRs that touch code/config (the one case it refuses to auto-handle).
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { ROOT, loadPorts } from '../lib.mjs';
import { classifyFiles, extractUrls, buildReviewInput, REVIEW_TOOL, decide, renderComment, MARKER } from './core.mjs';
import { checkUrls } from './check-urls.mjs';
import { runReview } from './anthropic.mjs';

const CONFIG_PATH = join(ROOT, '.github/pr-ai-review.json');
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const policyDoc = existsSync(join(ROOT, config.policyDoc)) ? readFileSync(join(ROOT, config.policyDoc), 'utf8') : '';

const repo = process.env.GITHUB_REPOSITORY;
const pr = process.env.PR_NUMBER;
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
const apiKey = process.env.ANTHROPIC_API_KEY;
const dryRun = process.argv.includes('--dry-run');
if (!repo || !pr) {
  console.error('GITHUB_REPOSITORY and PR_NUMBER must be set');
  process.exit(1);
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });

function changedFiles() {
  const out = gh(['pr', 'view', pr, '--repo', repo, '--json', 'files', '-q', '.files[].path']);
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function postComment(body) {
  if (dryRun) {
    console.log('--- comment (dry-run) ---\n' + body);
    return;
  }
  gh(['pr', 'comment', pr, '--repo', repo, '--body', body]);
}

function enableAutoMerge() {
  if (dryRun) {
    console.log(`--- would enable ${config.mergeMethod} auto-merge on #${pr} ---`);
    return;
  }
  gh(['pr', 'merge', pr, '--repo', repo, `--${config.mergeMethod}`, '--auto']);
}

async function main() {
  const files = changedFiles();
  const classification = classifyFiles(files, config);
  console.log(`Changed files (${files.length}): ${files.join(', ')}`);

  if (!classification.dataOnly) {
    const decision = decide({ classification, validationErrors: [], urlChecks: [], ai: null, config });
    postComment(renderComment(decision));
    console.log('Verdict: human (non-data changes) — not auto-handled.');
    return;
  }

  // Validate the whole data tree with the trusted scripts (PR data already on disk).
  const { ports, errors } = loadPorts();
  const bySlug = new Map(ports.map((p) => [p.slug, p]));

  // The ports this PR touched.
  const changedSlugs = classification.dataFiles
    .filter((f) => /^ports\/[a-z0-9-]+\.yml$/.test(f))
    .map((f) => basename(f, '.yml'));
  // Image-only changes still reference a port; fall back to every port the errors mention.
  const slugs = changedSlugs.length ? changedSlugs : [...bySlug.keys()];

  // Collect URLs across the changed entries and check them once.
  const urlSet = [];
  for (const slug of slugs) {
    const entry = bySlug.get(slug);
    if (entry) urlSet.push(...extractUrls(entry));
  }
  const seen = new Set();
  const uniqueUrls = urlSet.filter((u) => (seen.has(u.url) ? false : seen.add(u.url)));
  const urlChecks = apiKey || uniqueUrls.length ? await checkUrls(uniqueUrls) : [];

  // Build one AI request. Usually one changed port; concatenate when several.
  const entryBlocks = changedSlugs
    .map((slug) => {
      const path = join(ROOT, 'ports', `${slug}.yml`);
      return existsSync(path) ? { slug, yaml: readFileSync(path, 'utf8') } : null;
    })
    .filter(Boolean);
  const entryYaml = entryBlocks.map((b) => `# ports/${b.slug}.yml\n${b.yaml}`).join('\n\n');
  const slugLabel = changedSlugs.join(', ') || '(images only)';

  let ai = null;
  if (apiKey) {
    const prompt = buildReviewInput({
      slug: slugLabel,
      entryYaml: entryYaml || '(no port file in this PR)',
      policyDoc,
      validationErrors: errors,
      urlChecks,
    });
    ai = await runReview({ apiKey, model, prompt, tool: REVIEW_TOOL });
    console.log(`AI verdict: ${ai.verdict} — ${ai.summary}`);
  } else {
    console.log('No ANTHROPIC_API_KEY — static layer only.');
  }

  const decision = decide({ classification, validationErrors: errors, urlChecks, ai, config });
  const body = renderComment(decision);
  console.log(`Final action: ${decision.action}`);

  if (decision.action === 'approve') {
    postComment(body);
    enableAutoMerge();
  } else {
    postComment(body);
  }
}

main().catch((e) => {
  console.error(e);
  // Fail soft: a reviewer crash must never merge anything. Leave the PR for a human.
  if (!dryRun) {
    try {
      gh([
        'pr',
        'comment',
        pr,
        '--repo',
        repo,
        '--body',
        `${MARKER}\n🤖 The automated reviewer hit an error and will leave this for a maintainer.`,
      ]);
    } catch (commentErr) {
      console.error('Could not post the failure comment:', commentErr?.message);
    }
  }
  process.exit(1);
});
