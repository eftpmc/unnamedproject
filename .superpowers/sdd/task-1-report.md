# Task 1 Report: Replace item/block types with Document/Project/Trigger in web/src/types.ts

## Plan
Plan 3: Web UI — Task 1 of 7

## Summary
Successfully updated `web/src/types.ts` to replace the old item/block type system with the new Document/Project/Trigger architecture, aligning the frontend type definitions with the backend refactor.

## Changes Made

### Types Removed
- `BlockContent` (union type for 14 different block content variants)
- `Block` (composite type extending BlockContent with optional id)
- `SpaceItemBase` (base interface for space items)
- `RepoItem` (repo-specific space item type)
- `FileItem` (file-specific space item type)
- `SpaceItem` (union type)
- `ItemTemplate` (interface for block templates)

### SessionEventType Union Updated
Replaced `'item_created' | 'item_updated'` with `'document_created' | 'document_updated'`
- Maintains existing event types: scope_changed, project_linked, project_created, artifact_created, approval_requested, approval_resolved, mcp_required

### Types Added
- `Document` — Core document interface with id, space_id, path, title, type, status, frontmatter, source_session_id, created_at, updated_at
- `DocumentWithBody` — Extended Document interface with body field
- `Project` — Project interface with id, space_id, name, repo_path, default_branch, origin ('created' | 'linked'), created_at
- `Trigger` — Trigger interface with id, space_id, kind ('schedule' | 'webhook' | 'manual'), schedule_cron, playbook_id, enabled, next_run_at, last_run_at, created_at

## Verification

### Typecheck Results
Ran: `cd web && npx tsc --noEmit`
- ✅ No errors within `types.ts` itself — file is internally consistent
- ✅ Errors only in other files that import removed types (expected; fixed in later tasks):
  - BlockRenderer.tsx, BlockRenderer.test.tsx
  - ChatView.tsx, ContextPanel.tsx, MessageList.tsx
  - api.ts
  - Settings.tsx, SpacePage.tsx

### File Changes Summary
- 1 file modified: web/src/types.ts
- 29 lines inserted (new Document, DocumentWithBody, Project, Trigger types)
- 35 lines deleted (old BlockContent, Block, SpaceItemBase, RepoItem, FileItem, SpaceItem, ItemTemplate)
- Net change: -6 lines

## Commit

```
Commit: 4336cda5f6aec0174ab7e289ed8da52f1933b855
Author: ari <61393419+eftpmc@users.noreply.github.com>
Date: Sat Jun 27 00:06:24 2026 -0400

Message: refactor(web): replace item/block types with Document/Project/Trigger
```

## Status

STATUS: DONE

All requirements from task-1-brief.md met:
- [x] Old types removed from types.ts
- [x] New types added with correct interfaces per specification
- [x] SessionEventType updated to replace item_created/item_updated with document_created/document_updated
- [x] types.ts has no internal errors
- [x] Changes committed with appropriate message
- [x] Typecheck confirms no errors in types.ts (errors in downstream files are expected)
