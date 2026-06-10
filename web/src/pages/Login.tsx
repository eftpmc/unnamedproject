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
      <form onSubmit={handleSubmit} className="w-80 flex flex-col gap-3">
        <div className="text-base-content text-xl font-medium mb-2">Sign in</div>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="input bg-base-300 border-none rounded-2xl text-base-content text-[15px] w-full"
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          className="input bg-base-300 border-none rounded-2xl text-base-content text-[15px] w-full"
        />

        {error && <div className="text-error text-sm">{error}</div>}

        <button
          type="submit"
          disabled={loading}
          className="btn rounded-full bg-base-content text-base-100 border-none hover:opacity-90 mt-1"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
