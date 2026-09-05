const COLORS = ['#6EC4FF', '#1B4FD8', '#8FD0FF', '#A78BFA', '#34D399', '#F472B6'];

/** Short amber burst for a locked-in vote. No-ops when the user prefers reduced motion. */
export function fireConfetti(): void {
  if (
    typeof window === 'undefined' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return;
  }

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:50%;top:45%;z-index:200;pointer-events:none';

  for (let i = 0; i < 16; i++) {
    const p = document.createElement('div');
    const c = COLORS[i % COLORS.length];
    p.style.cssText =
      `position:absolute;width:7px;height:${4 + (i % 3) * 3}px;background:${c};` +
      `left:${(Math.random() - 0.5) * 130}px;top:${(Math.random() - 0.5) * 30}px;` +
      `border-radius:2px;animation:cvfall ${0.7 + Math.random() * 0.5}s ease-in forwards;` +
      `transform:rotate(${Math.random() * 360}deg)`;
    box.appendChild(p);
  }

  document.body.appendChild(box);
  setTimeout(() => box.remove(), 1400);
}
