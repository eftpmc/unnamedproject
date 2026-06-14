/* global React, Icon, CHATS, PROJECTS, ARTIFACTS, FILES, ACTIVITY, StatusPill */
const { useState: useStateS, useRef: useRefS, useEffect: useEffectS } = React;

/* ============================================================
   CHAT SCREEN
   ============================================================ */
/* ============================================================
   SCOPE CHIP  (per-chat routing: Auto / pin to project)
   ============================================================ */
function ScopeChip({ open, setOpen, pins, projList, onToggle, onAuto, onNew }) {
  const isAuto = pins.length === 0;
  const label = isAuto ? 'Auto' : pins.length === 1 ? pins[0] : pins.length + ' projects';
  return (
    <div className="scope">
      <button className="scope-chip" onClick={() => setOpen(!open)} aria-expanded={open}>
        {isAuto
          ? <span className="scope-ico"><Icon name="target" size={13} /></span>
          : pins.length === 1
            ? <span className="dot live" />
            : <span className="dot-stack">{pins.slice(0, 3).map((_, i) => <span key={i} className="dot live" />)}</span>}
        <span>{label}</span>
        <span className="scope-ico"><Icon name="chevronDown" size={11} /></span>
      </button>
      {open && (
        <React.Fragment>
          <div className="scope-backdrop" onClick={() => setOpen(false)} />
          <div className="scope-menu">
            <div className="scope-menu-label">Scope of this chat</div>
            <button className={'scope-opt' + (isAuto ? ' sel' : '')} onClick={onAuto}>
              <span className="so-ico"><Icon name="target" size={14} /></span>
              <div className="so-main">
                <div className="scope-opt-title">Auto</div>
                <div className="scope-opt-sub">Let the agent route this chat</div>
              </div>
              <span className="so-check"><Icon name="check" size={14} sw={2.4} /></span>
            </button>
            <div className="scope-divider" />
            <div className="scope-list">
              {projList.map((p) => {
                const on = pins.indexOf(p.name) !== -1;
                return (
                  <button key={p.name} className={'scope-opt' + (on ? ' sel' : '')} onClick={() => onToggle(p.name)}>
                    <span className="so-ico"><Icon name={p.icon} size={14} /></span>
                    <div className="so-main">
                      <div className="scope-opt-title">{p.name}</div>
                      <div className="scope-opt-sub">{p.type}</div>
                    </div>
                    <span className={'so-box' + (on ? ' on' : '')}>{on && <Icon name="check" size={11} sw={2.6} />}</span>
                  </button>
                );
              })}
            </div>
            <div className="scope-divider" />
            <button className="scope-opt scope-new" onClick={onNew}>
              <span className="so-ico so-ico-dash"><Icon name="plus" size={14} sw={2} /></span>
              <div className="so-main">
                <div className="scope-opt-title">New project…</div>
                <div className="scope-opt-sub">Spin one up for this work</div>
              </div>
            </button>
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

function ChatScreen({ onOpenCampaign, onOpenProject }) {
  const [text, setText] = useStateS('');
  const taRef = useRefS(null);
  const scrollRef = useRefS(null);
  const [ctxOpen, setCtxOpen] = useStateS(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 1100) return false;
    const saved = localStorage.getItem('ui_ctx');
    return saved == null ? true : saved === 'open';
  });
  const setPanel = (open) => {
    setCtxOpen(open);
    try { localStorage.setItem('ui_ctx', open ? 'open' : 'closed'); } catch (e) {}
  };
  const togglePanel = () => setPanel(!ctxOpen);

  const [scopeOpen, setScopeOpen] = useStateS(false);
  const [pins, setPins] = useStateS(['Aurora Web']);
  const [projList, setProjList] = useStateS(() => PROJECTS.map((p) => ({ name: p.name, type: p.type, icon: p.icon })));
  const [events, setEvents] = useStateS([]);

  const branchFor = (name) => (name === 'Aurora Web' ? 'agent/onboarding-copy' : 'main');
  const describe = (next) => {
    if (next.length === 0) return ['target', 'Back to Auto — the agent will route this chat'];
    if (next.length === 1) return ['gitMerge', 'Scoped to ' + next[0] + ' — re-checked out ' + branchFor(next[0])];
    return ['gitGraph', 'Now reading from ' + next.slice(0, -1).join(', ') + ' and ' + next[next.length - 1]];
  };
  const applyScope = (next) => {
    setPins(next);
    const d = describe(next);
    setEvents((ev) => ev.concat([{ kind: 'sys', icon: d[0], text: d[1], time: 'now', id: 'e' + Date.now() }]));
  };
  const toggleProject = (name) => applyScope(pins.indexOf(name) !== -1 ? pins.filter((n) => n !== name) : pins.concat([name]));
  const setAuto = () => { applyScope([]); setScopeOpen(false); };
  const newProject = () => {
    const name = 'Onboarding Web';
    setProjList((l) => (l.some((p) => p.name === name) ? l : l.concat([{ name, type: 'code repo', icon: 'folder' }])));
    setPins([name]);
    setEvents((ev) => ev.concat([{ kind: 'project', name, sub: 'React + Vite · created from this chat', time: 'now', id: 'p' + Date.now() }]));
    setScopeOpen(false);
  };

  useEffectS(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 144) + 'px';
  }, [text]);

  useEffectS(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, []);

  useEffectS(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events]);

  return (
    <div className="chat-split" data-ctx={ctxOpen ? 'open' : 'closed'}>
    <div className="chat">
      <header className="page-head">
        <div className="page-head-row">
          <h1 className="page-title">Refine onboarding flow copy</h1>
          <div className="head-actions">
            <button className="config-trigger">
              medium · Auto<Icon name="chevronDown" size={12} />
            </button>
            <button
              className={'ctx-trigger' + (ctxOpen ? ' on' : '')}
              onClick={togglePanel}
              title={ctxOpen ? 'Hide context' : 'Show context'}
              aria-pressed={ctxOpen}
            >
              <Icon name="panelRight" size={15} />
              <span className="ctx-trigger-label">Context</span>
              {!ctxOpen && <span className="ctx-trigger-dot" />}
            </button>
          </div>
        </div>
        <ScopeChip
          open={scopeOpen}
          setOpen={setScopeOpen}
          pins={pins}
          projList={projList}
          onToggle={toggleProject}
          onAuto={setAuto}
          onNew={newProject}
        />
      </header>

      <div className="msg-scroll" ref={scrollRef}>
        <div className="msg-wrap">
          <div className="msg-user">
            <div className="bubble">
              The welcome screen copy feels stiff. Can you rewrite the three onboarding steps to sound warmer, and keep each headline under 6 words?
            </div>
          </div>

          <div className="msg-bot">
            <p>Here's a warmer pass on the three steps. I kept each headline tight and let the supporting line carry the friendliness:</p>
            <ul>
              <li><strong>Step 1 — "Let's get you set up"</strong> · A couple of details and you're in.</li>
              <li><strong>Step 2 — "Bring your work along"</strong> · Connect a repo or start fresh.</li>
              <li><strong>Step 3 — "You're ready to go"</strong> · Your first agent is standing by.</li>
            </ul>
            <p>I also updated <code>onboarding.tsx</code> with these strings — want me to soften the button labels too?</p>
          </div>

          <div className="msg-bot">
            <p>Since this spans a few files and screens, I've set it up as a campaign so the work stays tracked in one place:</p>
          </div>

          <div className="exec card-create">
            <div className="exec-head">
              <div className="exec-icon icon-accent"><Icon name="sparkle" size={15} /></div>
              <div className="exec-meta">
                <div className="exec-tool">Created campaign</div>
                <div className="exec-proj">Aurora Web</div>
              </div>
              <StatusPill status="done" />
            </div>
            <div className="cc-body">
              <div className="cc-name">Onboarding copy refresh</div>
              <div className="cc-desc">Tracks the three-step welcome rewrite, its chats, and artifacts together.</div>
              <div className="cc-actions">
                <button className="btn btn-soft btn-sm" onClick={onOpenCampaign}>View campaign<Icon name="chevronRight" size={13} /></button>
                <button className="link-action" onClick={() => setScopeOpen(true)}>Change</button>
              </div>
            </div>
          </div>

          <div className="exec">
            <div className="exec-head">
              <div className="exec-icon"><Icon name="code" size={15} /></div>
              <div className="exec-meta">
                <div className="exec-tool">claude_code</div>
                <div className="exec-proj">Aurora Web</div>
              </div>
              <StatusPill status="done" />
            </div>
            <div className="exec-body">
              <div className="exec-log">{`✓ edited src/onboarding/steps.tsx
✓ updated 3 headline strings
✓ ran prettier · 1 file changed
  +12 −9`}</div>
            </div>
          </div>

          <div className="exec artifact-card">
            <div className="artifact-thumb"><span className="thumb-tag">interactive<br/>prototype</span></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="exec-tool">Onboarding flow — v3</div>
              <div className="exec-proj" style={{ marginTop: '.2rem' }}>Prototype · ready to preview</div>
              <button className="btn btn-soft btn-sm" style={{ marginTop: '.6rem' }}>
                Open preview<Icon name="chevronRight" size={13} />
              </button>
            </div>
          </div>

          <div className="msg-bot">
            <p>Done. The prototype above reflects the new copy across all three steps. The tone is friendlier without getting cutesy.</p>
          </div>

          {events.map((e) => e.kind === 'sys' ? (
            <div key={e.id} className="sys-line">
              <span className="sys-ico"><Icon name={e.icon} size={13} /></span>
              <span className="sys-text">{e.text}</span>
              <span className="sys-time">{e.time}</span>
            </div>
          ) : (
            <div key={e.id} className="exec card-create">
              <div className="exec-head">
                <div className="exec-icon icon-accent"><Icon name="grid" size={15} /></div>
                <div className="exec-meta">
                  <div className="exec-tool">Created project</div>
                  <div className="exec-proj">from this chat</div>
                </div>
                <StatusPill status="done" />
              </div>
              <div className="cc-body">
                <div className="cc-name">{e.name}</div>
                <div className="cc-desc">{e.sub}</div>
                <div className="cc-actions">
                  <button className="btn btn-soft btn-sm" onClick={onOpenProject}>Open project<Icon name="chevronRight" size={13} /></button>
                  <button className="link-action">Rename</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="banner banner-warn">
        <div className="banner-left">
          <Icon name="bell" size={14} style={{ color: 'var(--warning)' }} />
          <span>Approval needed for <strong style={{ color: 'var(--fg)', fontWeight: 600 }}>git commit</strong></span>
        </div>
        <button className="link-action">Review</button>
      </div>

      <div className="composer">
        <div className="composer-box">
          <textarea
            ref={taRef}
            rows={1}
            placeholder="Message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className={'send-btn' + (text.trim() ? '' : ' disabled')}>
            <Icon name="arrowUp" size={17} sw={2} />
          </button>
        </div>
      </div>
    </div>
    <ContextPanel open={ctxOpen} onClose={() => setPanel(false)} />
    {ctxOpen && <div className="ctx-scrim" onClick={() => setPanel(false)} />}
    </div>
  );
}

function ContextPanel({ open, onClose }) {
  return (
    <aside className="context-panel" data-open={open ? 'true' : 'false'}>
      <div className="ctx-inner">
        <div className="ctx-handle" onClick={onClose} />
        <div className="ctx-head-row">
          <div className="ctx-head">Context</div>
          <button className="ctx-close" onClick={onClose} aria-label="Close context"><Icon name="x" size={16} /></button>
        </div>

      <div className="ctx-section">
        <div className="ctx-label">Project</div>
        <button className="ctx-project">
          <span className="dot live" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ctx-proj-name">Aurora Web</div>
            <div className="ctx-proj-sub">React + Vite monorepo</div>
          </div>
          <Icon name="chevronRight" size={14} style={{ color: 'var(--faint-fg)' }} />
        </button>
      </div>

      <div className="ctx-section">
        <div className="ctx-label">Working branch</div>
        <div className="ctx-branch">
          <Icon name="gitMerge" size={14} style={{ color: 'var(--muted-fg)' }} />
          <code>agent/onboarding-copy</code>
        </div>
        <div className="ctx-branch-meta">2 commits ahead · 1 file changed</div>
        <button className="btn btn-primary btn-sm ctx-full">Merge to main</button>
      </div>

      <div className="ctx-section ctx-attention">
        <div className="ctx-label" style={{ color: 'var(--warning)' }}>Needs approval</div>
        <div className="ctx-approval-title">git commit</div>
        <div className="ctx-approval-sub">Commit onboarding copy changes</div>
        <div className="ctx-approval-actions">
          <button className="btn btn-ghost btn-sm">Deny</button>
          <button className="btn btn-primary btn-sm"><Icon name="check" size={13} sw={2.2} />Approve</button>
        </div>
      </div>

      <div className="ctx-section">
        <div className="ctx-label">Artifacts</div>
        <button className="ctx-artifact">
          <span className="ctx-thumb"><Icon name="sparkle" size={13} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ctx-art-name">Onboarding flow — v3</div>
            <div className="ctx-art-sub">Prototype</div>
          </div>
          <span className="status status-done"><Icon name="check" size={10} sw={2.4} /></span>
        </button>
        <button className="ctx-artifact">
          <span className="ctx-thumb"><Icon name="file" size={13} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ctx-art-name">Q2 changelog</div>
            <div className="ctx-art-sub">Document</div>
          </div>
          <span className="status status-wait">review</span>
        </button>
      </div>
      </div>
    </aside>
  );
}

/* ============================================================
   PROJECTS GRID
   ============================================================ */
function ProjectsScreen({ onOpen }) {
  return (
    <div className="chat">
      <header className="page-head">
        <div className="page-head-row">
          <h1 className="page-title">Projects</h1>
          <button className="btn btn-soft btn-sm"><Icon name="plus" size={14} />New project</button>
        </div>
      </header>
      <div className="page-body">
        <div className="content-col">
          <div className="proj-grid">
            {PROJECTS.map((p) => (
              <button key={p.id} className="card clickable" onClick={onOpen}>
                <div className="card-top">
                  <div className="card-title-row">
                    <span className="card-icon"><Icon name={p.icon} size={16} /></span>
                    <span className="card-name">{p.name}</span>
                  </div>
                  {p.running > 0 && (
                    <span className="running-pill"><span className="pulse" />{p.running} running</span>
                  )}
                </div>
                <p className="card-desc">{p.desc}</p>
                <div className="card-meta">
                  <span>{p.type}</span>
                  {p.caps.includes('graph') && (<><span className="meta-sep">·</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem' }}><Icon name="gitGraph" size={11} />graph</span></>)}
                  {p.caps.includes('videos') && (<><span className="meta-sep">·</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem' }}><Icon name="video" size={11} />videos</span></>)}
                  <span className="meta-sep">·</span><span>{p.campaigns} campaigns</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PROJECT DETAIL (tabs)
   ============================================================ */
function ProjectDetailScreen({ onBack, onOpenCampaign }) {
  const [tab, setTab] = useStateS('Overview');
  const tabs = ['Overview', 'Campaigns', 'Artifacts', 'Files', 'Settings'];

  return (
    <div className="chat">
      <header className="page-head">
        <div className="breadcrumb">
          <a href="#" onClick={(e) => { e.preventDefault(); onBack && onBack(); }}>Projects</a><span className="crumb-sep"><Icon name="chevronRight" size={12} /></span>
          <span style={{ color: 'var(--fg)' }}>Aurora Web</span>
        </div>
        <div className="page-head-row">
          <h1 className="page-title">Aurora Web</h1>
          <button className="btn btn-primary btn-sm"><Icon name="sparkle" size={14} />New campaign</button>
        </div>
        <div className="page-sub">Marketing site and customer dashboard · React + Vite monorepo</div>
      </header>

      <div className="tabbar">
        {tabs.map((t) => (
          <button key={t} className={'tab' + (t === tab ? ' active' : '')} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      <div className="page-body">
        <div className="content-col">
          {tab === 'Overview'  && <OverviewTab onOpenTab={setTab} onOpenCampaign={onOpenCampaign} />}
          {tab === 'Campaigns' && <CampaignsTab onOpenCampaign={onOpenCampaign} />}
          {tab === 'Artifacts' && <ArtifactsTab />}
          {tab === 'Files'     && <FilesTab />}
          {tab === 'Settings'  && <SettingsTab />}
        </div>
      </div>
    </div>
  );
}

/* ---- shared campaign row ---- */
function statusEl(status) {
  if (status === 'running') return <StatusPill status="run" />;
  if (status === 'review')  return <span className="status status-wait">In review</span>;
  return <span className="status status-done"><Icon name="check" size={11} sw={2.4} />Done</span>;
}

function CampaignRow({ c, onOpen }) {
  return (
    <button className="campaign-row" onClick={onOpen}>
      <div className="cmp-main">
        <div className="cmp-top">
          <span className="cmp-name">{c.name}</span>
          {statusEl(c.status)}
        </div>
        <div className="cmp-desc">{c.desc}</div>
        <div className="cmp-meta">
          <span><Icon name="message" size={12} />{c.chats} chats</span>
          <span className="meta-sep">·</span>
          <span><Icon name="sparkle" size={12} />{c.artifacts} artifacts</span>
          <span className="meta-sep">·</span>
          <span>updated {c.updated}</span>
        </div>
      </div>
      <Icon name="chevronRight" size={16} style={{ color: 'var(--faint-fg)', flexShrink: 0 }} />
    </button>
  );
}

/* ---- Overview ---- */
function OverviewTab({ onOpenTab, onOpenCampaign }) {
  const running = CAMPAIGNS.filter((c) => c.status === 'running');
  return (
    <div className="ov">
      <div className="ov-connect">
        <div className="ov-connect-main">
          <span className="ov-repo-icon"><Icon name="gitGraph" size={18} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="ov-repo-name">github.com/aurora/web</div>
            <div className="ov-repo-sub">main · synced 4m ago</div>
          </div>
        </div>
        <span className="status status-done"><Icon name="check" size={11} sw={2.4} />Connected</span>
      </div>

      <div className="stat-grid">
        <button className="stat" onClick={() => onOpenTab('Campaigns')}>
          <div className="stat-num">{CAMPAIGNS.length}</div>
          <div className="stat-label">Campaigns</div>
        </button>
        <button className="stat" onClick={() => onOpenTab('Artifacts')}>
          <div className="stat-num">{ARTIFACTS.length}</div>
          <div className="stat-label">Artifacts</div>
        </button>
        <div className="stat">
          <div className="stat-num">{running.length}</div>
          <div className="stat-label">Running now</div>
        </div>
      </div>

      {running.length > 0 && (
        <div>
          <h2 className="section-label">Active now</h2>
          <div className="campaign-list">
            {running.map((c) => <CampaignRow key={c.id} c={c} onOpen={onOpenCampaign} />)}
          </div>
        </div>
      )}

      <div>
        <h2 className="section-label">Recent activity</h2>
        <div className="activity-list">
          {ACTIVITY.slice(0, 4).map((a) => (
            <div key={a.id} className="act-row">
              <div className="act-icon"><Icon name={a.icon} size={17} /></div>
              <div className="act-main">
                <div className="act-title">{a.tool}</div>
                <div className="act-sub">{a.sub}</div>
              </div>
              {a.status === 'run' ? <StatusPill status="run" /> : <span className="act-time">{a.time}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---- Campaigns ---- */
function CampaignsTab({ onOpenCampaign }) {
  return (
    <div className="campaign-list">
      {CAMPAIGNS.map((c) => <CampaignRow key={c.id} c={c} onOpen={onOpenCampaign} />)}
    </div>
  );
}

/* ---- Artifacts ---- */
function ArtifactsTab() {
  return (
    <div className="artifacts-grid">
      {ARTIFACTS.map((a) => (
        <button key={a.id} className="card clickable">
          <div className="big-thumb"><span className="thumb-tag">{a.tag}</span></div>
          <div className="card-top">
            <div style={{ minWidth: 0 }}>
              <div className="card-name" style={{ fontSize: '.88rem' }}>{a.title}</div>
              <div className="card-meta" style={{ marginTop: '.3rem' }}>{a.kind}</div>
            </div>
            {a.status === 'running'
              ? <StatusPill status="run" />
              : a.status === 'review'
                ? <span className="status status-wait">In review</span>
                : <span className="status status-done"><Icon name="check" size={11} sw={2.4} />Ready</span>}
          </div>
        </button>
      ))}
    </div>
  );
}

/* ---- Files ---- */
function FilesTab() {
  return (
    <div className="file-list">
      {FILES.map((f) => (
        <div key={f.path} className="file-row">
          <span style={{ color: f.dir ? 'var(--accent)' : 'var(--muted-fg)' }}>
            <Icon name={f.dir ? 'folder' : 'file'} size={15} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className={'file-name' + (f.dir ? ' dir' : '')}>{f.name}</div>
            <div className="file-path">{f.path}</div>
          </div>
          {f.size && <span className="file-size">{f.size}</span>}
        </div>
      ))}
    </div>
  );
}

/* ---- Settings ---- */
function SettingsTab() {
  return (
    <div className="settings">
      <div className="set-group">
        <div className="set-field">
          <label htmlFor="set-name">Project name</label>
          <input id="set-name" className="input" defaultValue="Aurora Web" />
        </div>
        <div className="set-field">
          <label htmlFor="set-desc">Description</label>
          <textarea id="set-desc" className="input" rows={2} defaultValue="Marketing site and customer dashboard. React + Vite monorepo." />
        </div>
      </div>

      <div className="set-group">
        <div className="set-group-title">Connection</div>
        <div className="set-row">
          <div className="set-row-main">
            <div className="set-row-title">GitHub repository</div>
            <div className="set-row-sub">github.com/aurora/web</div>
          </div>
          <span className="status status-done"><Icon name="check" size={11} sw={2.4} />Connected</span>
        </div>
        <div className="set-row">
          <div className="set-row-main">
            <div className="set-row-title">Default branch</div>
            <div className="set-row-sub">main</div>
          </div>
          <button className="btn btn-soft btn-sm">Change</button>
        </div>
      </div>

      <div className="set-group">
        <div className="set-group-title">Agent defaults</div>
        <div className="set-row">
          <div className="set-row-main">
            <div className="set-row-title">Permission mode</div>
            <div className="set-row-sub">Ask before file writes and commits</div>
          </div>
          <button className="config-trigger">Auto<Icon name="chevronDown" size={12} /></button>
        </div>
      </div>

      <div className="set-actions">
        <button className="btn btn-primary btn-sm"><Icon name="check" size={14} sw={2.2} />Save changes</button>
      </div>

      <div className="set-danger">
        <div className="set-row-main">
          <div className="set-row-title">Delete project</div>
          <div className="set-row-sub">Permanently remove Aurora Web and all its campaigns.</div>
        </div>
        <button className="btn btn-danger btn-sm">Delete</button>
      </div>
    </div>
  );
}

/* ============================================================
   CAMPAIGN DETAIL
   ============================================================ */
function CampaignScreen({ onBackProjects, onBackProject, onOpenChat }) {
  const c = CAMPAIGN_DETAIL;
  const done = c.progress.filter((p) => p.done).length;
  const pct = Math.round((done / c.progress.length) * 100);

  return (
    <div className="chat">
      <header className="page-head">
        <div className="breadcrumb">
          <a href="#" onClick={(e) => { e.preventDefault(); onBackProjects && onBackProjects(); }}>Projects</a>
          <span className="crumb-sep"><Icon name="chevronRight" size={12} /></span>
          <a href="#" onClick={(e) => { e.preventDefault(); onBackProject && onBackProject(); }}>Aurora Web</a>
          <span className="crumb-sep"><Icon name="chevronRight" size={12} /></span>
          <span style={{ color: 'var(--fg)' }}>{c.name}</span>
        </div>
        <div className="page-head-row">
          <h1 className="page-title">{c.name}</h1>
          <div className="cmp-head-actions">
            <StatusPill status="run" />
            <button className="btn btn-primary btn-sm" onClick={onOpenChat}><Icon name="plus" size={14} sw={2} />New chat</button>
          </div>
        </div>
        <div className="page-sub">{c.desc}</div>
      </header>

      <div className="page-body">
        <div className="content-col">
          <div className="cmp-grid">
            <div className="cmp-col">

              <section className="cmp-block">
                <div className="cmp-block-head">
                  <h2 className="cmp-block-title">Progress</h2>
                  <span className="cmp-prog-count">{done} of {c.progress.length} done</span>
                </div>
                <div className="prog-track"><span className="prog-fill" style={{ width: pct + '%' }} /></div>
                <ul className="checklist">
                  {c.progress.map((p, i) => (
                    <li key={i} className={'check' + (p.done ? ' done' : '')}>
                      <span className="check-box">{p.done && <Icon name="check" size={11} sw={2.6} />}</span>
                      <span className="check-label">{p.label}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="cmp-block">
                <div className="cmp-block-head">
                  <h2 className="cmp-block-title">Chats</h2>
                  <span className="cmp-count">{c.chats.length}</span>
                </div>
                <div className="cmp-chat-list">
                  {c.chats.map((ch, i) => (
                    <button key={i} className="cmp-chat-row" onClick={onOpenChat}>
                      <span className="cmp-chat-icon"><Icon name="message" size={15} /></span>
                      <div className="cmp-chat-main">
                        <div className="cmp-chat-title">{ch.title}</div>
                        <div className="cmp-chat-meta">{ch.msgs} messages · {ch.time}</div>
                      </div>
                      {ch.status === 'running'
                        ? <StatusPill status="run" />
                        : <span className="status status-done"><Icon name="check" size={11} sw={2.4} />Done</span>}
                      <Icon name="chevronRight" size={16} style={{ color: 'var(--faint-fg)', flexShrink: 0 }} />
                    </button>
                  ))}
                </div>
              </section>

              <section className="cmp-block">
                <div className="cmp-block-head">
                  <h2 className="cmp-block-title">Artifacts</h2>
                  <span className="cmp-count">{c.artifacts.length}</span>
                </div>
                <div className="artifacts-grid">
                  {c.artifacts.map((a, i) => (
                    <button key={i} className="card clickable">
                      <div className="big-thumb"><span className="thumb-tag">{a.tag}</span></div>
                      <div className="card-top">
                        <div style={{ minWidth: 0 }}>
                          <div className="card-name" style={{ fontSize: '.88rem' }}>{a.title}</div>
                          <div className="card-meta" style={{ marginTop: '.3rem' }}>{a.kind}</div>
                        </div>
                        {a.status === 'review'
                          ? <span className="status status-wait">In review</span>
                          : <span className="status status-done"><Icon name="check" size={11} sw={2.4} />Ready</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </section>

            </div>

            <aside className="cmp-aside">
              <div className="cmp-info-card">
                <div className="cmp-info-row">
                  <span className="cmp-info-label">Status</span>
                  <span className="status status-run"><span className="spinner" />Running</span>
                </div>
                <div className="cmp-info-row">
                  <span className="cmp-info-label">Branch</span>
                  <code className="cmp-branch-code">{c.branch}</code>
                </div>
                <div className="cmp-info-row">
                  <span className="cmp-info-label">Started</span>
                  <span className="cmp-info-val">{c.started}</span>
                </div>
                <div className="cmp-info-row">
                  <span className="cmp-info-label">Last active</span>
                  <span className="cmp-info-val">{c.updated} ago</span>
                </div>
              </div>

              <div className="cmp-info-card">
                <div className="cmp-aside-label">Team</div>
                <div className="avatar-row">
                  {c.team.map((t, i) => <span key={i} className="avatar avatar-stack">{t}</span>)}
                  <button className="avatar-add" aria-label="Add member"><Icon name="plus" size={13} sw={2} /></button>
                </div>
              </div>

              <div className="cmp-info-card">
                <div className="cmp-aside-label">Recent activity</div>
                <div className="mini-timeline">
                  {c.events.map((e, i) => (
                    <div key={i} className={'tl-row' + (i === c.events.length - 1 ? ' last' : '')}>
                      <div className="tl-marker">
                        <span className="tl-icon"><Icon name={e.icon} size={12} /></span>
                      </div>
                      <div className="tl-main">
                        <div className="tl-tool">{e.tool}</div>
                        <div className="tl-sub">{e.sub}</div>
                        <div className="tl-time">{e.status === 'run' ? 'running · ' : ''}{e.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ACTIVITY
   ============================================================ */
function ActivityScreen() {
  const attention = ACTIVITY.filter((a) => a.attention);
  const rest = ACTIVITY.filter((a) => !a.attention);
  return (
    <div className="chat">
      <header className="page-head">
        <div className="page-head-row"><h1 className="page-title">Activity</h1></div>
        <div className="page-sub">Live tool runs and approvals across all projects</div>
      </header>
      <div className="page-body">
        <div className="content-col">
          {attention.length > 0 && <h2 className="section-label">Needs your attention</h2>}
          <div className="activity-list">
            {attention.map((a) => (
              <div key={a.id} className="act-row attention">
                <div className="act-icon" style={{ color: 'var(--warning)' }}><Icon name={a.icon} size={17} /></div>
                <div className="act-main">
                  <div className="act-title">{a.tool}</div>
                  <div className="act-sub">{a.sub}</div>
                </div>
                <div className="act-actions">
                  <button className="btn btn-ghost btn-sm">Deny</button>
                  <button className="btn btn-primary btn-sm"><Icon name="check" size={13} sw={2.2} />Approve</button>
                </div>
              </div>
            ))}
          </div>

          <h2 className="section-label">Recent</h2>
          <div className="activity-list">
            {rest.map((a) => (
              <div key={a.id} className="act-row">
                <div className="act-icon"><Icon name={a.icon} size={17} /></div>
                <div className="act-main">
                  <div className="act-title">{a.tool}</div>
                  <div className="act-sub">{a.sub}</div>
                </div>
                {a.status === 'run' ? <StatusPill status="run" /> : <span className="status status-done"><Icon name="check" size={11} sw={2.4} />Done</span>}
                <span className="act-time">{a.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ChatScreen, ProjectsScreen, ProjectDetailScreen, CampaignScreen, ActivityScreen });
