/** Currency display — 2 decimals max, no grouping (matches the design's $2200). */
export const money = (n: number): string =>
  n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 2 });
