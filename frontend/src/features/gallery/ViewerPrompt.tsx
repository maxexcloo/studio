import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { TextBox } from "../../ui/TextBox";
import {
  ProposalLabel,
  SendButton,
  UndoButton,
  proposalText,
  proposedClass,
} from "../generation/AskChange";
import { CustomDialog } from "../generation/CustomDialog";
import { useItemChange } from "./useItemChange";
import { type Iteration, typedPrompt, useMediaReview } from "./useMediaAction";

import classes from "./MediaViewer.module.css";

export type ViewerChange = "edit" | "recreate";

/** A tile's Edit or Recreate request, passed to the viewer that carries it out. */
export type ViewerAsk = {
  itemId: string;
  action: ViewerChange;
  change: { request: string } | { custom: true };
};

export interface ViewerDraftActions {
  /** The current prompt, when changed, and the prompt to base suggestions on. */
  changedPrompt?: string;
  suggestionPrompt: string;
  pending: boolean;
  pick: (action: ViewerChange, request: string) => void;
  custom: (action: ViewerChange) => void;
}

/**
 * The viewer's prompt and its assistance. The field holds the item's prompt: editing it and
 * pressing Enter or Generate runs it with the item's settings as a new version. Its assistance
 * asks for a suggestion, template or Custom… change through `useItemChange`; tile choices use the
 * same request path. Review Prompt is off until chosen: when on, a proposal fills the field
 * until Run runs it or Undo restores what was typed; otherwise, the proposal runs at once.
 */
export function useViewerPrompt(item: MediaItem, iterate: (iteration: Iteration) => void) {
  const original = typedPrompt(item);
  const [prompt, setPrompt] = useState(original);
  const field = useRef<HTMLTextAreaElement>(null);
  const [review] = useMediaReview();
  const ask = useItemChange<string>(item, {
    iterate,
    review,
    show: (proposal) => setPrompt(proposalText(proposal)),
    restore: setPrompt,
  });
  const pick = (action: ViewerChange, request: string) =>
    ask.send(request, prompt, item.type === "video" ? "animate" : action);
  const [customAction, setCustomAction] = useState<ViewerChange | null>(null);
  // A tile's menu opened the viewer with its choice, asked once the assistant is ready.
  const location = useLocation();
  const navigate = useNavigate();
  const asked = (location.state as { ask?: ViewerAsk } | null)?.ask;
  useEffect(() => {
    if (!asked || asked.itemId !== item.id || !ask.available) return;
    navigate(location, { replace: true, state: { ...location.state, ask: undefined } });
    if ("custom" in asked.change) setCustomAction(asked.action);
    else pick(asked.action, asked.change.request);
  }, [asked, ask.available]);
  const custom = (
    <CustomDialog
      opened={Boolean(customAction)}
      onClose={() => setCustomAction(null)}
      title="Custom Change"
      action={review ? "Ask" : "Run"}
      onSend={(request) => customAction && pick(customAction, request)}
    />
  );
  const draft: ViewerDraftActions = {
    changedPrompt: prompt.trim() !== original.trim() ? prompt.trim() : undefined,
    suggestionPrompt: ask.typed ?? prompt,
    pending: ask.pending,
    pick,
    custom: setCustomAction,
  };
  return { item, original, prompt, setPrompt, field, ask, custom, draft };
}

export type ViewerPromptState = ReturnType<typeof useViewerPrompt>;

/** The prompt field, at the top of the viewer's action bar. At rest it is one line; focused, all. */
export function ViewerPrompt({
  state,
  iterate,
  pending,
}: {
  state: ViewerPromptState;
  iterate: (iteration: Iteration) => void;
  pending?: Iteration;
}) {
  const { item, original, prompt, setPrompt, field, ask, custom } = state;
  const change = ask.proposal;
  const video = item.type === "video";
  const running = pending?.kind === "prompt";
  const submit = change
    ? {
        label: "Run",
        disabled: !prompt.trim(),
        onSubmit: () => {
          ask.run(prompt);
          setPrompt(original);
        },
      }
    : {
        label: "Generate",
        disabled: !prompt.trim() || prompt.trim() === original.trim() || running,
        onSubmit: () => iterate({ kind: "prompt", prompt: prompt.trim(), operation: "image" }),
      };
  function keys(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!submit.disabled) submit.onSubmit();
    } else if (event.key === "Escape" && change) {
      // Undoing the proposal comes first; a second Escape closes the viewer.
      event.preventDefault();
      ask.undo();
    }
  }
  // The phone editor offers these above the keyboard; at rest they stand beside the field.
  const sends = change
    ? [
        { label: "Undo", icon: icons.undo, disabled: false, keepOpen: true, onSubmit: ask.undo },
        submit,
      ]
    : [submit];
  const send = (
    <>
      {change && <UndoButton onClick={ask.undo} />}
      <SendButton
        label={submit.label}
        disabled={submit.disabled}
        loading={!change && running}
        onClick={submit.onSubmit}
      />
    </>
  );
  return (
    <>
      <TextBox
        ref={field}
        aria-label="Prompt"
        placeholder={`Describe the ${video ? "video" : "image"}`}
        variant="unstyled"
        autosize
        oneLine
        minRows={1}
        maxRows={4}
        className={change ? `${classes.prompt} ${proposedClass}` : classes.prompt}
        description={change && <ProposalLabel proposal={change} before={original} />}
        value={prompt}
        readOnly={change?.action === "upscale"}
        onChange={setPrompt}
        onKeyDown={keys}
        tools={[]}
        reset={original}
        send={send}
        busy={ask.pending ? "Asking for a Change…" : undefined}
        submit={sends}
      />
      {custom}
    </>
  );
}
