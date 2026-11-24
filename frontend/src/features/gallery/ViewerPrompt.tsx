import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import type { ImageChangeAction } from "../../../../shared/suggestions";
import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { TextBox } from "../../ui/TextBox";
import { useRemembered } from "../auth/useRemembered";
import {
  ProposalLabel,
  SendButton,
  assistMenu,
  changeTemplates,
  proposalText,
  proposalUndo,
  useChangeSuggestions,
} from "../generation/AskChange";
import { CustomDialog } from "../generation/CustomDialog";
import { assistantQuery } from "../generation/PromptAssistant";
import { askNextSteps, nextStepsQuery } from "../taste/suggestions";
import { useActionProfile } from "./mediaProfiles";
import { useItemChange } from "./useItemChange";
import { type Iteration, typedPrompt, useMediaReview } from "./useMediaAction";

import classes from "./MediaViewer.module.css";

export type ViewerChange = ImageChangeAction;

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
  suggestionPrompt?: string;
  pending: boolean;
  pick: (action: ViewerChange, request: string, profileId?: string) => void;
  custom: (action: ViewerChange, profileId?: string) => void;
}

/**
 * The viewer's prompt and its assistance. The field holds the item's prompt: editing it and
 * pressing Enter or Generate runs it with the item's settings as a new version. Its assistance
 * asks for a suggestion, template or Custom… change through `useItemChange`; tile choices use the
 * same request path. Review Prompt fills the field with a proposal until it is run or undone.
 */
export function useViewerPrompt(item: MediaItem, iterate: (iteration: Iteration) => void) {
  const original = typedPrompt(item);
  const [prompt, setPrompt] = useState(original);
  const field = useRef<HTMLTextAreaElement>(null);
  const [reviewChoice, setReview] = useMediaReview();
  const review = reviewChoice ?? false;
  const reviewPrompt = reviewChoice ?? true;
  const ask = useItemChange<string>(item, {
    iterate,
    review,
    show: (proposal) => setPrompt(proposalText(proposal)),
    restore: setPrompt,
  });
  const pick = (action: ViewerChange, request: string, profileId?: string, fromPrompt = false) =>
    ask.send(request, prompt, item.type === "video" ? "animate" : action, profileId, {
      freshSeed: fromPrompt,
      preview: fromPrompt ? reviewPrompt : review,
    });
  const [customAction, setCustomAction] = useState<
    (Pick<ViewerAsk, "action" | "profileId"> & { fromPrompt: boolean }) | null
  >(null);
  const openCustom = (action: ViewerChange, profileId?: string, fromPrompt = false) =>
    setCustomAction({ action, profileId, fromPrompt });
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
      action={(customAction?.fromPrompt ? reviewPrompt : review) ? "Ask" : "Run"}
      onSend={(request) =>
        customAction &&
        pick(customAction.action, request, customAction.profileId, customAction.fromPrompt)
      }
    />
  );
  const base = ask.typed ?? prompt;
  const draft: ViewerDraftActions = {
    changedPrompt: prompt.trim() !== original.trim() ? prompt.trim() : undefined,
    suggestionPrompt: base === original ? undefined : base,
    pending: ask.pending,
    pick,
    custom: openCustom,
  };
  return {
    item,
    original,
    prompt,
    setPrompt,
    field,
    ask,
    custom,
    draft,
    openCustom,
    pick,
    reviewPrompt,
    setReview,
  };
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
  const {
    item,
    original,
    prompt,
    setPrompt,
    field,
    ask,
    custom,
    draft,
    openCustom,
    reviewPrompt,
    setReview,
  } = state;
  const assistant = useQuery(assistantQuery).data;
  const change = ask.proposal;
  const [mode, setMode] = useRemembered<ViewerChange>("viewer-prompt-change", "recreate");
  const { menu: editProfiles, profileId: selectedEdit } = useActionProfile("image");
  const editProfileId = mode === "edit" ? selectedEdit : undefined;
  const generate = ask.freshSeed && change?.action !== "edit";
  const running = pending?.kind === "prompt";
  const [requested, setRequested] = useState<{ itemId: string; prompt?: string }>();
  const queried = requested?.itemId === item.id && requested;
  const base = queried ? queried.prompt : undefined;
  const pick = (request: string) => state.pick(mode, request, editProfileId, true);
  const imageAction = item.type === "image" ? mode : undefined;
  const templates = imageAction
    ? (assistant?.changes ?? [])
    : (assistant?.themes ?? []).flatMap((theme) =>
        theme.id !== "custom" && theme.instruction
          ? [{ ...theme, instruction: theme.instruction }]
          : [],
      );
  const suggestions = useChangeSuggestions({
    query: nextStepsQuery(item, base, imageAction),
    fresh: () => askNextSteps(item, true, base, imageAction),
    enabled: ask.available && Boolean(queried),
    disabled: ask.pending || !queried,
    onPick: pick,
  });
  const tools = ask.available
    ? [
        {
          id: "viewer-changes",
          label: "AI",
          heading: false,
          icon: icons.assistant,
          menu: [
            ...proposalUndo(change && ask.undo),
            ...assistMenu({
              settings: [
                ...(imageAction
                  ? [
                      {
                        id: "viewer-prompt-change",
                        label: "Suggestion Action",
                        disabled: ask.pending,
                        choice: {
                          value: mode,
                          options: [
                            { value: "edit", label: "Edit" },
                            { value: "recreate", label: "Recreate" },
                          ],
                          onChange: (value: string) =>
                            setMode(value === "edit" ? "edit" : "recreate"),
                        },
                      },
                    ]
                  : []),
                ...(imageAction === "edit" ? editProfiles : []),
                {
                  id: "review",
                  label: "Review Prompt",
                  icon: icons.review,
                  checked: reviewPrompt,
                  keepOpen: true,
                  disabled: ask.pending,
                  onClick: () => setReview(!reviewPrompt),
                },
              ],
              suggestions,
              ...changeTemplates(
                templates,
                pick,
                () => openCustom(mode, editProfileId, true),
                ask.pending,
                imageAction,
              ),
              last: [],
            }),
          ],
          onOpen: () => {
            setRequested({ itemId: item.id, prompt: draft.suggestionPrompt });
          },
        },
      ]
    : [];
  const submit = change
    ? {
        label: generate ? "Generate" : "Run",
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
      // Undoing the proposal comes first; a second Escape leaves the box.
      event.preventDefault();
      ask.undo();
    }
  }
  const send = (
    <SendButton
      label={submit.label}
      disabled={submit.disabled}
      loading={!change && running}
      onClick={submit.onSubmit}
    />
  );
  return (
    <>
      <TextBox
        ref={field}
        aria-label="Prompt"
        menuLabel="AI"
        placeholder="Prompt…"
        variant="unstyled"
        autosize
        oneLine
        minRows={1}
        maxRows={4}
        className={classes.prompt}
        below={
          change && (
            <ProposalLabel
              proposal={change}
              before={original}
              labels={generate ? { recreate: "Generate" } : undefined}
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
        submit={[submit]}
      />
      {custom}
    </>
  );
}
