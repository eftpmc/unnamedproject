import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { updateDocument } from '../lib/api.js';
import type { DocumentWithBody } from '../types.js';

const PROSE_CLASSES = `text-[14px] leading-relaxed text-fg-soft
  [&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-foreground
  [&_h2]:mb-1 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground
  [&_h3]:mb-0.5 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground
  [&_p]:mb-3 [&_p:last-child]:mb-0
  [&_ul]:mb-3 [&_ul]:ml-5 [&_ul]:list-disc
  [&_ol]:mb-3 [&_ol]:ml-5 [&_ol]:list-decimal
  [&_li]:mb-1
  [&_hr]:my-4 [&_hr]:border-border-soft
  [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]
  [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border-soft [&_pre]:bg-muted/30 [&_pre]:p-3`;

export default function DocumentView({ spaceId, doc, onSaved }: { spaceId: string; doc: DocumentWithBody; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(doc.body);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try { await updateDocument(spaceId, doc.id, { body }); onSaved(); setEditing(false); }
    finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end gap-2">
        {editing ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => { setBody(doc.body); setEditing(false); }}>Cancel</Button>
            <Button size="sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
        )}
      </div>
      {editing ? (
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={24}
          className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      ) : (
        <div className={PROSE_CLASSES}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.body}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
