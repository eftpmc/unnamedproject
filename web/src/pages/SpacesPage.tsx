import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { createSpace, linkProject, getSpaces } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CenteredEmptyState, ContentColumn, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { Space } from '../types.js';

const AVATAR_COLORS = [
  'bg-blue-500/20 text-blue-300',
  'bg-violet-500/20 text-violet-300',
  'bg-emerald-500/20 text-emerald-300',
  'bg-amber-500/20 text-amber-300',
  'bg-rose-500/20 text-rose-300',
  'bg-cyan-500/20 text-cyan-300',
  'bg-orange-500/20 text-orange-300',
  'bg-pink-500/20 text-pink-300',
];

function spaceAvatarColor(name: string): string {
  const hash = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default function SpacesPage() {
  usePageTitle('Spaces');
  const navigate = useNavigate();
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
        await linkProject(created.id, {
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
        className="border-0 pb-0"
        contentClassName="max-w-4xl"
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
          <ContentColumn className="max-w-4xl">
            <div className="relative mb-5">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint-fg" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter Spaces…"
                className="w-full rounded-lg border border-border-soft bg-card py-2 pl-8 pr-3 text-sm placeholder:text-faint-fg focus:border-border focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
              />
            </div>

            {filteredSpaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Spaces matched "{search}".</p>
            ) : (
              <div className="flex flex-col gap-2">
                {filteredSpaces.map(space => (
                  <div
                    key={space.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open Space: ${space.name}`}
                    onClick={() => navigate(`/spaces/${space.id}`)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/spaces/${space.id}`); } }}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3.5 transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    <div className={cn('grid size-9 shrink-0 place-items-center rounded-xl text-sm font-semibold', spaceAvatarColor(space.name))}>
                      {space.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{space.name}</div>
                      {space.description && (
                        <div className="truncate text-[11px] text-faint-fg">{space.description}</div>
                      )}
                    </div>
                    <ChevronRight size={14} className="shrink-0 text-faint-fg" />
                  </div>
                ))}
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
            <Input placeholder="Space name" value={name} onChange={e => setName(e.target.value)} autoFocus />
            <Input placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
            <Input placeholder="Local repo path (optional)" value={repoPath} onChange={e => setRepoPath(e.target.value)} />
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
