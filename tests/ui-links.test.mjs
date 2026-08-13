/**
 * The link out of the application.
 *
 * There is exactly one address and exactly one place it is written down. A url
 * repeated in the markup is a url that gets changed in three files and missed
 * in the fourth - and here the fourth would be the one people click.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { REPOSITORY_URL } from '../src/ui/links.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const APP = readFileSync(`${SRC}ui/app.js`, 'utf8');
const LINKS = readFileSync(`${SRC}ui/links.js`, 'utf8');

test('the address is a plain https url', () => {
  assert.match(REPOSITORY_URL, /^https:\/\/[\w.-]+\/[\w./-]+$/);
  assert.equal(REPOSITORY_URL.includes('github.com'), true);
});

test('the address is written down once, and nowhere else', () => {
  const occurrences = (text) => text.split(REPOSITORY_URL).length - 1;
  assert.equal(occurrences(LINKS), 1, 'links.js holds the one copy');
  assert.equal(occurrences(APP), 0, 'the shell uses the constant, not the string');
});

test('the link opens elsewhere and hands nothing over', () => {
  // Without `noopener` the page that opens gets a handle on this window and
  // can navigate it. `noreferrer` keeps the local path out of the referrer.
  const anchor = /el\(\s*'a',\s*\{[\s\S]*?\}\s*\)/.exec(APP);
  assert.notEqual(anchor, null, 'the shell builds an anchor');
  assert.match(anchor[0], /href: REPOSITORY_URL/);
  assert.match(anchor[0], /target: '_blank'/);
  assert.match(anchor[0], /rel: 'noopener noreferrer'/);
});

test('it is a link, not a game action', () => {
  // Nothing about it may touch the state: no store, no confirmation, no
  // handler at all.
  const anchor = /el\(\s*'a',\s*\{[\s\S]*?\}\s*\)/.exec(APP)[0];
  assert.equal(anchor.includes('setState'), false);
  assert.equal(anchor.includes('on:'), false);
});
