/**
 * codeField.js - a field that takes a pasted code, parses it and says what
 * happened.
 *
 * Three states only: empty, accepted, rejected. A rejection always names one
 * of the three parse codes of SPEC 4.6, and none of the three wordings hints
 * at cheating: a damaged code is a damaged code (SPEC 4.8).
 *
 * The parsing itself is never done here - it is `decodeSettingsCode`,
 * `decodeCommitCode` and friends from the core, handed in as `decode`.
 */

import { el, setText, toggleClass } from '../dom.js';
import { MAX_CODE_LENGTH } from '../store.js';
import { copyText } from '../clipboard.js';
import { t } from '../../i18n/index.js';

/**
 * Trims a pasted code and refuses anything absurdly long before a parser ever
 * sees it (SPEC 5.2).
 *
 * @param {unknown} raw Whatever the field holds.
 * @param {number} [maxLength=MAX_CODE_LENGTH] Ceiling for the trimmed text.
 * @returns {{value: string, empty: boolean, tooLong: boolean}} The trimmed
 *   value and what is wrong with it, if anything.
 */
export function normalizeCodeInput(raw, maxLength = MAX_CODE_LENGTH) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return {
    value: text,
    empty: text.length === 0,
    tooLong: text.length > maxLength,
  };
}

/**
 * Picks the message for a parse failure. The three codes mean three different
 * things to a player and must never be collapsed into one line.
 *
 * @param {Error} error Error thrown by a core decoder.
 * @returns {string} Text for the status line.
 */
export function describeCodeError(error) {
  switch (error?.code) {
    case 'BAD_FORMAT':
      return t('error.BAD_FORMAT');
    case 'BAD_CHECKSUM':
      return t('error.BAD_CHECKSUM');
    case 'OUT_OF_RANGE':
      return t('error.OUT_OF_RANGE');
    // A code of the wrong kind is named, not called "wrong format": the player
    // pasted something real, just not the thing this field wants.
    case 'WRONG_KIND_SETTINGS':
      return t('error.WRONG_KIND_SETTINGS');
    case 'WRONG_KIND_COMMIT':
      return t('error.WRONG_KIND_COMMIT');
    // The single most dangerous mix-up on the verification screen: two reveal
    // strings lie side by side, and pasting your own would otherwise come back
    // as "the commit does not match", which reads as an accusation (SPEC 4.8).
    case 'OWN_REVEAL':
      return t('error.OWN_REVEAL');
    default:
      return t('error.UNKNOWN');
  }
}

/**
 * Builds a read only block that shows a generated code and copies it.
 *
 * The copy button never fails quietly: outside a secure context
 * `navigator.clipboard` is missing, and then the text is selected and the
 * player is asked to press Ctrl+C (SPEC 5.2).
 *
 * @param {object} options Block options, strings already translated.
 * @param {string} options.label Label above the code.
 * @param {string} [options.hint] Explanation under the label.
 * @param {string} [options.copyLabel] Caption of the copy button.
 * @param {string} [options.emptyText] Shown while there is no code yet.
 * @returns {{root: HTMLElement, setCode: (code: string|null) => void}} The
 *   element and its setter; `null` puts it back into the empty state.
 */
export function createCodeOutput(options) {
  const {
    label,
    hint = null,
    copyLabel = t('code.copy'),
    emptyText = t('code.empty'),
  } = options;

  let code = null;
  const value = el('div', { class: 'code-output', text: emptyText });
  const status = el('div', { class: 'status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const button = el('button', {
    class: 'is-primary',
    text: copyLabel,
    attrs: { type: 'button' },
    props: { disabled: true },
    on: {
      click: async () => {
        if (code === null) {
          return;
        }
        const result = await copyText(code, value);
        setText(status, result.ok ? t('code.copied') : t('code.copyManually'));
        toggleClass(status, 'is-ok', result.ok);
        toggleClass(status, 'is-warn', !result.ok);
      },
    },
  });

  const root = el('div', { class: 'field' }, [
    el('span', { class: 'field__label', text: label }),
    hint === null ? null : el('p', { class: 'panel__hint', text: hint }),
    value,
    el('div', { class: 'button-row' }, [button]),
    status,
  ]);

  return {
    root,
    setCode(next) {
      code = next ?? null;
      setText(value, code === null ? emptyText : code);
      button.disabled = code === null;
      setText(status, '');
      toggleClass(status, 'is-ok', false);
      toggleClass(status, 'is-warn', false);
    },
  };
}

/**
 * Builds a code field.
 *
 * @param {object} options Field options; all visible strings arrive already
 *   translated, so that the key literals stay at the call site where the
 *   build time checker can see them.
 * @param {string} options.label Field label.
 * @param {string} [options.hint] Explanation under the label.
 * @param {string} [options.placeholder] Placeholder text.
 * @param {string} [options.acceptedText] Status line shown when a code parses.
 * @param {(value: string) => Promise<unknown>} options.decode Parser from the
 *   core. Rejections are expected and are turned into a status line.
 * @param {(result: unknown, value: string) => void} [options.onAccepted] Called
 *   with the parsed result.
 * @param {() => void} [options.onCleared] Called when the field becomes empty
 *   or stops parsing.
 * @param {number} [options.maxLength=MAX_CODE_LENGTH] Ceiling before parsing.
 * @returns {{root: HTMLElement, setValue: (value: string) => void, getValue: () => string, setDisabled: (disabled: boolean) => void, clear: () => void}}
 *   The element and a small control surface.
 * @throws {Error} If `decode` is not a function.
 */
export function createCodeField(options) {
  const {
    label,
    hint = null,
    placeholder = '',
    acceptedText = t('code.accepted'),
    decode,
    onAccepted = () => {},
    onCleared = () => {},
    maxLength = MAX_CODE_LENGTH,
  } = options;

  if (typeof decode !== 'function') {
    throw new Error('a code field needs a decode function');
  }

  const input = el('textarea', {
    class: 'code-input',
    attrs: { rows: '2', spellcheck: 'false', autocomplete: 'off', placeholder },
  });
  const status = el('div', { class: 'status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const labelNode = el('label', { class: 'field__label', text: label });
  const root = el('div', { class: 'field' }, [
    labelNode,
    hint === null ? null : el('p', { class: 'panel__hint', text: hint }),
    input,
    status,
  ]);

  let sequence = 0;

  /**
   * @param {'idle'|'ok'|'error'} kind What to show.
   * @param {string} text Message.
   * @returns {void}
   */
  function showStatus(kind, text) {
    setText(status, text);
    toggleClass(status, 'is-ok', kind === 'ok');
    toggleClass(status, 'is-error', kind === 'error');
    toggleClass(input, 'is-invalid', kind === 'error');
  }

  /**
   * Parses whatever the field holds now.
   *
   * @returns {Promise<void>} Resolves once the status line is up to date.
   */
  async function parseCurrent() {
    const ticket = (sequence += 1);
    const { value, empty, tooLong } = normalizeCodeInput(input.value, maxLength);

    if (empty) {
      showStatus('idle', '');
      onCleared();
      return;
    }
    if (tooLong) {
      // Too long to be any of our codes: refused before the parser, so that a
      // pasted novel cannot reach the hashing path at all.
      showStatus('error', t('error.BAD_FORMAT'));
      onCleared();
      return;
    }

    try {
      const result = await decode(value);
      if (ticket !== sequence) {
        return;
      }
      showStatus('ok', acceptedText);
      onAccepted(result, value);
    } catch (error) {
      if (ticket !== sequence) {
        return;
      }
      // A rejected code is an everyday event here, not a failure of the
      // application: it is shown, by its own code, and nothing else happens.
      showStatus('error', describeCodeError(error));
      onCleared();
    }
  }

  input.addEventListener('input', () => {
    void parseCurrent();
  });

  return {
    root,
    setValue(value) {
      input.value = value ?? '';
      void parseCurrent();
    },
    getValue() {
      return normalizeCodeInput(input.value, maxLength).value;
    },
    setDisabled(disabled) {
      input.disabled = Boolean(disabled);
    },
    clear() {
      input.value = '';
      showStatus('idle', '');
    },
  };
}
