import { Check, ChevronDown, Folder, Target } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '../lib/utils.js';
import type { Space, SessionSpaceLink } from '../types.js';

export default function ScopePopover({
  projects,
  pinnedProject,
  inferredProject,
  agentActive,
  onOpenProject,
  onScopeChange,
}: {
  projects: Space[];
  pinnedProject: Space | null;
  inferredProject: SessionSpaceLink | null;
  agentActive: boolean;
  onOpenProject: (projectId: string) => void;
  onScopeChange: (projectId: string | null) => void;
}) {
  const isAuto = !pinnedProject;
  const triggerLabel = pinnedProject?.name ?? (inferredProject ? `Auto · ${inferredProject.name}` : 'Auto');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-1 flex w-fit max-w-full items-center gap-1.5 rounded-lg border border-border/40 bg-muted/50 px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
          aria-label={`Chat scope: ${triggerLabel}`}
        >
          {isAuto ? (
            <Target size={12} className="shrink-0" strokeWidth={1.85} />
          ) : (
            <span className={cn('size-1.5 shrink-0 rounded-full', agentActive ? 'bg-success' : 'bg-muted-foreground/40')} />
          )}
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown size={11} className="shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold text-faint-fg">
          Scope of this chat
        </div>
        <ScopeOption
          selected={isAuto}
          icon={<Target size={14} />}
          title="Auto"
          description={inferredProject ? `Agent attached ${inferredProject.name}.` : 'Let the agent route this work or create a project.'}
          onClick={() => onScopeChange(null)}
        />
        <div className="my-1 border-t border-border-soft" />
        <div className="max-h-60 overflow-y-auto">
          {projects.map(project => (
            <ScopeOption
              key={project.id}
              selected={pinnedProject?.id === project.id}
              icon={<Folder size={14} />}
              title={project.name}
              description="Space context"
              onClick={() => onScopeChange(project.id)}
              onAuxClick={() => onOpenProject(project.id)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ScopeOption({
  selected,
  icon,
  title,
  description,
  onClick,
  onAuxClick,
}: {
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  onAuxClick?: () => void;
}) {
  return (
    <div className="group flex items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors',
          selected ? 'bg-accent-tint text-on-accent-soft' : 'hover:bg-muted',
        )}
      >
        <span className={cn('grid size-7 shrink-0 place-items-center rounded-md', selected ? 'bg-primary/10' : 'bg-muted text-muted-foreground')}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">{title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{description}</span>
        </span>
        {selected && <Check size={13} className="shrink-0" strokeWidth={2.4} />}
      </button>
      {onAuxClick && (
        <button
          type="button"
          onClick={onAuxClick}
          className="hidden shrink-0 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground group-hover:block"
        >
          Open
        </button>
      )}
    </div>
  );
}
