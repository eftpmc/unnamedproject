import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, Check, Pencil, X } from 'lucide-react';
import { getDocumentById, updateDocumentById } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { timeAgo } from '../lib/utils.js';
import { Button } from '@/components/ui/button';
import { EmptyPanel, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { DocumentWithBody } from '../types.js';

const PROSE = 'text-[14px] leading-relaxed text-fg-soft [&_a]:text-primary [&_a]:underline-offset-2 [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_h1:first-child]:mt-0 [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground [&_hr]:my-5 [&_hr]:border-border-soft [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:ml-5 [&_ol]:list-decimal [&_p:last-child]:mb-0 [&_p]:mb-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border-soft [&_pre]:bg-muted/30 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12px] [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border-soft [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border-soft [&_th]:bg-muted/30 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:mb-3 [&_ul]:ml-5 [&_ul]:list-disc';

export default function DocumentPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const { data: document, isLoading, isError } = useQuery<DocumentWithBody>({
    queryKey: ['document', documentId],
    queryFn: () => getDocumentById(documentId!),
    enabled: !!documentId,
  });

  const saveMutation = useMutation({
    mutationFn: (body: string) => updateDocumentById(documentId!, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document', documentId] });
      setEditing(false);
    },
  });

  usePageTitle(document?.title ?? 'Document');

  function startEdit() {
    setDraft(document?.body ?? '');
    setEditing(true);
  }

  if (isLoading) return <PageShell><PageLoading rows={4} /></PageShell>;

  if (isError || !document) {
    return (
      <PageShell>
        <PageHeader
          title="Document not found"
          className="px-4 pt-6 sm:px-8 sm:pt-10"
          contentClassName="max-w-4xl"
          titleClassName="text-2xl sm:text-3xl"
        />
        <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
          <div className="mx-auto max-w-4xl">
            <EmptyPanel title="Document not found" description="This document may have been deleted or moved." />
          </div>
        </PageBody>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={document.title}
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-4xl"
        titleClassName="text-2xl sm:text-3xl"
        breadcrumb={(
          <Link to="/documents" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft size={14} />
            Documents
          </Link>
        )}
        description={(
          <span>
            {[document.type, document.status, timeAgo(document.updated_at)].filter(Boolean).join(' · ')}
          </span>
        )}
        actions={
          editing ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saveMutation.isPending}>
                <X size={14} className="mr-1" />Cancel
              </Button>
              <Button size="sm" onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending}>
                <Check size={14} className="mr-1" />{saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={startEdit}>
              <Pencil size={13} className="mr-1.5" />Edit
            </Button>
          )
        }
      />
      <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
        <article className="mx-auto max-w-4xl overflow-hidden rounded-lg border border-border-soft bg-card">
          <div className="border-b border-border-soft px-4 py-3">
            <div className="truncate font-mono text-xs text-muted-foreground">{document.path}</div>
          </div>
          {editing ? (
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveMutation.mutate(draft); }
                if (e.key === 'Escape') setEditing(false);
              }}
              className="w-full resize-none bg-transparent px-5 py-4 font-mono text-sm text-foreground outline-none"
              style={{ minHeight: '60vh' }}
              autoFocus
            />
          ) : (
            <div className={`px-5 py-4 ${PROSE}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{document.body || '_No content yet._'}</ReactMarkdown>
            </div>
          )}
        </article>
      </PageBody>
    </PageShell>
  );
}
