import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Download, Pencil, Plus, Trash2, X } from 'lucide-react';
import { getFileById, updateFileById, deleteFileById, getFileContentUrl } from '../lib/api.js';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { usePageTitle } from '../lib/usePageTitle.js';
import { MARKDOWN_PROSE_CLASS } from '../lib/prose.js';
import { timeAgo } from '../lib/utils.js';
import { Button } from '@/components/ui/button';
import { EmptyPanel, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { LibraryFileWithBody } from '../types.js';

function isTextDoc(mimeType: string): boolean {
  return mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType === 'application/xml'
    || mimeType === 'application/yaml';
}

function BinaryViewer({ document }: { document: LibraryFileWithBody }) {
  const contentUrl = getFileContentUrl(document.id);
  const mime = document.mime_type;

  if (mime.startsWith('image/')) {
    return (
      <div className="flex items-center justify-center p-6">
        <img
          src={contentUrl}
          alt={document.title}
          className="max-h-[70vh] max-w-full rounded object-contain"
        />
      </div>
    );
  }

  if (mime === 'application/pdf') {
    return (
      <iframe
        src={contentUrl}
        title={document.title}
        className="h-[75vh] w-full border-0"
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 px-5 py-12 text-center">
      <p className="text-sm text-muted-foreground">This file type cannot be previewed.</p>
      <a
        href={contentUrl}
        download={document.title}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Download size={14} />
        Download
      </a>
    </div>
  );
}

export default function DocumentPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const { data: document, isLoading, isError } = useQuery<LibraryFileWithBody>({
    queryKey: ['document', documentId],
    queryFn: () => getFileById(documentId!),
    enabled: !!documentId,
  });

  const saveMutation = useMutation({
    mutationFn: ({ title, body }: { title: string; body: string }) =>
      updateFileById(documentId!, { title: title.trim() || document?.title, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document', documentId] });
      qc.invalidateQueries({ queryKey: ['library-files'] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteFileById(documentId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-files'] });
      navigate('/library');
    },
  });

  usePageTitle(document?.title ?? 'Document');

  function startEdit() {
    setDraftTitle(document?.title ?? '');
    setDraftBody(document?.body ?? '');
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
  }

  function save() {
    saveMutation.mutate({ title: draftTitle, body: draftBody });
  }

  useEffect(() => {
    if (editing && bodyRef.current) {
      const el = bodyRef.current;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing, draftBody]);

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

  const isText = isTextDoc(document.mime_type);

  return (
    <PageShell>
      <PageHeader
        title={document.title}
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-4xl"
        titleClassName="text-2xl sm:text-3xl"
        breadcrumb={(
          <Link to="/library" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
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
              <Button size="sm" variant="ghost" onClick={cancel} disabled={saveMutation.isPending}>
                <X size={14} className="mr-1" />Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saveMutation.isPending}>
                <Check size={14} className="mr-1" />{saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {isText && (
                <Button size="sm" variant="ghost" onClick={startEdit}>
                  <Pencil size={13} className="mr-1.5" />Edit
                </Button>
              )}
              {!isText && (
                <a
                  href={getFileContentUrl(document.id)}
                  download={document.title}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Download size={13} />Download
                </a>
              )}
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} />
              </Button>
            </div>
          )
        }
      />
      <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
        <article className="mx-auto max-w-4xl overflow-hidden rounded-lg border border-border-soft bg-card">
          <div className="border-b border-border-soft px-4 py-3">
            <div className="truncate font-mono text-xs text-muted-foreground">{document.path}</div>
          </div>
          {isText ? (
            editing ? (
              <div className="flex flex-col">
                <input
                  value={draftTitle}
                  onChange={e => setDraftTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') cancel(); }}
                  placeholder="Document title"
                  className="border-b border-border-soft bg-transparent px-5 py-3 text-lg font-semibold text-foreground outline-none placeholder:text-muted-foreground"
                  autoFocus
                />
                <textarea
                  ref={bodyRef}
                  value={draftBody}
                  onChange={e => {
                    setDraftBody(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onKeyDown={e => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
                    if (e.key === 'Escape') cancel();
                  }}
                  className="w-full resize-none overflow-hidden bg-transparent px-5 py-4 font-mono text-sm text-foreground outline-none"
                  style={{ minHeight: '60vh' }}
                />
              </div>
            ) : (
              <div className={`px-5 py-4 ${MARKDOWN_PROSE_CLASS}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{document.body || '_No content yet._'}</ReactMarkdown>
              </div>
            )
          ) : (
            <BinaryViewer document={document} />
          )}
          <TagsPanel documentId={documentId!} tags={document.tags} onSaved={() => {
            qc.invalidateQueries({ queryKey: ['document', documentId] });
            qc.invalidateQueries({ queryKey: ['library-files'] });
          }} />
        </article>
      </PageBody>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete document?"
          description="This will permanently delete the file. This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </PageShell>
  );
}

function TagsPanel({ documentId, tags, onSaved }: {
  documentId: string;
  tags: Record<string, unknown>;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [addingNew, setAddingNew] = useState(false);

  const patchMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateFileById(documentId, { tags: patch }),
    onSuccess: () => { setEditing(null); setAddingNew(false); setNewKey(''); setNewVal(''); onSaved(); },
  });

  const entries = Object.entries(tags);

  function startEdit(key: string) {
    setEditing(key);
    setDraft(String(tags[key] ?? ''));
  }

  function commitEdit(key: string) {
    const val = draft.trim();
    if (val === String(tags[key] ?? '')) { setEditing(null); return; }
    patchMutation.mutate({ [key]: val });
  }

  function deleteKey(key: string) {
    const next = { ...tags };
    delete next[key];
    updateFileById(documentId, { tags: next }).then(onSaved);
  }

  function addField() {
    const k = newKey.trim();
    const v = newVal.trim();
    if (!k) return;
    patchMutation.mutate({ [k]: v });
  }

  return (
    <div className="border-t border-border-soft">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-5 py-3 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Metadata
        {entries.length > 0 && (
          <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">{entries.length}</span>
        )}
      </button>

      {open && (
        <div className="px-5 pb-4">
          <table className="w-full text-xs">
            <tbody>
              {entries.map(([key, val]) => (
                <tr key={key} className="group border-t border-border-soft/50 first:border-0">
                  <td className="w-32 py-1.5 pr-3 font-mono text-muted-foreground">{key}</td>
                  <td className="py-1.5">
                    {editing === key ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onBlur={() => commitEdit(key)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); commitEdit(key); }
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        className="w-full rounded border border-ring bg-background px-1.5 py-0.5 font-mono outline-none focus:ring-1 focus:ring-ring/50"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(key)}
                        className="font-mono text-foreground hover:underline"
                      >
                        {String(val)}
                      </button>
                    )}
                  </td>
                  <td className="w-6 py-1.5 text-right opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => deleteKey(key)}
                      className="text-muted-foreground hover:text-destructive"
                      title={`Remove ${key}`}
                    >
                      <X size={11} />
                    </button>
                  </td>
                </tr>
              ))}
              {addingNew && (
                <tr className="border-t border-border-soft/50">
                  <td className="py-1.5 pr-3">
                    <input
                      autoFocus
                      value={newKey}
                      onChange={e => setNewKey(e.target.value)}
                      placeholder="key"
                      onKeyDown={e => { if (e.key === 'Escape') { setAddingNew(false); setNewKey(''); setNewVal(''); } }}
                      className="w-full rounded border border-ring bg-background px-1.5 py-0.5 font-mono text-xs outline-none focus:ring-1 focus:ring-ring/50"
                    />
                  </td>
                  <td className="py-1.5">
                    <input
                      value={newVal}
                      onChange={e => setNewVal(e.target.value)}
                      placeholder="value"
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); addField(); }
                        if (e.key === 'Escape') { setAddingNew(false); setNewKey(''); setNewVal(''); }
                      }}
                      className="w-full rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
                    />
                  </td>
                  <td className="w-6 py-1.5 text-right">
                    <button type="button" onClick={addField} className="text-muted-foreground hover:text-foreground">
                      <Check size={11} />
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {!addingNew && (
            <button
              type="button"
              onClick={() => setAddingNew(true)}
              className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Plus size={11} />Add field
            </button>
          )}
        </div>
      )}
    </div>
  );
}
