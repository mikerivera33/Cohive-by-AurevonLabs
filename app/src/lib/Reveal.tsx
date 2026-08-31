import { useEffect, useRef } from 'react';
import type { ComponentPropsWithoutRef, ElementType } from 'react';

type RevealProps<E extends ElementType> = {
  as?: E;
} & Omit<ComponentPropsWithoutRef<E>, 'as'>;

/**
 * Scroll-driven reveal. Renders any element with `.rv` and flips it to `.rv.in`
 * the first time it crosses into view, then stops observing.
 */
export function Reveal<E extends ElementType = 'div'>({
  as,
  className,
  ...rest
}: RevealProps<E>) {
  const Tag = (as || 'div') as ElementType;
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      el.classList.add('in');
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.08 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return <Tag ref={ref} className={['rv', className].filter(Boolean).join(' ')} {...rest} />;
}
