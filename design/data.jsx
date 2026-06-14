/* global React */
const { useState, useRef, useEffect } = React;

/* ----------------------------------------------------------
   Icons — lucide-style stroke paths
   ---------------------------------------------------------- */
const ICONS = {
  plus: '<path d="M5 12h14M12 5v14"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.6-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  pencil: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  gitMerge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  gitGraph: '<circle cx="5" cy="6" r="3"/><circle cx="5" cy="18" r="3"/><path d="M5 9v6"/><circle cx="19" cy="12" r="3"/><path d="M8 6h8a3 3 0 0 1 3 3v0M8 18h8a3 3 0 0 0 3-3v0"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4z"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  panelRight: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  target: '<circle cx="12" cy="12" r="9"/><path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21"/><circle cx="12" cy="12" r="2.5"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
};

function Icon({ name, size = 18, sw = 1.75, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      style={style} dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }} />
  );
}

/* ----------------------------------------------------------
   Sample data
   ---------------------------------------------------------- */
const CHATS = [
  { id: 'c1', title: 'Refine onboarding flow copy', time: '2m', project: 'Aurora Web' },
  { id: 'c2', title: 'Migrate auth to session tokens', time: '1h', project: 'Aurora Web' },
  { id: 'c3', title: 'Dark mode contrast audit', time: '3h', project: 'Aurora Web' },
  { id: 'c4', title: 'Weekly changelog draft', time: 'Yesterday', project: 'Field Notes' },
  { id: 'c5', title: 'Investigate slow dashboard query', time: '2d', project: 'Pipeline API' },
];

const PROJECTS = [
  { id: 'p1', name: 'Aurora Web', desc: 'Marketing site and customer dashboard. React + Vite monorepo.', type: 'code repo', running: 1, caps: ['graph'], campaigns: 4, icon: 'folder' },
  { id: 'p2', name: 'Field Notes', desc: 'Long-form research docs and weekly briefings.', type: 'doc project', running: 0, caps: [], campaigns: 2, icon: 'file' },
  { id: 'p3', name: 'Pipeline API', desc: 'Go service powering ingestion and scheduled jobs.', type: 'code repo', running: 0, caps: ['graph'], campaigns: 7, icon: 'folder' },
  { id: 'p4', name: 'Brand Reels', desc: 'Short product videos and social cutdowns.', type: 'doc project', running: 2, caps: ['videos'], campaigns: 3, icon: 'file' },
  { id: 'p5', name: 'Atlas Mobile', desc: 'React Native client. Shared design tokens with Aurora.', type: 'code repo', running: 0, caps: ['graph'], campaigns: 1, icon: 'folder' },
  { id: 'p6', name: 'Support Macros', desc: 'Canned responses and triage automations.', type: 'doc project', running: 0, caps: [], campaigns: 5, icon: 'file' },
];

const ARTIFACTS = [
  { id: 'a1', title: 'Onboarding flow — v3', kind: 'Prototype', status: 'ready', tag: 'interactive prototype' },
  { id: 'a2', title: 'Q2 changelog', kind: 'Document', status: 'review', tag: 'markdown doc' },
  { id: 'a3', title: 'Pricing page hero', kind: 'Design', status: 'ready', tag: 'hero mock 1440×900' },
  { id: 'a4', title: 'Launch teaser', kind: 'Video', status: 'running', tag: 'render 0:24' },
];

const CAMPAIGNS = [
  { id: 'cmp1', name: 'Onboarding copy refresh', desc: 'Warmer copy across the three-step welcome sequence.', status: 'running', chats: 3, artifacts: 2, updated: '2m' },
  { id: 'cmp2', name: 'Auth → session tokens', desc: 'Migrate JWT auth to httpOnly session tokens.', status: 'review', chats: 5, artifacts: 1, updated: '1h' },
  { id: 'cmp3', name: 'Dark-mode contrast audit', desc: 'WCAG AA pass on the dashboard in dark theme.', status: 'done', chats: 2, artifacts: 4, updated: '3h' },
  { id: 'cmp4', name: 'Q2 marketing site refresh', desc: 'New hero, pricing, and changelog pages shipped.', status: 'done', chats: 8, artifacts: 5, updated: '2d' },
];

const CAMPAIGN_DETAIL = {
  id: 'cmp1', name: 'Onboarding copy refresh', status: 'running',
  desc: 'Warmer copy across the three-step welcome sequence — friendlier tone without losing clarity.',
  branch: 'agent/onboarding-copy', started: 'Jun 11', updated: '2m',
  progress: [
    { label: 'Rewrite the three onboarding step headlines', done: true },
    { label: 'Update onboarding.tsx copy strings', done: true },
    { label: 'Soften primary button labels', done: false },
    { label: 'QA copy in the staging build', done: false },
  ],
  chats: [
    { title: 'Refine onboarding flow copy', time: '2m', msgs: 6, status: 'running' },
    { title: 'Tone exploration for the welcome screen', time: '1h', msgs: 12, status: 'done' },
    { title: 'Headline length audit', time: '3h', msgs: 4, status: 'done' },
  ],
  artifacts: [
    { title: 'Onboarding flow — v3', kind: 'Prototype', status: 'ready', tag: 'interactive prototype' },
    { title: 'Welcome copy deck', kind: 'Document', status: 'review', tag: 'markdown doc' },
  ],
  team: ['JL', 'AM', 'RK'],
  events: [
    { tool: 'claude_code', sub: 'Edited onboarding/steps.tsx', time: '2m', icon: 'code', status: 'run' },
    { tool: 'create_artifact', sub: 'Onboarding flow — v3', time: '18m', icon: 'sparkle', status: 'done' },
    { tool: 'git', sub: 'Committed 3 copy changes', time: '1h', icon: 'gitMerge', status: 'done' },
  ],
};

const FILES = [
  { name: 'src', path: 'aurora-web/src', dir: true },
  { name: 'package.json', path: 'aurora-web/package.json', size: '1.2 KB' },
  { name: 'README.md', path: 'aurora-web/README.md', size: '4.8 KB' },
  { name: 'vite.config.ts', path: 'aurora-web/vite.config.ts', size: '640 B' },
  { name: 'index.css', path: 'aurora-web/src/index.css', size: '4.7 KB' },
];

const ACTIVITY = [
  { id: 'e1', tool: 'Approve file write', sub: 'src/routes/auth.ts · Pipeline API', status: 'wait', icon: 'file', time: 'now', attention: true },
  { id: 'e2', tool: 'claude_code', sub: 'Refactor session middleware · Aurora Web', status: 'run', icon: 'code', time: '1m' },
  { id: 'e3', tool: 'render_video', sub: 'Launch teaser · Brand Reels', status: 'run', icon: 'video', time: '3m' },
  { id: 'e4', tool: 'git', sub: 'Merged branch agent/auth-tokens · Pipeline API', status: 'done', icon: 'gitMerge', time: '12m' },
  { id: 'e5', tool: 'create_artifact', sub: 'Q2 changelog · Field Notes', status: 'done', icon: 'file', time: '40m' },
  { id: 'e6', tool: 'claude_code', sub: 'Add dark-mode token audit · Aurora Web', status: 'done', icon: 'code', time: '1h' },
];

/* ----------------------------------------------------------
   Small shared bits
   ---------------------------------------------------------- */
function StatusPill({ status }) {
  if (status === 'done') return <span className="status status-done"><Icon name="check" size={11} sw={2.4} />Done</span>;
  if (status === 'run')  return <span className="status status-run"><span className="spinner" />Running</span>;
  if (status === 'wait') return <span className="status status-wait"><Icon name="bell" size={11} sw={2} />Needs approval</span>;
  return null;
}

Object.assign(window, { React, useState, useRef, useEffect, Icon, ICONS, CHATS, PROJECTS, ARTIFACTS, CAMPAIGNS, CAMPAIGN_DETAIL, FILES, ACTIVITY, StatusPill });
