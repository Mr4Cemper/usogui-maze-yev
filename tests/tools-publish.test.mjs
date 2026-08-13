/**
 * The set that goes to the public repository.
 *
 * The white list is the only place where the composition of the publication is
 * decided, so it is worth holding it against the list of things that must
 * never be published - and against the disk, because a white list naming a
 * file that is not there is a white list nobody has read for a while.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { FORBIDDEN, WHITE_LIST, forbiddenIn, parseArgs } from '../tools/pack-public.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('nothing in the white list matches a forbidden shape', () => {
  const offenders = forbiddenIn(WHITE_LIST.map((entry) => entry.path));
  assert.deepEqual(offenders, [], 'these entries would publish something they must not');
});

test('every entry of the white list exists and says why it is there', () => {
  for (const entry of WHITE_LIST) {
    assert.equal(typeof entry.path, 'string');
    assert.equal(existsSync(join(ROOT, entry.path)), true, `${entry.path} is named but missing`);
    assert.equal(typeof entry.why, 'string');
    assert.equal(entry.why.length > 10, true, `${entry.path} needs a reason, not a word`);
  }
});

test('the deliverable itself is in the set', () => {
  // The built page is an artefact, and it is published on purpose: downloading
  // one file is the whole point of this project.
  const paths = WHITE_LIST.map((entry) => entry.path);
  for (const required of ['Usogui_Maze_yev.html', 'README.md', 'LICENSE', 'SPEC.md', 'src']) {
    assert.equal(paths.includes(required), true, `${required} has to be published`);
  }
});

test('the forbidden list catches what it is for', () => {
  const caught = (path) => forbiddenIn([path]).length === 1;
  assert.equal(caught('node_modules/esbuild/package.json'), true);
  assert.equal(caught('test-output.txt'), true);
  assert.equal(caught('roundtrip-output.txt'), true);
  assert.equal(caught('usogui-maze-reveal-2026-08-13.txt'), true);
  assert.equal(caught('docs/reveal-notes.md'), true);
  assert.equal(caught('.claude/settings.json'), true);
  assert.equal(caught('.remember/now.md'), true);
  assert.equal(caught('fixture.json'), true);
  assert.equal(caught('preview-run1.html'), true);
  assert.equal(caught('secrets.env'), true);
  // And leaves the sources alone.
  for (const fine of ['src/ui/app.js', 'tests/ui-ink.test.mjs', 'docs/PUBLISH.md', 'README.md']) {
    assert.equal(forbiddenIn([fine]).length, 0, fine);
  }
});

test('every forbidden rule explains itself', () => {
  for (const rule of FORBIDDEN) {
    assert.equal(rule.pattern instanceof RegExp, true);
    assert.equal(typeof rule.why, 'string');
    assert.equal(rule.why.length > 10, true);
  }
});

test('the packer reads its arguments and refuses nonsense', () => {
  assert.deepEqual(parseArgs([]), { out: 'publish', keep: false });
  assert.equal(parseArgs(['--out=elsewhere']).out, 'elsewhere');
  assert.equal(parseArgs(['--keep']).keep, true);
  assert.throws(() => parseArgs(['--wipe-everything']), /unknown argument/);
});
