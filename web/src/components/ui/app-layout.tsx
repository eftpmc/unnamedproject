import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

function PageShell({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}
      {...props}
    >
      {children}
    </div>
  );
}

function PageHeader({
  title,
  description,
  actions,
  size = 'compact',
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  size?: 'compact' | 'page';
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-border/40 px-4 py-3 sm:px-6',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className={cn(
          'truncate font-semibold text-foreground',
          size === 'page' ? 'text-2xl tracking-tight' : 'text-[15px]',
        )}>
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}

function PageBody({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div className={cn('flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6', className)} {...props}>
      {children}
    </div>
  );
}

function ContentColumn({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div className={cn('mx-auto w-full max-w-5xl', className)} {...props}>
      {children}
    </div>
  );
}

function PageSection({
  title,
  children,
  className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3 border-t border-border/50 py-6 first:border-t-0 first:pt-0', className)}>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Surface({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<'div'> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border/50 bg-background/55 shadow-none',
        interactive && 'transition-colors hover:border-border hover:bg-background/85',
        className,
      )}
      {...props}
    />
  );
}

function EmptyPanel({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm',
        className,
      )}
    >
      <div className="font-medium text-foreground">{title}</div>
      {description && (
        <div className="mt-1 leading-relaxed text-muted-foreground">{description}</div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function CenteredEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-1 items-center justify-center px-6 pb-24', className)}>
      <Surface className="w-full max-w-md px-6 py-5 text-center shadow-sm">
        <div className="text-base font-semibold text-foreground">{title}</div>
        {description && (
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        {actionLabel && onAction && (
          <Button onClick={onAction} className="mt-4">
            {actionLabel}
          </Button>
        )}
      </Surface>
    </div>
  );
}

function PageLoading({
  className,
  rows = 3,
}: {
  className?: string;
  rows?: number;
}) {
  return (
    <PageBody className={className}>
      <ContentColumn className="space-y-4">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn('h-20 rounded-xl', i % 2 === 1 && 'w-2/3', i % 2 === 0 && 'w-full')}
          />
        ))}
      </ContentColumn>
    </PageBody>
  );
}

export {
  CenteredEmptyState,
  ContentColumn,
  EmptyPanel,
  PageBody,
  PageHeader,
  PageLoading,
  PageSection,
  PageShell,
  Surface,
};
