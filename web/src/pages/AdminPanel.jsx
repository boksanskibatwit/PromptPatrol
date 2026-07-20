import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { setPendingUpload } from '../lib/uploadHandoff';
import { getDownloadUrl } from '../lib/api';
import logo from './PromptPatrol.png';

const PAGE_SIZE = 10;

const STATUS_META = {
  scanning: { label: 'Scanning', cls: 'dash-status--scanning' },
  review:   { label: 'Review',   cls: 'dash-status--review'   },
  stored:   { label: 'Stored',   cls: 'dash-status--stored'   },
  failed:   { label: 'Failed',   cls: 'dash-status--failed'   },
};

const FILE_ICON = {
  pdf:  'picture_as_pdf',
  docx: 'article',
  txt:  'description',
  rtf:  'description',
};

const REQUEST_STATUS_META = {
  pending:  { label: 'Pending',  cls: 'admin-badge--pending'  },
  approved: { label: 'Approved', cls: 'admin-badge--approved' },
  rejected: { label: 'Rejected', cls: 'admin-badge--rejected' },
};

const USER_ROLE_META = {
  admin: { label: 'Admin', cls: 'admin-badge--approved' },
  user:  { label: 'User',  cls: 'admin-badge--user'     },
};

const USER_STATUS_META = {
  active:    { label: 'Active',    cls: 'admin-badge--approved' },
  suspended: { label: 'Suspended', cls: 'admin-badge--rejected' },
};

const USER_ROLE_OPTIONS   = [['user', 'User'], ['admin', 'Admin']];
const USER_STATUS_OPTIONS = [['active', 'Active'], ['suspended', 'Suspended']];

// Sort keys offered in the Filters panel. Each can be toggled on/off and
// flipped between directions; multiple may be active and apply in priority
// order (top to bottom of `sortCriteria`).
const USER_SORT_OPTIONS = [
  { key: 'name',   label: 'Name',      asc: 'A → Z',          desc: 'Z → A',          defaultDir: 'asc'  },
  { key: 'docs',   label: 'Documents', asc: 'Fewest first',   desc: 'Most first',     defaultDir: 'desc' },
  { key: 'joined', label: 'Joined',    asc: 'Oldest first',   desc: 'Newest first',   defaultDir: 'desc' },
];

function formatDate(iso) {
  if (!iso) return '—';
  const then = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (then.toDateString() === now.toDateString()) {
    return `${Math.floor(diffMin / 60)} hr ago`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const opts = { month: 'short', day: 'numeric' };
  if (then.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return then.toLocaleDateString('en-US', opts);
}

export default function AdminPanel() {
  const navigate = useNavigate();

  const [tab, setTab] = useState('documents'); // 'documents' | 'users' | 'requests'
  const [email, setEmail] = useState('');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Account requests state
  const [requests, setRequests] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [reqLoading, setReqLoading] = useState(true);
  const [reqError, setReqError] = useState('');
  const [reqFilter, setReqFilter] = useState('pending');
  const [reqSearch, setReqSearch] = useState('');
  const [reqPage, setReqPage] = useState(1);
  const [busyReq, setBusyReq] = useState(null);
  const [reqActionError, setReqActionError] = useState('');

  // Users state
  const [users, setUsers] = useState([]);
  const [userLoading, setUserLoading] = useState(true);
  const [userError, setUserError] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [filterRoles, setFilterRoles] = useState([]);          // [] = all roles
  const [filterStatuses, setFilterStatuses] = useState([]);    // [] = all statuses
  const [sortCriteria, setSortCriteria] = useState([{ key: 'name', dir: 'asc' }]);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef(null);
  const [userPage, setUserPage] = useState(1);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [busyDelete, setBusyDelete] = useState(false);
  const [confirmMfaId, setConfirmMfaId] = useState(null);
  const [busyMfa, setBusyMfa] = useState(false);
  const [confirmPwResetId, setConfirmPwResetId] = useState(null);
  const [busyPwReset, setBusyPwReset] = useState(false);
  const [userRowMenu, setUserRowMenu] = useState(null);
  const [userActionError, setUserActionError] = useState('');
  const [docsModalUser, setDocsModalUser] = useState(null);

  // Documents state
  const [documents, setDocuments] = useState([]);
  const [docLoading, setDocLoading] = useState(true);
  const [docError, setDocError] = useState('');
  const [docSearch, setDocSearch] = useState('');
  const [docStatusFilter, setDocStatusFilter] = useState('all');
  const [docPage, setDocPage] = useState(1);
  const [docRowMenu, setDocRowMenu] = useState(null);
  const [docActionError, setDocActionError] = useState('');
  const fileInputRef = useRef(null);

  const loadRequests = useCallback(async () => {
    setReqLoading(true);
    const { data, error } = await supabase
      .from('account_requests')
      .select('*')
      .order('requested_at', { ascending: false });
    if (error) setReqError(error.message);
    else setRequests(data ?? []);
    setReqLoading(false);
  }, []);

  const loadUsers = useCallback(async () => {
    setUserLoading(true);
    const { data, error } = await supabase
      .from('users')
      .select('id, email, username, role, status, last_login_at, created_at')
      .order('created_at', { ascending: false });
    if (error) setUserError(error.message);
    else setUsers(data ?? []);
    setUserLoading(false);
  }, []);

  const loadDocuments = useCallback(async () => {
    setDocLoading(true);
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('uploaded_at', { ascending: false });
    if (error) setDocError(error.message);
    else setDocuments(data ?? []);
    setDocLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/login'); return; }

      // Verify admin role
      const { data: profile, error: profileErr } = await supabase
        .from('users')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (profileErr || profile?.role !== 'admin') {
        navigate('/dashboard');
        return;
      }

      if (active) {
        setEmail(session.user?.email ?? '');
        setCurrentUserId(session.user?.id ?? null);
      }
      await Promise.all([loadRequests(), loadDocuments(), loadUsers()]);
    }
    init();
    return () => { active = false; };
  }, [navigate, loadRequests, loadDocuments, loadUsers]);

  useEffect(() => {
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target)) {
        setFilterMenuOpen(false);
      }
      if (!e.target.closest?.('.dash-actions')) {
        setDocRowMenu(null);
        setUserRowMenu(null);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (!docsModalUser) return;
    function onKey(e) { if (e.key === 'Escape') setDocsModalUser(null); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [docsModalUser]);

  // Re-fetch all three datasets without a full page reload (which would
  // bounce through login/MFA).
  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([loadRequests(), loadDocuments(), loadUsers()]);
    setRefreshing(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  // ── Document actions ─────────────────────────────────────────────────────

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingUpload(file);
    navigate('/redact');
  }

  // Presigned URLs come from the backend; admin RLS allows reading any
  // user's document row, so the same endpoint serves the admin views.
  async function handleView(doc) {
    setDocRowMenu(null);
    setDocError('');
    // Open a blank tab synchronously, then navigate it once we have the URL.
    // 'noopener' would make window.open return null and lose the reference, so
    // we omit it and sever the opener link manually instead.
    const tab = window.open('about:blank', '_blank');
    try {
      const url = await getDownloadUrl(doc.id);
      if (tab) {
        tab.location = url;
      } else {
        window.location.assign(url);
      }
    } catch (e) {
      tab?.close();
      setDocError(e.message);
    }
  }

  async function handleDownload(doc) {
    setDocRowMenu(null);
    setDocError('');
    try {
      const url = await getDownloadUrl(doc.id, { attachment: true });
      const a = document.createElement('a');
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setDocError(e.message);
    }
  }

  // ── Account request actions ──────────────────────────────────────────────

  async function handleReviewRequest(req, newStatus) {
    setReqActionError('');
    setBusyReq(req.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const action = newStatus === 'approved' ? 'approve' : 'reject';
      const resp = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/accounts/${req.id}/${action}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail ?? `Failed to ${action} account.`);
      }
      await loadRequests();
    } catch (e) {
      setReqActionError(e.message);
    } finally {
      setBusyReq(null);
    }
  }

  // ── User delete ──────────────────────────────────────────────────────────

  async function handleResetMfa(userId) {
    setUserActionError('');
    setBusyMfa(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/users/${userId}/reset-mfa`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail ?? 'Failed to reset MFA.');
      }
      setConfirmMfaId(null);
    } catch (e) {
      setUserActionError(e.message);
    } finally {
      setBusyMfa(false);
    }
  }

  async function handleResetPassword(userId) {
    setUserActionError('');
    setBusyPwReset(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/users/${userId}/reset-password`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail ?? 'Failed to reset password.');
      }
      setConfirmPwResetId(null);
    } catch (e) {
      setUserActionError(e.message);
    } finally {
      setBusyPwReset(false);
    }
  }

  async function handleDeleteUser(userId) {
    setUserActionError('');
    setBusyDelete(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/users/${userId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail ?? 'Failed to delete user.');
      }
      setConfirmDeleteId(null);
      await loadUsers();
    } catch (e) {
      setUserActionError(e.message);
    } finally {
      setBusyDelete(false);
    }
  }

  // ── Filtered / paged data ────────────────────────────────────────────────

  const filteredRequests = useMemo(() => {
    const q = reqSearch.trim().toLowerCase();
    return requests.filter((r) => {
      const matchesStatus = reqFilter === 'all' || r.status === reqFilter;
      const matchesSearch = !q ||
        r.requested_email?.toLowerCase().includes(q) ||
        r.requested_name?.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [requests, reqFilter, reqSearch]);

  const reqPageCount = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));
  const reqCurrentPage = Math.min(reqPage, reqPageCount);
  const reqStart = (reqCurrentPage - 1) * PAGE_SIZE;
  const reqPageRows = filteredRequests.slice(reqStart, reqStart + PAGE_SIZE);

  useEffect(() => { setReqPage(1); }, [reqSearch, reqFilter]);

  const filteredDocs = useMemo(() => {
    const q = docSearch.trim().toLowerCase();
    return documents.filter((doc) => {
      const matchesStatus = docStatusFilter === 'all' || doc.status === docStatusFilter;
      const matchesSearch = !q || doc.original_filename?.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [documents, docSearch, docStatusFilter]);

  const docPageCount = Math.max(1, Math.ceil(filteredDocs.length / PAGE_SIZE));
  const docCurrentPage = Math.min(docPage, docPageCount);
  const docStart = (docCurrentPage - 1) * PAGE_SIZE;
  const docPageRows = filteredDocs.slice(docStart, docStart + PAGE_SIZE);

  useEffect(() => { setDocPage(1); }, [docSearch, docStatusFilter]);

  const docCountByOwner = useMemo(() => {
    const counts = {};
    for (const d of documents) {
      if (d.owner_id) counts[d.owner_id] = (counts[d.owner_id] ?? 0) + 1;
    }
    return counts;
  }, [documents]);

  // Map owner_id → display name so the Documents table can show the user
  // rather than the raw UUID.
  const userById = useMemo(() => {
    const map = {};
    for (const u of users) map[u.id] = u;
    return map;
  }, [users]);

  function ownerLabel(ownerId) {
    if (!ownerId) return '—';
    const u = userById[ownerId];
    return u?.username || u?.email || ownerId;
  }

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const rows = users.filter((u) => {
      const matchesRole = filterRoles.length === 0 || filterRoles.includes(u.role);
      const matchesStatus = filterStatuses.length === 0 || filterStatuses.includes(u.status);
      const matchesSearch = !q ||
        u.email?.toLowerCase().includes(q) ||
        u.username?.toLowerCase().includes(q);
      return matchesRole && matchesStatus && matchesSearch;
    });

    // Per-key comparator (ascending); direction is applied per criterion below.
    const compareBy = {
      name:   (a, b) => (a.username || a.email || '')
        .localeCompare(b.username || b.email || '', undefined, { sensitivity: 'base' }),
      docs:   (a, b) => (docCountByOwner[a.id] ?? 0) - (docCountByOwner[b.id] ?? 0),
      joined: (a, b) => new Date(a.created_at) - new Date(b.created_at),
    };

    const criteria = sortCriteria.length ? sortCriteria : [{ key: 'name', dir: 'asc' }];
    // Name always has the lowest priority: it only breaks ties left by the
    // other active sorts (e.g. Documents trumps Name when both are on).
    const ordered = [...criteria].sort((a, b) => (a.key === 'name' ? 1 : 0) - (b.key === 'name' ? 1 : 0));
    const sorted = [...rows];
    sorted.sort((a, b) => {
      for (const { key, dir } of ordered) {
        const cmp = compareBy[key]?.(a, b) ?? 0;
        if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
    return sorted;
  }, [users, userSearch, filterRoles, filterStatuses, sortCriteria, docCountByOwner]);

  const userPageCount = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const userCurrentPage = Math.min(userPage, userPageCount);
  const userStart = (userCurrentPage - 1) * PAGE_SIZE;
  const userPageRows = filteredUsers.slice(userStart, userStart + PAGE_SIZE);

  useEffect(() => { setUserPage(1); }, [userSearch, filterRoles, filterStatuses, sortCriteria]);

  // ── Filters panel helpers ────────────────────────────────────────────────
  const toggleInArray = (setter) => (value) =>
    setter((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
  const toggleRole = toggleInArray(setFilterRoles);
  const toggleStatus = toggleInArray(setFilterStatuses);

  function toggleSort(key, defaultDir) {
    setSortCriteria((prev) => prev.some((s) => s.key === key)
      ? prev.filter((s) => s.key !== key)
      : [...prev, { key, dir: defaultDir }]);
  }
  function flipSortDir(key) {
    setSortCriteria((prev) =>
      prev.map((s) => s.key === key ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s));
  }
  function resetFilters() {
    setFilterRoles([]);
    setFilterStatuses([]);
    setSortCriteria([{ key: 'name', dir: 'asc' }]);
  }

  const activeFilterCount = filterRoles.length + filterStatuses.length +
    sortCriteria.filter((s) => !(s.key === 'name' && s.dir === 'asc')).length;

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

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
            <span className="admin-header-badge">Admin</span>
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
                  <span className="material-symbols-outlined dash-menu-icon">logout</span>
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
          <div className="dash-head">
            <div className="dash-head-titles">
              <span className="dash-eyebrow">Administration</span>
              <h1 className="dash-title">Admin Panel</h1>
            </div>
            <button
              type="button"
              className={`dash-refresh-btn ${refreshing ? 'dash-refresh-btn--spinning' : ''}`}
              onClick={handleRefresh}
              disabled={refreshing}
              title="Reload requests, users, and documents"
            >
              <span className="material-symbols-outlined">refresh</span>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {/* Tab bar */}
          <div className="admin-tabs">
            <button
              type="button"
              className={`admin-tab ${tab === 'documents' ? 'admin-tab--active' : ''}`}
              onClick={() => setTab('documents')}
            >
              <span className="material-symbols-outlined">folder_open</span>
              Documents
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'users' ? 'admin-tab--active' : ''}`}
              onClick={() => setTab('users')}
            >
              <span className="material-symbols-outlined">group</span>
              Users
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'requests' ? 'admin-tab--active' : ''}`}
              onClick={() => setTab('requests')}
            >
              <span className="material-symbols-outlined">person_add</span>
              Account Requests
              {pendingCount > 0 && (
                <span className="admin-tab-badge">{pendingCount}</span>
              )}
            </button>
          </div>

          {/* ── Account Requests tab ── */}
          {tab === 'requests' && (
            <>
              <div className="dash-controls">
                <div className="dash-search">
                  <span className="material-symbols-outlined dash-search-icon">search</span>
                  <input
                    type="text"
                    className="dash-search-input"
                    placeholder="Search by name or email…"
                    value={reqSearch}
                    onChange={(e) => setReqSearch(e.target.value)}
                  />
                </div>

                <div className="dash-select-wrap">
                  <select
                    className="dash-select"
                    value={reqFilter}
                    onChange={(e) => setReqFilter(e.target.value)}
                  >
                    <option value="all">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <span className="material-symbols-outlined dash-select-icon">expand_more</span>
                </div>

                <div className="dash-controls-spacer" />
                <div className="dash-count">
                  <span className="material-symbols-outlined dash-count-icon">info</span>
                  <span>{filteredRequests.length} request{filteredRequests.length === 1 ? '' : 's'}</span>
                </div>
              </div>

              {reqActionError && <p className="dash-action-error">{reqActionError}</p>}

              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Applicant</th>
                      <th>Requested</th>
                      <th>Status</th>
                      <th className="dash-th-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reqLoading ? (
                      <tr><td colSpan={4} className="dash-empty">Loading requests…</td></tr>
                    ) : reqError ? (
                      <tr><td colSpan={4} className="dash-empty dash-empty--error">{reqError}</td></tr>
                    ) : reqPageRows.length === 0 ? (
                      <tr><td colSpan={4} className="dash-empty">No requests match your filters.</td></tr>
                    ) : reqPageRows.map((req) => {
                      const meta = REQUEST_STATUS_META[req.status] ?? { label: req.status, cls: '' };
                      const isPending = req.status === 'pending';
                      const isBusy = busyReq === req.id;
                      return (
                        <tr key={req.id} className="dash-row">
                          <td>
                            <div className="admin-applicant">
                              <span className="admin-applicant-name">{req.requested_name || '—'}</span>
                              <span className="admin-applicant-email">{req.requested_email || '—'}</span>
                            </div>
                          </td>
                          <td>
                            <span className="dash-uploaded">{formatDate(req.requested_at)}</span>
                          </td>
                          <td>
                            <span className={`admin-badge ${meta.cls}`}>{meta.label}</span>
                          </td>
                          <td className="dash-td-right">
                            {isPending ? (
                              <div className="admin-action-btns">
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--approve"
                                  disabled={isBusy}
                                  onClick={() => handleReviewRequest(req, 'approved')}
                                >
                                  {isBusy ? (
                                    <span className="material-symbols-outlined">progress_activity</span>
                                  ) : (
                                    <>
                                      <span className="material-symbols-outlined">check</span>
                                      Approve
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--reject"
                                  disabled={isBusy}
                                  onClick={() => handleReviewRequest(req, 'rejected')}
                                >
                                  <span className="material-symbols-outlined">close</span>
                                  Reject
                                </button>
                              </div>
                            ) : (
                              <span className="admin-reviewed-by">
                                {req.reviewed_at ? formatDate(req.reviewed_at) : '—'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!reqLoading && !reqError && filteredRequests.length > PAGE_SIZE && (
                <div className="dash-pagination">
                  <span className="dash-pagination-info">
                    Showing {reqStart + 1} to {reqStart + reqPageRows.length} of {filteredRequests.length} entries
                  </span>
                  <div className="dash-pagination-controls">
                    <button type="button" className="dash-page-btn" disabled={reqCurrentPage <= 1} onClick={() => setReqPage((p) => Math.max(1, p - 1))} aria-label="Previous page">
                      <span className="material-symbols-outlined">chevron_left</span>
                    </button>
                    {Array.from({ length: reqPageCount }, (_, i) => i + 1).map((p) => (
                      <button key={p} type="button" className={`dash-page-btn ${p === reqCurrentPage ? 'dash-page-btn--active' : ''}`} onClick={() => setReqPage(p)} aria-current={p === reqCurrentPage ? 'page' : undefined}>{p}</button>
                    ))}
                    <button type="button" className="dash-page-btn" disabled={reqCurrentPage >= reqPageCount} onClick={() => setReqPage((p) => Math.min(reqPageCount, p + 1))} aria-label="Next page">
                      <span className="material-symbols-outlined">chevron_right</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── All Documents tab ── */}
          {tab === 'documents' && (
            <>
              <div className="dash-controls">
                <div className="dash-search">
                  <span className="material-symbols-outlined dash-search-icon">search</span>
                  <input
                    type="text"
                    className="dash-search-input"
                    placeholder="Search by filename…"
                    value={docSearch}
                    onChange={(e) => setDocSearch(e.target.value)}
                  />
                </div>

                <div className="dash-select-wrap">
                  <select
                    className="dash-select"
                    value={docStatusFilter}
                    onChange={(e) => setDocStatusFilter(e.target.value)}
                  >
                    <option value="all">All Status</option>
                    {Object.entries(STATUS_META).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined dash-select-icon">expand_more</span>
                </div>

                <div className="dash-controls-spacer" />
                <div className="dash-count">
                  <span className="material-symbols-outlined dash-count-icon">info</span>
                  <span>{filteredDocs.length} document{filteredDocs.length === 1 ? '' : 's'}</span>
                </div>

                <button type="button" className="dash-upload-btn" onClick={handleUploadClick}>
                  <span className="material-symbols-outlined dash-upload-icon">add</span>
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

              {docActionError && <p className="dash-action-error">{docActionError}</p>}

              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Filename</th>
                      <th>Owner</th>
                      <th>Status</th>
                      <th>Uploaded</th>
                      <th className="dash-th-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docLoading ? (
                      <tr><td colSpan={5} className="dash-empty">Loading documents…</td></tr>
                    ) : docError ? (
                      <tr><td colSpan={5} className="dash-empty dash-empty--error">{docError}</td></tr>
                    ) : docPageRows.length === 0 ? (
                      <tr><td colSpan={5} className="dash-empty">No documents match your filters.</td></tr>
                    ) : docPageRows.map((doc) => {
                      const meta = STATUS_META[doc.status] ?? { label: doc.status, cls: '' };
                      return (
                        <tr key={doc.id} className="dash-row">
                          <td>
                            <div className="dash-file">
                              <span className="material-symbols-outlined dash-file-icon">
                                {FILE_ICON[doc.file_type] ?? 'description'}
                              </span>
                              <span className="dash-file-name">{doc.original_filename}</span>
                            </div>
                          </td>
                          <td>
                            <span className="dash-uploaded admin-owner-id">{ownerLabel(doc.owner_id)}</span>
                          </td>
                          <td>
                            <div className={`dash-status ${meta.cls}`}>
                              <span className="dash-status-dot" />
                              <span className="dash-status-label">{meta.label}</span>
                            </div>
                          </td>
                          <td>
                            <span className="dash-uploaded">{formatDate(doc.uploaded_at)}</span>
                          </td>
                          <td className="dash-td-right">
                            <div className="dash-actions">
                              <button
                                type="button"
                                className="dash-actions-btn"
                                aria-label="Document actions"
                                onClick={() => setDocRowMenu((r) => (r === doc.id ? null : doc.id))}
                              >
                                <span className="material-symbols-outlined">more_vert</span>
                              </button>
                              {docRowMenu === doc.id && (
                                <div className="dash-row-menu" role="menu">
                                  <button type="button" className="dash-menu-item" onClick={() => handleView(doc)}>
                                    <span className="material-symbols-outlined dash-menu-icon">visibility</span>
                                    View
                                  </button>
                                  <button type="button" className="dash-menu-item" onClick={() => handleDownload(doc)}>
                                    <span className="material-symbols-outlined dash-menu-icon">download</span>
                                    Download
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!docLoading && !docError && filteredDocs.length > PAGE_SIZE && (
                <div className="dash-pagination">
                  <span className="dash-pagination-info">
                    Showing {docStart + 1} to {docStart + docPageRows.length} of {filteredDocs.length} entries
                  </span>
                  <div className="dash-pagination-controls">
                    <button type="button" className="dash-page-btn" disabled={docCurrentPage <= 1} onClick={() => setDocPage((p) => Math.max(1, p - 1))} aria-label="Previous page">
                      <span className="material-symbols-outlined">chevron_left</span>
                    </button>
                    {Array.from({ length: docPageCount }, (_, i) => i + 1).map((p) => (
                      <button key={p} type="button" className={`dash-page-btn ${p === docCurrentPage ? 'dash-page-btn--active' : ''}`} onClick={() => setDocPage(p)} aria-current={p === docCurrentPage ? 'page' : undefined}>{p}</button>
                    ))}
                    <button type="button" className="dash-page-btn" disabled={docCurrentPage >= docPageCount} onClick={() => setDocPage((p) => Math.min(docPageCount, p + 1))} aria-label="Next page">
                      <span className="material-symbols-outlined">chevron_right</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {/* ── Users tab ── */}
          {tab === 'users' && (
            <>
              <div className="dash-controls">
                <div className="dash-search">
                  <span className="material-symbols-outlined dash-search-icon">search</span>
                  <input
                    type="text"
                    className="dash-search-input"
                    placeholder="Search by name or email…"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                  />
                </div>

                <div className="dash-filter-wrap" ref={filterMenuRef}>
                  <button
                    type="button"
                    className={`dash-filter-btn ${activeFilterCount > 0 ? 'dash-filter-btn--active' : ''}`}
                    aria-haspopup="true"
                    aria-expanded={filterMenuOpen}
                    onClick={() => setFilterMenuOpen((o) => !o)}
                  >
                    <span className="material-symbols-outlined">tune</span>
                    Filters
                    {activeFilterCount > 0 && (
                      <span className="dash-filter-badge">{activeFilterCount}</span>
                    )}
                  </button>

                  {filterMenuOpen && (
                    <div className="dash-filter-panel" role="menu">
                      <div className="dash-filter-section">
                        <div className="dash-filter-heading">Role</div>
                        {USER_ROLE_OPTIONS.map(([val, label]) => (
                          <label key={val} className="dash-filter-check">
                            <input
                              type="checkbox"
                              checked={filterRoles.includes(val)}
                              onChange={() => toggleRole(val)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>

                      <div className="dash-filter-section">
                        <div className="dash-filter-heading">Status</div>
                        {USER_STATUS_OPTIONS.map(([val, label]) => (
                          <label key={val} className="dash-filter-check">
                            <input
                              type="checkbox"
                              checked={filterStatuses.includes(val)}
                              onChange={() => toggleStatus(val)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>

                      <div className="dash-filter-section">
                        <div className="dash-filter-heading">Sort by</div>
                        {USER_SORT_OPTIONS.map((opt) => {
                          const active = sortCriteria.find((s) => s.key === opt.key);
                          return (
                            <div key={opt.key} className="dash-filter-sort-row">
                              <label className="dash-filter-check">
                                <input
                                  type="checkbox"
                                  checked={!!active}
                                  onChange={() => toggleSort(opt.key, opt.defaultDir)}
                                />
                                {opt.label}
                              </label>
                              {active && (
                                <button
                                  type="button"
                                  className="dash-filter-dir"
                                  onClick={() => flipSortDir(opt.key)}
                                >
                                  {active.dir === 'asc' ? opt.asc : opt.desc}
                                  <span className="material-symbols-outlined">
                                    {active.dir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                                  </span>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="dash-filter-foot">
                        <button type="button" className="dash-filter-reset" onClick={resetFilters}>
                          Reset
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="dash-controls-spacer" />
                <div className="dash-count">
                  <span className="material-symbols-outlined dash-count-icon">info</span>
                  <span>{filteredUsers.length} user{filteredUsers.length === 1 ? '' : 's'}</span>
                </div>
              </div>

              {userActionError && <p className="dash-action-error">{userActionError}</p>}

              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th className="dash-th-center">Role</th>
                      <th className="dash-th-center">Status</th>
                      <th className="dash-th-center">Documents</th>
                      <th className="dash-th-center">Joined</th>
                      <th className="dash-th-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userLoading ? (
                      <tr><td colSpan={6} className="dash-empty">Loading users…</td></tr>
                    ) : userError ? (
                      <tr><td colSpan={6} className="dash-empty dash-empty--error">{userError}</td></tr>
                    ) : userPageRows.length === 0 ? (
                      <tr><td colSpan={6} className="dash-empty">No users match your filters.</td></tr>
                    ) : userPageRows.map((u) => {
                      const roleMeta   = USER_ROLE_META[u.role]     ?? { label: u.role,   cls: '' };
                      const statusMeta = USER_STATUS_META[u.status]  ?? { label: u.status, cls: '' };
                      return (
                        <tr key={u.id} className="dash-row">
                          <td>
                            <div className="admin-applicant">
                              <span className="admin-applicant-name">{u.username || '—'}</span>
                              <span className="admin-applicant-email">{u.email || '—'}</span>
                            </div>
                          </td>
                          <td className="dash-td-center">
                            <span className={`admin-badge ${roleMeta.cls}`}>{roleMeta.label}</span>
                          </td>
                          <td className="dash-td-center">
                            <span className={`admin-badge ${statusMeta.cls}`}>{statusMeta.label}</span>
                          </td>
                          <td className="dash-td-center">
                            <span className="dash-uploaded">{docCountByOwner[u.id] ?? 0}</span>
                          </td>
                          <td className="dash-td-center">
                            <span className="dash-uploaded">{formatDate(u.created_at)}</span>
                          </td>
                          <td className="dash-td-right">
                            {u.id === currentUserId ? (
                              <span className="admin-reviewed-by">You</span>
                            ) : confirmDeleteId === u.id ? (
                              <div className="admin-action-btns">
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--reject"
                                  disabled={busyDelete}
                                  onClick={() => handleDeleteUser(u.id)}
                                >
                                  {busyDelete
                                    ? <span className="material-symbols-outlined">progress_activity</span>
                                    : <><span className="material-symbols-outlined">delete</span>Confirm</>
                                  }
                                </button>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--approve"
                                  disabled={busyDelete}
                                  onClick={() => setConfirmDeleteId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : confirmPwResetId === u.id ? (
                              <div className="admin-action-btns">
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--action"
                                  disabled={busyPwReset}
                                  onClick={() => handleResetPassword(u.id)}
                                >
                                  {busyPwReset
                                    ? <span className="material-symbols-outlined">progress_activity</span>
                                    : <><span className="material-symbols-outlined">password</span>Confirm</>
                                  }
                                </button>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--approve"
                                  disabled={busyPwReset}
                                  onClick={() => setConfirmPwResetId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : confirmMfaId === u.id ? (
                              <div className="admin-action-btns">
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--action"
                                  disabled={busyMfa}
                                  onClick={() => handleResetMfa(u.id)}
                                >
                                  {busyMfa
                                    ? <span className="material-symbols-outlined">progress_activity</span>
                                    : <><span className="material-symbols-outlined">lock_reset</span>Confirm</>
                                  }
                                </button>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--approve"
                                  disabled={busyMfa}
                                  onClick={() => setConfirmMfaId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="dash-actions">
                                <button
                                  type="button"
                                  className="dash-actions-btn"
                                  aria-label="User actions"
                                  onClick={() => setUserRowMenu((r) => (r === u.id ? null : u.id))}
                                >
                                  <span className="material-symbols-outlined">more_vert</span>
                                </button>
                                {userRowMenu === u.id && (
                                  <div className="dash-row-menu" role="menu">
                                    <button
                                      type="button"
                                      className="dash-menu-item"
                                      onClick={() => { setUserRowMenu(null); setDocsModalUser(u); }}
                                    >
                                      <span className="material-symbols-outlined dash-menu-icon">folder_open</span>
                                      View Uploaded Documents
                                    </button>
                                    <button
                                      type="button"
                                      className="dash-menu-item"
                                      onClick={() => { setUserRowMenu(null); setUserActionError(''); setConfirmPwResetId(u.id); }}
                                    >
                                      Reset Password
                                    </button>
                                    <button
                                      type="button"
                                      className="dash-menu-item"
                                      onClick={() => { setUserRowMenu(null); setUserActionError(''); setConfirmMfaId(u.id); }}
                                    >
                                      Reset MFA
                                    </button>
                                    <button
                                      type="button"
                                      className="dash-menu-item"
                                      onClick={() => { setUserRowMenu(null); setUserActionError(''); setConfirmDeleteId(u.id); }}
                                    >
                                      <span className="material-symbols-outlined dash-menu-icon">delete</span>
                                      Remove
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!userLoading && !userError && filteredUsers.length > PAGE_SIZE && (
                <div className="dash-pagination">
                  <span className="dash-pagination-info">
                    Showing {userStart + 1} to {userStart + userPageRows.length} of {filteredUsers.length} entries
                  </span>
                  <div className="dash-pagination-controls">
                    <button type="button" className="dash-page-btn" disabled={userCurrentPage <= 1} onClick={() => setUserPage((p) => Math.max(1, p - 1))} aria-label="Previous page">
                      <span className="material-symbols-outlined">chevron_left</span>
                    </button>
                    {Array.from({ length: userPageCount }, (_, i) => i + 1).map((p) => (
                      <button key={p} type="button" className={`dash-page-btn ${p === userCurrentPage ? 'dash-page-btn--active' : ''}`} onClick={() => setUserPage(p)} aria-current={p === userCurrentPage ? 'page' : undefined}>{p}</button>
                    ))}
                    <button type="button" className="dash-page-btn" disabled={userCurrentPage >= userPageCount} onClick={() => setUserPage((p) => Math.min(userPageCount, p + 1))} aria-label="Next page">
                      <span className="material-symbols-outlined">chevron_right</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {/* ── User documents modal ── */}
      {docsModalUser && (() => {
        const userDocs = documents.filter((d) => d.owner_id === docsModalUser.id);
        return (
          <div
            className="admin-modal-overlay"
            role="presentation"
            onClick={() => setDocsModalUser(null)}
          >
            <div
              className="admin-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Uploaded documents"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="admin-modal-head">
                <div className="admin-modal-titles">
                  <span className="dash-eyebrow">Uploaded Documents</span>
                  <h2 className="admin-modal-title">{docsModalUser.username || docsModalUser.email || 'User'}</h2>
                </div>
                <button
                  type="button"
                  className="admin-modal-close"
                  aria-label="Close"
                  onClick={() => setDocsModalUser(null)}
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="admin-modal-body">
                {userDocs.length === 0 ? (
                  <p className="dash-empty">This user has not uploaded any documents.</p>
                ) : (
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
                      {userDocs.map((doc) => {
                        const meta = STATUS_META[doc.status] ?? { label: doc.status, cls: '' };
                        return (
                          <tr key={doc.id} className="dash-row">
                            <td>
                              <div className="dash-file">
                                <span className="material-symbols-outlined dash-file-icon">
                                  {FILE_ICON[doc.file_type] ?? 'description'}
                                </span>
                                <span className="dash-file-name">{doc.original_filename}</span>
                              </div>
                            </td>
                            <td>
                              <div className={`dash-status ${meta.cls}`}>
                                <span className="dash-status-dot" />
                                <span className="dash-status-label">{meta.label}</span>
                              </div>
                            </td>
                            <td>
                              <span className="dash-uploaded">{formatDate(doc.uploaded_at)}</span>
                            </td>
                            <td className="dash-td-right">
                              <div className="admin-action-btns">
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--action"
                                  onClick={() => handleView(doc)}
                                >
                                  <span className="material-symbols-outlined">visibility</span>
                                  View
                                </button>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--action"
                                  onClick={() => handleDownload(doc)}
                                >
                                  <span className="material-symbols-outlined">download</span>
                                  Download
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      <footer className="dash-footer">
        <div className="dash-footer-inner">
          <div className="dash-footer-brand-block">
            <span className="dash-footer-brand">PromptPatrol</span>
            <p className="dash-footer-copy">© 2026 PromptPatrol — Senior Project. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
