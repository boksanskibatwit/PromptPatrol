import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function MFA() {
  const [factorId, setFactorId] = useState(null);
  const [qr, setQr] = useState(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();

  useEffect(() => {
    async function setupMFA() {
      setLoading(true);

      const { data } = await supabase.auth.mfa.listFactors();

      if (data?.totp?.length > 0) {
        setFactorId(data.totp[0].id);
        setLoading(false);
        return;
      }

      const { data: enroll, error } =
        await supabase.auth.mfa.enroll({
          factorType: 'totp',
        });

      if (error) {
        alert(error.message);
        setLoading(false);
        return;
      }

      setFactorId(enroll.id);
      setQr(enroll.totp.qr_code);
      setLoading(false);
    }

    setupMFA();
  }, []);

  async function verifyMFA() {
  if (!factorId) return;

  
  const { data: challenge, error: challengeError } =
    await supabase.auth.mfa.challenge({ factorId });

  if (challengeError) {
    alert(challengeError.message);
    return;
  }

  //verify
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });

  if (error) {
    alert('Invalid MFA code');
    return;
  }


  navigate('/dashboard');
}

  if (loading) return <h2>Loading MFA...</h2>;

  return (
    <div style={{ padding: 20 }}>
      <h1>MFA Authentication</h1>

      {qr && (
        <>
          <p>Scan this in Google Authenticator:</p>
          <img src={qr} alt="QR Code" />
        </>
      )}

      <input
        type="text"
        placeholder="6-digit code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />

      <button onClick={verifyMFA}>Verify</button>
    </div>
  );
}