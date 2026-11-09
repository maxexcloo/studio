import { useRef, useState, type KeyboardEvent } from "react";
import type { MediaItem } from "../../types";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { useGroupFeature } from "../auth/AccountGate";
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
import { itemAction } from "./itemActions";
import { useChatAction } from "./MediaActions";
import { typedPrompt, type Iteration } from "./useMediaAction";
import { useItemChange } from "./useItemChange";
import classes from "./MediaViewer.module.css";

/**
 * The viewer's prompt field, at the top of its action bar. It holds the item's prompt: editing it
 * and pressing Enter or Generate runs it with the item's settings as a new version. Ask sends the
 * text as a change in plain words instead (`useItemChange`), and Suggestions offers the image's
 * next steps as changes to ask for, until Run runs the proposal or Undo restores what was typed.
 * Its tools are the text box's: Suggestions, Ask, then Continue in Chat (desktop; phones show it on
 * the action bar), which takes the item, and any change typed, to a new Chat. The bar has Copy.
 */
export function ViewerPrompt({
  item,
  groups,
  iterate,
  pending,
  onApplied,
}: {
  item: MediaItem;
  /** The item's actions, whose Upscale a change may run. */
  groups: ActionGroups;
  iterate: (iteration: Iteration) => void;
  pending?: Iteration;
  onApplied: () => void;
}) {
  const phone = usePhone();
  const chat = useChatAction(item, onApplied);
  const chatOn = useGroupFeature("chat");
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
  const done = item.status === "done" && Boolean(item.url);
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
  const continueInChat = itemAction("chat");
  const typed = prompt.trim() !== original.trim() ? prompt.trim() : undefined;
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
    // Custom… selects the prompt for a change typed over it; phones open the editor.
    onCustom: () => {
      if (phone) return field.current?.click();
      field.current?.focus();
      field.current?.select();
    },
  });
  const tools = [
    offered && suggestions.action,
    ask.available &&
      !change && {
        id: "ask",
        label: "Ask for a Change",
        icon: icons.assistant,
        disabled: !prompt.trim() || ask.pending,
        onClick: () => ask.send(prompt, prompt.trim()),
      },
    done &&
      chatOn &&
      !phone && {
        ...continueInChat,
        id: "chat",
        disabled: chat.isPending,
        onClick: () => chat.mutate(typed),
      },
  ].filter((tool): tool is Action => Boolean(tool));
  // Phones generate from the editor's send arrow; a proposal's Run stays in the field.
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
      minRows={1}
      maxRows={phone ? 2 : 4}
      className={change ? `${classes.prompt} ${proposedClass}` : classes.prompt}
      description={change && <ProposalLabel proposal={change} />}
      value={prompt}
      readOnly={change?.action === "upscale"}
      onChange={setPrompt}
      onKeyDown={keys}
      tools={tools}
      copy={false}
      send={send}
      busy={ask.pending ? "Asking for a Change…" : chat.isPending ? "Starting a Chat…" : undefined}
      submit={change ? undefined : submit}
    />
  );
}
