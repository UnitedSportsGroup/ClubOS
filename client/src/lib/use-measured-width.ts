import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Measure the container ourselves instead of using recharts'
 * `<ResponsiveContainer>`.
 *
 * 🔴 ResponsiveContainer measures ZERO on first paint and corrects itself on
 * the next ResizeObserver tick. The chart drawn in that first pass collapses
 * every point onto one x — a single vertical blue line where the graph should
 * be — and that is what a fresh page load renders before it settles. Caught by
 * screenshotting: it looked perfect in a browser that had already been sitting
 * on the page, and broken in every capture taken at load.
 *
 * Rendering nothing until the width is known makes the first painted frame the
 * correct one, which is the only frame some people will look at.
 */
export function useMeasuredWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  // 🔴 A CALLBACK ref, not useRef + useEffect([]).
  //
  // The chart div only exists in the `hasAny` branch. With an empty dep array
  // the effect runs ONCE, on mount — and if the div was not mounted at that
  // instant (one render with an empty series, a refetch, StrictMode's
  // double-invoke) then `ref.current` is null, the observer never attaches,
  // and the width stays 0 forever. That is exactly what shipped in v473: the
  // headline read $6,928.00 on production with no chart under it.
  //
  // A callback ref fires whenever the node attaches or detaches, so a
  // conditionally-rendered element is always measured.
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const set = () => setWidth(el.clientWidth);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    observer.current = ro;
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return { ref, width };
}
