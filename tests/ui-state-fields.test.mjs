/**
 * Every field of the interface state has to be declared in three places:
 * `createDefaultState`, `serializeState` and `deserializeState`. A field that
 * skips one of them either does not survive a reload or, worse, survives a
 * reset - and nothing says so out loud until someone notices the behaviour.
 *
 * That is not a hypothetical: the turn clock was written into the state by the
 * game screen for a whole part without ever being declared anywhere.
 *
 * The second test reads the sources. It is the only way to catch a field that
 * a screen invents on its own, because such a field never reaches the pure
 * functions the first test can see.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  SESSION_FIELDS,
  createDefaultState,
  deserializeState,
  resetState,
  serializeState,
} from '../src/ui/store.js';

const UI_DIR = fileURLToPath(new URL('../src/ui', import.meta.url));

test('what is stored and what lives for the session cover the whole state', () => {
  const state = createDefaultState();
  const stored = Object.keys(serializeState(state));
  const declared = Object.keys(state).sort();
  const covered = [...stored, ...SESSION_FIELDS].sort();
  assert.deepEqual(
    covered,
    declared,
    'every field is either stored or listed in SESSION_FIELDS, and nothing is in both',
  );
});

test('a restored state has exactly the fields of a fresh one', () => {
  const restored = deserializeState(serializeState(createDefaultState()));
  assert.deepEqual(Object.keys(restored).sort(), Object.keys(createDefaultState()).sort());
});

test('a reset state has exactly the fields of a fresh one', () => {
  assert.deepEqual(
    Object.keys(resetState(createDefaultState())).sort(),
    Object.keys(createDefaultState()).sort(),
  );
});

test('the fields that live for the session are not stored', () => {
  const stored = Object.keys(serializeState(createDefaultState()));
  for (const field of SESSION_FIELDS) {
    assert.equal(stored.includes(field), false, `${field} must not be written to storage`);
  }
});

/**
 * Removes comments and the insides of string literals, so that braces and
 * colons in prose cannot be mistaken for code.
 *
 * @param {string} source JavaScript source.
 * @returns {string} The same source with comments and string bodies blanked.
 */
function blankOutText(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    const quote = source[i];
    if (quote === "'" || quote === '"' || quote === '`') {
      i += 1;
      while (i < source.length && source[i] !== quote) {
        i += source[i] === '\\' ? 2 : 1;
      }
      i += 1;
      out += `${quote}${quote}`;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/**
 * Finds the end of a bracketed run that starts at `start`.
 *
 * @param {string} text Source with strings already blanked.
 * @param {number} start Index of the opening bracket.
 * @param {string} open Opening bracket.
 * @param {string} close Closing bracket.
 * @returns {number} Index of the matching close, or the end of the text.
 */
function matchBracket(text, start, open, close) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === open) {
      depth += 1;
    } else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return text.length;
}

/**
 * Reads the top level keys of an object literal.
 *
 * Computed keys - `{ [name]: value }` - are skipped on purpose: the name is
 * not in the source, and every one of them in this interface is a field the
 * default state already declares.
 *
 * @param {string} text The literal, braces included.
 * @returns {string[]} The keys written out by hand.
 */
function literalKeys(text) {
  const keys = [];
  let depth = 0;
  let previous = '';
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if ('{(['.includes(character)) {
      depth += 1;
    } else if ('})]'.includes(character)) {
      depth -= 1;
    } else if (depth === 1 && /[A-Za-z_$]/.test(character) && (previous === '{' || previous === ',')) {
      const rest = text.slice(i);
      const name = /^[A-Za-z_$][\w$]*/.exec(rest)[0];
      const after = rest.slice(name.length).replace(/^\s*/, '');
      if (after.startsWith(':')) {
        keys.push(name);
      }
      i += name.length - 1;
      continue;
    }
    if (!/\s/.test(character)) {
      previous = character;
    }
  }
  return keys;
}

/**
 * Lists every JavaScript file under a directory.
 *
 * @param {string} directory Where to look.
 * @returns {Promise<string[]>} Absolute paths.
 */
async function listSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSources(full)));
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

test('no screen writes a field the state does not declare', async () => {
  const declared = new Set(Object.keys(createDefaultState()));
  const offenders = [];
  for (const file of await listSources(UI_DIR)) {
    const source = blankOutText(await readFile(file, 'utf8'));
    let from = 0;
    while (true) {
      const at = source.indexOf('setState(', from);
      if (at === -1) {
        break;
      }
      const callStart = at + 'setState'.length;
      const callEnd = matchBracket(source, callStart, '(', ')');
      const call = source.slice(callStart, callEnd);
      const brace = call.indexOf('{');
      if (brace !== -1) {
        const literal = call.slice(brace, matchBracket(call, brace, '{', '}') + 1);
        for (const key of literalKeys(literal)) {
          if (!declared.has(key)) {
            offenders.push(`${file.slice(UI_DIR.length + 1)}: ${key}`);
          }
        }
      }
      from = callEnd;
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'add the field to createDefaultState, and then either to serializeState and deserializeState or to SESSION_FIELDS',
  );
});
