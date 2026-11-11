import { useRef, useState, type KeyboardEvent } from "react";
import type { MediaItem } from "../../types";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { icons } from "../../ui/icons";
import {
  ProposalLabel,
  proposalText,
  proposedClass,
  SendButton,
  UndoButton,
  useChangeSuggestions,
} from "../generation/AskChange";
import { askNextSteps, nextStepsQuery } from "../taste/suggestions";
import type { Action, ActionGroups } from "./ActionBar";
import { typedPrompt, type Iteration } from "./useMediaAction";
import { useItemChange } from "./useItemChange";
import classes from "./MediaViewer.module.css";

/**
 * The viewer's prompt field, at the top of its action bar. It holds the item's prompt: editing it
 * and pressing Enter or Generate runs it with the item's settings as a new version. Ask sends the
 * text as a change in plain words instead (`useItemChange`), and Suggestions offers the image's
 * next steps as changes to ask for, until Run runs the proposal or Undo restores what was typed.
 * Its tools are the text box's: Suggestions, with Refresh Suggestions in its menu, and Ask for a
 * Change…, which phones' editor offers as a send beside Generate instead. Reset returns to the
 * item's prompt; the bar has Copy. At rest it is one line; focused, it shows the whole prompt.
 */
export function ViewerPrompt({
  item,
  groups,
  iterate,
  pending,
}: {
  item: MediaItem;
  /** The item's actions, whose Upscale a change may run. */
  groups: ActionGroups;
  iterate: (iteration: Iteration) => void;
  pending?: Iteration;
}) {
  const phone = usePhone();
  const original = typedPrompt(item);
  const [prompt, setPrompt] = useState(original);
  const field = useRef<HTMLTextAreaElement>(null);
  const ask = useItemChange<string>(item, {
    groups: () => groups,
    iterate,
    show: (proposal) => setPrompt(proposalText(proposal)),
    restore: setPrompt,
  });
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
  // Next steps, which Suggestions offers, are written for images; they load as the image opens.
  const offered = ask.available && item.type === "image";
  const suggestions = useChangeSuggestions({
    query: nextStepsQuery(item.jobId ?? ""),
    fresh: () => askNextSteps(item.jobId!, true),
    enabled: offered && Boolean(item.jobId),
    disabled: ask.pending,
    // The field is the request: a suggestion fills it and asks at once.
    onPick: (request) => {
      setPrompt(request);
      ask.send(request, request);
    },
  });
  // Text typed over the prompt is the change to ask for; otherwise Ask for a Change… selects the
  // prompt for one typed over it.
  const typed = Boolean(prompt.trim()) && prompt !== original;
  const tools = [
    offered && suggestions.action,
    ask.available &&
      !change &&
      !phone && {
        id: "ask",
        label: "Ask for a Change…",
        icon: icons.assistant,
        disabled: ask.pending,
        onClick: () => {
          if (typed) return ask.send(prompt, prompt.trim());
          field.current?.focus();
          field.current?.select();
        },
      },
  ].filter((tool): tool is Action => Boolean(tool));
  // Phones ask or generate from the editor's sends; a proposal's Run stays in the field.
  const sends = [
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
      tools={tools}
      copy={false}
      reset={original}
      send={send}
      busy={ask.pending ? "Asking for a Change…" : undefined}
      submit={change ? undefined : sends}
    />
  );
}
