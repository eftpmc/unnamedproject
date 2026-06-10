import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getConnections, createConnection, deleteConnection,
  getWorkspaces, createWorkspace, deleteWorkspace,
  getMemory,
} from '../lib/api.js';
import { clearToken } from '../lib/auth.js';
import { useNavigate } from 'react-router-dom';
import type { Connection, Workspace } from '../types.js';

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: '#555555', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, marginTop: 28 }}>
      {children}
    </div>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#333', fontSize: 11, padding: '0 4px' }} title="Delete">
      ×
    </button>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: connections = [] } = useQuery<Connection[]>({ queryKey: ['connections'], queryFn: getConnections });
  const { data: workspaces = [] } = useQuery<Workspace[]>({ queryKey: ['workspaces'], queryFn: getWorkspaces });
  const { data: memory = {} } = useQuery<Record<string, string>>({ queryKey: ['memory'], queryFn: getMemory });

  // Connection form
  const [showConnForm, setShowConnForm] = useState(false);
  const [connName, setConnName] = useState('');
  const [connType, setConnType] = useState('anthropic');
  const [connConfig, setConnConfig] = useState('{}');
  const [connError, setConnError] = useState('');

  const createConnMutation = useMutation({
    mutationFn: () => {
      let config: Record<string, unknown>;
      try { config = JSON.parse(connConfig); } catch { throw new Error('Config must be valid JSON'); }
      return createConnection({ name: connName, type: connType, config });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['connections'] }); setShowConnForm(false); setConnName(''); setConnConfig('{}'); setConnError(''); },
    onError: (e: Error) => setConnError(e.message),
  });

  const deleteConnMutation = useMutation({
    mutationFn: deleteConnection,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });

  // Workspace form
  const [showWsForm, setShowWsForm] = useState(false);
  const [wsName, setWsName] = useState('');
  const [wsDesc, setWsDesc] = useState('');
  const [wsRepo, setWsRepo] = useState('');
  const [wsConnIds, setWsConnIds] = useState<string[]>([]);
  const [wsError, setWsError] = useState('');

  const createWsMutation = useMutation({
    mutationFn: () => createWorkspace({ name: wsName, description: wsDesc || undefined, repo_path: wsRepo || undefined, enabled_connection_ids: wsConnIds }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workspaces'] }); setShowWsForm(false); setWsName(''); setWsDesc(''); setWsRepo(''); setWsConnIds([]); setWsError(''); },
    onError: (e: Error) => setWsError(e.message),
  });

  const deleteWsMutation = useMutation({
    mutationFn: deleteWorkspace,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspaces'] }),
  });

  function handleSignOut() {
    clearToken();
    navigate('/login', { replace: true });
  }

  const inputStyle = {
    background: '#111',
    border: '1px solid #1e1e1e',
    borderRadius: 5,
    padding: '7px 10px',
    color: '#ccc',
    fontSize: 11,
    width: '100%',
    outline: 'none',
    fontFamily: 'inherit',
  };

  const btnPrimary = {
    background: '#1e1e1e',
    border: '1px solid #2a2a2a',
    borderRadius: 5,
    padding: '6px 14px',
    color: '#ccc',
    fontSize: 11,
    cursor: 'pointer',
  };

  const btnCancel = {
    background: 'none',
    border: 'none',
    color: '#444',
    fontSize: 11,
    cursor: 'pointer',
    padding: '6px 8px',
  };

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    padding: '7px 0',
    borderBottom: '1px solid #141414',
    gap: 8,
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', maxWidth: 600 }}>
      <div style={{ color: '#aaa', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Settings</div>

      {/* Connections */}
      <SectionHeader>Connections</SectionHeader>
      {connections.map(c => (
        <div key={c.id} style={rowStyle}>
          <div style={{ flex: 1, color: '#888', fontSize: 11 }}>{c.name}</div>
          <div style={{ color: '#444', fontSize: 9, background: '#141414', border: '1px solid #222', borderRadius: 3, padding: '2px 6px' }}>{c.type}</div>
          <DeleteBtn onClick={() => deleteConnMutation.mutate(c.id)} />
        </div>
      ))}
      {!showConnForm && (
        <button onClick={() => setShowConnForm(true)} style={{ ...btnPrimary, marginTop: 8 }}>Add connection</button>
      )}
      {showConnForm && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          <input placeholder="Name" value={connName} onChange={e => setConnName(e.target.value)} style={inputStyle} />
          <select value={connType} onChange={e => setConnType(e.target.value)} style={{ ...inputStyle }}>
            <option value="anthropic">anthropic</option>
            <option value="openai">openai</option>
            <option value="github">github</option>
            <option value="mcp">mcp</option>
          </select>
          <textarea
            placeholder='Config JSON — e.g. {"apiKey":"sk-..."}'
            value={connConfig}
            onChange={e => setConnConfig(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 10 }}
          />
          {connError && <div style={{ color: '#ef4444', fontSize: 10 }}>{connError}</div>}
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => createConnMutation.mutate()} style={btnPrimary} disabled={!connName.trim()}>Save</button>
            <button onClick={() => { setShowConnForm(false); setConnError(''); }} style={btnCancel}>Cancel</button>
          </div>
        </div>
      )}

      {/* Workspaces */}
      <SectionHeader>Workspaces</SectionHeader>
      {workspaces.map(w => (
        <div key={w.id} style={rowStyle}>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#888', fontSize: 11 }}>{w.name}</div>
            {w.description && <div style={{ color: '#444', fontSize: 9, marginTop: 2 }}>{w.description}</div>}
          </div>
          <DeleteBtn onClick={() => deleteWsMutation.mutate(w.id)} />
        </div>
      ))}
      {!showWsForm && (
        <button onClick={() => setShowWsForm(true)} style={{ ...btnPrimary, marginTop: 8 }}>Add workspace</button>
      )}
      {showWsForm && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          <input placeholder="Name" value={wsName} onChange={e => setWsName(e.target.value)} style={inputStyle} />
          <input placeholder="Description (optional)" value={wsDesc} onChange={e => setWsDesc(e.target.value)} style={inputStyle} />
          <input placeholder="Repo path (optional)" value={wsRepo} onChange={e => setWsRepo(e.target.value)} style={inputStyle} />
          {connections.length > 0 && (
            <div>
              <div style={{ color: '#444', fontSize: 9, marginBottom: 6 }}>Connections</div>
              {connections.map(c => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={wsConnIds.includes(c.id)}
                    onChange={e => setWsConnIds(prev => e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id))}
                  />
                  <span style={{ color: '#666', fontSize: 10 }}>{c.name} ({c.type})</span>
                </label>
              ))}
            </div>
          )}
          {wsError && <div style={{ color: '#ef4444', fontSize: 10 }}>{wsError}</div>}
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => createWsMutation.mutate()} style={btnPrimary} disabled={!wsName.trim()}>Save</button>
            <button onClick={() => { setShowWsForm(false); setWsError(''); }} style={btnCancel}>Cancel</button>
          </div>
        </div>
      )}

      {/* Memory */}
      <SectionHeader>Memory</SectionHeader>
      {Object.keys(memory).length === 0 ? (
        <div style={{ color: '#333', fontSize: 10 }}>No memory stored yet.</div>
      ) : (
        <div style={{ border: '1px solid #1a1a1a', borderRadius: 5, overflow: 'hidden' }}>
          {Object.entries(memory).map(([k, v], i) => (
            <div key={k} style={{ ...rowStyle, padding: '6px 10px', borderBottom: i < Object.keys(memory).length - 1 ? '1px solid #141414' : 'none' }}>
              <div style={{ width: 140, color: '#555', fontSize: 10, fontFamily: 'monospace', flexShrink: 0 }}>{k}</div>
              <div style={{ flex: 1, color: '#888', fontSize: 10 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Account */}
      <SectionHeader>Account</SectionHeader>
      <button onClick={handleSignOut} style={{ ...btnPrimary, color: '#ef4444', borderColor: '#2a1010' }}>Sign out</button>
    </div>
  );
}
