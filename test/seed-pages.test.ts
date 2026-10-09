import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseSeedPages } from '../scripts/discover/sources.mjs';

test('non-GitHub seed pages: comments stripped, fragments kept, text-fragment noise and GitHub lines dropped', () => {
  const text = [
    '# header',
    'https://raicuparta.com/neon-white-vr-mod   # Neon White',
    'https://thunderstore.io/package/DrBibop/VRMod/#:~:text=Playing%20in%20VR',
    'https://example.com/page#install',
    'https://github.com/Nibre/MotherVR   # GitHub seeds belong to parseSeeds',
    'https://raicuparta.com/neon-white-vr-mod',
  ].join('\n');
  assert.deepEqual(parseSeedPages(text), [
    'https://raicuparta.com/neon-white-vr-mod',
    'https://thunderstore.io/package/DrBibop/VRMod/',
    'https://example.com/page#install',
  ]);
});
