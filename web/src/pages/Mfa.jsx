import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function MFA() {
  const [factorId, setFactorId] = useState(null);
  const [qr, setQr] = useState(null);
  const [manualKey, setManualKey] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [isEnrollment, setIsEnrollment] = useState(false);
  const [copied, setCopied] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    async function setupMFA() {
      setLoading(true);

      const { data } = await supabase.auth.mfa.listFactors();
      const factors = data?.totp ?? [];

      // Check if the user has a VERIFIED factor — go straight to verify
      const verifiedFactor = factors.find((f) => f.status === 'verified');
      if (verifiedFactor) {
        setFactorId(verifiedFactor.id);
        setIsEnrollment(false);
        setLoading(false);
        return;
      }

      // Clean up any leftover UNVERIFIED factors from previous attempts
      // so we can enroll fresh without a "friendly name already exists" error
      for (const stale of factors.filter((f) => f.status === 'unverified')) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
      }

      // Enroll a new TOTP factor
      const { data: enroll, error: enrollError } =
        await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: `PromptPatrol-${Date.now()}`,
        });

      if (enrollError) {
        setError(enrollError.message);
        setLoading(false);
        return;
      }

      setFactorId(enroll.id);
      setQr(enroll.totp.qr_code);
      setIsEnrollment(true);

      // Extract the secret from the TOTP URI for manual entry
      // URI format: otpauth://totp/...?secret=XXXX&...
      if (enroll.totp.uri) {
        const match = enroll.totp.uri.match(/secret=([A-Z0-9]+)/i);
        if (match) {
          const raw = match[1];
          // Format as groups of 4 for readability
          setManualKey(raw.match(/.{1,4}/g)?.join(' ') || raw);
        }
      }

      setLoading(false);
    }

    setupMFA();
  }, []);

  async function handleVerify(e) {
    e?.preventDefault();
    if (!factorId || !code) return;

    setError('');
    setVerifying(true);

    // Challenge
    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId });

    if (challengeError) {
      setError(challengeError.message);
      setVerifying(false);
      return;
    }

    // Verify
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });

    if (verifyError) {
      setError('Invalid code. Check your authenticator app and try again.');
      setVerifying(false);
      return;
    }

    navigate('/dashboard');
  }

  function handleCodeInput(e) {
    // Only allow digits, max 6
    const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
    setCode(digits);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(manualKey.replace(/\s/g, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback — select the input
    }
  }

  /* ── Loading state ── */
  if (loading) {
    return (
      <div className="mfa-page">
        <main className="mfa-main">
          <p className="mfa-loading">Setting up MFA…</p>
        </main>
      </div>
    );
  }

  /* ── Returning user: just verify ── */
  if (!isEnrollment) {
    return (
      <div className="mfa-page">
        <main className="mfa-main">
          <div className="mfa-card mfa-card--narrow">
            <div className="mfa-breadcrumb">
              <span className="mfa-breadcrumb-label">Security Protocol</span>
              <span className="mfa-breadcrumb-line" />
              <span className="mfa-breadcrumb-step">MFA Verify</span>
            </div>

            <h1 className="mfa-heading">Two-factor authentication</h1>
            <p className="mfa-description">
              Enter the 6-digit code from your authenticator app to continue.
            </p>

            <form className="mfa-verify-form" onSubmit={handleVerify}>
              <div className="mfa-field">
                <label htmlFor="auth-code">Verification Code</label>
                <input
                  id="auth-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={handleCodeInput}
                  className="mfa-code-input"
                  autoFocus
                />
              </div>

              {error && <p className="mfa-error">{error}</p>}

              <button
                type="submit"
                className="mfa-btn"
                disabled={verifying || code.length < 6}
              >
                {verifying ? 'Verifying…' : 'Verify'}
              </button>
            </form>
          </div>
        </main>

        <footer className="mfa-footer">
          <div className="mfa-footer-inner">
            <strong className="mfa-footer-brand">PromptPatrol</strong>
            <span className="mfa-footer-copy">&copy; 2026 Prompt Patrol</span>
          </div>
        </footer>
      </div>
    );
  }

  /* ── First-time enrollment ── */
  return (
    <div className="mfa-page">
      <main className="mfa-main">
        <div className="mfa-card">
          {/* Decorative corner accent */}
          <div className="mfa-corner-accent" />

          {/* Breadcrumb */}
          <div className="mfa-breadcrumb">
            <span className="mfa-breadcrumb-label">Security Protocol</span>
            <span className="mfa-breadcrumb-line" />
            <span className="mfa-breadcrumb-step">MFA 3.0</span>
          </div>

          {/* Header */}
          <div className="mfa-header">
            <h1 className="mfa-heading">Enroll Google Authenticator</h1>
            <p className="mfa-description">
              Enhance your workspace security by linking your account to a
              trusted device. Scan the cryptographic token to begin.
            </p>
          </div>

          {/* Setup area — two columns */}
          <div className="mfa-setup">
            {/* Left: QR Code */}
            <div className="mfa-qr-section">
              <span className="mfa-step-label">1. Scan this QR code</span>
              <div className="mfa-qr-frame">
                {qr ? (
                  <img src={qr} alt="MFA QR Code" className="mfa-qr-img" />
                ) : (
                  <div className="mfa-qr-placeholder" />
                )}
              </div>
              <p className="mfa-qr-caption">
                Scan this QR code with your authenticator app
              </p>
            </div>

            {/* Right: Manual key + verification */}
            <div className="mfa-right-section">
              {/* Manual backup key */}
              <div className="mfa-manual">
                <label className="mfa-step-label" htmlFor="manual-key">
                  2. Manual Backup
                </label>
                <div className="mfa-manual-input-wrapper">
                  <input
                    id="manual-key"
                    type="text"
                    readOnly
                    value={manualKey}
                    className="mfa-manual-input"
                  />
                  <button
                    type="button"
                    className="mfa-copy-btn"
                    onClick={handleCopy}
                    title="Copy key"
                  >
                    {copied ? '✓' : '⎘'}
                  </button>
                </div>
                <p className="mfa-hint">
                  Or enter the key manually if your camera is unavailable.
                </p>
              </div>

              {/* Verification code */}
              <form className="mfa-verify-section" onSubmit={handleVerify}>
                <label className="mfa-step-label" htmlFor="enroll-code">
                  3. Verification
                </label>
                <input
                  id="enroll-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000 000"
                  value={code}
                  onChange={handleCodeInput}
                  className="mfa-code-input"
                />
                <p className="mfa-hint">
                  Then enter the 6-digit code generated by your app.
                </p>

                {error && <p className="mfa-error">{error}</p>}

                <button
                  type="submit"
                  className="mfa-btn"
                  disabled={verifying || code.length < 6}
                >
                  {verifying ? 'Enabling…' : 'Enable Two-Factor'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>

      <footer className="mfa-footer">
        <div className="mfa-footer-inner">
          <strong className="mfa-footer-brand">PromptPatrol</strong>
          <span className="mfa-footer-copy">&copy; 2026 Prompt Patrol</span>
        </div>
      </footer>
    </div>
  );
}
