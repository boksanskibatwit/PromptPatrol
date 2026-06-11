import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { setPendingUpload } from '../lib/uploadHandoff';
import { getDownloadUrl, deleteDocument } from '../lib/api';
import logo from './PromptPatrol.png';

const PAGE_SIZE = 10;

/* Maps document_status_t -> display label + dot color class */
const STATUS_META = {
  scanning: { label: 'Scanning', cls: 'dash-status--scanning' },
  review: { label: 'Review', cls: 'dash-status--review' },
  stored: { label: 'Stored', cls: 'dash-status--stored' },
  failed: { label: 'Failed', cls: 'dash-status--failed' },
};

/* Maps file_type_t -> Material Symbols icon name */
const FILE_ICON = {
  pdf: 'picture_as_pdf',
  docx: 'article',
  txt: 'description',
  rtf: 'description',
};

const STATUS_FILTERS = ['all', 'scanning', 'review', 'stored', 'failed'];

/* "2 min ago" / "Yesterday" / "Apr 18" / "Apr 18, 2024" */
function formatUploaded(iso) {
  if (!iso) return '—';
  const then = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now - then) / 60000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;

  if (then.toDateString() === now.toDateString()) {
    const hr = Math.floor(diffMin / 60);
    return `${hr} hr ago`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return 'Yesterday';

  const opts = { month: 'short', day: 'numeric' };
  if (then.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return then.toLocaleDateString('en-US', opts);
}

export default function Dashboard() {
  const navigate = useNavigate();

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [email, setEmail] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  const [menuOpen, setMenuOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState(null); // open row id
  const [busyId, setBusyId] = useState(null);
  const menuRef = useRef(null);
  const fileInputRef = useRef(null);

  const reload = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('documents')
      .select('*')
      .order('uploaded_at', { ascending: false });

    if (queryError) setError(queryError.message);
    else setDocuments(data ?? []);
    setLoading(false);
  }, []);

  // Load the current user's documents (RLS scopes the rows to the owner).
  useEffect(() => {
    let active = true;
    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate('/login');
        return;
      }
      if (active) setEmail(session.user?.email ?? '');
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', session.user.id)
        .single();
      if (profile?.role === 'admin') {
        navigate('/admin');
        return;
      }
      await reload();
    }
    init();
    return () => {
      active = false;
    };
  }, [navigate, reload]);

  // Close any open menu on outside click.
  useEffect(() => {
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
      if (!e.target.closest?.('.dash-actions')) setRowMenu(null);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((doc) => {
      const matchesStatus =
        statusFilter === 'all' || doc.status === statusFilter;
      const matchesSearch =
        !q || doc.original_filename?.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [documents, search, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow reselecting the same file later
    if (!file) return;
    // Original stays in memory only; redaction happens before any storage.
    setPendingUpload(file);
    navigate('/redact');
  }

  // View/download fetch a short-lived presigned S3 URL from the backend.
  async function handleView(doc) {
    setRowMenu(null);
    setActionError('');
    // Open the tab synchronously so popup blockers allow it, then point it
    // at the presigned URL once the backend responds.
    const tab = window.open('', '_blank', 'noopener');
    try {
      const url = await getDownloadUrl(doc.id);
      if (tab) tab.location = url;
      else window.open(url, '_blank', 'noopener');
    } catch (e) {
      tab?.close();
      setActionError(e.message);
    }
  }

  async function handleDownload(doc) {
    setRowMenu(null);
    setActionError('');
    try {
      // Content-Disposition on the presigned URL triggers the download and
      // names the file after original_filename.
      const url = await getDownloadUrl(doc.id, { attachment: true });
      const a = document.createElement('a');
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setActionError(e.message);
    }
  }

  async function handleDelete(doc) {
    setRowMenu(null);
    setActionError('');
    if (!window.confirm(`Delete "${doc.original_filename}"? This cannot be undone.`)) {
      return;
    }
    setBusyId(doc.id);
    try {
      // Backend removes the S3 object, then the rows (cascade covers the rest).
      await deleteDocument(doc.id);
      await reload();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="dash-page">
      {/* ── Top navigation ── */}
      <header className="dash-header">
        <div className="dash-header-inner">
          <div className="dash-brand">
            <img src={logo} alt="PromptPatrol" className="dash-logo" />
            <span className="dash-brand-name">PromptPatrol</span>
          </div>

          <div className="dash-profile" ref={menuRef}>
            <button
              type="button"
              className="dash-profile-btn"
              aria-label="User profile"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span className="material-symbols-outlined">account_circle</span>
            </button>

            {menuOpen && (
              <div className="dash-menu" role="menu">
                {email && <div className="dash-menu-email">{email}</div>}
                <button
                  type="button"
                  className="dash-menu-item"
                  role="menuitem"
                  onClick={handleSignOut}
                >
                  <span className="material-symbols-outlined dash-menu-icon">
                    logout
                  </span>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="dash-main">
        <section className="dash-section">
          {/* Header area */}
          <div className="dash-head">
            <div className="dash-head-titles">
              <span className="dash-eyebrow">Dashboard</span>
              <h1 className="dash-title">My Documents</h1>
            </div>
          </div>

          {/* Filter controls */}
          <div className="dash-controls">
            <div className="dash-search">
              <span className="material-symbols-outlined dash-search-icon">
                search
              </span>
              <input
                type="text"
                className="dash-search-input"
                placeholder="Search by filename..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="dash-select-wrap">
              <select
                className="dash-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {s === 'all' ? 'All Status' : STATUS_META[s].label}
                  </option>
                ))}
              </select>
              <span className="material-symbols-outlined dash-select-icon">
                expand_more
              </span>
            </div>

            <div className="dash-controls-spacer" />

            <div className="dash-count">
              <span className="material-symbols-outlined dash-count-icon">
                info
              </span>
              <span>
                {filtered.length} document{filtered.length === 1 ? '' : 's'} found
              </span>
            </div>

            <button
              type="button"
              className="dash-upload-btn"
              onClick={handleUploadClick}
            >
              <span className="material-symbols-outlined dash-upload-icon">
                add
              </span>
              Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.rtf"
              hidden
              onChange={handleFileChange}
            />
          </div>

          {actionError && <p className="dash-action-error">{actionError}</p>}

          {/* Table */}
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Status</th>
                  <th>Uploaded</th>
                  <th className="dash-th-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="dash-empty">
                      Loading documents…
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={4} className="dash-empty dash-empty--error">
                      {error}
                    </td>
                  </tr>
                ) : pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="dash-empty">
                      {documents.length === 0
                        ? 'No documents yet. Upload one to get started.'
                        : 'No documents match your filters.'}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((doc) => {
                    const meta = STATUS_META[doc.status] ?? {
                      label: doc.status,
                      cls: '',
                    };
                    return (
                      <tr key={doc.id} className="dash-row">
                        <td>
                          <div className="dash-file">
                            <span className="material-symbols-outlined dash-file-icon">
                              {FILE_ICON[doc.file_type] ?? 'description'}
                            </span>
                            <span className="dash-file-name">
                              {doc.original_filename}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className={`dash-status ${meta.cls}`}>
                            <span className="dash-status-dot" />
                            <span className="dash-status-label">
                              {meta.label}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="dash-uploaded">
                            {formatUploaded(doc.uploaded_at)}
                          </span>
                        </td>
                        <td className="dash-td-right">
                          <div className="dash-actions">
                            <button
                              type="button"
                              className="dash-actions-btn"
                              aria-label="Document actions"
                              disabled={busyId === doc.id}
                              onClick={() =>
                                setRowMenu((r) => (r === doc.id ? null : doc.id))
                              }
                            >
                              <span className="material-symbols-outlined">
                                {busyId === doc.id ? 'progress_activity' : 'more_vert'}
                              </span>
                            </button>

                            {rowMenu === doc.id && (
                              <div className="dash-row-menu" role="menu">
                                <button
                                  type="button"
                                  className="dash-menu-item"
                                  onClick={() => handleView(doc)}
                                >
                                  <span className="material-symbols-outlined dash-menu-icon">
                                    visibility
                                  </span>
                                  View
                                </button>
                                <button
                                  type="button"
                                  className="dash-menu-item"
                                  onClick={() => handleDownload(doc)}
                                >
                                  <span className="material-symbols-outlined dash-menu-icon">
                                    download
                                  </span>
                                  Download
                                </button>
                                <button
                                  type="button"
                                  className="dash-menu-item dash-menu-item--danger"
                                  onClick={() => handleDelete(doc)}
                                >
                                  <span className="material-symbols-outlined dash-menu-icon">
                                    delete
                                  </span>
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!loading && !error && filtered.length > 0 && (
            <div className="dash-pagination">
              <span className="dash-pagination-info">
                Showing {start + 1} to {start + pageRows.length} of{' '}
                {filtered.length} entries
              </span>
              <div className="dash-pagination-controls">
                <button
                  type="button"
                  className="dash-page-btn"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <span className="material-symbols-outlined">chevron_left</span>
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`dash-page-btn ${
                      p === currentPage ? 'dash-page-btn--active' : ''
                    }`}
                    onClick={() => setPage(p)}
                    aria-current={p === currentPage ? 'page' : undefined}
                  >
                    {p}
                  </button>
                ))}
                <button
                  type="button"
                  className="dash-page-btn"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  aria-label="Next page"
                >
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="dash-footer">
        <div className="dash-footer-inner">
          <div className="dash-footer-brand-block">
            <span className="dash-footer-brand">PromptPatrol</span>
            <p className="dash-footer-copy">
              © 2026 PromptPatrol — Senior Project. All rights reserved.
            </p>
          </div>
          <nav className="dash-footer-nav">
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
            <a href="#">Security Disclosure</a>
            <a href="#">Support</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
