import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from './format';

/** One compact controls row; search takes space only when requested. */
export function PickerTools({ children, clear, search, query, onClearSearch, onType, searchLabel, className }: {
  children: React.ReactNode;
  clear?: React.ReactNode;
  search?: React.ReactNode;
  query: string;
  onClearSearch: () => void;
  /** Typing anywhere in the picker opens search with that character. */
  onType?: (key: string) => void;
  searchLabel: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const expanded = open || Boolean(query);
  const id = React.useId();
  const root = React.useRef<HTMLDivElement>(null);
  const focusSearch = () => requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }));
  React.useEffect(() => {
    const surface = root.current?.parentElement;
    if (!surface || !onType || !search) return;
    const type = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1 || event.key === ' ') return;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      setOpen(true);
      onType(event.key);
      focusSearch();
    };
    surface.addEventListener('keydown', type);
    return () => surface.removeEventListener('keydown', type);
  }, [onType, Boolean(search)]);
  const toggle = () => {
    if (expanded) { setOpen(false); onClearSearch(); }
    else {
      setOpen(true);
      focusSearch();
    }
  };
  return <div ref={root} className={cn('picker-tools', className)}>
    <div className="picker-toolbar">
      <div className="picker-controls">{children}</div>
      {clear}
      {search ? <button type="button" className="picker-search-toggle" aria-label={expanded ? 'Close Search' : searchLabel} aria-expanded={expanded} aria-controls={id} onClick={toggle}>{expanded ? <X size={17} /> : <Search size={17} />}</button> : null}
    </div>
    {search && expanded ? <div id={id} className="picker-search-row">{search}</div> : null}
  </div>;
}
