import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import type { Change } from "../../../../shared/suggestions";
import type { MediaItem } from "../../types";
import { type Action, type ActionGroups } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import {
  ProposalLabel,
  SendButton,
  UndoButton,
  assistMenu,
  proposalText,
  proposedClass,
  useChangeSuggestions,
} from "../generation/AskChange";
import { CustomDialog } from "../generation/CustomDialog";
import { assistantQuery } from "../generation/PromptAssistant";
import { askNextSteps, nextStepsQuery } from "../taste/suggestions";
import { useItemChange } from "./useItemChange";
import { type EditAsk, type Iteration, typedPrompt, useEditReview } from "./useMediaAction";

import classes from "./MediaViewer.module.css";

/** A change asked for from a tile's Edit menu, which opens the viewer to ask it there. */
export type ViewerAsk = { request: string } | { custom: true };

/**
 * The viewer's prompt and its assistance. The field holds the item's prompt: editing it and
 * pressing Enter or Generate runs it with the item's settings as a new version. Suggestions asks
 * for a suggestion, template or Custom… change through `useItemChange`; tile Edit choices use
 * the same request path. Review Prompt is off until chosen: when on, a proposal fills the field
 * until Run runs it or Undo restores what was typed; otherwise, the proposal runs at once.
 */
export function useViewerPrompt(
  item: MediaItem,
  { groups, iterate }: { groups: () => ActionGroups; iterate: (iteration: Iteration) => void },
) {
  const original = typedPrompt(item);
  const [prompt, setPrompt] = useState(original);
  const field = useRef<HTMLTextAreaElement>(null);
  const [review, setReview] = useEditReview();
  const runNow = useRef<(proposal: Change) => void>(() => {});
  const ask = useItemChange<string>(item, {
    groups,
    iterate,
    show: (proposal) => (review ? setPrompt(proposalText(proposal)) : runNow.current(proposal)),
    restore: setPrompt,
  });
  // Another item starts from its own prompt, without the last one's proposal.
  const [shownItem, setShownItem] = useState(item.id);
  if (shownItem !== item.id) {
    setShownItem(item.id);
    setPrompt(original);
    ask.done();
  }
  runNow.current = (proposal) => {
    ask.run(proposal.prompt, proposal);
    setPrompt(original);
  };
  // Under review the field shows the request while it is asked for.
  const pick = (request: string) => {
    if (review) setPrompt(request);
    ask.send(request, prompt);
  };
  const [customOpen, setCustomOpen] = useState(false);
  // A tile's Edit menu opened the viewer with its choice, asked once the assistant is ready.
  const location = useLocation();
  const navigate = useNavigate();
  const asked = (location.state as { ask?: ViewerAsk } | null)?.ask;
  useEffect(() => {
    if (!asked || !ask.available) return;
    navigate(location, { replace: true, state: { ...location.state, ask: undefined } });
    if ("custom" in asked) setCustomOpen(true);
    else pick(asked.request);
  }, [asked, ask.available]);
  const assistant = useQuery(assistantQuery).data;
  const custom = (
    <CustomDialog
      opened={customOpen}
      onClose={() => setCustomOpen(false)}
      title="Custom Change"
      action={review ? "Ask" : "Run"}
      onSend={(request) => ask.send(request, prompt)}
    />
  );
  const edit: EditAsk = {
    pending: ask.pending,
    pick,
    custom: () => setCustomOpen(true),
  };
  // Capture the current draft when either menu opens, without asking on every keystroke.
  const [suggestionSource, setSuggestionSource] = useState<{ item: string; prompt: string }>();
  const suggestionPrompt = suggestionSource?.item === item.id ? suggestionSource.prompt : original;
  const suggestions = useChangeSuggestions({
    query: nextStepsQuery(item.jobId ?? "", suggestionPrompt, item.id),
    fresh: () => askNextSteps(item.jobId!, true, suggestionPrompt, item.id),
    enabled: ask.available && item.type === "image" && suggestionSource?.item === item.id,
    disabled: ask.pending,
    onPick: pick,
  });
  const suggestionsTool: Action | null = ask.available
    ? {
        id: "suggestions",
        label: "Suggestions",
        icon: icons.assistant,
        onOpen: () => setSuggestionSource({ item: item.id, prompt: ask.typed ?? prompt }),
        menu: assistMenu({
          settings: [
            {
              id: "review",
              label: "Review Prompt",
              icon: icons.review,
              checked: review,
              keepOpen: true,
              onClick: () => setReview(!review),
            },
          ],
          suggestions: item.type === "image" ? suggestions.group : [],
          templates: (assistant?.changes ?? []).map((change) => ({
            id: `change:${change.id}`,
            label: change.label,
            icon: icons.assistant,
            disabled: ask.pending,
            onClick: () => pick(change.instruction),
          })),
          custom: [
            {
              id: "custom",
              label: "Custom…",
              icon: icons.custom,
              disabled: ask.pending,
              onClick: () => setCustomOpen(true),
            },
          ],
          last: [],
        }),
      }
    : null;
  return { item, original, prompt, setPrompt, field, ask, custom, edit, suggestionsTool };
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
  const phone = usePhone();
  const { item, original, prompt, setPrompt, field, ask, custom, suggestionsTool } = state;
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
        disabled: !prompt.trim() || running,
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
  // Phones generate from the editor's send, and a proposal's Undo and Run show there too; at rest,
  // Undo and Run stand beside the field.
  const sends = change
    ? [
        { label: "Undo", icon: icons.undo, disabled: false, keepOpen: true, onSubmit: ask.undo },
        submit,
      ]
    : [submit];
  const send = (
    <>
      {change && <UndoButton onClick={ask.undo} />}
      {(change || !phone) && (
        <SendButton
          label={submit.label}
          disabled={submit.disabled}
          loading={!change && running}
          onClick={submit.onSubmit}
        />
      )}
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
        tools={suggestionsTool ? [suggestionsTool] : []}
        copy={false}
        reset={original}
        send={send}
        busy={ask.pending ? "Asking for a Change…" : undefined}
        submit={sends}
      />
      {custom}
    </>
  );
}
