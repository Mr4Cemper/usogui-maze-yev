/**
 * persist.js - localStorage behind a prefix and a schema version.
 *
 * localStorage is a convenience only. On `file://` some browsers share one
 * storage area between every local html file, so nothing here is treated as a
 * secret store: the salt also goes into the reveal file, which is the only
 * carrier the protocol relies on (SPEC 5.2, 4.9).
 *
 * A stored schema version that is not the current one is dropped, never
 * migrated: a half migrated setup screen is worse than an empty one.
 */

/** Prefix every key of this application carries. */
export const STORAGE_PREFIX = 'umy:';

/** Bump this whenever the stored shape changes. Old data is then dropped. */
export const SCHEMA_VERSION = 1;

const STATE_KEY = `${STORAGE_PREFIX}state`;

/**
 * Returns the storage, or null when it cannot be used at all.
 *
 * Access itself can throw: some browsers deny storage to `file://` pages and
 * to private windows.
 *
 * @returns {Storage|null} The storage or null.
 */
function getStorage() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) {
      return null;
    }
    const probe = `${STORAGE_PREFIX}probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch (error) {
    // Denied storage is a normal situation here, not a bug: the interface
    // keeps working and only loses the convenience of remembering things.
    console.warn('localStorage is not available, the setup will not be remembered:', error.message);
    return null;
  }
}

/**
 * Tells whether anything can be stored in this runtime.
 *
 * @returns {boolean} True when localStorage answered.
 */
export function isStorageAvailable() {
  return getStorage() !== null;
}

/**
 * Reads the saved snapshot.
 *
 * @returns {object|null} The stored payload, or null when there is nothing
 *   usable: no storage, no entry, damaged JSON or a different schema version.
 */
export function loadSnapshot() {
  const storage = getStorage();
  if (storage === null) {
    return null;
  }
  const raw = storage.getItem(STATE_KEY);
  if (raw === null) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn('stored state is not readable and was dropped:', error.message);
    storage.removeItem(STATE_KEY);
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || parsed.version !== SCHEMA_VERSION) {
    storage.removeItem(STATE_KEY);
    return null;
  }
  return parsed.data ?? null;
}

/**
 * Writes the snapshot.
 *
 * @param {object} data Serialisable payload.
 * @returns {boolean} True when it was stored.
 */
export function saveSnapshot(data) {
  const storage = getStorage();
  if (storage === null) {
    return false;
  }
  try {
    storage.setItem(STATE_KEY, JSON.stringify({ version: SCHEMA_VERSION, data }));
    return true;
  } catch (error) {
    // Quota or a denied write. Nothing to recover, but the user should not be
    // told the setup was remembered when it was not.
    console.warn('the setup could not be stored:', error.message);
    return false;
  }
}

/**
 * Removes the snapshot.
 *
 * @returns {void}
 */
export function clearSnapshot() {
  const storage = getStorage();
  if (storage !== null) {
    storage.removeItem(STATE_KEY);
  }
}
