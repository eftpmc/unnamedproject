import { useState, type KeyboardEvent } from 'react';

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export default function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [value, setValue] = useState('');

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  return (
    <div className="px-3 py-2.5 border-t border-[#141414] shrink-0">
      <div className="bg-base-300 border border-neutral rounded-lg px-3 py-2 flex items-end gap-2">
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message…"
          disabled={disabled}
          rows={1}
          className={`flex-1 bg-transparent border-none outline-none text-[11px] resize-none font-inherit leading-relaxed ${disabled ? 'text-[#333333]' : 'text-base-content'}`}
        />
        <button
          onClick={submit}
          disabled={disabled || !value.trim()}
          title="Send"
          className={`btn btn-ghost btn-xs btn-square min-h-0 h-auto p-0.5 shrink-0 ${disabled || !value.trim() ? 'text-[#333333]' : 'text-[#666666]'}`}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M12 7L2 2l2.5 5L2 12l10-5z" fill="currentColor"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
