import { usePageTitle } from '../lib/usePageTitle.js';
import { CenteredEmptyState, PageHeader, PageShell } from '@/components/ui/app-layout';

export default function MediaPage() {
  usePageTitle('Media');
  return (
    <PageShell>
      <PageHeader title="Media" className="border-0 pb-0" contentClassName="max-w-5xl" />
      <CenteredEmptyState
        title="No media yet"
        description="Images and files created by the agent will appear here."
      />
    </PageShell>
  );
}
