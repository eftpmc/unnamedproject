import type { Document } from '../types.js';

export default function TrackerView({ documents, onOpen }: { documents: Document[]; onOpen: (doc: Document) => void }) {
  const groups = new Map<string, Document[]>();
  for (const d of documents) {
    const key = d.status ?? 'No status';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
  }
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {[...groups.entries()].map(([status, docs]) => (
        <div key={status} className="flex w-64 shrink-0 flex-col gap-2">
          <div className="text-xs font-semibold text-muted-foreground">{status} <span className="text-faint-fg">{docs.length}</span></div>
          {docs.map(doc => (
            <button
              key={doc.id}
              type="button"
              onClick={() => onOpen(doc)}
              className="rounded-lg border border-border-soft bg-card px-3 py-2 text-left text-sm transition-colors hover:border-border"
            >
              <div className="truncate font-medium">{doc.title}</div>
              {doc.type && <div className="text-[11px] text-faint-fg capitalize">{doc.type}</div>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
