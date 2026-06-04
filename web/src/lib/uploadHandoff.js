/**
 * In-memory hand-off for the file being uploaded.
 *
 * The original (un-redacted) file must NEVER hit long-term storage — it only
 * lives in browser memory while the user steps through redaction. We pass it
 * from the dashboard to the redaction page through this module-level slot
 * rather than router state or storage, so it vanishes on refresh/navigation.
 *
 * Read with peekPendingUpload() (pure — safe to call during render, including
 * React StrictMode's double-invoke) and clear explicitly with
 * clearPendingUpload() from an effect once the file has been captured.
 */
let pending = null;

export function setPendingUpload(file) {
  pending = file;
}

/** Returns the pending file without clearing it. Safe to call during render. */
export function peekPendingUpload() {
  return pending;
}

export function clearPendingUpload() {
  pending = null;
}
