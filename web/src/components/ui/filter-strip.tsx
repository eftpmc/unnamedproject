import { cn } from '@/lib/utils';

interface FilterStripItem {
  value: string;
  label: string;
}

function FilterStrip({
  value,
  items,
  onValueChange,
  className,
}: {
  value: string;
  items: FilterStripItem[];
  onValueChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('-mx-1 flex gap-1 overflow-x-auto px-1 sm:mx-0 sm:shrink-0 sm:px-0', className)}>
      {items.map(item => (
        <button
          key={item.value}
          type="button"
          onClick={() => onValueChange(item.value)}
          className={cn(
            'h-8 rounded-lg px-2.5 text-sm transition-colors',
            value === item.value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export { FilterStrip };
