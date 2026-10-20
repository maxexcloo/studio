import React from 'react';

/**
 * A code-split component that can be fetched ahead of time. Once `preload()`
 * has finished, it renders at once: React.lazy alone always suspends on its
 * first render, even when the code is already there, and React then holds the
 * fallback on screen for about 300 ms before revealing the content.
 */
export function preloadable<P extends object>(load: () => Promise<React.ComponentType<P>>) {
  let loaded: React.ComponentType<P> | null = null;
  let pending: Promise<React.ComponentType<P>> | null = null;
  const preload = () => {
    pending ??= load().then((component) => (loaded = component)).catch((error) => { pending = null; throw error; });
    return pending;
  };
  const Lazy = React.lazy(() => preload().then((component) => ({ default: component })));
  function Preloaded(props: P) {
    // Chosen once per mount, so a load finishing later never swaps the component under it.
    const [Ready] = React.useState(() => loaded);
    return React.createElement((Ready || Lazy) as React.ComponentType<P>, props);
  }
  return { Component: Preloaded, preload };
}
