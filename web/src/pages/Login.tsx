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
    <div className="h-full flex items-center justify-center bg-base-100">
      <form onSubmit={handleSubmit} className="w-70 flex flex-col gap-2.5">
        <div className="text-base-content text-sm font-medium mb-2">Sign in</div>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="input input-sm bg-base-300 border-neutral text-base-content text-xs w-full"
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          className="input input-sm bg-base-300 border-neutral text-base-content text-xs w-full"
        />

        {error && <div className="text-error text-[11px]">{error}</div>}

        <button
          type="submit"
          disabled={loading}
          className="btn btn-sm bg-neutral border-neutral-content/20 text-base-content text-xs mt-1"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
