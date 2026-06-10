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
    <div style={{ padding: '10px 12px', borderTop: '1px solid #141414', flexShrink: 0 }}>
      <div style={{
        background: '#111111',
        border: '1px solid #1e1e1e',
        borderRadius: 7,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 8,
      }}>
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message…"
          disabled={disabled}
          rows={1}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: disabled ? '#333' : '#cccccc',
            fontSize: 11,
            resize: 'none',
            fontFamily: 'inherit',
            lineHeight: 1.5,
          }}
        />
        <button
          onClick={submit}
          disabled={disabled || !value.trim()}
          title="Send"
          style={{
            background: 'none',
            border: 'none',
            cursor: disabled || !value.trim() ? 'not-allowed' : 'pointer',
            color: disabled || !value.trim() ? '#333' : '#666',
            padding: '0 2px',
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M12 7L2 2l2.5 5L2 12l10-5z" fill="currentColor"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
