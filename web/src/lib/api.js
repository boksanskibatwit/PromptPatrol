/**
 * Client for the FastAPI backend document routes.
 *
 * Replaces the old direct S3-via-API-Gateway path (lib/storage.js): the file
 * goes to the backend, which runs the redaction engine and is the only thing
 * that touches S3. Every call carries the caller's Supabase JWT; the backend
 * re-validates it and RLS scopes the DB rows.
 */

import { supabase } from '../supabaseClient';

const API_URL = import.meta.env.VITE_API_URL;

/** Extension used as the S3 object key suffix, derived from the filename. */
export function extensionOf(filename) {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

async function authHeader() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  return { Authorization: `Bearer ${session.access_token}` };
}

async function parseError(res, fallback) {
  try {
    const body = await res.json();
    if (body?.detail) return typeof body.detail === 'string' ? body.detail : fallback;
  } catch {
    /* non-JSON error body */
  }
  return fallback;
}

/** Run the detection engine. Returns { pages: [{ preview, candidates }] }. */
export async function analyzeDocument(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_URL}/documents/analyze`, {
    method: 'POST',
    headers: await authHeader(),
    body: form,
  });
  if (!res.ok) throw new Error(await parseError(res, `Analyze failed (${res.status})`));
  return res.json();
}

/**
 * Apply redactions server-side. `candidates` is the flattened candidate list
 * from analyze, each with a `decision` of 'confirmed' | 'rejected'. The
 * backend stores the artifact in S3 and records all DB rows.
 */
export async function redactDocument(file, candidates) {
  const form = new FormData();
  form.append('file', file);
  form.append('candidates', JSON.stringify(candidates));
  const res = await fetch(`${API_URL}/documents/redact`, {
    method: 'POST',
    headers: await authHeader(),
    body: form,
  });
  if (!res.ok) throw new Error(await parseError(res, `Redact failed (${res.status})`));
  return res.json();
}

/** Short-lived presigned URL for the stored artifact. */
export async function getDownloadUrl(documentId, { attachment = false } = {}) {
  const res = await fetch(
    `${API_URL}/documents/${documentId}/download?attachment=${attachment}`,
    { headers: await authHeader() }
  );
  if (!res.ok) throw new Error(await parseError(res, `Download failed (${res.status})`));
  const { url } = await res.json();
  return url;
}

/** Delete the S3 object and the document rows. */
export async function deleteDocument(documentId) {
  const res = await fetch(`${API_URL}/documents/${documentId}`, {
    method: 'DELETE',
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(await parseError(res, `Delete failed (${res.status})`));
}

/**
 * Admin-only delete: removes any user's document via the service role, not
 * just the caller's own. Backend enforces the admin role.
 */
export async function adminDeleteDocument(documentId) {
  const res = await fetch(`${API_URL}/admin/documents/${documentId}`, {
    method: 'DELETE',
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(await parseError(res, `Delete failed (${res.status})`));
}
