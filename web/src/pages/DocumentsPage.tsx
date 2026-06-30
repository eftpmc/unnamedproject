import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Folder } from 'lucide-react';
import { getAllFiles, getProjects } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { Button } from '@/components/ui/button';
import {
  CenteredEmptyState, ContentColumn, PageBody, PageHeader, PageLoading, PageShell,
} from '@/components/ui/app-layout';
import { DataTable, DataTableBody, DataTableHeader, DataTableRow } from '@/components/ui/data-table';
import FileBrowser from '../components/FileBrowser.js';
import type { LibraryFile, Project } from '../types.js';

export default function DocumentsPage() {
  usePageTitle('Library');
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedProjectId = searchParams.get('p');

  const { data: documents = [], isLoading: docsLoading } = useQuery<LibraryFile[]>({
    queryKey: ['library-files'],
    queryFn: () => getAllFiles(),
  });

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => getProjects(),
    staleTime: 60_000,
  });

  const isLoading = docsLoading || projectsLoading;
  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;

  function selectProject(id: string) {
    setSearchParams({ p: id }, { replace: false });
  }

  return (
    <PageShell>
      <PageHeader
        title={selectedProject ? selectedProject.name : 'Library'}
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
        actions={selectedProject ? (
          <Button variant="ghost" size="sm" onClick={() => setSearchParams({}, { replace: false })}>
            ← All projects
          </Button>
        ) : undefined}
      />

      {isLoading ? (
        <PageLoading rows={4} />
      ) : !selectedProject ? (
        projects.length === 0 ? (
          <CenteredEmptyState
            title="No projects yet"
            description="Create a project to start building your library."
          />
        ) : (
          <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
            <ContentColumn className="max-w-7xl">
              <DataTable>
                <DataTableHeader className="grid-cols-[minmax(0,1fr)_5rem]">
                  <span>Project</span>
                  <span className="justify-self-end">Files</span>
                </DataTableHeader>
                <DataTableBody>
                  {projects.map(project => {
                    const count = documents.filter(d => d.project_id === project.id).length;
                    return (
                      <DataTableRow key={project.id} className="grid-cols-[minmax(0,1fr)_5rem]">
                        <div className="flex min-w-0 items-center gap-3">
                          <Folder size={14} className="shrink-0 text-muted-foreground" />
                          <button
                            type="button"
                            onClick={() => selectProject(project.id)}
                            className="min-w-0 truncate text-left text-sm font-medium text-foreground underline-offset-2 hover:underline"
                          >
                            {project.name}
                          </button>
                        </div>
                        <span className="justify-self-end text-xs text-faint-fg">
                          {count} {count === 1 ? 'file' : 'files'}
                        </span>
                      </DataTableRow>
                    );
                  })}
                </DataTableBody>
              </DataTable>
            </ContentColumn>
          </PageBody>
        )
      ) : (
        <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
          <ContentColumn className="max-w-7xl">
            <FileBrowser
              projectId={selectedProject.id}
              projectName={selectedProject.name}
              canEdit
              canDelete
            />
          </ContentColumn>
        </PageBody>
      )}
    </PageShell>
  );
}
