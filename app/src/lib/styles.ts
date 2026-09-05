import type { CSSProperties } from 'react';
import type { Category } from '../types';

/** Per-category accent — drives map pins, spot rails and the hex chips. */
export const CATEGORY_COLORS: Record<Category, string> = {
  food: '#F472B6',
  sight: '#4EB4FF',
  nature: '#34D399',
  museum: '#60A5FA',
  nightlife: '#A78BFA',
  shopping: '#8FD0FF',
  hotel: '#2DD4BF',
};

export const CATEGORY_LABELS: Record<Category, string> = {
  food: 'Food',
  sight: 'Sight',
  nature: 'Nature',
  museum: 'Museum',
  nightlife: 'Nightlife',
  shopping: 'Shopping',
  hotel: 'Stay',
};

export const catColor = (c: Category | string): string =>
  CATEGORY_COLORS[c as Category] || '#4EB4FF';

export const catLabel = (c: Category | string): string =>
  CATEGORY_LABELS[c as Category] || String(c);

/** Small category hexagon. */
export const catChip = (cat: Category | string): CSSProperties => ({
  width: 12,
  height: 12,
  flexShrink: 0,
  background: catColor(cat),
  clipPath: 'polygon(50% 0%,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)',
  display: 'inline-block',
});

/** Glowing member dot. */
export const memberDot = (c: string): CSSProperties => ({
  width: 9,
  height: 9,
  borderRadius: 99,
  background: c,
  boxShadow: `0 0 7px ${c}`,
  display: 'inline-block',
  flexShrink: 0,
  marginTop: 4,
});

/** Pill filter chip — filled when selected. */
export const chipStyle = (on: boolean, color?: string): CSSProperties => ({
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontWeight: 600,
  fontSize: 10.5,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  borderRadius: 99,
  padding: '7px 13px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'all .22s cubic-bezier(.2,.85,.25,1.1)',
  border: on ? 'none' : '1px solid var(--lineB)',
  background: on ? color || 'var(--grad)' : 'transparent',
  color: on ? 'var(--onGrad)' : 'var(--soft)',
  boxShadow: on ? 'var(--glow)' : 'none',
});

/** Sets the scale factor used by `.press:active`. */
export const press = (scale = 0.96) => ({ '--press': scale }) as CSSProperties;
