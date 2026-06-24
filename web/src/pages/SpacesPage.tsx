import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, FileStack, FolderGit2, MessagesSquare, Plus, Search } from 'lucide-react';
import { createSpace, createSpaceItem, getChats, getSpaceItems, getSpacePlans, getSpaces } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CenteredEmptyState, ContentColumn, PageBody, PageHeader, PageLoading, PageShell, Surface } from '@/components/ui/app-layout';
import type { Session, Space } from '../types.js';

function SpaceCard({ space }: { space: Space }) {
  const navigate = useNavigate();
  const { data: items = [] } = useQuery({
    queryKey: ['space-items', space.id],
    queryFn: () => getSpaceItems(space.id),
    staleTime: 60_000,
  });
  const { data: plans = [] } = useQuery({
    queryKey: ['space-plans', space.id],
    queryFn: () => getSpacePlans(space.id),
    staleTime: 30_000,
  });
  const { data: chats = [] } = useQuery<Session[]>({ queryKey: ['chats'], queryFn: getChats, staleTime: 60_000 });
  const chatCount = chats.filter(chat => chat.pinned_space_id === space.id).length;
  const repoCount = items.filter(item => item.type === 'repo').length;
  const runningCount = plans.filter(plan => plan.status === 'running').length;

  return (
    <button
      type="button"
      aria-label={`Open Space: ${space.name}`}
      className="block h-full w-full rounded-lg text-left"
      onClick={() => navigate(`/spaces/${space.id}`)}
    >
      <Surface interactive className="flex h-full min-h-36 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              {repoCount > 0 ? <FolderGit2 size={15} /> : <Boxes size={15} />}
            </div>
            <span className="truncate text-sm font-semibold tracking-tight">{space.name}</span>
          </div>
          {runningCount > 0 && (
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-on-accent-soft">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              {runningCount} running
            </span>
          )}
        </div>
        <p className="mt-3 line-clamp-2 min-h-10 text-[13px] leading-relaxed text-muted-foreground">
          {space.description || 'A shared workspace for chats, repositories, files, and notes.'}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-[11px] text-faint-fg">
          <span className="inline-flex items-center gap-1"><FileStack size={11} />{items.length} items</span>
          <span className="inline-flex items-center gap-1"><MessagesSquare size={11} />{chatCount} chats</span>
          <span>{plans.length} plans</span>
        </div>
      </Surface>
    </button>
  );
}

export default function SpacesPage() {
  usePageTitle('Spaces');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [search, setSearch] = useState('');

  const { data: spaces = [], isLoading } = useQuery<Space[]>({ queryKey: ['spaces'], queryFn: getSpaces });
  const filteredSpaces = search.trim()
    ? spaces.filter(space =>
        space.name.toLowerCase().includes(search.toLowerCase()) ||
        space.description?.toLowerCase().includes(search.toLowerCase()))
    : spaces;

  const createMutation = useMutation({
    mutationFn: async () => {
      const created = await createSpace({
        name: name.trim(),
        description: description.trim() || undefined,
        enabled_connection_ids: [],
      });
      if (repoPath.trim()) {
        await createSpaceItem(created.id, {
          type: 'repo',
          name: name.trim(),
          repo_path: repoPath.trim(),
        });
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      setOpen(false);
      setName('');
      setDescription('');
      setRepoPath('');
    },
  });

  return (
    <PageShell>
      <PageHeader
        title="Spaces"
        description="Organize chats, repositories, files, notes, plans, and reusable pipelines."
        actions={(
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setOpen(true)}>
            <Plus size={14} />
            New Space
          </Button>
        )}
      />

      {isLoading ? <PageLoading rows={3} /> : spaces.length === 0 ? (
        <CenteredEmptyState
          title="No Spaces yet"
          description="Create a Space to collect related work and give the agent durable context."
          actionLabel="Create your first Space"
          onAction={() => setOpen(true)}
        />
      ) : (
        <PageBody>
          <ContentColumn>
            {spaces.length > 4 && (
              <div className="relative mb-5 max-w-sm">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint-fg" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Filter Spaces…"
                  className="w-full rounded-lg border border-border-soft bg-card py-2 pl-8 pr-3 text-sm placeholder:text-faint-fg focus:border-border focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
            {filteredSpaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Spaces matched “{search}”.</p>
            ) : (
              <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]">
                {filteredSpaces.map(space => <SpaceCard key={space.id} space={space} />)}
              </div>
            )}
          </ContentColumn>
        </PageBody>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Space</DialogTitle>
            <DialogDescription>Start empty or attach a local repository now.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Input placeholder="Space name" value={name} onChange={event => setName(event.target.value)} autoFocus />
            <Input placeholder="Description (optional)" value={description} onChange={event => setDescription(event.target.value)} />
            <Input placeholder="Local repo path (optional)" value={repoPath} onChange={event => setRepoPath(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!name.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? 'Creating…' : 'Create Space'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
