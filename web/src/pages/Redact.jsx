import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { peekPendingUpload, clearPendingUpload } from '../lib/uploadHandoff';
import { analyzeDocument, redactDocument, extensionOf } from '../lib/api';
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
  email: 'Email',
  phone_number: 'Phone_Number',
};

const ENTITY_OPTIONS = Object.entries(ENTITY_LABEL);

function renderPreview(page, decisions) {
  const pageText = page.text || page.preview.join('\n');
  const baseOffset = page.start_offset ?? 0;
  const confirmed = page.candidates
    .filter((c) => decisions[c.id] === 'confirmed')
    .map((c) => ({
      ...c,
      localStart: Math.max(0, c.start_offset - baseOffset),
      localEnd: Math.max(0, c.end_offset - baseOffset),
    }))
    .filter((c) => c.localEnd > c.localStart)
    .sort((a, b) => a.localStart - b.localStart);

  const parts = [];
  let cursor = 0;
  confirmed.forEach((c) => {
    if (c.localStart < cursor) return;
    if (c.localStart > cursor) {
      parts.push({
        type: 'text',
        value: pageText.slice(cursor, c.localStart),
        start: cursor,
        end: c.localStart,
      });
    }
    parts.push({
      type: 'redacted',
      value: ENTITY_LABEL[c.entity] ?? c.entity,
      id: c.id,
      start: c.localStart,
      end: c.localEnd,
    });
    cursor = c.localEnd;
  });
  if (cursor < pageText.length) {
    parts.push({ type: 'text', value: pageText.slice(cursor), start: cursor, end: pageText.length });
  }

  return parts.length ? parts : [{ type: 'text', value: 'No readable text was found on this page.' }];
}

export default function Redact() {
  const navigate = useNavigate();

  // Read the in-memory file (without clearing — safe under StrictMode).
  const fileRef = useRef(peekPendingUpload());
  const file = fileRef.current;

  // scanning -> review -> storing
  const [phase, setPhase] = useState('scanning');
  const [pages, setPages] = useState(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [decisions, setDecisions] = useState({});
  const [error, setError] = useState('');
  const [manualEntity, setManualEntity] = useState(ENTITY_OPTIONS[0][0]);
  const [selectionError, setSelectionError] = useState('');
  const previewRef = useRef(null);

  // No file means the user hit /redact directly — send them back. Otherwise
  // capture is done, so clear the hand-off slot (in an effect, not render).
  useEffect(() => {
    if (!file) {
      navigate('/dashboard', { replace: true });
      return;
    }
    clearPendingUpload();
  }, [file, navigate]);

  // Run the backend detection engine on the in-memory file.
  useEffect(() => {
    if (!file) return undefined;
    let active = true;
    (async () => {
      try {
        const { pages: result } = await analyzeDocument(file);
        if (!active) return;
        setPages(result);
        setDecisions(
          Object.fromEntries(
            result.flatMap((p) => p.candidates).map((c) => [c.id, 'confirmed'])
          )
        );
        setPhase('review');
      } catch (e) {
        if (!active) return;
        setError(e.message);
        setPages([]);
        setPhase('review');
      }
    })();
    return () => {
      active = false;
    };
  }, [file]);

  if (!file) return null;

  const ext = extensionOf(file.name);
  const supported = SUPPORTED_EXTS.includes(ext);
  const allCandidates = (pages ?? []).flatMap((p) => p.candidates);
  const page = pages?.[pageIdx];
  const totalPages = pages?.length ?? 0;
  const confirmedCount = Object.values(decisions).filter(
    (d) => d === 'confirmed'
  ).length;
  const previewParts = page ? renderPreview(page, decisions) : [];

  function setDecision(id, value) {
    setDecisions((d) => ({ ...d, [id]: value }));
  }

  function setCandidateEntity(id, entity) {
    setPages((currentPages) =>
      currentPages?.map((p) => ({
        ...p,
        candidates: p.candidates.map((c) => (c.id === id ? { ...c, entity } : c)),
      })) ?? currentPages
    );
  }

  function readPreviewSelection() {
    const root = previewRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      return null;
    }

    function offsetFromBoundary(container, offset) {
      if (container.nodeType === Node.TEXT_NODE) {
        const span = container.parentElement?.closest?.('[data-local-start][data-local-end]');
        if (!span || span.dataset.partType !== 'text') return null;
        return Number(span.dataset.localStart) + offset;
      }

      const before = container.childNodes[Math.max(0, offset - 1)];
      const at = container.childNodes[offset];
      const element = at || before;
      const span = element?.closest?.('[data-local-start][data-local-end]');
      if (!span || span.dataset.partType !== 'text') return null;
      return at ? Number(span.dataset.localStart) : Number(span.dataset.localEnd);
    }

    const localStart = offsetFromBoundary(range.startContainer, range.startOffset);
    const localEnd = offsetFromBoundary(range.endContainer, range.endOffset);
    if (localStart === null || localEnd === null || localEnd <= localStart) return null;

    return {
      start: (page.start_offset ?? 0) + localStart,
      end: (page.start_offset ?? 0) + localEnd,
      text: (page.text || page.preview.join('\n')).slice(localStart, localEnd),
    };
  }

  function addManualRedaction() {
    setSelectionError('');
    const selected = readPreviewSelection();
    const selectedText = selected?.text?.trim();

    if (!selected || !selectedText) {
      setSelectionError('Select unredacted text in the preview before adding a manual redaction.');
      return;
    }

    const overlaps = page.candidates.some(
      (c) =>
        decisions[c.id] === 'confirmed' &&
        selected.start < c.end_offset &&
        c.start_offset < selected.end
    );
    if (overlaps) {
      setSelectionError('That selection overlaps an existing redaction.');
      return;
    }

    const id = `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const candidate = {
      id,
      entity: manualEntity,
      text: selected.text,
      page: pageIdx + 1,
      start_offset: selected.start,
      end_offset: selected.end,
      confidence: 1,
      source: 'manual',
    };

    setPages((currentPages) =>
      currentPages.map((p, idx) =>
        idx === pageIdx ? { ...p, candidates: [...p.candidates, candidate] } : p
      )
    );
    setDecisions((d) => ({ ...d, [id]: 'confirmed' }));
    window.getSelection()?.removeAllRanges();
  }

  async function handleApply() {
    setError('');

    if (!supported) {
      setError(`Unsupported file type ".${ext}". Allowed: ${SUPPORTED_EXTS.join(', ')}.`);
      return;
    }

    setPhase('storing');

    // The backend applies the redactions, stores ONLY the redacted artifact
    // in S3, and records documents / redacted_documents / candidate rows.
    try {
      await redactDocument(
        file,
        allCandidates.map((c) => ({
          ...c,
          decision: decisions[c.id] === 'confirmed' ? 'confirmed' : 'rejected',
        }))
      );
    } catch (e) {
      setError(e.message);
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
              page {totalPages === 0 ? 0 : pageIdx + 1} of {totalPages}
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
            disabled={storing || phase === 'scanning' || !page}
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
          {!page ? (
            <p className="redact-status">
              This document could not be analyzed.{' '}
              <button
                type="button"
                className="redact-nav-btn"
                onClick={() => navigate('/dashboard')}
              >
                Back to dashboard
              </button>
            </p>
          ) : (
          <div className="redact-grid">
            {/* Left: document preview */}
            <section className="redact-preview">
              <h2 className="redact-col-title">Preview</h2>
              <div className="redact-preview-body" ref={previewRef}>
                <pre className="redact-preview-text">
                  {previewParts.map((part, i) =>
                    part.type === 'redacted' ? (
                      <mark
                        key={`${part.id}-${i}`}
                        className="redact-preview-mask"
                        data-local-start={part.start}
                        data-local-end={part.end}
                        data-part-type="redacted"
                      >
                        {part.value}
                      </mark>
                    ) : (
                      <span
                        key={i}
                        data-local-start={part.start}
                        data-local-end={part.end}
                        data-part-type="text"
                      >
                        {part.value}
                      </span>
                    )
                  )}
                </pre>
              </div>
            </section>

            {/* Right: candidate review cards */}
            <section className="redact-candidates">
              <h2 className="redact-col-title">Candidates (page {pageIdx + 1})</h2>
              <p className="redact-candidates-note">
                {confirmedCount} of {allCandidates.length} items marked for
                redaction across all pages.
              </p>
              <div className="redact-manual">
                <div className="redact-manual-row">
                  <label className="redact-manual-field">
                    <span>Entity type</span>
                    <select
                      value={manualEntity}
                      onChange={(e) => setManualEntity(e.target.value)}
                      disabled={storing}
                    >
                      {ENTITY_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="redact-nav-btn redact-manual-add"
                    disabled={storing}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={addManualRedaction}
                  >
                    Add selected text
                  </button>
                </div>
                {selectionError && <p className="redact-manual-error">{selectionError}</p>}
              </div>

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
                        <div className="redact-cand-info">
                          <span className="redact-cand-entity">
                            {ENTITY_LABEL[c.entity] ?? c.entity}
                          </span>
                          {c.source === 'manual' && (
                            <select
                              className="redact-cand-select"
                              value={c.entity}
                              disabled={storing}
                              onChange={(e) => setCandidateEntity(c.id, e.target.value)}
                              aria-label="Manual redaction entity type"
                            >
                              {ENTITY_OPTIONS.map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          )}
                          <span className="redact-cand-text">{c.text}</span>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={confirmed}
                          className={`redact-switch ${confirmed ? 'redact-switch--on' : 'redact-switch--off'}`}
                          onClick={() =>
                            setDecision(c.id, confirmed ? 'rejected' : 'confirmed')
                          }
                          aria-label={`Redact ${ENTITY_LABEL[c.entity] ?? c.entity}`}
                        >
                          <span className="redact-switch-track">
                            <span className="redact-switch-thumb" />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
          )}
        </main>
      )}
    </div>
  );
}
