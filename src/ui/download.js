/**
 * download.js - saving a text file from a page that has no server behind it.
 *
 * The reveal file is the only carrier of the salt that survives a closed tab,
 * so this path has to work on `file://` as well (SPEC 4.9, 5.2).
 */

/**
 * Offers a text file for download.
 *
 * @param {string} filename Name suggested to the browser.
 * @param {string} text File contents.
 * @param {string} [mime='text/plain;charset=utf-8'] Content type.
 * @returns {boolean} True when the download was started. False means the
 *   browser refused and the caller must say so out loud: a blocking step that
 *   silently does nothing is the worst possible outcome here.
 * @throws {Error} If the arguments are not strings.
 */
/**
 * Saves a blob under a name.
 *
 * @param {string} filename Name to offer.
 * @param {Blob} blob What to save.
 * @returns {boolean} True when the browser was asked.
 */
export function downloadBlob(filename, blob) {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next tick: revoking it at once can cancel the download.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch (error) {
    console.warn('saving the file failed:', error.message);
    return false;
  }
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('filename must be a non empty string');
  }
  if (typeof text !== 'string') {
    throw new Error(`file contents must be a string, got ${String(text)}`);
  }

  let url = null;
  try {
    const blob = new Blob([text], { type: mime });
    url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch (error) {
    console.warn('saving the file failed:', error.message);
    return false;
  } finally {
    if (url !== null) {
      // Give the click a moment before the blob disappears.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  }
}

/**
 * Builds a timestamp for a file name: `YYYY-MM-DD-HHMM`, local time.
 *
 * @param {Date} [now=new Date()] Moment to render.
 * @returns {string} The stamp.
 */
export function fileStamp(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  );
}
