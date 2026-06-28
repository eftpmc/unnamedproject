import type React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

function ModuleCard({
  title,
  count,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('overflow-hidden rounded-lg border border-border-soft bg-muted/20', className)}>
      <div className="flex min-h-9 items-center justify-between gap-3 px-3 pb-2 pt-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-medium text-muted-foreground">{title}</h2>
          {typeof count === 'number' && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground">
              {count}
            </span>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className="-mt-1 overflow-hidden rounded-t-lg bg-card">{children}</div>
    </section>
  );
}

function ModuleRowList({ children }: { children: React.ReactNode }) {
  return <div className="p-1">{children}</div>;
}

function ModuleRow({
  divided,
  className,
  children,
}: {
  divided?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={divided ? 'border-t border-border-soft' : undefined}>
      <div className={cn('grid min-h-10 items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40', className)}>
        {children}
      </div>
    </div>
  );
}

function ModuleEmptyRow({ label, action, to }: { label: string; action: string; to: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-11 items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 text-xs font-medium text-primary">
        {action}
        <ArrowRight size={13} />
      </span>
    </Link>
  );
}

function ModuleIconButton({
  title,
  ariaLabel,
  onClick,
  bordered = false,
  children,
}: {
  title: string;
  ariaLabel: string;
  onClick: () => void;
  bordered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        bordered && 'border border-border-soft bg-background shadow-sm',
      )}
    >
      {children}
    </button>
  );
}

function ModuleIconLink({
  to,
  title,
  ariaLabel,
  children,
}: {
  to: string;
  title: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      title={title}
      aria-label={ariaLabel}
      className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
    >
      {children}
    </Link>
  );
}

export {
  ModuleCard,
  ModuleEmptyRow,
  ModuleIconButton,
  ModuleIconLink,
  ModuleRow,
  ModuleRowList,
};
