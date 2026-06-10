import { Outlet } from 'react-router-dom';

export default function AppLayout() {
  return (
    <div style={{ display: 'flex', height: '100%', background: '#0a0a0a' }}>
      <Outlet />
    </div>
  );
}
