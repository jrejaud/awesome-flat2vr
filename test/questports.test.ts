import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseQuestPortLinks, parseQuestPortSlugs } from '../scripts/discover/sources.mjs';

test('QuestPorts index: every /ports/<slug> link, deduped', () => {
  const html =
    '<a href="/ports/goldeneye-vr"><img src="/covers/x.jpg"></a><a href="/ports/avp-vr">' +
    '<a href="/ports/goldeneye-vr">dup</a><a href="/about">x</a>';
  assert.deepEqual(parseQuestPortSlugs(html), ['goldeneye-vr', 'avp-vr']);
});

test('QuestPorts port page: keeps the port repo and homepage, drops the directory chrome', () => {
  const html = readFileSync(new URL('./fixtures/questports-goldeneye.html', import.meta.url), 'utf8');
  const links = parseQuestPortLinks(html);
  assert.ok(links.includes('https://github.com/MrSco/goldeneye-vr'));
  assert.ok(links.includes('https://goldeneyevr.com'));
  assert.ok(!links.some((u) => /felipevc13\/questports|fonts\.g|questports\.vercel\.app|supabase/.test(u)));
});
