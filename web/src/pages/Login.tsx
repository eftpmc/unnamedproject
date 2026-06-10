import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../lib/api.js';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/s', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0a',
    }}>
      <form onSubmit={handleSubmit} style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ color: '#cccccc', fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Sign in</div>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          style={{
            background: '#111',
            border: '1px solid #1e1e1e',
            borderRadius: 6,
            padding: '8px 12px',
            color: '#ccc',
            fontSize: 12,
            outline: 'none',
          }}
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          style={{
            background: '#111',
            border: '1px solid #1e1e1e',
            borderRadius: 6,
            padding: '8px 12px',
            color: '#ccc',
            fontSize: 12,
            outline: 'none',
          }}
        />

        {error && <div style={{ color: '#ef4444', fontSize: 11 }}>{error}</div>}

        <button
          type="submit"
          disabled={loading}
          style={{
            background: '#1e1e1e',
            border: '1px solid #333',
            borderRadius: 6,
            padding: '8px 12px',
            color: loading ? '#555' : '#ccc',
            fontSize: 12,
            cursor: loading ? 'not-allowed' : 'pointer',
            marginTop: 4,
          }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
