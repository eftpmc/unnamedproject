import { useState } from 'react';

export default function EditableTitle({ title, onSave }: { title: string; onSave: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) onSave(trimmed);
    else setDraft(title);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(title); setEditing(false); } }}
        className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-foreground outline-none focus:underline focus:decoration-border"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(title); setEditing(true); }}
      title="Click to rename"
      className="min-w-0 truncate text-left text-[15px] font-semibold text-foreground hover:underline hover:decoration-border"
    >
      {title}
    </button>
  );
}
