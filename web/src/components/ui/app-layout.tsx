import * as React from 'react';
import { cn } from '@/lib/utils';

function PageShell({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)} {...props}>
      {children}
    </div>
  );
}

function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
  contentClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  className?: string;
  /** Constrains and centers the header's inner content (e.g. "max-w-2xl") to match a page's content column width. The header's own background/border stay full-width. */
  contentClassName?: string;
}) {
  return (
    <header className={cn('shrink-0 border-b border-border-soft px-5 py-4', className)}>
      <div className={cn('mx-auto w-full', contentClassName)}>
        {breadcrumb && <div className="mb-1.5">{breadcrumb}</div>}
        <div className="flex min-h-8 items-center justify-between gap-3">
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {description && (
          <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</div>
        )}
      </div>
    </header>
  );
}

function PageBody({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex-1 overflow-y-auto px-5 py-5', className)}
      {...props}
    >
      {children}
    </div>
  );
}

function ContentColumn({ className, children, ...props }: React.ComponentProps<'div'>) {
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
    <section className={cn('space-y-3', className)}>
      <h2 className="text-[13px] font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** Bordered card surface. `interactive` adds lift-on-hover. */
function Surface({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<'div'> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border-soft bg-card',
        interactive &&
          'cursor-pointer transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-px hover:border-border hover:shadow-md',
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
        'rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm',
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
    <div className={cn('flex flex-1 items-center justify-center px-6', className)}>
      <div className="w-full max-w-sm text-center">
        <p className="text-base font-semibold tracking-tight text-foreground">{title}</p>
        {description && (
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-[filter] hover:brightness-105"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function PageLoading({ className, rows = 3 }: { className?: string; rows?: number }) {
  return (
    <PageBody className={className}>
      <ContentColumn className="space-y-4">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-muted" />
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-20 animate-pulse rounded-xl bg-muted',
              i % 2 === 1 && 'w-2/3',
            )}
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
