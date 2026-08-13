/**
 * clipboard.js - copying that never fails silently.
 *
 * `navigator.clipboard` does not exist outside a secure context, and a page
 * opened from `file://` is not one in several browsers (SPEC 5.2). Three steps
 * are tried in order, and the caller is always told which one worked so that
 * it can say "now press Ctrl+C" when none did.
 */

/**
 * Copies text through the fallback path: a hidden textarea plus the old
 * `execCommand('copy')`.
 *
 * @param {string} text Text to copy.
 * @returns {boolean} True when the command reported success.
 */
function copyWithExecCommand(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'readonly');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch (error) {
    // Browsers may refuse the deprecated command outright. That is one of the
    // two expected failures, and the caller gets `false` so it can ask the
    // player to copy by hand.
    console.warn('execCommand copy failed:', error.message);
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

/**
 * Selects the text of an element, so that a player can copy it by hand when
 * both automatic paths are unavailable.
 *
 * @param {Element} node Element holding the text.
 * @returns {boolean} True when a selection was made.
 */
export function selectElementText(node) {
  const selection = globalThis.getSelection?.();
  if (!selection || typeof document.createRange !== 'function') {
    return false;
  }
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/**
 * Copies text to the clipboard.
 *
 * @param {string} text Text to copy.
 * @param {Element} [sourceNode=null] Element showing the same text; it gets
 *   selected when copying is impossible, so the player can press Ctrl+C.
 * @returns {Promise<{ok: boolean, method: 'clipboard'|'execCommand'|'manual'}>}
 *   How it went. `manual` means nothing was copied and the text was selected
 *   instead.
 * @throws {Error} If the text is not a string.
 */
export async function copyText(text, sourceNode = null) {
  if (typeof text !== 'string') {
    throw new Error(`text to copy must be a string, got ${String(text)}`);
  }

  if (globalThis.navigator?.clipboard?.writeText) {
    try {
      await globalThis.navigator.clipboard.writeText(text);
      return { ok: true, method: 'clipboard' };
    } catch (error) {
      // Denied permission or an insecure context: fall through to the old way.
      console.warn('navigator.clipboard refused, falling back:', error.message);
    }
  }

  if (typeof document !== 'undefined' && copyWithExecCommand(text)) {
    return { ok: true, method: 'execCommand' };
  }

  if (sourceNode !== null) {
    selectElementText(sourceNode);
  }
  return { ok: false, method: 'manual' };
}
