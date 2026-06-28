import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageBody, PageHeader, PageShell } from '@/components/ui/app-layout';
import { createTopLevelProject } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';

export default function NewProjectPage() {
  usePageTitle('New project');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [branch, setBranch] = useState('');

  const createMutation = useMutation({
    mutationFn: () => createTopLevelProject({
      name: name.trim(),
      ...(repoPath.trim() ? { repo_path: repoPath.trim() } : {}),
      ...(branch.trim() ? { default_branch: branch.trim() } : {}),
    }),
    onSuccess: project => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/projects/${project.id}`);
    },
  });

  return (
    <PageShell>
      <PageHeader
        title="New project"
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
        breadcrumb={(
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} />
            Projects
          </button>
        )}
      />
      <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
        <div className="mx-auto w-full max-w-xl">
          <form
            className="overflow-hidden rounded-lg border border-border-soft bg-card"
            onSubmit={event => {
              event.preventDefault();
              if (!name.trim() || createMutation.isPending) return;
              createMutation.mutate();
            }}
          >
            <div className="border-b border-border-soft bg-muted/20 px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-medium text-foreground">Project details</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Create an empty project or link an existing local repository.</p>
              </div>
            </div>

            <div className="space-y-3.5 px-4 py-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</span>
                <Input placeholder="Project name" value={name} onChange={e => setName(e.target.value)} autoFocus />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Local repo path</span>
                <Input placeholder="/Users/zack/Code/project" value={repoPath} onChange={e => setRepoPath(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Default branch</span>
                <Input placeholder="main" value={branch} onChange={e => setBranch(e.target.value)} />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border-soft bg-muted/10 px-4 py-3">
              <Button type="button" variant="ghost" onClick={() => navigate('/projects')}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create project'}
              </Button>
            </div>
          </form>
        </div>
      </PageBody>
    </PageShell>
  );
}
