import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import logo from './PromptPatrol.png';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      const msg = signInError.message ?? '';
      if (msg.toLowerCase().includes('banned') || msg.toLowerCase().includes('user banned')) {
        setError('Your account is pending admin approval. You will be notified once it is reviewed.');
      } else {
        setError(msg);
      }
      setLoading(false);
      return;
    }

    const { data: factors } = await supabase.auth.mfa.listFactors();

    const hasMFA = factors?.totp?.length > 0;
    if (!hasMFA) {
      navigate('/mfa');
      return;
    }

    navigate('/mfa');
  }

  async function handleForgot(e) {
    e.preventDefault();
    setForgotError('');
    setForgotLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (resetError) {
      setForgotError(resetError.message);
    } else {
      setForgotSent(true);
    }
    setForgotLoading(false);
  }

  return (
    <div className="login-page">
      <main className="login-main">
        <div className="login-logo-wrapper">
          <img src={logo} alt="Prompt Patrol" className="login-logo" />
        </div>

        {forgotMode ? (
          <>
            <h1 className="login-heading">Reset password</h1>
            <p className="login-subtitle">We'll send a reset link to your email address.</p>

            {forgotSent ? (
              <p className="login-success">Check your inbox — a reset link is on its way.</p>
            ) : (
              <form className="login-form" onSubmit={handleForgot}>
                <div className="login-field">
                  <label htmlFor="forgot-email">EMAIL ADDRESS</label>
                  <input
                    id="forgot-email"
                    type="email"
                    placeholder="name@company.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                  />
                </div>

                {forgotError && <p className="login-error">{forgotError}</p>}

                <button type="submit" className="login-btn" disabled={forgotLoading}>
                  {forgotLoading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            )}

            <div className="login-links">
              <button
                type="button"
                className="login-forgot"
                onClick={() => { setForgotMode(false); setForgotSent(false); setForgotError(''); }}
              >
                Back to sign in
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="login-heading">
              Sign in to<br />Prompt Patrol
            </h1>
            <p className="login-subtitle">Secure PII redaction for financial analysts.</p>

            <form className="login-form" onSubmit={handleSubmit}>
              <div className="login-field">
                <label htmlFor="email">EMAIL ADDRESS</label>
                <input
                  id="email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="login-field">
                <label htmlFor="password">PASSWORD</label>
                <input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && <p className="login-error">{error}</p>}

              <button type="submit" className="login-btn" disabled={loading}>
                {loading ? 'Signing in…' : 'Continue'}
              </button>
            </form>

            <div className="login-links">
              <button
                type="button"
                className="login-forgot"
                onClick={() => { setForgotMode(true); setForgotEmail(email); }}
              >
                Forgot password?
              </button>
              <span className="login-or">or</span>
              <Link to="/request-account" className="login-signup-link">Don't have an account?</Link>
            </div>
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
