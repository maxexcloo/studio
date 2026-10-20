import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { ImagePlus, X } from 'lucide-react';
import { modelGroups, modelName } from './catalogueNames';
import { Tip } from './components';
import { cn } from './format';
import { modelDetails } from './modelCatalogue';
import { composerAnchor, surfaceMotion, useComposerSurfaceBox } from './composerSurface';
import { useDismiss } from './useDismiss';
import type { Profile } from './types';

/** The ready profiles that take a reference image, of the kind the composer makes. */
export type ReferenceWithChoice = { profiles: Profile[]; onPick: (profileId: string) => void };

function Surface({ profiles, onPick, onClose }: { profiles: Profile[]; onPick: (profileId: string) => void; onClose: () => void }) {
  const present = useIsPresent();
  const surface = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef(document.querySelector<HTMLElement>('[data-open-trigger][aria-label="Reference With"][aria-expanded="true"]') || (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const [anchor] = React.useState(() => composerAnchor(opener.current));
  const { box, asSheet } = useComposerSurfaceBox(anchor);
  const close = React.useCallback(() => { onClose(); opener.current?.focus({ preventScroll: true }); }, [onClose]);
  useDismiss([surface, opener], present, close);
  // Grouped by family, as the model picker lists them.
  const groups = modelGroups(profiles);
  return createPortal(<motion.div ref={surface} className={cn('reference-popover reference-with', asSheet && 'is-sheet')} style={asSheet ? undefined : box || undefined} role={present ? 'dialog' : undefined} aria-label="Reference With" aria-hidden={!present || undefined} inert={!present} data-open-surface {...surfaceMotion}>
    <header className="reference-popover-head"><ImagePlus size={16} /><strong>Reference With</strong><button type="button" className="reference-popover-close" aria-label="Close Reference With" onClick={close}><X size={15} /></button></header>
    <div className="reference-popover-body reference-with-body">
      {groups.map((group) => (
        <section key={group.id} className="reference-with-group" aria-label={group.label || undefined}>
          {group.label ? <h4>{group.label}</h4> : null}
          {group.rows.map((profile) => (
            <button key={profile.id} type="button" className="model-option reference-with-option" onClick={() => { onClose(); onPick(profile.id); }}>
              <span className="model-copy"><strong>{modelName(profile).name}</strong><em>{modelDetails(profile)}</em></span>
            </button>
          ))}
        </section>
      ))}
    </div>
  </motion.div>, document.body);
}

/**
 * Where the current model takes no reference image: a button in the
 * Reference button's place that lists the models that do. Picking one
 * switches to it and opens its reference picker.
 */
export function ReferenceWithButton({ profiles, onPick }: ReferenceWithChoice) {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  return (
    <>
      <Tip content="Choose a model that takes a reference image">
        <button type="button" data-open-trigger className={cn('ref-chip ref-add reference-with-trigger', open && 'is-open')} aria-label="Reference With" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <ImagePlus size={15} strokeWidth={2.2} />
          <span className="ref-add-label"><span>Reference With</span></span>
        </button>
      </Tip>
      <AnimatePresence>{open ? <Surface profiles={profiles} onPick={onPick} onClose={close} /> : null}</AnimatePresence>
    </>
  );
}
