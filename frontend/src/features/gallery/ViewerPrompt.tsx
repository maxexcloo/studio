import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Tooltip } from "@mantine/core";
import type { MediaItem } from "../../types";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { useGroupFeature } from "../auth/AccountGate";
import {
  AskButton,
  ChangeSuggestions,
  ProposalLabel,
  proposalText,
  proposedClass,
  SendButton,
  UndoButton,
} from "../generation/AskChange";
import { askNextSteps, nextStepsQuery } from "../taste/suggestions";
import type { ActionGroups } from "./ActionBar";
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
 * Its actions are the text box's tools, the send last. Continue in Chat (desktop; phones show it on
 * the action bar) takes the item, and any change typed, to a new Chat.
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
  const ContinueIcon = continueInChat.icon;
  const typed = prompt.trim() !== original.trim() ? prompt.trim() : undefined;
  // Next steps, which Suggestions offers, are written for images.
  const offered = ask.available && item.type === "image";
  // Suggestions start loading in the background as the image opens, so the menu is ready.
  const client = useQueryClient();
  useEffect(() => {
    if (offered && item.jobId) void client.prefetchQuery(nextStepsQuery(item.jobId));
  }, [client, offered, item.jobId]);
  const actions = [
    done && chatOn && !phone && (
      <Tooltip key="chat" label={continueInChat.label}>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={continueInChat.label}
          loading={chat.isPending}
          onClick={() => chat.mutate(typed)}
        >
          <ContinueIcon size={16} />
        </ActionIcon>
      </Tooltip>
    ),
    ask.available && !change && (
      <AskButton
        key="ask"
        disabled={!prompt.trim()}
        loading={ask.pending}
        onClick={() => ask.send(prompt, prompt.trim())}
      />
    ),
    offered && (
      <ChangeSuggestions
        key="suggestions"
        query={nextStepsQuery(item.jobId!)}
        fresh={() => askNextSteps(item.jobId!, true)}
        disabled={ask.pending}
        // The field is the request: a suggestion fills it and asks at once.
        onPick={(request) => {
          setPrompt(request);
          ask.send(request, request);
        }}
        // Custom… selects the prompt for a change typed over it; phones open the editor.
        onCustom={() => {
          if (phone) return field.current?.click();
          field.current?.focus();
          field.current?.select();
        }}
      />
    ),
    change && <UndoButton key="undo" onClick={ask.undo} />,
    // Phones generate from the editor's send arrow; a proposal's Run stays in the field.
    (change || !phone) && (
      <SendButton
        key="send"
        label={submit.label}
        disabled={submit.disabled}
        loading={!change && running}
        onClick={submit.onSubmit}
      />
    ),
  ];
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
      tools={actions}
      submit={change ? undefined : submit}
    />
  );
}
