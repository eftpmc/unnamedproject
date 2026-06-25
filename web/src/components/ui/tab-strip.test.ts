import { describe, expect, it } from 'vitest';
import { computeVisibleTabs } from './tab-strip.js';

describe('computeVisibleTabs', () => {
  it('shows everything when not yet measured (containerWidth <= 0)', () => {
    expect(computeVisibleTabs(0, [50, 50, 50], 0)).toEqual({ visible: [0, 1, 2], overflow: [] });
  });

  it('shows everything when it all fits', () => {
    // 3 tabs * 50 + 2 gaps * 4 + padding 6 = 164
    expect(computeVisibleTabs(200, [50, 50, 50], 0)).toEqual({ visible: [0, 1, 2], overflow: [] });
  });

  it('overflows tabs that do not fit, keeping a left-to-right prefix', () => {
    // budget = 100 - 6 - 40 - 4 = 50; tab 0 (50) fits exactly, tab 1 would need +4 gap = 54 > 50
    const result = computeVisibleTabs(100, [50, 50, 50], 0);
    expect(result.visible).toEqual([0]);
    expect(result.overflow).toEqual([1, 2]);
  });

  it('always keeps the active tab visible even if it would otherwise overflow', () => {
    // Same budget as above (50), active tab is index 2 (the last, which would
    // normally be cut). It must be forced into the visible set.
    const result = computeVisibleTabs(100, [50, 50, 50], 2);
    expect(result.visible).toContain(2);
    expect(result.overflow).not.toContain(2);
  });

  it('trims previously-included tabs to make room for a forced active tab', () => {
    // budget = 150 - 6 - 40 - 4 = 100. Greedy fits tabs 0 and 1 (50+4+50=104 > 100,
    // so only tab 0 fits: 50 <= 100). Active is tab 2 (width 50): needs 50+4+50=104 > 100,
    // so tab 0 must be dropped to make room, leaving just the active tab.
    const result = computeVisibleTabs(150, [50, 50, 50], 2);
    expect(result.visible).toEqual([2]);
    expect(result.overflow).toEqual([0, 1]);
  });

  it('shows the active tab alone if it does not fit with anything else', () => {
    const result = computeVisibleTabs(60, [50, 50, 50], 1);
    expect(result.visible).toEqual([1]);
    expect(result.overflow).toEqual([0, 2]);
  });
});
