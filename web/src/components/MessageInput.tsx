import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { ArrowUp, FileText, Mic, MicOff, Paperclip, Pencil, Square, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import ChatConfigPopover from './ChatConfigPopover.js';
import type { EffortLevel } from '../types.js';

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (attachments: File[]) => Promise<boolean>;
  onStop?: () => void;
  disabled?: boolean;
  isEditing?: boolean;
  onCancelEdit?: () => void;
  pendingFiles?: File[];
  onPendingFilesConsumed?: () => void;
  effort: EffortLevel;
  onConfigChange: (config: { effort?: EffortLevel }) => void;
}

const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export default function MessageInput({ value, onChange, onSend, onStop, disabled, isEditing, onCancelEdit, pendingFiles, onPendingFilesConsumed, effort, onConfigChange }: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const dictationBaseRef = useRef('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const supportsSpeech = typeof window !== 'undefined' && !!((window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [value]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!pendingFiles?.length) return;
    const available = MAX_ATTACHMENTS - attachments.length;
    const accepted = pendingFiles.filter(f => f.size <= MAX_ATTACHMENT_BYTES).slice(0, Math.max(available, 0));
    if (accepted.length) setAttachments(prev => [...prev, ...accepted]);
    onPendingFilesConsumed?.();
  }, [pendingFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  async function submit() {
    if ((!value.trim() && attachments.length === 0) || disabled) return;
    const sent = await onSend(attachments);
    if (!sent) return;
    setAttachments([]);
    setAttachmentError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleFilesSelected(e: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length === 0) return;
    const availableSlots = MAX_ATTACHMENTS - attachments.length;
    const accepted = selected
      .filter(file => file.size <= MAX_ATTACHMENT_BYTES)
      .slice(0, Math.max(availableSlots, 0));

    if (accepted.length !== selected.length) {
      setAttachmentError(`Attach up to ${MAX_ATTACHMENTS} files, ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB each.`);
    } else {
      setAttachmentError(null);
    }
    setAttachments(prev => [...prev, ...accepted]);
    e.target.value = '';
  }

  function removeAttachment(index: number) {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }

  function toggleDictation() {
    if (disabled) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognitionCtor = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setSpeechError('Voice input is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    dictationBaseRef.current = value;
    setSpeechError(null);

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0]?.transcript ?? '';
      }
      const base = dictationBaseRef.current.trimEnd();
      onChange(`${base}${base && transcript ? ' ' : ''}${transcript.trimStart()}`);
    };
    recognition.onerror = (event) => {
      setSpeechError(event.error === 'not-allowed' ? 'Microphone access was blocked.' : 'Voice input stopped.');
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      setSpeechError('Voice input could not start.');
      setIsListening(false);
    }
  }

  const canSend = !disabled && (!!value.trim() || attachments.length > 0);

  return (
    <div className="shrink-0 px-4 pb-5 sm:px-6">
      <div className={cn('mx-auto max-w-[46rem] rounded-[18px] border bg-card px-3 pb-2.5 pt-2.5 shadow-sm', isEditing ? 'border-primary/50' : 'border-input')}>
        {isEditing && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-primary/8 px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Pencil size={11} />
              Editing message
            </div>
            <button
              type="button"
              onClick={onCancelEdit}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((file, index) => (
              <div key={`${file.name}-${file.size}-${index}`} className="flex max-w-full items-center gap-1.5 rounded-lg border border-border-soft bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
                <FileText size={13} className="shrink-0" />
                <span className="max-w-44 truncate">{file.name}</span>
                <span className="shrink-0 text-faint-fg">{formatFileSize(file.size)}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(index)}
                  className="grid size-4 shrink-0 place-items-center rounded hover:bg-muted"
                  aria-label={`Remove ${file.name}`}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachmentError && <div className="mb-2 text-xs text-destructive">{attachmentError}</div>}
        {speechError && <div className="mb-2 text-xs text-destructive">{speechError}</div>}
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Agent is responding…' : 'Message…'}
          disabled={disabled}
          rows={1}
          className="max-h-44 min-h-[1.5rem] w-full resize-none border-0 bg-transparent dark:bg-transparent px-1 py-1 text-[15px] shadow-none placeholder:text-faint-fg focus-visible:ring-0"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFilesSelected}
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.csv,.json,.md,.tsx,.ts,.jsx,.js,.css,.html,.xml,.yaml,.yml,.toml,.sql,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.cc,.cpp,.h,.hpp,.sh,.zsh,.env"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
              title="Attach files"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-50"
            >
              <Paperclip size={16} strokeWidth={2} />
            </button>
            <ChatConfigPopover
              effort={effort}
              onConfigChange={onConfigChange}
            />
          </div>
          <div className="flex items-center gap-1">
            {disabled && onStop ? (
              <button
                type="button"
                onClick={onStop}
                title="Stop"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground transition-colors hover:bg-accent"
              >
                <Square size={13} className="fill-current" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={toggleDictation}
                  disabled={disabled || !supportsSpeech}
                  title={supportsSpeech ? (isListening ? 'Stop voice input' : 'Start voice input') : 'Voice input is not supported in this browser'}
                  aria-pressed={isListening}
                  className={cn(
                    'grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors disabled:cursor-default disabled:opacity-50',
                    isListening
                      ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {isListening ? <MicOff size={16} strokeWidth={2} /> : <Mic size={16} strokeWidth={2} />}
                </button>
                <button
                  type="button"
                  onClick={submit}
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
