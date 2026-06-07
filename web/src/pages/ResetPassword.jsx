import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import logo from './PromptPatrol.png';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Supabase parses the reset token from the URL hash and emits PASSWORD_RECOVERY.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });

    // Fallback: if a session already exists from the hash being processed synchronously.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    // If no recovery event arrives within 5 s the link is invalid or expired.
    const timer = setTimeout(() => setInvalid((prev) => { if (!prev) return true; return prev; }), 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  // Suppress the invalid flag once ready.
  const showInvalid = invalid && !ready;

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setError('');
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    }
    setLoading(false);
  }

  return (
    <div className="login-page">
      <main className="login-main">
        <div className="login-logo-wrapper">
          <img src={logo} alt="Prompt Patrol" className="login-logo" />
        </div>

        <h1 className="login-heading">Set new password</h1>

        {showInvalid ? (
          <>
            <p className="login-error">This reset link is invalid or has expired.</p>
            <div className="login-links">
              <button type="button" className="login-forgot" onClick={() => navigate('/login')}>
                Back to sign in
              </button>
            </div>
          </>
        ) : !ready ? (
          <p className="login-subtitle">Verifying reset link…</p>
        ) : success ? (
          <>
            <p className="login-success">Password updated. Redirecting you to sign in…</p>
          </>
        ) : (
          <>
            <p className="login-subtitle">Choose a new password for your account.</p>

            <form className="login-form" onSubmit={handleSubmit}>
              <div className="login-field">
                <label htmlFor="new-password">NEW PASSWORD</label>
                <input
                  id="new-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div className="login-field">
                <label htmlFor="confirm-password">CONFIRM PASSWORD</label>
                <input
                  id="confirm-password"
                  type="password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>

              {error && <p className="login-error">{error}</p>}

              <button type="submit" className="login-btn" disabled={loading}>
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </>
        )}
      </main>

      <footer className="login-footer">
        <strong className="login-footer-brand">Prompt Patrol</strong>
        <span className="login-footer-copy">&copy; 2026 PROMPT PATROL &ndash; SENIOR PROJECT</span>
      </footer>
    </div>
  );
}
