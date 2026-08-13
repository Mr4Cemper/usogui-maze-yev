/**
 * check-i18n.mjs - every `t('...')` in the sources must exist in every
 * dictionary.
 *
 * SPEC 5.4 asks for key parity and for a missing key to be a build error
 * rather than a silently untranslated line. `build.mjs` runs this first and
 * stops when it fails, and `npm test` runs it too.
 *
 * Keys are only found when they are written as literals: `t('setup.title')`.
 * That is exactly why the interface never builds a key by concatenation - a
 * key this tool cannot see is a key that can go missing unnoticed.
 */

import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_DIR = join(ROOT, 'src');
const DICTIONARY_DIR = join(ROOT, 'src', 'i18n');

const CALL_PATTERN = /\bt\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g;

/**
 * Lists every file under a directory that matches a suffix.
 *
 * @param {string} directory Where to look.
 * @param {string} suffix File ending to keep.
 * @returns {Promise<string[]>} Absolute paths.
 */
async function listFiles(directory, suffix) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full, suffix)));
    } else if (entry.name.endsWith(suffix)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Collects the keys used by the interface.
 *
 * @returns {Promise<Map<string, string[]>>} Key to the files that use it.
 */
async function collectUsedKeys() {
  const used = new Map();
  for (const file of await listFiles(SOURCE_DIR, '.js')) {
    if (file.startsWith(DICTIONARY_DIR)) {
      continue;
    }
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(CALL_PATTERN)) {
      const key = match[2];
      const where = relative(ROOT, file);
      const files = used.get(key) ?? [];
      if (!files.includes(where)) {
        files.push(where);
      }
      used.set(key, files);
    }
  }
  return used;
}

/**
 * Loads every dictionary next to `index.js`.
 *
 * @returns {Promise<Map<string, object>>} Language code to dictionary.
 * @throws {Error} If a dictionary has no default export object.
 */
async function loadDictionaries() {
  const dictionaries = new Map();
  for (const file of await listFiles(DICTIONARY_DIR, '.js')) {
    if (basename(file) === 'index.js') {
      continue;
    }
    const module = await import(pathToFileURL(file).href);
    const dictionary = module.default;
    if (dictionary === null || typeof dictionary !== 'object') {
      throw new Error(`${relative(ROOT, file)} must export a dictionary object as default`);
    }
    dictionaries.set(basename(file, '.js'), dictionary);
  }
  return dictionaries;
}

/**
 * Runs the check.
 *
 * @returns {Promise<{ok: boolean, problems: string[], used: number, languages: string[]}>}
 *   The verdict, with one line per problem.
 * @throws {Error} If the sources or the dictionaries cannot be read.
 */
export async function checkI18n() {
  const used = await collectUsedKeys();
  const dictionaries = await loadDictionaries();
  const problems = [];

  if (dictionaries.size === 0) {
    problems.push('no dictionaries found in src/i18n');
    return { ok: false, problems, used: used.size, languages: [] };
  }

  for (const [language, dictionary] of dictionaries) {
    for (const [key, files] of used) {
      if (!Object.prototype.hasOwnProperty.call(dictionary, key)) {
        problems.push(`missing key "${key}" in ${language}.js (used in ${files.join(', ')})`);
      }
    }
  }

  // Parity between languages, so a later dictionary cannot quietly lag behind.
  const [first, ...others] = [...dictionaries.keys()];
  for (const language of others) {
    const reference = Object.keys(dictionaries.get(first));
    const current = new Set(Object.keys(dictionaries.get(language)));
    for (const key of reference) {
      if (!current.has(key)) {
        problems.push(`key "${key}" exists in ${first}.js but not in ${language}.js`);
      }
    }
    for (const key of current) {
      if (!reference.includes(key)) {
        problems.push(`key "${key}" exists in ${language}.js but not in ${first}.js`);
      }
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    used: used.size,
    languages: [...dictionaries.keys()],
  };
}

/**
 * Keys a dictionary carries about itself, read straight out of it instead of
 * through `t()`: the language picker shows every language in its own words, so
 * it cannot ask the current dictionary for them.
 */
const METADATA_KEYS = Object.freeze(['lang.name']);

/**
 * Lists keys that no source uses. Not a failure: a dictionary may keep a line
 * ready for a screen that is still being written.
 *
 * @returns {Promise<string[]>} Unused keys of the first dictionary.
 */
export async function unusedKeys() {
  const used = await collectUsedKeys();
  const dictionaries = await loadDictionaries();
  const first = dictionaries.values().next().value ?? {};
  return Object.keys(first).filter((key) => !used.has(key) && !METADATA_KEYS.includes(key));
}

/**
 * Command line entry point.
 *
 * @returns {Promise<void>} Resolves after the report is printed.
 */
async function main() {
  const report = await checkI18n();
  const unused = await unusedKeys();

  console.log(
    `i18n: ${report.used} keys used, languages: ${report.languages.join(', ') || 'none'}`,
  );
  if (unused.length > 0) {
    console.log(`i18n: ${unused.length} unused key(s): ${unused.join(', ')}`);
  }
  if (!report.ok) {
    for (const problem of report.problems) {
      console.error(`i18n: ${problem}`);
    }
    console.error(`i18n: ${report.problems.length} problem(s)`);
    process.exitCode = 1;
    return;
  }
  console.log('i18n: every key is present in every dictionary');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
