import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { peekPendingUpload, clearPendingUpload } from '../lib/uploadHandoff';
import {
  BUCKET_NAME,
  deleteObject,
  extensionOf,
  objectKeyFor,
  putObject,
} from '../lib/storage';
import logo from './PromptPatrol.png';

// file_type_t enum — only these can be stored.
const SUPPORTED_EXTS = ['pdf', 'docx', 'txt', 'rtf'];

/* entity_type_t -> display label (matches the wireframe casing). */
const ENTITY_LABEL = {
  person_name: 'Person_Name',
  company_name: 'Company_Name',
  location: 'Location',
  date_of_birth: 'Date_of_Birth',
  ssn: 'SSN',
  account_number: 'Account Number',
  credit_card: 'Credit_Card',
  routing_number: 'Routing_Number',
  date: 'Date',
};

/*
 * Placeholder document pages + candidates until the spaCy/regex pipeline is
 * connected. Page 1 mirrors the wireframe; pages 2-4 are filler so Prev/Next
 * can be demonstrated.
 */
const MOCK_PAGES = [
  {
    preview: [
      'Loan Application reviewed for applicant',
      'Collin J. Lane, residing at',
      '550 Huntington Ave, Boston, MA',
      'Date of Birth:        11/22/2003',
      'SSN: *** **** 2022',
      'Annual Reported Income: $100,000,000',
      'Account Number: 427498 - 234824',
    ],
    candidates: [
      { id: 'p1-1', entity: 'person_name', text: 'Collin J. Lane' },
      { id: 'p1-2', entity: 'location', text: '550 Huntington Ave' },
      { id: 'p1-3', entity: 'date_of_birth', text: '11/22/2003' },
      { id: 'p1-4', entity: 'ssn', text: '**** **** 2022' },
      { id: 'p1-5', entity: 'account_number', text: '427498 - 234824' },
    ],
  },
  {
    preview: [
      'Co-applicant details',
      'Jane A. Doe, residing at',
      '12 Beacon Street, Boston, MA',
      'Date of Birth:        04/02/1999',
      'SSN: *** **** 8841',
    ],
    candidates: [
      { id: 'p2-1', entity: 'person_name', text: 'Jane A. Doe' },
      { id: 'p2-2', entity: 'location', text: '12 Beacon Street' },
      { id: 'p2-3', entity: 'date_of_birth', text: '04/02/1999' },
      { id: 'p2-4', entity: 'ssn', text: '**** **** 8841' },
    ],
  },
  {
    preview: [
      'Employment verification',
      'Employer: Acme Financial Group',
      'Contact: hr@acmefinancial.com',
      'Routing Number: 011000015',
    ],
    candidates: [
      { id: 'p3-1', entity: 'company_name', text: 'Acme Financial Group' },
      { id: 'p3-2', entity: 'routing_number', text: '011000015' },
    ],
  },
  {
    preview: [
      'Signatures',
      'Signed on 05/14/2026 by Collin J. Lane',
      'Card on file: 4242 4242 4242 4242',
    ],
    candidates: [
      { id: 'p4-1', entity: 'date', text: '05/14/2026' },
      { id: 'p4-2', entity: 'person_name', text: 'Collin J. Lane' },
      { id: 'p4-3', entity: 'credit_card', text: '4242 4242 4242 4242' },
    ],
  },
];

const ALL_CANDIDATES = MOCK_PAGES.flatMap((p) => p.candidates);

export default function Redact() {
  const navigate = useNavigate();

  // Read the in-memory file (without clearing — safe under StrictMode).
  const fileRef = useRef(peekPendingUpload());
  const file = fileRef.current;

  // scanning -> review -> storing
  const [phase, setPhase] = useState('scanning');
  const [pageIdx, setPageIdx] = useState(0);
  const [decisions, setDecisions] = useState(() =>
    Object.fromEntries(ALL_CANDIDATES.map((c) => [c.id, 'confirmed']))
  );
  const [error, setError] = useState('');

  // No file means the user hit /redact directly — send them back. Otherwise
  // capture is done, so clear the hand-off slot (in an effect, not render).
  useEffect(() => {
    if (!file) {
      navigate('/dashboard', { replace: true });
      return;
    }
    clearPendingUpload();
  }, [file, navigate]);

  // Simulate the redaction scan.
  useEffect(() => {
    if (!file) return undefined;
    const t = setTimeout(() => setPhase('review'), 1400);
    return () => clearTimeout(t);
  }, [file]);

  if (!file) return null;

  const ext = extensionOf(file.name);
  const supported = SUPPORTED_EXTS.includes(ext);
  const page = MOCK_PAGES[pageIdx];
  const totalPages = MOCK_PAGES.length;
  const confirmedCount = Object.values(decisions).filter(
    (d) => d === 'confirmed'
  ).length;

  function setDecision(id, value) {
    setDecisions((d) => ({ ...d, [id]: value }));
  }

  async function handleApply() {
    setError('');

    if (!supported) {
      setError(`Unsupported file type ".${ext}". Allowed: ${SUPPORTED_EXTS.join(', ')}.`);
      return;
    }

    setPhase('storing');

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      navigate('/login');
      return;
    }

    // 1. Document metadata row (owner-scoped by RLS).
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .insert({
        owner_id: session.user.id,
        original_filename: file.name,
        file_type: ext,
        size_bytes: file.size,
        status: 'stored',
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (docErr) {
      setError(docErr.message);
      setPhase('review');
      return;
    }

    // 2. Upload the redacted artifact to S3.
    //    (Mock: the algorithm isn't wired up yet, so we store the file as-is.)
    const key = objectKeyFor(doc.id, ext);
    try {
      await putObject(key, file, file.type || 'application/octet-stream');
    } catch (e) {
      // Roll back the orphaned metadata row so the dashboard stays consistent.
      await supabase.from('documents').delete().eq('id', doc.id);
      setError(e.message);
      setPhase('review');
      return;
    }

    // 3. Record the S3 location.
    const { error: redErr } = await supabase.from('redacted_documents').insert({
      source_document_id: doc.id,
      s3_bucket: BUCKET_NAME,
      s3_object_key: key,
      file_type: ext,
      size_bytes: file.size,
      written_to_s3_at: new Date().toISOString(),
    });

    if (redErr) {
      // The file is in S3 but we couldn't record it — clean both up.
      try {
        await deleteObject(key);
      } catch {
        /* best effort */
      }
      await supabase.from('documents').delete().eq('id', doc.id);
      setError(redErr.message);
      setPhase('review');
      return;
    }

    navigate('/dashboard');
  }

  const storing = phase === 'storing';

  return (
    <div className="redact-page">
      {/* ── Header: filename + page count + controls ── */}
      <header className="redact-bar">
        <div className="redact-bar-left">
          <img src={logo} alt="PromptPatrol" className="redact-bar-logo" />
          <div>
            <div className="redact-bar-file">{file.name}</div>
            <div className="redact-bar-page">
              page {pageIdx + 1} of {totalPages}
            </div>
          </div>
        </div>

        <div className="redact-bar-actions">
          <button
            type="button"
            className="redact-nav-btn"
            disabled={pageIdx === 0 || storing}
            onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
          >
            &lt; Prev
          </button>
          <button
            type="button"
            className="redact-nav-btn"
            disabled={pageIdx >= totalPages - 1 || storing}
            onClick={() => setPageIdx((i) => Math.min(totalPages - 1, i + 1))}
          >
            Next &gt;
          </button>
          <button
            type="button"
            className="redact-apply-btn"
            disabled={storing || phase === 'scanning'}
            onClick={handleApply}
          >
            {storing ? 'Storing…' : 'Apply Redactions →'}
          </button>
        </div>
      </header>

      {phase === 'scanning' ? (
        <main className="redact-scanning">
          <p className="redact-status">Scanning for sensitive information…</p>
        </main>
      ) : (
        <main className="redact-review">
          {error && <p className="redact-error">{error}</p>}
          <div className="redact-grid">
            {/* Left: document preview */}
            <section className="redact-preview">
              <h2 className="redact-col-title">Preview</h2>
              <div className="redact-preview-body">
                {page.preview.map((line, i) => (
                  <p key={i} className="redact-preview-line">
                    {line}
                  </p>
                ))}
              </div>
            </section>

            {/* Right: candidate review cards */}
            <section className="redact-candidates">
              <h2 className="redact-col-title">Candidates (page {pageIdx + 1})</h2>
              <p className="redact-candidates-note">
                {confirmedCount} of {ALL_CANDIDATES.length} items marked for
                redaction across all pages. (Placeholder findings until the
                detection pipeline is connected.)
              </p>

              {page.candidates.length === 0 ? (
                <p className="redact-candidates-empty">
                  No candidates on this page.
                </p>
              ) : (
                <ul className="redact-cand-list">
                  {page.candidates.map((c) => {
                    const confirmed = decisions[c.id] === 'confirmed';
                    return (
                      <li key={c.id} className="redact-cand">
                        <input
                          type="checkbox"
                          className="redact-cand-check"
                          checked={confirmed}
                          onChange={() =>
                            setDecision(c.id, confirmed ? 'rejected' : 'confirmed')
                          }
                          aria-label={`Redact ${ENTITY_LABEL[c.entity] ?? c.entity}`}
                        />
                        <div className="redact-cand-info">
                          <span className="redact-cand-entity">
                            {ENTITY_LABEL[c.entity] ?? c.entity}
                          </span>
                          <span className="redact-cand-text">{c.text}</span>
                        </div>
                        <div className="redact-cand-actions">
                          <button
                            type="button"
                            className={`redact-yes ${confirmed ? 'redact-yes--on' : ''}`}
                            onClick={() => setDecision(c.id, 'confirmed')}
                            aria-label="Confirm redaction"
                          >
                            <span className="material-symbols-outlined">check</span>
                          </button>
                          <button
                            type="button"
                            className={`redact-no ${!confirmed ? 'redact-no--on' : ''}`}
                            onClick={() => setDecision(c.id, 'rejected')}
                            aria-label="Reject redaction"
                          >
                            <span className="material-symbols-outlined">close</span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </main>
      )}
    </div>
  );
}
