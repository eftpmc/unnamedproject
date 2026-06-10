import { useState, type KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';

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
    <div className="px-6 py-4 border-t border-base-300 shrink-0">
      <div className="bg-base-300 rounded-2xl px-4 py-3 flex items-end gap-3">
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message…"
          disabled={disabled}
          rows={1}
          className={`flex-1 bg-transparent border-none outline-none text-[15px] resize-none font-inherit leading-relaxed ${disabled ? 'text-base-content/30' : 'text-base-content'}`}
        />
        <button
          onClick={submit}
          disabled={disabled || !value.trim()}
          title="Send"
          className={`btn btn-circle btn-sm shrink-0 ${disabled || !value.trim() ? 'btn-ghost text-base-content/20' : 'bg-base-content text-base-100 border-none hover:opacity-90'}`}
        >
          <ArrowUp size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
