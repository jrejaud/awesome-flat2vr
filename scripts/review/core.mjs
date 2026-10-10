// Pure logic for the AI PR reviewer. No network, no fs, no process — so it is unit-testable
// the same way scripts/discover/core.mjs is. The I/O lives in ai-review.mjs / check-urls.mjs.

// --- changed-file classification (the pull_request_target safety gate) -------------------
// A PR is "data only" when every changed path is a data file (ports/images) or a generated
// file. Anything else — scripts, workflows, package.json, the schema, CI — means the PR could
// alter the very code the bot runs with a privileged token, so it must go to a human instead
// of the auto-merge path.

export function globToRegExp(glob) {
  // Supports ** (any depth), * (one segment), and literal chars. Anchored.
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** → match across path separators
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // swallow the slash after **/
      } else {
        re += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

export function classifyFiles(files, config) {
  const allowed = [...(config.dataGlobs ?? []), ...(config.generatedFiles ?? [])].map(globToRegExp);
  const offending = files.filter((f) => !allowed.some((re) => re.test(f)));
  const dataFiles = files.filter((f) => (config.dataGlobs ?? []).map(globToRegExp).some((re) => re.test(f)));
  return { dataOnly: offending.length === 0 && files.length > 0, offending, dataFiles };
}

// --- URL extraction ----------------------------------------------------------------------
// Every URL a port entry can carry, tagged with the field it came from so the reviewer can
// require the important ones to resolve.
export function extractUrls(entry) {
  const out = [];
  const push = (field, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) out.push({ field, url });
  };
  push('download_url', entry.download_url);
  push('source_url', entry.source_url);
  push('homepage', entry.homepage);
  for (const a of entry.authors ?? []) push('author', a.url);
  for (const img of entry.images ?? []) push('image_source', img.source_url);
  for (const r of entry.reviews ?? []) push('review', r.url);
  // de-dupe by url, keeping the first (most important) field
  const seen = new Set();
  return out.filter((u) => (seen.has(u.url) ? false : seen.add(u.url)));
}

// --- the Claude tool schema (forces a structured verdict) --------------------------------
export const REVIEW_TOOL = {
  name: 'submit_review',
  description: 'Submit the verdict for this pull request.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'summary', 'issues'],
    properties: {
      verdict: {
        type: 'string',
        enum: ['approve', 'request_changes'],
        description:
          'approve only if this is a genuine, accurate flat2vr port entry with all required info and the links point where they claim. Otherwise request_changes.',
      },
      summary: {
        type: 'string',
        description: 'One or two friendly sentences for the contributor, explaining the verdict.',
      },
      issues: {
        type: 'array',
        description: 'Concrete, actionable things to fix. Empty when approving.',
        items: { type: 'string' },
      },
    },
  },
};

export function buildReviewInput({ slug, entryYaml, policyDoc, validationErrors, urlChecks }) {
  const urlLines = urlChecks
    .map((u) => `- ${u.field}: ${u.url} → ${u.ok ? `reachable (HTTP ${u.status})` : `UNREACHABLE (${u.status})`}`)
    .join('\n');
  const staticBlock = validationErrors.length
    ? `The automated schema/format check FAILED with:\n${validationErrors.map((e) => `- ${e}`).join('\n')}`
    : 'The automated schema/format check PASSED.';
  return [
    'You are the maintainer-bot for an open "awesome list" of flatscreen-to-VR game ports.',
    'A contributor opened a pull request adding or updating one entry. Decide whether to approve and merge it,',
    'or to request changes. Be welcoming and concrete — contributors are often first-time GitHub users.',
    '',
    '# What makes an entry legitimate',
    policyDoc.trim(),
    '',
    '# Static check result',
    staticBlock,
    '',
    '# Link reachability (checked automatically)',
    urlLines || '(no links found)',
    '',
    `# The proposed entry (ports/${slug}.yml)`,
    '```yaml',
    entryYaml.trim(),
    '```',
    '',
    '# Your job',
    '- Approve only if the entry is a real VR port of a real game, the facts are internally consistent,',
    "  every required field is present and sensible, and download_url / source_url point to the creator's own page",
    '  (a release page or repo), never a rehosted binary, a pirated game, or an unrelated link.',
    '- If the static check failed, you must request_changes and restate the fix in plain language.',
    '- If a required link is unreachable, request_changes.',
    '- Treat spam, joke entries, advertising, or anything off-topic as request_changes.',
    'Call submit_review with your verdict.',
  ].join('\n');
}

// --- final decision: static gate caps what the AI may do ---------------------------------
export function decide({ classification, validationErrors, urlChecks, ai, config }) {
  if (!classification.dataOnly) {
    return {
      action: 'human',
      offending: classification.offending,
      summary:
        'This PR changes files outside the data set (scripts, workflow, schema or config), so an automated review is not safe. A maintainer will take a look.',
    };
  }
  const required = new Set(config.requiredLiveUrlFields ?? []);
  const deadRequired = urlChecks.filter((u) => required.has(u.field) && !u.ok);
  const staticOk = validationErrors.length === 0 && deadRequired.length === 0;
  const aiApproves = ai && ai.verdict === 'approve';
  if (aiApproves && staticOk) {
    return { action: 'approve', summary: ai.summary };
  }
  return {
    action: 'request_changes',
    summary: ai?.summary ?? 'Some automated checks need attention before this can be merged.',
    validationErrors,
    deadRequired,
    aiIssues: ai?.issues ?? [],
  };
}

// --- comment rendering -------------------------------------------------------------------
export const MARKER = '<!-- ai-pr-review -->';

export function renderComment(decision) {
  const lines = [MARKER];
  if (decision.action === 'approve') {
    lines.push('🤖 **Approved and merging.**', '', decision.summary, '', 'Thanks for the contribution! 🎉');
  } else if (decision.action === 'human') {
    lines.push('🤖 **Needs a maintainer.**', '', decision.summary);
    if (decision.offending?.length) {
      lines.push('', 'Files outside the data set:', ...decision.offending.map((f) => `- \`${f}\``));
    }
  } else {
    lines.push('🤖 **Changes requested.**', '', decision.summary);
    const bullets = [
      ...(decision.validationErrors ?? []).map((e) => `- ${e}`),
      ...(decision.deadRequired ?? []).map((u) => `- The ${u.field} link looks unreachable (${u.status}): ${u.url}`),
      ...(decision.aiIssues ?? []).map((i) => `- ${i}`),
    ];
    if (bullets.length) lines.push('', '**Please fix:**', ...bullets);
    lines.push('', "Push a new commit to this branch and I'll re-check automatically.");
  }
  lines.push('', '_Automated review. A human maintainer can override._');
  return lines.join('\n');
}
