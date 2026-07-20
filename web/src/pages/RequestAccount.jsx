import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import logo from './PromptPatrol.png';

export default function RequestAccount() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name, description } },
    });

    if (signUpError) {
      // With email confirmation disabled, Supabase reports duplicate emails
      // directly ("User already registered") — surface it in friendlier terms.
      const msg = signUpError.message ?? '';
      setError(/already registered/i.test(msg)
        ? 'An account with this email already exists. Try logging in or resetting your password.'
        : msg);
      setLoading(false);
      return;
    }

    // NOTE: we intentionally do NOT try to detect a duplicate email here. With
    // "Confirm email" enabled, Supabase returns an empty identities array for
    // EVERY signup (anti-enumeration), so an identities-length check flags all
    // signups as duplicates. Duplicate rejection lives in the backend
    // (/admin/signup-ban checks account_requests), which is authoritative.
    const authUserId = signUpData?.user?.id;
    if (!authUserId) {
      setError('Signup succeeded but user ID was missing. Please try again.');
      setLoading(false);
      return;
    }

    // Tell the backend to record the request and ban the user until approved.
    try {
      const resp = await fetch(`${import.meta.env.VITE_API_URL}/admin/signup-ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_user_id: authUserId,
          email,
          full_name: name,
          description,
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail ?? 'Failed to submit account request.');
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    // Sign the new session out — they must wait for admin approval before logging in.
    await supabase.auth.signOut();
    setSuccess(true);
    setLoading(false);
  }

  if (success) {
    return (
      <div className="req-page">
        <main className="req-main">
          <div className="req-logo-wrapper">
            <img src={logo} alt="Prompt Patrol" className="req-logo" />
          </div>
          <h1 className="req-heading">Request submitted</h1>
          <p className="req-subtitle">
            Check your email to confirm your account. An administrator will
            review your request shortly.
          </p>
          <div className="req-bottom-link">
            <Link to="/login" className="req-signin-link">
              Back to sign in
            </Link>
          </div>
        </main>
        <footer className="req-footer">
          <strong className="req-footer-brand">Prompt Patrol</strong>
          <span className="req-footer-copy">
            &copy; 2026 Prompt Patrol &ndash; Senior Project
          </span>
        </footer>
      </div>
    );
  }

  return (
    <div className="req-page">
      <main className="req-main">
        <div className="req-content">
          {/* Brand Mark */}
          <div className="req-logo-wrapper">
            <img src={logo} alt="Prompt Patrol" className="req-logo" />
          </div>

          {/* Typography Header */}
          <h1 className="req-heading">Request a Prompt Patrol account</h1>
          <p className="req-subtitle">
            Secure PII redaction for financial analysts.
          </p>

          {/* Form Card */}
          <div className="req-card">
            <form className="req-form" onSubmit={handleSubmit}>
              <div className="req-field">
                <label htmlFor="req-name">Full Name</label>
                <input
                  id="req-name"
                  type="text"
                  placeholder="Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="req-field">
                <label htmlFor="req-email">Work Email</label>
                <input
                  id="req-email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="req-field">
                <label htmlFor="req-password">Password</label>
                <input
                  id="req-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div className="req-field">
                <label htmlFor="req-description">Brief Description</label>
                <textarea
                  id="req-description"
                  placeholder="Your supervisor, department, and any additional details."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>

              {error && <p className="req-error">{error}</p>}

              <button type="submit" className="req-btn" disabled={loading}>
                {loading ? 'Submitting…' : 'Request access'}
              </button>
            </form>
          </div>

          {/* Bottom Navigation Link */}
          <div className="req-bottom-link">
            <p>
              Already have an account?{' '}
              <Link to="/login" className="req-signin-link">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </main>

      <footer className="req-footer">
        <strong className="req-footer-brand">Prompt Patrol</strong>
        <span className="req-footer-copy">
          &copy; 2026 Prompt Patrol &ndash; Senior Project
        </span>
      </footer>
    </div>
  );
}
