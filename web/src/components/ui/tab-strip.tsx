import * as React from 'react';
import { Check, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const GAP = 4; // px, matches gap-1
const TRACK_PADDING = 6; // px, matches p-[3px] on both sides
const MORE_BUTTON_WIDTH = 40; // px, fixed-size icon-only trigger

export interface TabStripItem {
  key: string;
  label: string;
}

/**
 * Pure fitting logic, kept separate from measurement/DOM so it's directly
 * unit-testable. Returns which tab indices are visible (left-to-right, with
 * the active tab always included even if it would otherwise overflow) and
 * which are pushed into the overflow menu.
 */
export function computeVisibleTabs(
  containerWidth: number,
  tabWidths: number[],
  activeIndex: number,
): { visible: number[]; overflow: number[] } {
  const n = tabWidths.length;
  const all = Array.from({ length: n }, (_, i) => i);

  if (containerWidth <= 0) {
    // Not measured yet — assume everything fits to avoid an initial flash
    // of a collapsed tab strip before the first real measurement.
    return { visible: all, overflow: [] };
  }

  const totalWidth = tabWidths.reduce((sum, w) => sum + w, 0) + GAP * Math.max(0, n - 1) + TRACK_PADDING;
  if (totalWidth <= containerWidth) {
    return { visible: all, overflow: [] };
  }

  const budget = containerWidth - TRACK_PADDING - MORE_BUTTON_WIDTH - GAP;
  const included: number[] = [];
  let running = 0;
  for (let i = 0; i < n; i++) {
    const w = tabWidths[i] + (included.length > 0 ? GAP : 0);
    if (running + w <= budget) {
      running += w;
      included.push(i);
    } else {
      break;
    }
  }

  if (!included.includes(activeIndex)) {
    const activeWidth = tabWidths[activeIndex];
    while (included.length > 0) {
      const currentTotal = included.reduce((sum, idx) => sum + tabWidths[idx], 0) + GAP * Math.max(0, included.length - 1);
      if (currentTotal + GAP + activeWidth <= budget) break;
      included.pop();
    }
    included.push(activeIndex);
  }

  const visibleSet = new Set(included);
  const visible = all.filter(i => visibleSet.has(i));
  const overflow = all.filter(i => !visibleSet.has(i));
  return { visible, overflow };
}

export function TabStrip<T extends TabStripItem>({
  tabs,
  activeKey,
  ariaLabel,
  renderTab,
  onSelect,
}: {
  tabs: T[];
  activeKey: string;
  ariaLabel: string;
  /** Renders the real interactive element (Link/button) for a tab in the always-visible row. */
  renderTab: (tab: T, isActive: boolean) => React.ReactNode;
  /** Called when a tab is chosen from the overflow ("...") menu. */
  onSelect: (tab: T) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const measureRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const [tabWidths, setTabWidths] = React.useState<number[]>([]);

  React.useLayoutEffect(() => {
    setTabWidths(measureRefs.current.map(el => el?.offsetWidth ?? 0));
  }, [tabs]);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const activeIndex = Math.max(0, tabs.findIndex(t => t.key === activeKey));
  const { visible, overflow } = React.useMemo(
    () => computeVisibleTabs(containerWidth, tabWidths.length === tabs.length ? tabWidths : tabs.map(() => 0), activeIndex),
    [containerWidth, tabWidths, tabs, activeIndex],
  );

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Hidden measurement row: same tabs, laid out but invisible, used only to read natural widths. */}
      <div aria-hidden className="invisible absolute inset-0 flex items-center gap-1 p-[3px]" style={{ pointerEvents: 'none' }}>
        {tabs.map((tab, i) => (
          <span
            key={tab.key}
            ref={el => { measureRefs.current[i] = el; }}
            className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-medium"
          >
            {tab.label}
          </span>
        ))}
      </div>

      <nav className="inline-flex h-9 w-fit items-center gap-1 rounded-lg bg-muted p-[3px]" aria-label={ariaLabel}>
        {visible.map(i => renderTab(tabs[i], tabs[i].key === activeKey))}
        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More tabs"
                className="inline-flex h-full items-center justify-center rounded-md px-2.5 text-muted-foreground transition-all hover:text-foreground"
              >
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {overflow.map(i => {
                const tab = tabs[i];
                const isActive = tab.key === activeKey;
                return (
                  <DropdownMenuItem key={tab.key} onSelect={() => onSelect(tab)}>
                    <span className={cn('flex-1', isActive && 'font-medium text-foreground')}>{tab.label}</span>
                    {isActive && <Check size={14} />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>
    </div>
  );
}
