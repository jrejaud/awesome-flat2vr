import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  globToRegExp,
  classifyFiles,
  extractUrls,
  decide,
  renderComment,
  buildReviewInput,
  REVIEW_TOOL,
  MARKER,
} from '../scripts/review/core.mjs';

const config = {
  dataGlobs: ['ports/*.yml', 'images/**'],
  generatedFiles: ['README.md', 'data/ports.json'],
  requiredLiveUrlFields: ['download_url', 'source_url'],
  mergeMethod: 'squash',
};

test('globToRegExp: single-segment vs recursive', () => {
  assert.equal(globToRegExp('ports/*.yml').test('ports/realrtcw.yml'), true);
  assert.equal(globToRegExp('ports/*.yml').test('ports/sub/realrtcw.yml'), false);
  assert.equal(globToRegExp('images/**').test('images/realrtcw/a.png'), true);
  assert.equal(globToRegExp('images/**').test('images/realrtcw/nested/a.png'), true);
});

test('classifyFiles: data-only PR passes the gate', () => {
  const c = classifyFiles(['ports/realrtcw.yml', 'images/realrtcw/x.png', 'README.md', 'data/ports.json'], config);
  assert.equal(c.dataOnly, true);
  assert.deepEqual(c.offending, []);
  assert.deepEqual(c.dataFiles, ['ports/realrtcw.yml', 'images/realrtcw/x.png']);
});

test('classifyFiles: a workflow or script change fails the gate', () => {
  const c = classifyFiles(['ports/realrtcw.yml', 'scripts/build.mjs'], config);
  assert.equal(c.dataOnly, false);
  assert.deepEqual(c.offending, ['scripts/build.mjs']);
});

test('classifyFiles: an empty change set is not data-only', () => {
  assert.equal(classifyFiles([], config).dataOnly, false);
});

test('extractUrls: pulls every link field and de-dupes', () => {
  const urls = extractUrls({
    download_url: 'https://github.com/x/y/releases/latest',
    source_url: 'https://github.com/x/y',
    homepage: 'https://x.dev',
    authors: [{ name: 'A', url: 'https://github.com/a' }, { name: 'B' }],
    images: [{ game: 'G', source_url: 'https://store.example/1' }],
    reviews: [{ title: 't', channel: 'c', url: 'https://youtu.be/1' }],
  });
  const fields = urls.map((u) => u.field);
  assert.deepEqual(fields, ['download_url', 'source_url', 'homepage', 'author', 'image_source', 'review']);
});

test('decide: non-data PR → human', () => {
  const classification = classifyFiles(['package.json'], config);
  const d = decide({ classification, validationErrors: [], urlChecks: [], ai: null, config });
  assert.equal(d.action, 'human');
});

test('decide: AI approve + clean static → approve', () => {
  const classification = classifyFiles(['ports/x.yml'], config);
  const urlChecks = [
    { field: 'download_url', url: 'u1', ok: true, status: 200 },
    { field: 'source_url', url: 'u2', ok: true, status: 200 },
  ];
  const d = decide({
    classification,
    validationErrors: [],
    urlChecks,
    ai: { verdict: 'approve', summary: 'ok', issues: [] },
    config,
  });
  assert.equal(d.action, 'approve');
});

test('decide: AI approves but a required link is dead → request_changes', () => {
  const classification = classifyFiles(['ports/x.yml'], config);
  const urlChecks = [{ field: 'download_url', url: 'u1', ok: false, status: 404 }];
  const d = decide({
    classification,
    validationErrors: [],
    urlChecks,
    ai: { verdict: 'approve', summary: 'ok', issues: [] },
    config,
  });
  assert.equal(d.action, 'request_changes');
  assert.equal(d.deadRequired.length, 1);
});

test('decide: schema error overrides an AI approve', () => {
  const classification = classifyFiles(['ports/x.yml'], config);
  const d = decide({
    classification,
    validationErrors: ['ports/x.yml: (root) must have required property name'],
    urlChecks: [],
    ai: { verdict: 'approve', summary: 'ok', issues: [] },
    config,
  });
  assert.equal(d.action, 'request_changes');
});

test('decide: a dead REVIEW link (non-required) does not block approval', () => {
  const classification = classifyFiles(['ports/x.yml'], config);
  const urlChecks = [
    { field: 'download_url', url: 'u1', ok: true, status: 200 },
    { field: 'source_url', url: 'u2', ok: true, status: 200 },
    { field: 'review', url: 'u3', ok: false, status: 404 },
  ];
  const d = decide({
    classification,
    validationErrors: [],
    urlChecks,
    ai: { verdict: 'approve', summary: 'ok', issues: [] },
    config,
  });
  assert.equal(d.action, 'approve');
});

test('renderComment: carries the marker and reflects the action', () => {
  const approve = renderComment({ action: 'approve', summary: 'Looks great.' });
  assert.ok(approve.includes(MARKER));
  assert.ok(/merging/i.test(approve));
  const rc = renderComment({
    action: 'request_changes',
    summary: 'Almost.',
    validationErrors: ['bad'],
    deadRequired: [],
    aiIssues: ['fix the version'],
  });
  assert.ok(/Please fix/.test(rc));
  assert.ok(rc.includes('fix the version'));
});

test('buildReviewInput: embeds static result, links, policy and the entry', () => {
  const prompt = buildReviewInput({
    slug: 'realrtcw',
    entryYaml: 'name: RealRTCW',
    policyDoc: 'POLICY-TEXT',
    validationErrors: [],
    urlChecks: [{ field: 'download_url', url: 'https://u', ok: true, status: 200 }],
  });
  assert.ok(prompt.includes('POLICY-TEXT'));
  assert.ok(prompt.includes('PASSED'));
  assert.ok(prompt.includes('ports/realrtcw.yml'));
  assert.ok(prompt.includes('name: RealRTCW'));
  assert.equal(REVIEW_TOOL.name, 'submit_review');
});
