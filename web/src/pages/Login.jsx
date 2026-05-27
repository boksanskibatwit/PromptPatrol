import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import logo from './PromptPatrol.png';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

async function handleSubmit(e) {
  e.preventDefault();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    alert(error.message);
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
    <div className='login'>
      <img src={logo} alt="PromptPatrol" width="300" />
      <h1>Login</h1>

      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button type="submit">Sign in</button>
      </form>
    </div>
  );
}