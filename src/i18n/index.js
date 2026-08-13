/**
 * i18n/index.js - `t()` and the current language.
 *
 * Dictionaries are flat objects of dotted keys, which keeps `tools/check-i18n.mjs`
 * able to read them without executing the interface. Part 4 adds `ru.js` and
 * `uk.js` next to `en.js` and registers them in DICTIONARIES; nothing else in
 * the interface changes, because every visible string already goes through
 * `t()` (SPEC 5.4).
 *
 * Keys are always written as literals inside `t('...')`. Never build a key by
 * concatenation: the build time checker reads the sources, and a key it cannot
 * see is a key that can silently go missing in a translation.
 */

import en from './en.js';
import ru from './ru.js';
import uk from './uk.js';

/**
 * Every dictionary the build knows about.
 *
 * Adding a language is adding a file and one line here. Nothing else in the
 * interface has to change: the picker lists whatever is registered, and each
 * dictionary carries its own name under `lang.name`.
 */
const DICTIONARIES = Object.freeze({ en, ru, uk });

/** Language used when a key is missing from the current one. */
export const FALLBACK_LANGUAGE = 'en';

let currentLanguage = FALLBACK_LANGUAGE;

/**
 * Lists the languages that can be selected.
 *
 * @returns {string[]} Language codes.
 */
export function availableLanguages() {
  return Object.keys(DICTIONARIES);
}

/**
 * Returns the language in use.
 *
 * @returns {string} Language code.
 */
export function getLanguage() {
  return currentLanguage;
}

/**
 * The name of a language, written in that language.
 *
 * Read out of the dictionary itself rather than through `t()`: a picker that
 * named the languages in the language currently on screen would be useless to
 * whoever cannot read that one.
 *
 * @param {string} code Language code.
 * @returns {string} The name, or the code when the language is unknown.
 */
export function languageName(code) {
  return DICTIONARIES[code]?.['lang.name'] ?? code;
}

/**
 * Tells whether a language can be selected.
 *
 * @param {unknown} code Candidate.
 * @returns {boolean} True when a dictionary is registered under it.
 */
export function isLanguage(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(DICTIONARIES, code);
}

/**
 * Switches the language.
 *
 * @param {string} code Language code, one of {@link availableLanguages}.
 * @returns {void}
 * @throws {Error} If the language is not registered.
 */
export function setLanguage(code) {
  if (!Object.prototype.hasOwnProperty.call(DICTIONARIES, code)) {
    throw new Error(`unknown language ${JSON.stringify(code)}`);
  }
  currentLanguage = code;
}

/**
 * Fills `{placeholders}` in a template.
 *
 * @param {string} template Text with `{name}` placeholders.
 * @param {object} params Values by name.
 * @returns {string} The filled text.
 */
function fill(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * Translates a key.
 *
 * @param {string} key Dotted key, always written as a literal.
 * @param {object} [params={}] Values for `{placeholders}`.
 * @returns {string} The translated text. A key that is missing everywhere
 *   comes back wrapped in guillemets so that it is impossible to miss on
 *   screen; `tools/check-i18n.mjs` makes that a build error instead.
 */
export function t(key, params = {}) {
  const dictionary = DICTIONARIES[currentLanguage] ?? DICTIONARIES[FALLBACK_LANGUAGE];
  const template =
    dictionary[key] ?? DICTIONARIES[FALLBACK_LANGUAGE][key] ?? null;
  if (template === null) {
    return `«${key}»`;
  }
  return fill(template, params);
}

/**
 * Tells whether a key exists in a dictionary.
 *
 * @param {string} key Dotted key.
 * @param {string} [language=FALLBACK_LANGUAGE] Which dictionary to look in.
 * @returns {boolean} True when the key is present.
 */
export function hasKey(key, language = FALLBACK_LANGUAGE) {
  const dictionary = DICTIONARIES[language];
  return dictionary !== undefined && Object.prototype.hasOwnProperty.call(dictionary, key);
}
