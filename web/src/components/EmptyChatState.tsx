import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { ArrowUp, FileText, Folder, Paperclip, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Project } from '../types.js';

const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

interface EmptyChatStateProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (content: string, attachments: File[]) => void;
  disabled: boolean;
  pendingFiles?: File[];
  onPendingFilesConsumed?: () => void;
  projectName?: string;
  projects?: Project[];
  onPinProject?: (projectId: string) => void;
}

const DEFAULT_PROMPTS = [
  'Help me plan the next useful step.',
  'Review this and suggest improvements.',
  'Start with the fewest questions needed.',
];

export default function EmptyChatState({ value, onChange, onSend, disabled, pendingFiles, onPendingFilesConsumed, projectName, projects = [], onPinProject }: EmptyChatStateProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<File[]>([]);

  const prompts = projectName
    ? [
        `Orient me on ${projectName}.`,
        `What's the highest-impact thing to work on in ${projectName}?`,
        `Review the current state of ${projectName}.`,
      ]
    : DEFAULT_PROMPTS;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [value]);

  useEffect(() => {
    if (!pendingFiles?.length) return;
    const available = MAX_ATTACHMENTS - attachments.length;
    const accepted = pendingFiles.filter(f => f.size <= MAX_ATTACHMENT_BYTES).slice(0, Math.max(available, 0));
    if (accepted.length) setAttachments(prev => [...prev, ...accepted]);
    onPendingFilesConsumed?.();
  }, [pendingFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(overrideContent?: string) {
    const content = (overrideContent ?? value).trim();
    if ((!content && attachments.length === 0) || disabled) return;
    onSend(content, attachments);
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleFilesSelected(e: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (!selected.length) return;
    const available = MAX_ATTACHMENTS - attachments.length;
    const accepted = selected.filter(f => f.size <= MAX_ATTACHMENT_BYTES).slice(0, Math.max(available, 0));
    setAttachments(prev => [...prev, ...accepted]);
    e.target.value = '';
  }

  const canSend = !disabled && (!!value.trim() || attachments.length > 0);
  const showProjectPins = !projectName && projects.length > 0 && onPinProject;

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
      <div className="w-full" style={{ maxWidth: '42rem' }}>

        {/* Input — primary element */}
        <div className="rounded-[18px] border border-input bg-card px-3 pb-2.5 pt-3 shadow-sm">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((file, i) => (
                <div key={i} className="flex items-center gap-1 rounded-md border border-border-soft bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                  <FileText size={11} className="shrink-0" />
                  <span className="max-w-[120px] truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                    className="ml-0.5 text-faint-fg hover:text-foreground"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder={projectName ? `Ask anything about ${projectName}…` : 'Message…'}
            disabled={disabled}
            rows={1}
            autoFocus
            className="max-h-44 min-h-[1.5rem] w-full resize-none border-0 bg-transparent dark:bg-transparent px-1 py-1 text-[15px] shadow-none placeholder:text-faint-fg focus-visible:ring-0"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <button
              type="button"
              disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
              onClick={() => fileInputRef.current?.click()}
              title="Attach file"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint-fg transition-colors hover:bg-muted hover:text-muted-foreground disabled:opacity-40"
            >
              <Paperclip size={15} />
            </button>
            <button
              type="button"
              onClick={() => submit()}
              disabled={!canSend}
              title="Send"
              className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-[filter,transform] active:translate-y-px',
                canSend
                  ? 'bg-primary text-primary-foreground hover:brightness-105'
                  : 'bg-muted text-faint-fg cursor-default',
              )}
            >
              <ArrowUp size={16} strokeWidth={2} />
            </button>
          </div>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilesSelected} />
        </div>

        {/* Prompt chips — secondary */}
        <div className="mt-3 flex flex-wrap gap-2">
          {prompts.map(prompt => (
            <button
              key={prompt}
              type="button"
              disabled={disabled}
              onClick={() => submit(prompt)}
              className="rounded-full border border-border-soft bg-card px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Project pins */}
        {showProjectPins && (
          <div className="mt-5 border-t border-border-soft pt-4">
            <p className="mb-2 text-[11px] font-medium text-faint-fg">Pin a project</p>
            <div className="flex flex-wrap gap-2">
              {projects.slice(0, 6).map(project => (
                <button
                  key={project.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPinProject(project.space_id)}
                  className="flex items-center gap-1.5 rounded-lg border border-border-soft bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-50"
                >
                  <Folder size={12} className="shrink-0" />
                  {project.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
