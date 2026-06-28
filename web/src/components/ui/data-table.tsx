import type React from 'react';
import { cn } from '@/lib/utils';

function DataTable({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border-soft bg-card', className)}>
      {children}
    </div>
  );
}

function DataTableHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid min-h-9 items-center gap-3 border-b border-border-soft bg-muted/20 px-3 text-xs font-medium text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}

function DataTableBody({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-border-soft">{children}</div>;
}

function DataTableRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid min-h-10 items-center gap-3 px-3 py-1.5 transition-colors hover:bg-muted/40', className)}>
      {children}
    </div>
  );
}

export { DataTable, DataTableBody, DataTableHeader, DataTableRow };
