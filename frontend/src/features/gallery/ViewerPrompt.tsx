import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { TextBox } from "../../ui/TextBox";
import {
  ProposalLabel,
  SendButton,
  UndoButton,
  assistMenu,
  changeTemplates,
  proposalText,
  proposedClass,
  useChangeSuggestions,
} from "../generation/AskChange";
import { CustomDialog } from "../generation/CustomDialog";
import { assistantQuery } from "../generation/PromptAssistant";
import { askNextSteps, nextStepsQuery } from "../taste/suggestions";
import { useItemChange } from "./useItemChange";
import { type Iteration, typedPrompt, useMediaReview } from "./useMediaAction";

import classes from "./MediaViewer.module.css";

export type ViewerChange = "edit" | "recreate";

/** A tile's Edit or Recreate request, passed to the viewer that carries it out. */
export type ViewerAsk = {
  itemId: string;
  action: ViewerChange;
  profileId?: string;
  change: { request: string } | { custom: true };
};

export interface ViewerDraftActions {
  /** The current prompt, when changed, and the prompt to base suggestions on. */
  changedPrompt?: string;
  suggestionPrompt: string;
  pending: boolean;
  pick: (action: ViewerChange, request: string, profileId?: string) => void;
  custom: (action: ViewerChange, profileId?: string) => void;
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
  const pick = (action: ViewerChange, request: string, profileId?: string, preview?: boolean) =>
    ask.send(request, prompt, item.type === "video" ? "animate" : action, profileId, preview);
  const [customAction, setCustomAction] = useState<
    (Pick<ViewerAsk, "action" | "profileId"> & { preview?: boolean }) | null
  >(null);
  const openCustom = (action: ViewerChange, profileId?: string, preview?: boolean) =>
    setCustomAction({ action, profileId, preview });
  // A tile's menu opened the viewer with its choice, asked once the assistant is ready.
  const location = useLocation();
  const navigate = useNavigate();
  const asked = (location.state as { ask?: ViewerAsk } | null)?.ask;
  useEffect(() => {
    if (!asked || asked.itemId !== item.id || !ask.available) return;
    navigate(location, { replace: true, state: { ...location.state, ask: undefined } });
    if ("custom" in asked.change) openCustom(asked.action, asked.profileId);
    else pick(asked.action, asked.change.request, asked.profileId);
  }, [asked, ask.available]);
  const custom = (
    <CustomDialog
      opened={Boolean(customAction)}
      onClose={() => setCustomAction(null)}
      title="Custom Change"
      action={review || customAction?.preview ? "Ask" : "Run"}
      onSend={(request) =>
        customAction &&
        pick(customAction.action, request, customAction.profileId, customAction.preview)
      }
    />
  );
  const draft: ViewerDraftActions = {
    changedPrompt: prompt.trim() !== original.trim() ? prompt.trim() : undefined,
    suggestionPrompt: ask.typed ?? prompt,
    pending: ask.pending,
    pick,
    custom: openCustom,
  };
  return { item, original, prompt, setPrompt, field, ask, custom, draft, openCustom, pick };
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
  const { item, original, prompt, setPrompt, field, ask, custom, openCustom } = state;
  const assistant = useQuery(assistantQuery).data;
  const change = ask.proposal;
  const running = pending?.kind === "prompt";
  const [requested, setRequested] = useState<{ itemId: string; prompt?: string }>();
  const queried = requested?.itemId === item.id && requested;
  const base = queried ? queried.prompt : undefined;
  const pick = (request: string) => state.pick("recreate", request, undefined, true);
  const suggestions = useChangeSuggestions({
    query: nextStepsQuery(item.jobId ?? "", base, item.id),
    fresh: () => askNextSteps(item.jobId!, true, base, item.id),
    enabled: ask.available && Boolean(queried),
    disabled: ask.pending,
    onPick: pick,
  });
  const tools = ask.available
    ? [
        {
          id: "viewer-changes",
          label: "Suggestions & Templates",
          icon: icons.assistant,
          menu: assistMenu({
            suggestions,
            ...changeTemplates(
              assistant?.changes ?? [],
              pick,
              () => openCustom("recreate", undefined, true),
              ask.pending,
            ),
            last: [],
          }),
          onOpen: () => {
            const typed = ask.typed ?? prompt;
            setRequested({ itemId: item.id, prompt: typed !== original ? typed : undefined });
          },
        },
      ]
    : [];
  const submit = change
    ? {
        label: ask.previewing ? "Generate" : "Run",
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
        placeholder="Prompt…"
        variant="unstyled"
        autosize
        oneLine
        minRows={1}
        maxRows={4}
        className={change ? `${classes.prompt} ${proposedClass}` : classes.prompt}
        description={
          change && (
            <ProposalLabel
              proposal={change}
              before={original}
              labels={ask.previewing ? { recreate: "Generate" } : undefined}
            />
          )
        }
        value={prompt}
        readOnly={change?.action === "upscale"}
        onChange={setPrompt}
        onKeyDown={keys}
        tools={tools}
        reset={change ? prompt : original}
        send={send}
        busy={ask.pending ? "Asking for a Change…" : undefined}
        submit={sends}
      />
      {custom}
    </>
  );
}
