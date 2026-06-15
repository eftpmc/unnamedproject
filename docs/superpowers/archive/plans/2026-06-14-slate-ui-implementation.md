# Slate UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the entire web app to match the "Soft Minimal / Slate" design prototype, using Hanken Grotesk and a cool blue-grey oklch token layer wired into Tailwind v4.

**Architecture:** Update design tokens in `index.css` (new Slate palette + Hanken Grotesk font), extend `@theme inline` so every new token becomes a Tailwind class, then restyle every page/component to match the prototype. New work is a `ContextPanel` component in the chat view. No data-layer changes — all work is presentational.

**Tech Stack:** React 19, Tailwind v4, shadcn/ui, React Router v6, React Query, lucide-react, `@fontsource-variable/hanken-grotesk`

**Design reference:** `design/unnamed UI - Soft Minimal.html` (prototype) and `design/styles.css` (token source)

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `web/package.json` | modify | add `@fontsource-variable/hanken-grotesk` |
| `web/src/index.css` | modify | Slate token values, Hanken Grotesk import, new CSS vars, updated `@theme inline` |
| `web/src/components/Sidebar.tsx` | modify | remove UserMenu, inline settings link + theme toggle in footer |
| `web/src/components/UserMenu.tsx` | delete | replaced by inline controls |
| `web/src/pages/AppLayout.tsx` | modify | mobile topbar classes |
| `web/src/components/ui/app-layout.tsx` | modify | Surface, PageHeader, PageBody, ContentColumn tokens |
| `web/src/pages/ProjectsPage.tsx` | modify | card grid, project card markup |
| `web/src/pages/ProjectPage.tsx` | modify | tab bar, all tab panels (Overview, Campaigns, Files, Settings) |
| `web/src/pages/CampaignPage.tsx` | modify | campaign detail layout + all sub-sections |
| `web/src/pages/ActivityPage.tsx` | modify | activity rows, attention rows |
| `web/src/components/ExecutionCard.tsx` | modify | card shell, status pills, log output |
| `web/src/components/MessageList.tsx` | modify | user bubble, bot message, system line |
| `web/src/components/MessageInput.tsx` | modify | composer box + send button |
| `web/src/components/ContextPanel.tsx` | **create** | right-side / bottom-sheet context panel |
| `web/src/components/ChatView.tsx` | modify | layout split, scope chip, context panel wiring, approval banner |

---

## Task 1: Install Hanken Grotesk + Update Token Layer

**Files:**
- Modify: `web/package.json`
- Modify: `web/src/index.css`

- [ ] **Step 1: Install the font package**

```bash
cd web && npm install @fontsource-variable/hanken-grotesk
```

Expected: package added to `web/node_modules`, `web/package.json` updated.

- [ ] **Step 2: Replace `index.css` entirely**

> This is the single source of truth for all design tokens. Replace the whole file.

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@fontsource-variable/hanken-grotesk";

@custom-variant dark (&:where([data-theme="unnamed-dark"], [data-theme="unnamed-dark"] *));

@theme inline {
  /* ---- Typography ---- */
  --font-heading: var(--font-sans);
  --font-sans: "Hanken Grotesk Variable", system-ui, sans-serif;

  /* ---- Colour aliases → Tailwind classes ---- */
  --color-background:          var(--background);
  --color-foreground:          var(--foreground);
  --color-fg-soft:             var(--fg-soft);
  --color-faint-fg:            var(--faint-fg);
  --color-card:                var(--card);
  --color-card-foreground:     var(--card-foreground);
  --color-popover:             var(--popover);
  --color-popover-foreground:  var(--popover-foreground);
  --color-primary:             var(--primary);
  --color-primary-foreground:  var(--primary-foreground);
  --color-secondary:           var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted:               var(--muted);
  --color-muted-foreground:    var(--muted-foreground);
  --color-accent:              var(--accent);
  --color-accent-foreground:   var(--accent-foreground);
  --color-accent-tint:         var(--accent-tint);
  --color-on-accent-soft:      var(--on-accent-soft);
  --color-destructive:         var(--destructive);
  --color-border:              var(--border);
  --color-border-soft:         var(--border-soft);
  --color-input:               var(--input);
  --color-ring:                var(--ring);
  --color-success:             var(--success);
  --color-warning:             var(--warning);
  --color-sidebar:             var(--sidebar);
  --color-sidebar-foreground:  var(--sidebar-foreground);
  --color-sidebar-primary:     var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent:      var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border:      var(--sidebar-border);
  --color-sidebar-ring:        var(--sidebar-ring);

  /* ---- Radius scale ---- */
  --radius-sm:  calc(var(--radius) * 0.62);
  --radius-md:  calc(var(--radius) * 0.8);
  --radius-lg:  var(--radius);
  --radius-xl:  calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.9);
}

/* ================================================================
   SLATE · LIGHT
   ================================================================ */
:root,
[data-theme="unnamed-light"] {
  color-scheme: light;

  /* Surfaces */
  --background:  oklch(0.983 0.004 250);
  --card:        oklch(1 0 0);
  --muted:       oklch(0.97 0.005 250);
  --popover:     oklch(1 0 0);

  /* Foreground hierarchy */
  --foreground:        oklch(0.31 0.013 258);
  --fg-soft:           oklch(0.43 0.014 258);
  --muted-foreground:  oklch(0.57 0.014 256);
  --faint-fg:          oklch(0.69 0.012 256);
  --card-foreground:   var(--foreground);
  --popover-foreground: var(--foreground);

  /* Borders */
  --border:      oklch(0.925 0.006 250);
  --border-soft: oklch(0.955 0.005 250);
  --input:       oklch(0.925 0.006 250);

  /* Interactive blue */
  --primary:             oklch(0.58 0.085 252);
  --primary-foreground:  oklch(0.99 0.004 250);
  --accent-tint:         oklch(0.95 0.025 252);
  --on-accent-soft:      oklch(0.5 0.09 252);

  /* Shadcn accent (hover surfaces — neutral) */
  --accent:            oklch(0.97 0.005 250);
  --accent-foreground: oklch(0.31 0.013 258);

  /* Secondary */
  --secondary:             oklch(0.97 0.005 250);
  --secondary-foreground:  oklch(0.31 0.013 258);

  /* Semantic */
  --success:     oklch(0.6 0.09 165);
  --warning:     oklch(0.7 0.1 70);
  --destructive: oklch(0.58 0.2 25);

  /* Focus ring */
  --ring: color-mix(in oklch, oklch(0.58 0.085 252) 55%, transparent);

  /* Sidebar */
  --sidebar:                     oklch(0.97 0.005 250);
  --sidebar-foreground:          oklch(0.31 0.013 258);
  --sidebar-primary:             oklch(0.58 0.085 252);
  --sidebar-primary-foreground:  oklch(0.99 0.004 250);
  --sidebar-accent:              oklch(1 0 0);
  --sidebar-accent-foreground:   oklch(0.31 0.013 258);
  --sidebar-border:              oklch(0.955 0.005 250);
  --sidebar-ring:                var(--ring);

  /* Base radius = 18 px */
  --radius: 1.125rem;
}

/* ================================================================
   SLATE · DARK
   ================================================================ */
[data-theme="unnamed-dark"] {
  color-scheme: dark;

  /* Surfaces */
  --background: oklch(0.19 0.011 258);
  --card:       oklch(0.232 0.013 258);
  --muted:      oklch(0.214 0.012 258);
  --popover:    oklch(0.255 0.014 258);

  /* Foreground hierarchy */
  --foreground:        oklch(0.93 0.006 258);
  --fg-soft:           oklch(0.83 0.008 258);
  --muted-foreground:  oklch(0.67 0.012 256);
  --faint-fg:          oklch(0.55 0.012 256);
  --card-foreground:   var(--foreground);
  --popover-foreground: var(--foreground);

  /* Borders */
  --border:      oklch(1 0 0 / 8%);
  --border-soft: oklch(1 0 0 / 4.5%);
  --input:       oklch(1 0 0 / 10%);

  /* Interactive blue */
  --primary:             oklch(0.7 0.1 256);
  --primary-foreground:  oklch(0.18 0.02 258);
  --accent-tint:         oklch(0.5 0.1 256 / 0.2);
  --on-accent-soft:      oklch(0.78 0.09 256);

  /* Shadcn accent (hover surfaces — neutral) */
  --accent:            oklch(0.214 0.012 258);
  --accent-foreground: oklch(0.93 0.006 258);

  /* Secondary */
  --secondary:             oklch(0.214 0.012 258);
  --secondary-foreground:  oklch(0.93 0.006 258);

  /* Semantic */
  --success:     oklch(0.74 0.1 165);
  --warning:     oklch(0.78 0.1 70);
  --destructive: oklch(0.68 0.19 24);

  /* Focus ring */
  --ring: color-mix(in oklch, oklch(0.7 0.1 256) 55%, transparent);

  /* Sidebar */
  --sidebar:                     oklch(0.214 0.012 258);
  --sidebar-foreground:          oklch(0.93 0.006 258);
  --sidebar-primary:             oklch(0.7 0.1 256);
  --sidebar-primary-foreground:  oklch(0.18 0.02 258);
  --sidebar-accent:              oklch(0.255 0.014 258);
  --sidebar-accent-foreground:   oklch(0.93 0.006 258);
  --sidebar-border:              oklch(1 0 0 / 4.5%);
  --sidebar-ring:                var(--ring);
}

/* ================================================================
   BASE LAYER
   ================================================================ */
@layer base {
  *,
  *::before,
  *::after {
    @apply border-border outline-ring/50;
    box-sizing: border-box;
  }

  html,
  body,
  #root {
    height: 100%;
  }

  body {
    @apply bg-background text-foreground font-sans;
    font-size: 15px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  button,
  input,
  textarea,
  select {
    font: inherit;
  }
}

/* ================================================================
   SCROLLBAR
   ================================================================ */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: color-mix(in oklch, var(--muted-foreground) 25%, transparent);
  border-radius: 999px;
}
```

- [ ] **Step 3: Start dev server and visually confirm the palette loaded**

```bash
cd web && npm run dev
```

Open `http://localhost:5173`. The sidebar should now have a cool blue-grey tint and Hanken Grotesk text. Check light + dark by toggling the theme (currently still in the UserMenu dropdown).

- [ ] **Step 4: Commit**

```bash
cd web && git add package.json package-lock.json src/index.css
git commit -m "feat: Slate token layer + Hanken Grotesk"
```

---

## Task 2: Update Sidebar — Remove UserMenu, Inline Settings + Theme Toggle

**Files:**
- Modify: `web/src/components/Sidebar.tsx`
- Delete: `web/src/components/UserMenu.tsx`

- [ ] **Step 1: Replace Sidebar.tsx**

Replace the full file content:

```tsx
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MessagesSquare, LayoutGrid, Activity, Settings, Sun, Moon } from 'lucide-react';
import { getChats, createChat } from '../lib/api.js';
import { timeAgo, cn } from '../lib/utils.js';
import { useTheme } from '../lib/useTheme.js';
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '@/components/ui/sidebar';
import type { Session } from '../types.js';

const RECENT_COUNT = 5;

interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
  pendingApprovalCount?: number;
}

export default function Sidebar({ className, onNavigate, pendingApprovalCount = 0 }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isMobile, setOpenMobile } = useSidebar();
  const { theme, toggleTheme } = useTheme();

  const { data: chats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });

  async function handleNewChat() {
    try {
      const { id } = await createChat();
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      navigate(`/c/${id}`);
      closeSidebar();
    } catch (err) {
      console.error('Failed to create chat:', err);
    }
  }

  const activeChatId = location.pathname.startsWith('/c/')
    ? location.pathname.split('/')[2]
    : null;

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  const recentChats = chats.slice(0, RECENT_COUNT);

  function closeSidebar() {
    onNavigate?.();
    if (isMobile) setOpenMobile(false);
  }

  function go(path: string) {
    navigate(path);
    closeSidebar();
  }

  return (
    <SidebarRoot
      className={cn('border-r border-sidebar-border bg-sidebar', className)}
      collapsible="offcanvas"
    >
      {/* ---- Header ---- */}
      <SidebarHeader className="gap-3 px-3 py-3">
        <div className="flex items-center gap-2 px-1">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground shadow-sm">
            u
          </div>
          <span className="text-sm font-semibold">unnamed</span>
        </div>
        <button
          onClick={handleNewChat}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-[filter] hover:brightness-105 active:translate-y-px"
        >
          <Plus size={14} strokeWidth={2} />
          New chat
        </button>
      </SidebarHeader>

      {/* ---- Nav + Recent ---- */}
      <SidebarContent>
        <SidebarGroup className="pb-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem
                icon={<Activity size={15} strokeWidth={1.75} />}
                label="Activity"
                active={isActive('/activity')}
                onClick={() => go('/activity')}
                badge={pendingApprovalCount > 0 ? pendingApprovalCount : undefined}
              />
              <NavItem
                icon={<MessagesSquare size={15} strokeWidth={1.75} />}
                label="Chats"
                active={isActive('/chats')}
                onClick={() => go('/chats')}
              />
              <NavItem
                icon={<LayoutGrid size={15} strokeWidth={1.75} />}
                label="Projects"
                active={isActive('/projects')}
                onClick={() => go('/projects')}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {recentChats.length > 0 && (
          <SidebarGroup className="min-h-0 flex-1 pt-1">
            <SidebarGroupLabel className="h-6 px-2 text-[11px] font-semibold uppercase tracking-wide text-faint-fg">
              Recent
            </SidebarGroupLabel>
            <SidebarGroupContent className="min-h-0 flex-1">
              <div className="min-w-0 overflow-hidden">
                <ul className="flex w-full flex-col gap-0 pb-2 pr-1">
                  {recentChats.map(chat => (
                    <li key={chat.id} className="w-full min-w-0">
                      <button
                        aria-label={`Open chat: ${chat.title ?? 'Untitled'}`}
                        onClick={() => go(`/c/${chat.id}`)}
                        className={cn(
                          'flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent',
                          activeChatId === chat.id &&
                            'bg-sidebar-accent shadow-xs ring-1 ring-sidebar-border',
                        )}
                      >
                        <span className="block truncate text-xs font-medium text-foreground">
                          {chat.title ?? 'Untitled chat'}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-faint-fg">
                          {timeAgo(chat.updated_at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {recentChats.length === 0 && <div className="flex-1" />}
      </SidebarContent>

      {/* ---- Footer: Settings + Theme toggle ---- */}
      <SidebarFooter className="border-t border-sidebar-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => go('/settings')}
            className={cn(
              'flex flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
              isActive('/settings') && 'bg-sidebar-accent text-foreground',
            )}
          >
            <Settings size={14} strokeWidth={1.75} />
            Settings
          </button>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-sidebar-border text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            {theme === 'unnamed-dark'
              ? <Sun size={14} strokeWidth={1.75} />
              : <Moon size={14} strokeWidth={1.75} />}
          </button>
        </div>
      </SidebarFooter>
    </SidebarRoot>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={onClick}
        className={cn(
          'h-9 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
          active && 'bg-sidebar-accent text-foreground shadow-xs ring-1 ring-sidebar-border/60',
        )}
      >
        {icon}
        <span className="flex-1">{label}</span>
        {badge != null && (
          <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-amber-900">
            {badge}
          </span>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
```

- [ ] **Step 2: Delete UserMenu.tsx**

```bash
rm web/src/components/UserMenu.tsx
```

- [ ] **Step 3: Verify no remaining imports of UserMenu**

```bash
grep -r "UserMenu" web/src/
```

Expected: no output.

- [ ] **Step 4: Verify existing sidebar tests still pass**

```bash
cd web && npm test -- --run 2>&1 | tail -20
```

Expected: no failures (sidebar tests are integration-light; the component renders without UserMenu).

- [ ] **Step 5: Visual check**

In the browser, sidebar footer should now show "Settings" text link + sun/moon icon button side by side. No user avatar dropdown.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Sidebar.tsx && git rm web/src/components/UserMenu.tsx
git commit -m "feat: sidebar footer — inline settings + theme toggle, remove UserMenu"
```

---

## Task 3: Update AppLayout Mobile Header

**Files:**
- Modify: `web/src/pages/AppLayout.tsx`

The mobile topbar (shown when sidebar is closed) needs to match the Slate design: brand mark uses `bg-primary`, sidebar trigger uses new border style.

- [ ] **Step 1: Update the mobile topbar div inside AppLayout.tsx**

Find the `<div className="flex h-14 ...">` block inside the `SidebarInset` and replace it:

```tsx
<div className="flex h-12 shrink-0 items-center justify-between border-b border-border-soft bg-background px-4 md:hidden">
  <div className="flex items-center gap-2">
    <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground shadow-sm">
      u
    </div>
    <span className="text-sm font-semibold">unnamed</span>
  </div>
  <SidebarTrigger
    aria-label="Open navigation"
    className="size-8 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
  />
</div>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/AppLayout.tsx
git commit -m "feat: mobile topbar — Slate token classes"
```

---

## Task 4: Update Layout Primitive Components

**Files:**
- Modify: `web/src/components/ui/app-layout.tsx`

- [ ] **Step 1: Replace app-layout.tsx**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

function PageShell({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)} {...props}>
      {children}
    </div>
  );
}

function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('shrink-0 border-b border-border-soft px-5 py-4', className)}>
      {breadcrumb && <div className="mb-1.5">{breadcrumb}</div>}
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h1 className="truncate text-[15px] font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {description && (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
    </header>
  );
}

function PageBody({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex-1 overflow-y-auto px-5 py-5', className)}
      {...props}
    >
      {children}
    </div>
  );
}

function ContentColumn({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('mx-auto w-full max-w-4xl', className)} {...props}>
      {children}
    </div>
  );
}

function PageSection({
  title,
  children,
  className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <h2 className="text-[13px] font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** Bordered card surface. `interactive` adds lift-on-hover. */
function Surface({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<'div'> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border-soft bg-card',
        interactive &&
          'cursor-pointer transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-px hover:border-border hover:shadow-md',
        className,
      )}
      {...props}
    />
  );
}

function EmptyPanel({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 text-sm',
        className,
      )}
    >
      <div className="font-medium text-foreground">{title}</div>
      {description && (
        <div className="mt-1 leading-relaxed text-muted-foreground">{description}</div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function CenteredEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-1 items-center justify-center px-6', className)}>
      <div className="w-full max-w-sm text-center">
        <p className="text-base font-semibold tracking-tight text-foreground">{title}</p>
        {description && (
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-[filter] hover:brightness-105"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function PageLoading({ className, rows = 3 }: { className?: string; rows?: number }) {
  return (
    <PageBody className={className}>
      <ContentColumn className="space-y-4">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-muted" />
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-20 animate-pulse rounded-xl bg-muted',
              i % 2 === 1 && 'w-2/3',
            )}
          />
        ))}
      </ContentColumn>
    </PageBody>
  );
}

export {
  CenteredEmptyState,
  ContentColumn,
  EmptyPanel,
  PageBody,
  PageHeader,
  PageLoading,
  PageSection,
  PageShell,
  Surface,
};
```

- [ ] **Step 2: Run tests**

```bash
cd web && npm test -- --run 2>&1 | tail -20
```

Expected: all pass (tests import from this file but don't assert on class names).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ui/app-layout.tsx
git commit -m "feat: layout primitives — Slate token classes"
```

---

## Task 5: Restyle Projects Page

**Files:**
- Modify: `web/src/pages/ProjectsPage.tsx`

- [ ] **Step 1: Replace the `ProjectCard` function**

Find the `function ProjectCard(...)` block and replace it with:

```tsx
function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const { data: campaigns = [] } = useQuery({
    queryKey: ['project-campaigns', project.id],
    queryFn: () => getProjectCampaigns(project.id),
    staleTime: 30_000,
  });
  const { data: caps } = useQuery({
    queryKey: ['project-capabilities', project.id],
    queryFn: () => getProjectCapabilities(project.id),
    staleTime: 30_000,
  });
  const runningCount = campaigns.filter(c => c.status === 'running').length;

  return (
    <Surface
      interactive
      as="button"
      className="flex h-full w-full flex-col gap-2.5 p-4 text-left"
      onClick={() => navigate(`/projects/${project.id}`)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {project.repo_path
            ? <FolderGit2 size={15} className="shrink-0 text-muted-foreground" />
            : <FileText size={15} className="shrink-0 text-muted-foreground" />}
          <span className="truncate text-sm font-semibold text-foreground">{project.name}</span>
        </div>
        {runningCount > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-on-accent-soft">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            {runningCount} running
          </span>
        )}
      </div>
      {project.description && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {project.description}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint-fg">
        <span>{project.repo_path ? 'code repo' : 'doc project'}</span>
        {caps?.has_graph && (
          <span className="flex items-center gap-1">
            <span className="text-border">·</span>
            <GitGraph size={10} className="shrink-0" />
            graph
          </span>
        )}
        {caps?.has_media && (
          <span className="flex items-center gap-1">
            <span className="text-border">·</span>
            <Video size={10} className="shrink-0" />
            videos
          </span>
        )}
        <span className="text-border">·</span>
        <span>{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}</span>
      </div>
    </Surface>
  );
}
```

> Note: `Surface` doesn't natively render as `<button>`. Change the `Surface` `div` → use a wrapper button instead:

Actually `Surface` renders a `div`. Wrap with a button instead:

```tsx
  return (
    <button
      className="block h-full w-full rounded-xl text-left"
      onClick={() => navigate(`/projects/${project.id}`)}
    >
      <Surface interactive className="flex h-full flex-col gap-2.5 p-4">
        {/* ... content same as above ... */}
      </Surface>
    </button>
  );
```

- [ ] **Step 2: Update the `ProjectsPage` grid container**

Find the grid `<div className="grid ...">` that wraps project cards and update to:

```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
  {projects.map(p => <ProjectCard key={p.id} project={p} />)}
</div>
```

- [ ] **Step 3: Update the "New project" button in the PageHeader actions**

```tsx
<button
  onClick={() => setDialogOpen(true)}
  className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-fg-soft shadow-xs transition-colors hover:border-muted-foreground hover:text-foreground"
>
  <Plus size={14} strokeWidth={2} />
  New project
</button>
```

- [ ] **Step 4: Run tests**

```bash
cd web && npm test -- --run 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ProjectsPage.tsx
git commit -m "feat: projects page — Slate design"
```

---

## Task 6: Restyle Project Detail Page

**Files:**
- Modify: `web/src/pages/ProjectPage.tsx`

This file has tabs (Overview, Campaigns, Files, Settings). Update each section.

- [ ] **Step 1: Update the tab bar**

Find the `<Tabs ...>` / `<TabsList ...>` render and replace with a custom tab bar to match the underline design:

```tsx
{/* Tab bar */}
<div className="flex shrink-0 gap-0 overflow-x-auto border-b border-border-soft px-5">
  {TABS.map(t => (
    <Link
      key={t.id}
      to={tabHref(projectId!, t.id)}
      className={cn(
        'border-b-2 px-1 pb-3 pt-3 text-sm font-medium whitespace-nowrap transition-colors',
        'mx-3 first:ml-0',
        tab === t.id
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-fg-soft',
      )}
    >
      {t.label}
    </Link>
  ))}
</div>
```

Define `TABS` near the top of the component:

```tsx
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'files', label: 'Files' },
  { id: 'settings', label: 'Settings' },
];
```

- [ ] **Step 2: Update OverviewTab — stat cards**

Find where stat counts are rendered (usually `bg-card` blocks). Replace with:

```tsx
{/* Stat grid */}
<div className="grid grid-cols-3 gap-4">
  {[
    { label: 'Campaigns', value: campaigns.length, onClick: () => navigate(tabHref(projectId!, 'campaigns')) },
    { label: 'Artifacts', value: artifactsCount },
    { label: 'Running now', value: runningCount },
  ].map(s => (
    <button
      key={s.label}
      onClick={s.onClick}
      disabled={!s.onClick}
      className="rounded-xl border border-border-soft bg-card p-4 text-left transition-[transform,box-shadow,border-color] hover:enabled:-translate-y-px hover:enabled:border-border hover:enabled:shadow-md disabled:cursor-default"
    >
      <div className="text-2xl font-semibold tracking-tight text-foreground">{s.value}</div>
      <div className="mt-1.5 text-xs text-muted-foreground">{s.label}</div>
    </button>
  ))}
</div>
```

- [ ] **Step 3: Update campaign rows**

Replace each campaign row's className block:

```tsx
<button
  key={c.id}
  className="flex w-full items-center gap-3 rounded-xl border border-border-soft bg-card p-4 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-md"
  onClick={() => navigate(`/projects/${projectId}/campaigns/${c.id}`)}
>
  {/* main */}
  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold text-foreground">{c.name}</span>
      <StatusPill status={c.status} />
    </div>
    {c.description && (
      <p className="text-xs leading-relaxed text-muted-foreground">{c.description}</p>
    )}
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint-fg">
      <span>{c.chat_count ?? 0} chats</span>
      <span className="text-border">·</span>
      <span>updated {timeAgo(c.updated_at)}</span>
    </div>
  </div>
  <ChevronRight size={15} className="shrink-0 text-faint-fg" />
</button>
```

Add a small `StatusPill` helper at the top of the file (or import if one exists):

```tsx
function StatusPill({ status }: { status: Campaign['status'] }) {
  const styles: Record<Campaign['status'], string> = {
    running: 'bg-primary/10 text-on-accent-soft',
    done: 'bg-success/10 text-success',
    error: 'bg-destructive/10 text-destructive',
    cancelled: 'bg-muted text-muted-foreground',
  };
  const labels: Record<Campaign['status'], string> = {
    running: 'Running', done: 'Done', error: 'Error', cancelled: 'Cancelled',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', styles[status])}>
      {status === 'running' && <span className="mr-1 size-1.5 animate-pulse rounded-full bg-primary" />}
      {labels[status]}
    </span>
  );
}
```

- [ ] **Step 4: Update Settings tab inputs**

Find the settings form fields and update to:
```tsx
<input
  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-faint-fg focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
  ...
/>
<textarea
  className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-faint-fg focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
  ...
/>
```

Danger zone block:
```tsx
<div className="flex items-center justify-between gap-4 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
  <div>
    <div className="text-sm font-medium text-foreground">Delete project</div>
    <div className="mt-0.5 text-xs text-muted-foreground">Permanently remove this project and all its campaigns.</div>
  </div>
  <button
    onClick={handleDelete}
    className="rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-white transition-[filter] hover:brightness-105"
  >
    Delete
  </button>
</div>
```

- [ ] **Step 5: Run tests**

```bash
cd web && npm test -- --run 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/ProjectPage.tsx
git commit -m "feat: project detail page — Slate design"
```

---

## Task 7: Restyle Campaign Page

**Files:**
- Modify: `web/src/pages/CampaignPage.tsx`

- [ ] **Step 1: Update status pills at top of file**

Replace the `CAMPAIGN_STATUS_COLORS` and inline status badge classes to use the same `StatusPill` pattern. At the top of the file, after imports:

```tsx
function StatusPill({ status }: { status: Campaign['status'] }) {
  const styles: Record<Campaign['status'], string> = {
    running: 'bg-primary/10 text-on-accent-soft',
    done:    'bg-success/10 text-success',
    error:   'bg-destructive/10 text-destructive',
    cancelled: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium', styles[status])}>
      {status === 'running' && <span className="size-1.5 animate-pulse rounded-full bg-primary" />}
      {{ running: 'Running', done: 'Done', error: 'Error', cancelled: 'Cancelled' }[status]}
    </span>
  );
}
```

- [ ] **Step 2: Update the outer layout to two-column**

The campaign detail should use a main column + sticky aside layout. Wrap the `PageBody` content:

```tsx
<div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_17rem] lg:items-start">
  {/* Left column */}
  <div className="flex flex-col gap-6">
    {/* Progress block */}
    {/* Tasks block */}
    {/* Chats block */}
  </div>
  {/* Right aside (sticky on large screens) */}
  <aside className="flex flex-col gap-4 lg:sticky lg:top-0">
    {/* Info card */}
    {/* Team card */}
    {/* Recent activity mini timeline */}
  </aside>
</div>
```

- [ ] **Step 3: Style each aside card**

Info card (status, branch, started, last active):

```tsx
<div className="rounded-xl border border-border-soft bg-card p-4 flex flex-col gap-3">
  {[
    { label: 'Status', value: <StatusPill status={campaignStatus ?? data.campaign.status} /> },
    { label: 'Branch', value: <code className="font-mono text-xs text-fg-soft truncate max-w-36">{data.campaign.branch ?? 'main'}</code> },
    { label: 'Started', value: <span className="text-sm font-medium">{timeAgo(data.campaign.created_at)}</span> },
    { label: 'Last active', value: <span className="text-sm font-medium">{timeAgo(data.campaign.updated_at)}</span> },
  ].map(row => (
    <div key={row.label} className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{row.label}</span>
      {row.value}
    </div>
  ))}
</div>
```

- [ ] **Step 4: Style task checklist rows**

```tsx
{data.tasks.map(task => {
  const status = taskStatuses[task.id] ?? task.status;
  const done = status === 'done';
  return (
    <div
      key={task.id}
      className={cn(
        'flex items-center gap-3 border-b border-border-soft py-2.5 text-sm last:border-b-0',
        done ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      <span className={cn(
        'grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors',
        done ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
      )}>
        {done && <Check size={11} strokeWidth={2.5} />}
      </span>
      <span className={cn('flex-1', done && 'line-through decoration-faint-fg decoration-1')}>{task.label ?? task.agent}</span>
      <StatusDot status={status} />
    </div>
  );
})}
```

Where `StatusDot` is a small coloured circle:

```tsx
function StatusDot({ status }: { status: CampaignTask['status'] }) {
  const cls: Record<CampaignTask['status'], string> = {
    waiting: 'bg-faint-fg',
    running: 'bg-primary animate-pulse',
    done:    'bg-success',
    error:   'bg-destructive',
  };
  return <span className={cn('size-1.5 shrink-0 rounded-full', cls[status])} />;
}
```

- [ ] **Step 5: Run tests**

```bash
cd web && npm test -- --run 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/CampaignPage.tsx
git commit -m "feat: campaign page — Slate design"
```

---

## Task 8: Restyle Activity Page

**Files:**
- Modify: `web/src/pages/ActivityPage.tsx`

- [ ] **Step 1: Update activity row styles**

Find where activity rows (campaigns needing attention vs. recent) are rendered. Replace row class strings:

Normal row:
```tsx
<div className="flex items-center gap-3 rounded-xl border border-border-soft bg-card p-4">
  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
    <StatusIcon size={16} className={STATUS_ICON_CLASS[effectiveStatus]} />
  </div>
  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
    <span className="text-sm font-medium text-foreground">{row.project_name} · {row.name}</span>
    <span className="text-xs text-muted-foreground">{row.description}</span>
  </div>
  <div className="flex shrink-0 items-center gap-2">
    <span className="text-[11px] text-faint-fg">{timeAgo(row.updated_at)}</span>
    <StatusPill status={effectiveStatus} />
  </div>
</div>
```

Attention row (pending approval):
```tsx
<div className="flex items-center gap-3 rounded-xl border border-warning/35 bg-warning/5 p-4">
  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
    <Bell size={16} />
  </div>
  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
    <span className="text-sm font-medium text-foreground">{approval.action}</span>
    <span className="text-xs text-muted-foreground">Awaiting your approval</span>
  </div>
  <div className="flex shrink-0 items-center gap-2">
    <button
      onClick={() => handleReject(approval.executionId)}
      className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      Deny
    </button>
    <button
      onClick={() => handleApprove(approval.executionId)}
      className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-[filter] hover:brightness-105"
    >
      <Check size={12} strokeWidth={2.5} />
      Approve
    </button>
  </div>
</div>
```

- [ ] **Step 2: Update section labels**

```tsx
<h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
  Needs your attention
</h2>
```

- [ ] **Step 3: Run tests**

```bash
cd web && npm test -- --run 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/ActivityPage.tsx
git commit -m "feat: activity page — Slate design"
```

---

## Task 9: Restyle Execution Cards + Message Components

**Files:**
- Modify: `web/src/components/ExecutionCard.tsx`
- Modify: `web/src/components/MessageList.tsx`
- Modify: `web/src/components/MessageInput.tsx`

### ExecutionCard

- [ ] **Step 1: Update ExecutionCard shell and status badge classes**

Find the outer card wrapper in `ExecutionCard.tsx` and update:

```tsx
{/* Outer card */}
<div className={cn(
  'overflow-hidden rounded-xl border bg-card',
  status === 'awaiting_approval'
    ? 'border-warning/35'
    : 'border-border-soft',
)}>
  {/* Header row */}
  <div className="flex items-center gap-2.5 px-3.5 py-3">
    <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
      <ToolIcon size={14} />
    </div>
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="text-xs font-medium text-foreground">{tool}</span>
      {projectName && <span className="text-[11px] text-faint-fg">{projectName}</span>}
    </div>
    <StatusBadge status={status} />
  </div>
  {/* Log body */}
  {outputLog && <OutputLog outputLog={outputLog} result={result} />}
  {/* Approval actions */}
  {needsApproval && approvalId && (
    <ApprovalActions approvalId={approvalId} executionId={executionId} action={action} />
  )}
</div>
```

Update `StatusBadge` helper:

```tsx
function StatusBadge({ status }: { status: ExecutionStatus }) {
  const styles: Record<ExecutionStatus, string> = {
    pending:           'bg-muted text-muted-foreground',
    running:           'bg-primary/10 text-on-accent-soft',
    done:              'bg-success/10 text-success',
    error:             'bg-destructive/10 text-destructive',
    awaiting_approval: 'bg-warning/15 text-amber-700 dark:text-amber-300',
  };
  const labels: Record<ExecutionStatus, string> = {
    pending: 'Pending', running: 'Running', done: 'Done',
    error: 'Error', awaiting_approval: 'Approval',
  };
  return (
    <span className={cn('flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', styles[status])}>
      {status === 'running' && <span className="size-1.5 animate-pulse rounded-full bg-primary" />}
      {status === 'awaiting_approval' && <Bell size={10} />}
      {labels[status]}
    </span>
  );
}
```

Update `OutputLog` inner pre:

```tsx
<div
  role="log"
  className="max-h-44 overflow-y-auto px-3.5 py-3 font-mono text-[12px] leading-relaxed text-muted-foreground whitespace-pre-wrap"
>
  {displayed}
</div>
```

Update the log container border:

```tsx
<div className="border-t border-border-soft bg-muted/20">
```

### MessageList

- [ ] **Step 2: Update user bubble class**

Find `msg-user` / user bubble wrapper and update:

```tsx
<div className="flex justify-end">
  <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-muted px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
    {message.content}
  </div>
</div>
```

- [ ] **Step 3: Update bot message wrapper class**

```tsx
<div className="max-w-[90%] text-[15px] leading-[1.72] text-fg-soft">
  <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
    {content}
  </ReactMarkdown>
</div>
```

- [ ] **Step 4: Update markdown component classes**

```tsx
const markdownComponents = {
  p:      ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  code:   ({ children }) => (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground/85">{children}</code>
  ),
  pre:    ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-xl border border-border-soft bg-muted/30 p-3 font-mono text-[12px] leading-relaxed">{children}</pre>
  ),
  ul: ({ children }) => <ul className="mb-3 ml-5 list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 ml-5 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
};
```

### MessageInput

- [ ] **Step 5: Update MessageInput composer box**

Replace the outer wrapper and box divs:

```tsx
<div className="shrink-0 px-5 pb-5 pt-3">
  <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border-soft bg-card px-3 pb-2.5 pt-2.5 shadow-sm">
    <Textarea
      ref={textareaRef}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={disabled ? 'Agent is responding…' : 'Message…'}
      disabled={disabled}
      rows={1}
      className="max-h-44 min-h-[1.5rem] flex-1 resize-none border-0 bg-transparent px-1 py-1 text-[15px] shadow-none placeholder:text-faint-fg focus-visible:ring-0"
    />
    <button
      onClick={submit}
      disabled={disabled || !value.trim()}
      title="Send"
      className={cn(
        'mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-[filter]',
        value.trim() && !disabled
          ? 'bg-primary text-primary-foreground hover:brightness-105'
          : 'bg-muted text-faint-fg cursor-default',
      )}
    >
      <ArrowUp size={16} strokeWidth={2} />
    </button>
  </div>
</div>
```

- [ ] **Step 6: Run tests**

```bash
cd web && npm test -- --run 2>&1 | tail -20
```

- [ ] **Step 7: Commit**

```bash
git add web/src/components/ExecutionCard.tsx web/src/components/MessageList.tsx web/src/components/MessageInput.tsx
git commit -m "feat: chat components — Slate design (execution cards, messages, composer)"
```

---

## Task 10: Build ContextPanel Component

**Files:**
- Create: `web/src/components/ContextPanel.tsx`

The context panel is a collapsible right-side drawer on desktop and a bottom sheet on mobile. It shows: current project, working branch + merge action, pending approval, and artifacts.

- [ ] **Step 1: Create ContextPanel.tsx**

```tsx
import { X, GitMerge, Check, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Session, Project } from '../types.js';

interface Approval {
  executionId: string;
  approvalId: string;
  action: string;
}

interface ContextPanelProps {
  open: boolean;
  onClose: () => void;
  project: Project | null;
  worktree: { branch: string; commits_ahead: number } | null;
  pendingApproval: Approval | null;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
  onMerge: () => void;
  mergeState: 'idle' | 'merging' | 'done' | 'error';
}

export default function ContextPanel({
  open,
  onClose,
  project,
  worktree,
  pendingApproval,
  onApprove,
  onDeny,
  onMerge,
  mergeState,
}: ContextPanelProps) {
  return (
    <>
      {/* Desktop: slide-in right panel */}
      <aside
        className={cn(
          'hidden shrink-0 overflow-hidden border-l border-border-soft bg-muted transition-[width] duration-300 ease-in-out md:block',
          open ? 'w-72' : 'w-0 border-l-transparent',
        )}
      >
        <div className="w-72 overflow-y-auto h-full">
          <PanelContent
            onClose={onClose}
            project={project}
            worktree={worktree}
            pendingApproval={pendingApproval}
            onApprove={onApprove}
            onDeny={onDeny}
            onMerge={onMerge}
            mergeState={mergeState}
          />
        </div>
      </aside>

      {/* Mobile: bottom sheet */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={onClose}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-background shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="mx-auto mt-2 h-1 w-8 rounded-full bg-border" />
            <PanelContent
              onClose={onClose}
              project={project}
              worktree={worktree}
              pendingApproval={pendingApproval}
              onApprove={onApprove}
              onDeny={onDeny}
              onMerge={onMerge}
              mergeState={mergeState}
            />
          </div>
        </div>
      )}
    </>
  );
}

function PanelContent({
  onClose,
  project,
  worktree,
  pendingApproval,
  onApprove,
  onDeny,
  onMerge,
  mergeState,
}: Omit<ContextPanelProps, 'open'>) {
  return (
    <div className="flex flex-col gap-5 p-4 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Context</span>
        <button
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>

      {/* Project */}
      {project && (
        <section className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Project</span>
          <div className="flex items-center gap-2.5 rounded-xl border border-border-soft bg-card p-3">
            <span className="size-2 shrink-0 rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_oklch,var(--success)_22%,transparent)]" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{project.name}</div>
              <div className="text-[11px] text-faint-fg">{project.description ?? (project.repo_path ? 'code repo' : 'doc project')}</div>
            </div>
          </div>
        </section>
      )}

      {/* Branch */}
      {worktree && (
        <section className="flex flex-col gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">Working branch</span>
          <div className="flex items-center gap-2 text-sm">
            <GitMerge size={13} className="shrink-0 text-muted-foreground" />
            <code className="font-mono text-xs text-fg-soft">{worktree.branch}</code>
          </div>
          <div className="text-[11px] text-faint-fg">
            {worktree.commits_ahead} commit{worktree.commits_ahead !== 1 ? 's' : ''} ahead
          </div>
          <button
            onClick={onMerge}
            disabled={mergeState === 'merging' || mergeState === 'done'}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-[filter] hover:enabled:brightness-105 disabled:opacity-60"
          >
            {mergeState === 'merging' ? 'Merging…' : mergeState === 'done' ? 'Merged ✓' : 'Merge to main'}
          </button>
          {mergeState === 'error' && (
            <p className="text-[11px] text-destructive">Merge failed — check branch status.</p>
          )}
        </section>
      )}

      {/* Pending approval */}
      {pendingApproval && (
        <section className="flex flex-col gap-2 rounded-xl border border-warning/35 bg-warning/5 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-warning">
            <Bell size={12} />
            Needs approval
          </div>
          <div className="text-sm font-semibold text-foreground">{pendingApproval.action}</div>
          <div className="flex gap-2">
            <button
              onClick={() => onDeny(pendingApproval.approvalId)}
              className="flex-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Deny
            </button>
            <button
              onClick={() => onApprove(pendingApproval.approvalId)}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-[filter] hover:brightness-105"
            >
              <Check size={11} strokeWidth={2.5} />
              Approve
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/ContextPanel.tsx
git commit -m "feat: ContextPanel component"
```

---

## Task 11: Update ChatView — Layout, Context Panel Wiring, Approval Banner

**Files:**
- Modify: `web/src/components/ChatView.tsx`

This is the largest wiring task. ChatView needs to: (a) adopt a flex row split layout (chat + context panel), (b) render the context panel with real data, (c) show an approval banner inline when the panel is closed on desktop.

- [ ] **Step 1: Add ContextPanel import + context panel state**

At the top of `ChatView.tsx`, add the import:

```tsx
import ContextPanel from './ContextPanel.js';
import { PanelRight } from 'lucide-react';
```

Inside the component, add state for context panel open/closed (persist to localStorage):

```tsx
const [ctxOpen, setCtxOpen] = useState<boolean>(() => {
  if (window.innerWidth <= 768) return false;
  return localStorage.getItem('ctx_panel') !== 'closed';
});

function toggleCtx() {
  setCtxOpen(prev => {
    const next = !prev;
    localStorage.setItem('ctx_panel', next ? 'open' : 'closed');
    return next;
  });
}
```

- [ ] **Step 2: Update the outer layout**

Find the outermost wrapping div for the chat and change it to a horizontal flex split:

```tsx
{/* Outer split: chat column + context panel */}
<div className="flex min-h-0 flex-1 overflow-hidden">
  {/* Chat column */}
  <div className="flex min-w-0 flex-1 flex-col">
    {/* ... existing PageHeader, msg scroll, banner, MessageInput ... */}
  </div>
  <ContextPanel
    open={ctxOpen}
    onClose={() => { setCtxOpen(false); localStorage.setItem('ctx_panel', 'closed'); }}
    project={pinnedProject}
    worktree={worktree ?? null}
    pendingApproval={pendingApproval}
    onApprove={handleApprove}
    onDeny={handleDeny}
    onMerge={() => mergeMutation.mutate()}
    mergeState={mergeState}
  />
</div>
```

Add these helpers inside the component (ChatView already has `approveExecution` / `rejectExecution` imported via the ExecutionCard path — import them directly here too):

```tsx
import { approveExecution, rejectExecution } from '../lib/api.js';

async function handleApprove(approvalId: string) {
  await approveExecution(approvalId);
}
async function handleDeny(approvalId: string) {
  await rejectExecution(approvalId);
}
```

`pendingApprovals` in ChatView is `Map<executionId, approvalId>`. The `action` string lives on the corresponding `InlineExecution`. Derive the full approval object like this:

```tsx
const firstPendingExecId = [...pendingApprovals.keys()][0] ?? null;
const firstPendingApprovalId = firstPendingExecId ? pendingApprovals.get(firstPendingExecId) ?? null : null;
const firstPendingExecution = firstPendingExecId
  ? Object.values(executions).flat().find(e => e.executionId === firstPendingExecId) ?? null
  : null;

const pendingApproval = firstPendingExecId && firstPendingApprovalId
  ? {
      executionId: firstPendingExecId,
      approvalId: firstPendingApprovalId,
      action: firstPendingExecution?.action ?? 'Tool execution',
    }
  : null;
```

- [ ] **Step 3: Add context panel toggle button to the PageHeader**

Inside the existing page header actions area, add:

```tsx
<button
  onClick={toggleCtx}
  aria-pressed={ctxOpen}
  title={ctxOpen ? 'Hide context' : 'Show context'}
  className={cn(
    'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
    ctxOpen
      ? 'border-transparent bg-accent-tint text-on-accent-soft'
      : 'border-border-soft bg-muted text-muted-foreground hover:border-muted-foreground',
  )}
>
  <PanelRight size={14} strokeWidth={1.75} />
  Context
  {!ctxOpen && pendingApproval && (
    <span className="size-1.5 rounded-full bg-warning" />
  )}
</button>
```

- [ ] **Step 4: Update the approval banner (shown when context panel is closed)**

Find the existing approval banner div and replace with:

```tsx
{pendingApproval && !ctxOpen && (
  <div className="flex shrink-0 items-center justify-between gap-3 border-t border-warning/25 bg-warning/8 px-5 py-2.5 text-sm">
    <div className="flex items-center gap-2 text-fg-soft">
      <Bell size={14} className="text-warning" />
      <span>Approval needed for <strong className="font-semibold text-foreground">{pendingApproval.action}</strong></span>
    </div>
    <button
      onClick={toggleCtx}
      className="text-xs font-medium text-on-accent-soft hover:underline"
    >
      Review
    </button>
  </div>
)}
```

- [ ] **Step 5: Update the `PageHeader` inside ChatView**

The chat header shows the title and scope. Update to use `border-border-soft` and the right font classes, matching the design's project chip below the title:

```tsx
<header className="shrink-0 border-b border-border-soft px-5 py-4">
  <div className="flex min-h-8 items-center justify-between gap-3">
    <h1 className="truncate text-[15px] font-semibold text-foreground">
      {chat?.title ?? 'New chat'}
    </h1>
    <div className="flex shrink-0 items-center gap-2">
      {/* effort selector — keep existing Select, just remove extra styling */}
      {/* context toggle button — added in step 3 */}
    </div>
  </div>
  {/* Scope chip / project breadcrumb */}
  {pinnedProject && (
    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="size-1.5 shrink-0 rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_oklch,var(--success)_22%,transparent)]" />
      {pinnedProject.name}
    </div>
  )}
</header>
```

- [ ] **Step 6: Update message scroll area padding**

```tsx
<div ref={scrollRef} className="flex-1 overflow-y-auto">
  <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
    {/* messages */}
  </div>
</div>
```

- [ ] **Step 7: Run all tests**

```bash
cd web && npm test -- --run 2>&1 | tail -30
```

Expected: all pass.

- [ ] **Step 8: Launch dev server and do a full visual pass**

```bash
cd web && npm run dev
```

Walk through each screen:
- [ ] Chat screen light: messages, execution card, composer, context panel open/closed, approval banner
- [ ] Chat screen dark: toggle theme
- [ ] Projects grid
- [ ] Project detail: Overview, Campaigns, Files, Settings tabs
- [ ] Campaign detail
- [ ] Activity
- [ ] Sidebar: footer has settings + theme toggle (no user chip)
- [ ] Mobile: sidebar offcanvas, context panel as bottom sheet

- [ ] **Step 9: Commit**

```bash
git add web/src/components/ChatView.tsx
git commit -m "feat: ChatView — context panel wiring, approval banner, Slate layout"
```

---

## Task 12: Final Polish Pass

**Files:** any of the above

- [ ] **Step 1: Check for any remaining hardcoded warm-palette classes**

```bash
grep -rn "bg-foreground\|text-background\|bg-blue-\|text-blue-\|bg-green-\|text-green-\|dark:" web/src/components web/src/pages 2>/dev/null | grep -v "node_modules"
```

For each hit, verify whether it was intentional (semantic colours like `text-blue-500` for running state should be replaced with `text-on-accent-soft` or `text-primary`; `bg-green-500` → `bg-success`; `dark:` variants should be replaced with CSS-var-based classes that respond to `[data-theme="unnamed-dark"]` automatically).

- [ ] **Step 2: Verify the `@custom-variant dark` works with the page components**

The dark variant in Tailwind v4 is declared as:
```css
@custom-variant dark (&:where([data-theme="unnamed-dark"], [data-theme="unnamed-dark"] *));
```

Any remaining `dark:` prefixed classes will still work. Remove them where the CSS var already handles both modes (most colour tokens do). Keep `dark:` only if you need a truly separate style that can't be expressed through the token system.

- [ ] **Step 3: Run full test suite one final time**

```bash
cd web && npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Slate UI polish pass — remove warm-palette remnants, clean dark: variants"
```
