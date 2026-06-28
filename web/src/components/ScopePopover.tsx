import { Check, Folder, Target } from 'lucide-react';
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '../lib/utils.js';
import type { Space } from '../types.js';

export default function ScopePopover({
  projects,
  pinnedProject,
  agentActive,
  onScopeChange,
}: {
  projects: Space[];
  pinnedProject: Space | null;
  agentActive: boolean;
  onScopeChange: (projectId: string | null) => void;
}) {
  const isAuto = !pinnedProject;
  const triggerLabel = pinnedProject?.name ?? 'No project';

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {isAuto ? (
          <Target size={14} className="shrink-0" strokeWidth={1.85} />
        ) : (
          <span className={cn('size-1.5 shrink-0 rounded-full', agentActive ? 'bg-success' : 'bg-muted-foreground/40')} />
        )}
        <span className="truncate">Pinned · {triggerLabel}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-72 p-2">
        <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold text-faint-fg">
          Pinned project
        </div>
        <ScopeOption
          selected={isAuto}
          icon={<Target size={14} />}
          title="None"
          description="Let the agent create or choose a project."
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
              description="Project context"
              onClick={() => onScopeChange(project.id)}
            />
          ))}
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ScopeOption({
  selected,
  icon,
  title,
  description,
  onClick,
}: {
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={onClick}
      className={cn(
        'min-w-0 gap-2 px-2 py-2',
        selected && 'bg-accent-tint text-on-accent-soft',
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
    </DropdownMenuItem>
  );
}
