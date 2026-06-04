/**
 * Thin client for the S3-backed API Gateway proxy.
 *
 * Routes are shaped /<bucket>/<filename>. Only redacted files are ever stored
 * here — originals are never persisted (see the upload flow).
 *
 *   PUT    -> upload      (fetch; requires CORS on the API Gateway)
 *   DELETE -> delete      (fetch; requires CORS on the API Gateway)
 *   GET    -> view/download is done via top-level navigation (objectUrl), which
 *             is NOT subject to CORS, so it works as soon as the GET method is
 *             configured on the API Gateway.
 */

const API_URL = import.meta.env.VITE_S3_API_URL;
const BUCKET = import.meta.env.VITE_S3_BUCKET;

/** Extension used as the S3 object key suffix, derived from the filename. */
export function extensionOf(filename) {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/** Canonical S3 object key for a document: "<documentId>.<ext>". */
export function objectKeyFor(documentId, ext) {
  return ext ? `${documentId}.${ext}` : documentId;
}

/** Fully-qualified URL for an object key. */
export function objectUrl(key) {
  return `${API_URL}/${BUCKET}/${encodeURIComponent(key)}`;
}

export const BUCKET_NAME = BUCKET;

/** Upload a File/Blob to the given key. Requires PUT + CORS on the gateway. */
export async function putObject(key, body, contentType) {
  const res = await fetch(objectUrl(key), {
    method: 'PUT',
    headers: contentType ? { 'Content-Type': contentType } : undefined,
    body,
  });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status}). Is CORS enabled on the API Gateway?`);
  }
  return key;
}

/** Delete an object by key. Requires DELETE + CORS on the gateway. */
export async function deleteObject(key) {
  const res = await fetch(objectUrl(key), { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Delete failed (${res.status}). Is DELETE configured + CORS enabled on the API Gateway?`);
  }
}
