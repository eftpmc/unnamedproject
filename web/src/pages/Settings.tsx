import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
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
    <div className="text-base-content/40 text-xs uppercase tracking-wider mb-3 mt-9">
      {children}
    </div>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn btn-ghost btn-sm btn-square text-base-content/30 hover:text-error" title="Delete">
      <Trash2 size={15} strokeWidth={1.75} />
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

  const inputCls = "input bg-base-300 border-none rounded-xl text-base-content text-sm w-full font-inherit";
  const btnPrimaryCls = "btn rounded-full bg-base-content text-base-100 border-none hover:opacity-90 text-sm";
  const btnCancelCls = "btn btn-ghost rounded-full text-base-content/40 text-sm";
  const rowCls = "flex items-center py-3 border-b border-base-300 gap-3";

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8 max-w-2xl">
      <div className="text-base-content text-xl font-medium mb-1">Settings</div>

      {/* Connections */}
      <SectionHeader>Connections</SectionHeader>
      {connections.map(c => (
        <div key={c.id} className={rowCls}>
          <div className="flex-1 text-base-content/70 text-sm">{c.name}</div>
          <div className="badge bg-base-300 border-none text-base-content/40 text-xs">{c.type}</div>
          <DeleteBtn onClick={() => deleteConnMutation.mutate(c.id)} />
        </div>
      ))}
      {!showConnForm && (
        <button onClick={() => setShowConnForm(true)} className={`${btnPrimaryCls} mt-3`}>Add connection</button>
      )}
      {showConnForm && (
        <div className="flex flex-col gap-3 mt-3">
          <input placeholder="Name" value={connName} onChange={e => setConnName(e.target.value)} className={inputCls} />
          <select value={connType} onChange={e => setConnType(e.target.value)} className="select bg-base-300 border-none rounded-xl text-base-content text-sm w-full font-inherit">
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
            className="textarea bg-base-300 border-none rounded-xl text-base-content text-sm w-full font-mono resize-y"
          />
          {connError && <div className="text-error text-sm">{connError}</div>}
          <div className="flex gap-2">
            <button onClick={() => createConnMutation.mutate()} className={btnPrimaryCls} disabled={!connName.trim()}>Save</button>
            <button onClick={() => { setShowConnForm(false); setConnError(''); }} className={btnCancelCls}>Cancel</button>
          </div>
        </div>
      )}

      {/* Workspaces */}
      <SectionHeader>Workspaces</SectionHeader>
      {workspaces.map(w => (
        <div key={w.id} className={rowCls}>
          <div className="flex-1">
            <div className="text-base-content/70 text-sm">{w.name}</div>
            {w.description && <div className="text-base-content/30 text-xs mt-0.5">{w.description}</div>}
          </div>
          <DeleteBtn onClick={() => deleteWsMutation.mutate(w.id)} />
        </div>
      ))}
      {!showWsForm && (
        <button onClick={() => setShowWsForm(true)} className={`${btnPrimaryCls} mt-3`}>Add workspace</button>
      )}
      {showWsForm && (
        <div className="flex flex-col gap-3 mt-3">
          <input placeholder="Name" value={wsName} onChange={e => setWsName(e.target.value)} className={inputCls} />
          <input placeholder="Description (optional)" value={wsDesc} onChange={e => setWsDesc(e.target.value)} className={inputCls} />
          <input placeholder="Repo path (optional)" value={wsRepo} onChange={e => setWsRepo(e.target.value)} className={inputCls} />
          {connections.length > 0 && (
            <div>
              <div className="text-base-content/40 text-xs mb-2">Connections</div>
              {connections.map(c => (
                <label key={c.id} className="flex items-center gap-2 mb-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wsConnIds.includes(c.id)}
                    onChange={e => setWsConnIds(prev => e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id))}
                    className="checkbox checkbox-sm"
                  />
                  <span className="text-base-content/60 text-sm">{c.name} ({c.type})</span>
                </label>
              ))}
            </div>
          )}
          {wsError && <div className="text-error text-sm">{wsError}</div>}
          <div className="flex gap-2">
            <button onClick={() => createWsMutation.mutate()} className={btnPrimaryCls} disabled={!wsName.trim()}>Save</button>
            <button onClick={() => { setShowWsForm(false); setWsError(''); }} className={btnCancelCls}>Cancel</button>
          </div>
        </div>
      )}

      {/* Memory */}
      <SectionHeader>Memory</SectionHeader>
      {Object.keys(memory).length === 0 ? (
        <div className="text-base-content/30 text-sm">No memory stored yet.</div>
      ) : (
        <div className="bg-base-300 rounded-2xl overflow-hidden">
          {Object.entries(memory).map(([k, v], i) => (
            <div key={k} className={`flex items-center gap-3 px-4 py-3 ${i < Object.keys(memory).length - 1 ? 'border-b border-base-200' : ''}`}>
              <div className="w-35 text-base-content/50 text-sm font-mono shrink-0">{k}</div>
              <div className="flex-1 text-base-content/70 text-sm">{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Account */}
      <SectionHeader>Account</SectionHeader>
      <button onClick={handleSignOut} className="btn rounded-full bg-error/10 border-none text-error hover:bg-error/20 text-sm">Sign out</button>
    </div>
  );
}
