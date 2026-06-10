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
    <div className="text-[#555555] text-[9px] uppercase tracking-wider mb-2.5 mt-7">
      {children}
    </div>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn btn-ghost btn-xs min-h-0 h-auto py-0 px-1 text-[#333333] text-[11px]" title="Delete">
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

  const inputCls = "input input-sm bg-base-300 border-neutral text-base-content text-[11px] w-full font-inherit";
  const btnPrimaryCls = "btn btn-sm bg-neutral border-neutral-content/20 text-base-content text-[11px]";
  const btnCancelCls = "btn btn-ghost btn-sm text-[#444444] text-[11px]";
  const rowCls = "flex items-center py-1.5 border-b border-[#141414] gap-2";

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 max-w-150">
      <div className="text-[#aaaaaa] text-sm font-medium mb-1">Settings</div>

      {/* Connections */}
      <SectionHeader>Connections</SectionHeader>
      {connections.map(c => (
        <div key={c.id} className={rowCls}>
          <div className="flex-1 text-[#888888] text-[11px]">{c.name}</div>
          <div className="badge badge-sm bg-[#141414] border-neutral-content/20 text-[#444444] text-[9px]">{c.type}</div>
          <DeleteBtn onClick={() => deleteConnMutation.mutate(c.id)} />
        </div>
      ))}
      {!showConnForm && (
        <button onClick={() => setShowConnForm(true)} className={`${btnPrimaryCls} mt-2`}>Add connection</button>
      )}
      {showConnForm && (
        <div className="flex flex-col gap-2 mt-2.5">
          <input placeholder="Name" value={connName} onChange={e => setConnName(e.target.value)} className={inputCls} />
          <select value={connType} onChange={e => setConnType(e.target.value)} className={`select select-sm bg-base-300 border-neutral text-base-content text-[11px] w-full font-inherit`}>
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
            className="textarea bg-base-300 border-neutral text-base-content text-[10px] w-full font-mono resize-y"
          />
          {connError && <div className="text-error text-[10px]">{connError}</div>}
          <div className="flex gap-1.5">
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
            <div className="text-[#888888] text-[11px]">{w.name}</div>
            {w.description && <div className="text-[#444444] text-[9px] mt-0.5">{w.description}</div>}
          </div>
          <DeleteBtn onClick={() => deleteWsMutation.mutate(w.id)} />
        </div>
      ))}
      {!showWsForm && (
        <button onClick={() => setShowWsForm(true)} className={`${btnPrimaryCls} mt-2`}>Add workspace</button>
      )}
      {showWsForm && (
        <div className="flex flex-col gap-2 mt-2.5">
          <input placeholder="Name" value={wsName} onChange={e => setWsName(e.target.value)} className={inputCls} />
          <input placeholder="Description (optional)" value={wsDesc} onChange={e => setWsDesc(e.target.value)} className={inputCls} />
          <input placeholder="Repo path (optional)" value={wsRepo} onChange={e => setWsRepo(e.target.value)} className={inputCls} />
          {connections.length > 0 && (
            <div>
              <div className="text-[#444444] text-[9px] mb-1.5">Connections</div>
              {connections.map(c => (
                <label key={c.id} className="flex items-center gap-1.5 mb-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wsConnIds.includes(c.id)}
                    onChange={e => setWsConnIds(prev => e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id))}
                    className="checkbox checkbox-xs"
                  />
                  <span className="text-[#666666] text-[10px]">{c.name} ({c.type})</span>
                </label>
              ))}
            </div>
          )}
          {wsError && <div className="text-error text-[10px]">{wsError}</div>}
          <div className="flex gap-1.5">
            <button onClick={() => createWsMutation.mutate()} className={btnPrimaryCls} disabled={!wsName.trim()}>Save</button>
            <button onClick={() => { setShowWsForm(false); setWsError(''); }} className={btnCancelCls}>Cancel</button>
          </div>
        </div>
      )}

      {/* Memory */}
      <SectionHeader>Memory</SectionHeader>
      {Object.keys(memory).length === 0 ? (
        <div className="text-[#333333] text-[10px]">No memory stored yet.</div>
      ) : (
        <div className="border border-neutral rounded-md overflow-hidden">
          {Object.entries(memory).map(([k, v], i) => (
            <div key={k} className={`flex items-center gap-2 px-2.5 py-1.5 ${i < Object.keys(memory).length - 1 ? 'border-b border-[#141414]' : ''}`}>
              <div className="w-35 text-[#555555] text-[10px] font-mono shrink-0">{k}</div>
              <div className="flex-1 text-[#888888] text-[10px]">{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Account */}
      <SectionHeader>Account</SectionHeader>
      <button onClick={handleSignOut} className={`${btnPrimaryCls} text-error border-[#2a1010]`}>Sign out</button>
    </div>
  );
}
