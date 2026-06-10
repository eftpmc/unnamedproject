import { Navigate } from 'react-router-dom';
import { getToken } from '../lib/auth.js';

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
