import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Modal } from './Modal';
import { dismissToast, toast } from './toast';

/** `irreversible` confirms even when the "Confirm before removing things" setting is off. `items` lists what it acts on (thumbnails and names). */
export type ConfirmationItem = { id: string; name: string; thumb?: string };
export type ConfirmationOptions = { title: string; description: string; action: string; destructive?: boolean; irreversible?: boolean; items?: ConfirmationItem[] };
export type ConfirmAction = (options: ConfirmationOptions) => Promise<boolean>;
export type PromptOptions = { title: string; description?: string; label?: string; initialValue?: string; action?: string; placeholder?: string };
export type PromptText = (options: PromptOptions) => Promise<string | null>;

/**
 * Confirmations ask in the status pill, inline, never in a dialog
 * (UI-PATTERNS › Messages): the question and one line on what happens, then
 * Cancel and the answer, with the list of what it acts on under the pill when
 * there are several. Naming text (`promptText`) still uses the shared Modal.
 */
export function useConfirmation(enabled: boolean) {
  const [prompt, setPrompt] = useState<PromptOptions | null>(null);
  const [draft, setDraft] = useState('');
  const promptResolveRef = useRef<((value: string | null) => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = useRef(new Set<string>());

  const settlePrompt = useCallback((value: string | null) => {
    const resolve = promptResolveRef.current;
    promptResolveRef.current = null;
    setPrompt(null);
    resolve?.(value);
  }, []);
  useEffect(() => () => {
    open.current.forEach((id) => dismissToast(id));
    promptResolveRef.current?.(null);
  }, []);

  const confirmAction: ConfirmAction = useCallback((options) => {
    if (!enabled && !options.irreversible) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let answered = false;
      const answer = (value: boolean) => { if (answered) return; answered = true; open.current.delete(id); resolve(value); };
      const id = toast.warning(options.title, {
        id: `confirm-${Math.random().toString(36).slice(2)}`,
        confirm: { detail: options.description, destructive: options.destructive, items: options.items },
        action: { label: options.action, onClick: () => answer(true) },
        onClose: () => answer(false)
      });
      open.current.add(id);
    });
  }, [enabled]);

  const promptText: PromptText = useCallback((options) => {
    if (promptResolveRef.current) return Promise.resolve(null);
    setDraft(options.initialValue || '');
    return new Promise<string | null>((resolve) => {
      promptResolveRef.current = resolve;
      setPrompt(options);
    });
  }, []);

  const submitPrompt = () => { const value = draft.trim(); if (value) settlePrompt(value); };

  const confirmationDialog = (
    <>
      <Modal
        open={!!prompt}
        onOpenChange={(open) => { if (!open) settlePrompt(null); }}
        size="alert"
        icon={<Pencil size={17} />}
        title={prompt?.title}
        description={prompt?.description}
        hideClose
        dismissOnOutside
        initialFocus={inputRef}
        footer={
          <>
            <button className="btn" onClick={() => settlePrompt(null)}>Cancel</button>
            <button className="btn is-primary" disabled={!draft.trim()} onClick={submitPrompt}>{prompt?.action || 'Save'}</button>
          </>
        }
      >
        <input
          ref={inputRef}
          className="modal-input"
          aria-label={prompt?.label || prompt?.title}
          value={draft}
          placeholder={prompt?.placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitPrompt(); } }}
        />
      </Modal>
    </>
  );
  return { confirmAction, promptText, confirmationDialog };
}
