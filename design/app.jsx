/* global React, ReactDOM, Icon, CHATS, ChatScreen, ProjectsScreen, ProjectDetailScreen, CampaignScreen, ActivityScreen */
const { useState: useStateA, useEffect: useEffectA } = React;

const NAV = [
  { id: 'activity', label: 'Activity', icon: 'activity', badge: 1 },
  { id: 'chats', label: 'Chats', icon: 'message' },
  { id: 'projects', label: 'Projects', icon: 'grid' },
];

function Sidebar({ screen, setScreen, onNavigate, theme, setTheme }) {
  // map screens -> active nav
  const activeNav = screen === 'projects' || screen === 'detail' || screen === 'campaign' ? 'projects'
    : screen === 'activity' ? 'activity'
    : screen === 'chat' ? 'chats' : null;

  return (
    <aside className="sidebar">
      <div className="side-head">
        <div className="brand">
          <div className="brand-mark">u</div>
          <span className="brand-name">unnamed</span>
        </div>
        <button className="newchat" onClick={() => { setScreen('chat'); onNavigate(); }}>
          <Icon name="plus" size={15} sw={2} /><span className="newchat-label">New chat</span>
        </button>
      </div>

      <nav className="side-nav">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={'nav-item' + (activeNav === n.id ? ' active' : '')}
            onClick={() => {
              if (n.id === 'chats') { setScreen('chat'); onNavigate(); return; }
              setScreen(n.id); onNavigate();
            }}
          >
            <Icon name={n.icon} size={16} />
            <span className="label">{n.label}</span>
            {n.badge && <span className="nav-badge">{n.badge}</span>}
          </button>
        ))}
      </nav>

      <div className="side-recent">
        <div className="recent-label">Recent</div>
        {CHATS.map((c, i) => (
          <button
            key={c.id}
            className={'recent-item' + (screen === 'chat' && i === 0 ? ' active' : '')}
            onClick={() => { setScreen('chat'); onNavigate(); }}
          >
            <span className="recent-title">{c.title}</span>
            <span className="recent-time">{c.time}</span>
          </button>
        ))}
      </div>

      <div className="side-foot">
        <button className="user-chip">
          <span className="avatar">JL</span>
          <span className="user-name">Jordan Lee</span>
          <Icon name="chevronDown" size={14} style={{ color: 'var(--faint-fg)' }} />
        </button>
        <button
          className="theme-toggle"
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} />
        </button>
      </div>
    </aside>
  );
}

function App() {
  const [theme, setTheme] = useStateA(() => localStorage.getItem('ui_theme') || 'light');
  const [screen, setScreen] = useStateA(() => localStorage.getItem('ui_screen') || 'chat');
  const [sbOpen, setSbOpen] = useStateA(false);

  useEffectA(() => {
    document.documentElement.setAttribute('data-dir', 'slate');
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ui_theme', theme);
  }, [theme]);

  useEffectA(() => { localStorage.setItem('ui_screen', screen); }, [screen]);

  const go = (s) => { setScreen(s); setSbOpen(false); };

  const content =
    screen === 'projects' ? <ProjectsScreen onOpen={() => go('detail')} />
    : screen === 'detail' ? <ProjectDetailScreen onBack={() => go('projects')} onOpenCampaign={() => go('campaign')} />
    : screen === 'campaign' ? <CampaignScreen onBackProjects={() => go('projects')} onBackProject={() => go('detail')} onOpenChat={() => go('chat')} />
    : screen === 'activity' ? <ActivityScreen />
    : <ChatScreen onOpenCampaign={() => go('campaign')} onOpenProject={() => go('detail')} />;

  const title = screen === 'projects' ? 'Projects'
    : screen === 'activity' ? 'Activity'
    : screen === 'campaign' ? 'Campaign'
    : screen === 'detail' ? 'Aurora Web' : 'Chat';

  return (
    <div className={'app' + (sbOpen ? ' sb-open' : '')}>
      <div className="scrim" onClick={() => setSbOpen(false)} />
      <Sidebar screen={screen} setScreen={setScreen} theme={theme} setTheme={setTheme} onNavigate={() => setSbOpen(false)} />
      <div className="main">
        <div className="topbar-mobile">
          <button className="hamburger" onClick={() => setSbOpen(true)} aria-label="Open menu"><Icon name="menu" size={18} /></button>
          <div className="brand"><div className="brand-mark">u</div><span className="brand-name">{title}</span></div>
          <div style={{ width: '2.2rem' }} />
        </div>
        {content}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
