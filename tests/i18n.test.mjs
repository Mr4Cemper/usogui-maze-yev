/**
 * The dictionaries. Two of them now, three later, and the danger is always the
 * same: a line that stays English in the middle of a Russian screen, or a code
 * the core can return and no dictionary can say out loud.
 *
 * The lists of codes are imported from the core, never retyped here. A copy
 * would agree with the original exactly until the day someone adds a code.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import en from '../src/i18n/en.js';
import ru from '../src/i18n/ru.js';
import uk from '../src/i18n/uk.js';
import { availableLanguages, languageName, setLanguage, t } from '../src/i18n/index.js';
import { checkI18n } from '../tools/check-i18n.mjs';
import { MAZE_PROBLEMS } from '../src/core/maze.js';
import { HINTS } from '../src/core/game.js';
import { VERIFY_CHECKS } from '../src/core/verify.js';

/** Every dictionary, by its code. */
const DICTIONARIES = { en, ru, uk };

/** The three codes every parser in the core can produce (SPEC 4.6). */
const PARSE_ERRORS = ['BAD_FORMAT', 'BAD_CHECKSUM', 'OUT_OF_RANGE'];

/**
 * Keys whose value is the same in every language on purpose.
 *
 * Everything here is a name, a coordinate or a pure format string. Nothing
 * here is an untranslated sentence.
 */
const SAME_IN_EVERY_LANGUAGE = new Set([
  // The name of the application.
  'app.title',
  // Cell labels, and nothing else: "C3-D3" reads the same in every language
  // and has to, because both players say it out loud (SPEC 1.2).
  'history.step',
]);

test('the checker itself is happy', async () => {
  const report = await checkI18n();
  assert.deepEqual(report.problems, []);
  assert.equal(report.ok, true);
  assert.deepEqual(report.languages.sort(), Object.keys(DICTIONARIES).sort());
});

test('every registered language has a dictionary and a name of its own', () => {
  assert.deepEqual(availableLanguages().sort(), Object.keys(DICTIONARIES).sort());
  for (const code of availableLanguages()) {
    assert.equal(typeof languageName(code), 'string');
    assert.equal(languageName(code).length > 0, true);
    assert.notEqual(languageName(code), code, `${code} must name itself in its own words`);
  }
});

test('the dictionaries hold exactly the same keys', () => {
  const reference = Object.keys(en).sort();
  for (const [code, dictionary] of Object.entries(DICTIONARIES)) {
    assert.deepEqual(Object.keys(dictionary).sort(), reference, `${code}.js`);
  }
});

test('every code the core can return has a line in every language', () => {
  const required = [
    ...MAZE_PROBLEMS.map((code) => `validate.${code}`),
    'validate.UNKNOWN',
    ...HINTS.map((code) => `hint.${code}`),
    'hint.UNKNOWN',
    ...PARSE_ERRORS.map((code) => `error.${code}`),
    'error.UNKNOWN',
    ...VERIFY_CHECKS.map((code) => `check.${code}`),
  ];
  for (const [code, dictionary] of Object.entries(DICTIONARIES)) {
    for (const key of required) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(dictionary, key),
        true,
        `${code}.js has no line for ${key}`,
      );
    }
  }
});

test('no dictionary holds an empty line or a line that is just its key', () => {
  for (const [code, dictionary] of Object.entries(DICTIONARIES)) {
    for (const [key, value] of Object.entries(dictionary)) {
      assert.equal(typeof value, 'string', `${code}.js: ${key} is not a string`);
      assert.equal(value.trim().length > 0, true, `${code}.js: ${key} is empty`);
      assert.notEqual(value.trim(), key, `${code}.js: ${key} was left as its own key`);
    }
  }
});

/** Every dictionary that is a translation, in the order languages were added. */
const TRANSLATIONS = Object.entries(DICTIONARIES).filter(([code]) => code !== 'en');

test('nothing was left in English by accident', () => {
  for (const [code, dictionary] of TRANSLATIONS) {
    const untranslated = [];
    for (const [key, value] of Object.entries(en)) {
      if (SAME_IN_EVERY_LANGUAGE.has(key)) {
        continue;
      }
      if (dictionary[key] === value) {
        untranslated.push(key);
      }
    }
    assert.deepEqual(untranslated, [], `${code}.js: these lines are identical to the English ones`);
  }
});

test('every translated line actually carries Cyrillic letters', () => {
  // Ukrainian і, ї, є and ґ live outside the А-Я block, so the class has to
  // name them: a line made only of them would otherwise look untranslated.
  const cyrillic = /[А-Яа-яЁёІіЇїЄєҐґ]/;
  for (const [code, dictionary] of TRANSLATIONS) {
    const suspicious = [];
    for (const [key, value] of Object.entries(dictionary)) {
      if (SAME_IN_EVERY_LANGUAGE.has(key) || key === 'lang.name') {
        continue;
      }
      if (!cyrillic.test(value)) {
        suspicious.push(key);
      }
    }
    assert.deepEqual(suspicious, [], `${code}.js: these lines have no Cyrillic in them at all`);
  }
});

test('placeholders survive translation', () => {
  const names = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [code, dictionary] of TRANSLATIONS) {
    const wrong = [];
    for (const [key, value] of Object.entries(en)) {
      if (names(value).join() !== names(dictionary[key]).join()) {
        wrong.push(`${key}: en ${names(value).join()} / ${code} ${names(dictionary[key]).join()}`);
      }
    }
    assert.deepEqual(wrong, [], 'a lost or renamed placeholder prints as {name} on screen');
  }
});

test('the coordinates and the code prefixes are not translated', () => {
  // Both players read these out loud and paste them to each other; a letter
  // that differs between two devices is a letter neither of them can fix.
  for (const [code, dictionary] of TRANSLATIONS) {
    assert.equal(dictionary['history.step'], '{from}-{to}', code);
    assert.match(dictionary['error.WRONG_KIND_SETTINGS'], /YM1/, code);
    assert.match(dictionary['error.WRONG_KIND_COMMIT'], /YMC1/, code);
    assert.match(dictionary['verify.myRevealPasteHint'], /YMR1/, code);
    assert.match(dictionary['rules.board.grid'], /A/, code);
    assert.match(dictionary['rules.board.grid'], /C3/, code);
  }
});

test('switching the language switches what t() returns, and back', () => {
  setLanguage('en');
  const english = t('app.stepVerify');
  const seen = new Set([english]);
  for (const [code] of TRANSLATIONS) {
    setLanguage(code);
    const translated = t('app.stepVerify');
    assert.notEqual(translated, english, `${code} shows the English word`);
    assert.match(translated, /[А-Яа-яІіЇїЄєҐґ]/, code);
    seen.add(translated);
  }
  assert.equal(seen.size, 1 + TRANSLATIONS.length, 'two languages show the very same word');
  setLanguage('en');
  assert.equal(t('app.stepVerify'), english);
});

test('a language that is not registered is refused, not silently ignored', () => {
  assert.throws(() => setLanguage('de'), /unknown language/);
  setLanguage('en');
});
