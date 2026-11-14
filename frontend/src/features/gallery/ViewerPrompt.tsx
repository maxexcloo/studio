import { useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import type { Change } from "../../../../shared/suggestions";
import { api } from "../../api";
import type { MediaItem } from "../../types";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { icons } from "../../ui/icons";
import { useRemembered } from "../auth/useRemembered";
import {
  ProposalLabel,
  proposalText,
  proposedClass,
  assistMenu,
  SendButton,
  UndoButton,
  useChangeSuggestions,
} from "../generation/AskChange";
import { assistantQuery } from "../generation/PromptAssistant";
import { askNextSteps, nextStepsQuery } from "../taste/suggestions";
import type { Action, ActionGroups } from "../../ui/ActionBar";
import { typedPrompt, type Iteration } from "./useMediaAction";
import { useItemChange } from "./useItemChange";
import classes from "./MediaViewer.module.css";

/**
 * The viewer's prompt and its assistance, shared by the prompt field and the bar's AI menu. The
 * field holds the item's prompt: editing it and pressing Enter or Generate runs it with the item's
 * settings as a new version, and Improve Prompt rewrites it in one of the assistant's styles. AI
 * (`ai`) offers Review Prompt, the image's next steps, Custom…, which asks for the text typed
 * over the prompt as a change in plain words (`useItemChange`), and Refresh Suggestions. Under
 * Review Prompt, the remembered default, a change's proposal fills the field until Run runs it or
 * Undo restores what was typed; without it, the proposal runs at once.
 */
export function useViewerPrompt(
  item: MediaItem,
  { groups, iterate }: { groups: ActionGroups; iterate: (iteration: Iteration) => void },
) {
  const phone = usePhone();
  const original = typedPrompt(item);
  const [prompt, setPrompt] = useState(original);
  const field = useRef<HTMLTextAreaElement>(null);
  const [review, setReview] = useRemembered("viewer-review-first", true);
  const runNow = useRef<(proposal: Change) => void>(() => {});
  const ask = useItemChange<string>(item, {
    groups: () => groups,
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
  // Next steps are written for images; they load as the image opens.
  const offered = ask.available && item.type === "image";
  const suggestions = useChangeSuggestions({
    query: nextStepsQuery(item.jobId ?? ""),
    fresh: () => askNextSteps(item.jobId!, true),
    enabled: offered && Boolean(item.jobId),
    disabled: ask.pending,
    // Under review the field shows the request while it is asked for.
    onPick: (request) => {
      if (review) setPrompt(request);
      ask.send(request, review ? request : prompt);
    },
  });
  const assistant = useQuery(assistantQuery).data;
  const profileId = String(item.settings?.profileId || "");
  const improve = useMutation({
    mutationFn: (preset: string) =>
      api<{ prompt?: string; source?: string; reason?: string }>("/api/assistant/rewrite", {
        method: "POST",
        body: JSON.stringify({ profileId, prompt, preset, stream: false }),
      }),
    onSuccess: (result) => {
      if (result.source === "fallback" || !result.prompt)
        return void notifications.show({
          message: `The prompt assistant is unavailable (${result.reason || "no reply"}).`,
        });
      setPrompt(result.prompt);
    },
  });
  // Text typed over the prompt is the change Custom… asks for; otherwise it selects the prompt for
  // one typed over it, and phones open the editor.
  const typed = Boolean(prompt.trim()) && prompt !== original;
  const custom = () => {
    if (typed) return ask.send(prompt, prompt.trim());
    if (phone) return field.current?.click();
    field.current?.focus();
    field.current?.select();
  };
  const ai: Action | null =
    ask.available && item.jobId
      ? {
          id: "ai",
          label: "AI",
          icon: icons.assistant,
          loading: ask.pending,
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
            fixed: { label: "Changes", options: [] },
            suggestions: offered ? suggestions.group : [],
            last: [
              {
                id: "custom",
                label: "Custom…",
                icon: icons.custom,
                disabled: ask.pending,
                onClick: custom,
              },
            ],
          }),
        }
      : null;
  // Improve Prompt's styles, but Custom, whose place AI's Custom… takes.
  const styles =
    assistant?.available && profileId
      ? assistant.presets.filter((style) => style.id !== "custom")
      : [];
  const improveTool: Action | null = styles.length
    ? {
        id: "improve",
        label: "Improve Prompt",
        icon: icons.assistant,
        disabled: improve.isPending || ask.pending || !prompt.trim(),
        menu: [
          styles.map((style) => ({
            id: `improve:${style.id}`,
            label: style.label,
            description: style.description,
            onClick: () => improve.mutate(style.id),
          })),
        ],
      }
    : null;
  return { item, original, prompt, setPrompt, field, ask, typed, ai, improveTool, improve };
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
  const { item, original, prompt, setPrompt, field, ask, typed, improveTool, improve } = state;
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
  // Phones ask or generate from the editor's named sends, and a proposal's Undo and Run show there
  // too; at rest, Undo and Run stand beside the field.
  const sends = change
    ? [
        { label: "Undo", icon: icons.undo, disabled: false, keepOpen: true, onSubmit: ask.undo },
        submit,
      ]
    : [
        ...(ask.available && phone
          ? [
              {
                label: "Ask for a Change",
                text: "Ask",
                icon: icons.assistant,
                disabled: !typed || ask.pending,
                keepOpen: true,
                onSubmit: () => ask.send(prompt, prompt.trim()),
              },
            ]
          : []),
        submit,
      ];
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
    <TextBox
      ref={field}
      aria-label="Prompt"
      placeholder={`Describe the ${video ? "video" : "image"}, or ask for a change`}
      variant="unstyled"
      autosize
      oneLine
      minRows={1}
      maxRows={4}
      className={change ? `${classes.prompt} ${proposedClass}` : classes.prompt}
      description={change && <ProposalLabel proposal={change} />}
      value={prompt}
      readOnly={change?.action === "upscale"}
      onChange={setPrompt}
      onKeyDown={keys}
      tools={improveTool ? [improveTool] : []}
      copy={false}
      reset={original}
      send={send}
      busy={
        ask.pending
          ? "Asking for a Change…"
          : improve.isPending
            ? "Improving the prompt…"
            : undefined
      }
      submit={sends}
    />
  );
}
