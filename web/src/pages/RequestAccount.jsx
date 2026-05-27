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

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          description,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

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
