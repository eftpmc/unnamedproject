# Navigation Redesign: Cloudflare-Style Layout

**Date:** 2026-06-27
**Status:** Approved

## Summary

Redesign the app's navigation and information architecture around a Cloudflare-style layout: icon-only sidebar that overlays on expand, a persistent header with a project selector, and Projects (git repos) as the primary top-level entity. Spaces are eliminated. Documents and Media become global. Triggers become global with an optional project association.

---

## Information Architecture

### Global navigation (sidebar)

| Icon | Label | Route |
|------|-------|-------|
| Chat | Chats | `/chats` |
| FolderGit | Projects | `/projects` |
| FileText | Documents | `/documents` |
| Image | Media | `/media` |
| Zap | Triggers | `/triggers` |
| Settings | Settings | `/settings` |

### Inside a project (sidebar swaps)

When the user navigates into a project, the sidebar replaces global nav with project-specific sections. No project name in the sidebar.

| Icon | Label | Route |
|------|-------|-------|
| ArrowLeft | Back | `/projects` |
| LayoutDashboard | Overview | `/projects/:id` |
| Files | Files | `/projects/:id/files` |
| MessageSquare | Chats | `/projects/:id/chats` |

No Settings section in the project sidebar. Project config lives in the Overview right panel.

---

## Layout

### The cross

Logo sits at the intersection of the sidebar (vertical) and header (horizontal), forming a visual cross. The sidebar column width (~48px collapsed) and header height are consistent at all breakpoints — the logo is always at their corner.

```
┌──────┬──────────────────────────────────────────┐
│  🟠  │  [selector ⌃]              [user menu]   │
├──────┼──────────────────────────────────────────┤
│  💬  │                                          │
│  📁  │            main content                  │
│  📄  │                                          │
│  🖼️  │                                          │
│  ⚡  │                                          │
│      │                                          │
│  ⚙️  │                                          │
└──────┴──────────────────────────────────────────┘
```

### Sidebar

- **Collapsed (default):** icon-only, ~48px wide. Always visible. Content is centered relative to this width — it never shifts.
- **Expanded (overlay):** slides open as an absolute overlay on top of content. Shows icons + labels. Content does not reflow.
- **Toggle:** clicking the logo or a hamburger icon at the bottom of the sidebar opens/closes it.
- **Active state:** icon for the active route is highlighted.
- **Project context:** when inside a project, sidebar shows project sections (Overview, Files, Chats) with a Back arrow at the top. Same collapsed/overlay behavior.

### Header

- **Logo** (left, 48px column): sits at intersection with sidebar.
- **Selector** (left of center): shows current project name + chevron when inside a project. Opens a searchable dropdown to switch projects. Shows nothing (or app name) at global level.
- **Right side:** user menu, any global actions.

### Project selector dropdown

Opens from the header selector:
- Search input: "Search projects..."
- List of projects with name and repo path
- Footer: "All projects →" link to `/projects`
- Active project has a checkmark

### Main content

- Centered, max-width constrained (e.g. `max-w-5xl`).
- Left margin accounts for collapsed sidebar width (48px). Never changes on sidebar toggle.

---

## Pages

### Projects list (`/projects`)

Grid or list of project cards. Each card: project name, repo path, branch, last activity. "New project" button top-right. "Link existing repo" option.

### Project Overview (`/projects/:id`)

Two-column layout:

**Left (main):**
- Recent file changes (from worktree)
- Recent chats pinned to this project
- Recent activity (agent events)

**Right panel:**
- Repository: path, default branch
- MCP Tools: toggles for enabled connections
- Quick Actions: "New chat", "New trigger (linked to this project)"
- Danger zone: "Delete project"

On mobile: right panel stacks below main content.

### Project Files (`/projects/:id/files`)

Full-width file browser for the repo. Existing `FileBrowser` component.

### Project Chats (`/projects/:id/chats`)

List of chats with `pinned_space_id` (to be renamed `pinned_project_id`) matching this project. "New chat" button creates a chat pinned to this project.

### Global Documents (`/documents`)

All documents across all projects. Filterable by type (pdf, md, docx), status, and project. Markdown files with frontmatter get status badges. Other document types (pdf, docx) shown with file icon and name.

### Global Media (`/media`)

All media files (images, video, audio) across all projects. Grid view for images, list view for others.

### Global Triggers (`/triggers`)

All triggers. Each trigger shows: kind (schedule/webhook/manual), schedule, linked project (optional). Create trigger modal includes optional project selector.

---

## Data model changes

- `space_id` → `project_id` on `sessions`, `documents`, `triggers` tables (spaces concept removed).
- `spaces` table → renamed or repurposed as `projects` table (already exists as `projects`; `spaces` table dropped).
- `triggers.space_id` → `triggers.project_id` (nullable — global triggers have no project).
- Documents and media no longer require a project — `project_id` is nullable on `documents`.
- Agent tools updated: `write_document`, `read_document`, etc. accept optional `project_id`.

---

## Migration from current state

Current routing:
- `/spaces` → `/projects`
- `/spaces/:id` → `/projects/:id`
- `/spaces/:id/documents` → `/documents` (global, filtered by project)
- `/spaces/:id/projects/:projectId` → `/projects/:projectId`
- `/spaces/:id/triggers` → `/triggers` (global)

The existing `Sidebar.tsx`, `AppLayout.tsx`, and `SpacePage.tsx` are replaced. `SpacesPage.tsx` becomes `ProjectsPage.tsx`.

---

## Mobile

- Sidebar collapses to a bottom tab bar or hamburger menu.
- Header selector remains in place.
- Project Overview right panel stacks below main content.
- File browser becomes full-width with simplified controls.

---

## Out of scope

- Multi-user / permissions
- Documents editor improvements
- Trigger execution logic changes
- Agent tool surface changes (separate plan)
