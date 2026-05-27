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

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
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

  return (
    <div className="login-page">
      <main className="login-main">
        <div className="login-logo-wrapper">
          <img src={logo} alt="Prompt Patrol" className="login-logo" />
        </div>

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
          <a href="#" className="login-forgot">Forgot password?</a>
          <span className="login-or">or</span>
          <Link to="/request-account" className="login-signup-link">Don't have an account?</Link>
        </div>
      </main>

      <footer className="login-footer">
        <strong className="login-footer-brand">Prompt Patrol</strong>
        <span className="login-footer-copy">&copy; 2026 PROMPT PATROL &ndash; SENIOR PROJECT</span>
      </footer>
    </div>
  );
}
