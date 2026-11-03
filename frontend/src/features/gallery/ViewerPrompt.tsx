import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { ActionIcon, Badge, Button, Group, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import type { Change, ChangeAction } from "../../../../shared/suggestions";
import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { useGroupFeature } from "../auth/AccountGate";
import { assistantQuery } from "../generation/PromptAssistant";
import { askChange } from "../taste/suggestions";
import { findAction, type ActionGroups } from "./ActionBar";
import { itemAction, useChatAction } from "./MediaActions";
import { typedPrompt, type Iteration } from "./useMediaAction";
import classes from "./MediaViewer.module.css";

// Pressing a field action keeps focus (and the phone keyboard) in the text.
const keepFocus = (event: PointerEvent) => event.preventDefault();

const actionLabels: Record<ChangeAction, string> = {
  edit: "Edit",
  recreate: "Recreate",
  animate: "Animate",
  upscale: "Upscale",
};

/**
 * The viewer's prompt field, at the top of its action bar. It holds the item's prompt: editing it
 * and pressing Enter or Generate runs it with the item's settings as a new version. Ask sends the
 * text as a change in plain words instead; the text model picks Edit, Recreate, Animate or Upscale
 * and its prompt replaces the text in place, highlighted beside the action's name, until Run runs it
 * or Undo restores what was typed. Continue in Chat (desktop; phones list it under More) takes the
 * item, and any change typed, to a new Chat.
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
  const assistant = useQuery(assistantQuery);
  const chat = useChatAction(item, onApplied);
  const chatOn = useGroupFeature("chat");
  const original = typedPrompt(item);
  const [prompt, setPrompt] = useState(original);
  // The proposed change, and the text it replaced for Undo.
  const [change, setChange] = useState<{ proposal: Change; typed: string } | null>(null);
  const done = item.status === "done" && Boolean(item.url);
  const video = item.type === "video";
  // The ways this item can change: an image edits, recreates and animates; a video animates again.
  const upscale = findAction(groups, "upscale-run") ?? findAction(groups, "upscale-again");
  const actions: ChangeAction[] = [
    ...(video ? [] : (["edit", "recreate"] as const)),
    "animate" as const,
    ...(upscale ? (["upscale"] as const) : []),
  ];
  const ask = useMutation({
    mutationFn: (text: string) => askChange(item.jobId!, text, actions),
    onSuccess: (answer, text) => {
      if (answer.reason) return void notifications.show({ message: answer.reason });
      const proposal = answer.suggestions[0];
      setChange({ proposal, typed: text });
      setPrompt(proposal.action === "upscale" ? proposal.label : proposal.prompt);
    },
  });
  const running = pending?.kind === "prompt";
  const mayAsk = done && Boolean(assistant.data?.available);
  function undo() {
    if (change) setPrompt(change.typed);
    setChange(null);
  }
  function run({ action }: Change) {
    if (action === "upscale") upscale?.onClick?.();
    else
      iterate({
        kind: "prompt",
        prompt: prompt.trim(),
        operation:
          action === "edit" ? "refine" : action === "animate" && !video ? "animate" : "image",
      });
    setChange(null);
    setPrompt(original);
  }
  const submit = change
    ? {
        label: "Run",
        disabled: !prompt.trim(),
        onSubmit: () => run(change.proposal),
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
      undo();
    }
  }
  const continueInChat = itemAction("chat");
  const ContinueIcon = continueInChat.icon;
  const typed = prompt.trim() !== original.trim() ? prompt.trim() : undefined;
  const askButton = mayAsk && !change && (
    <Tooltip label="Ask for a Change">
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label="Ask for a Change"
        disabled={!prompt.trim()}
        loading={ask.isPending}
        onPointerDown={keepFocus}
        onClick={() => ask.mutate(prompt.trim())}
      >
        <icons.assistant size={18} />
      </ActionIcon>
    </Tooltip>
  );
  // The action's name rides with Undo, so the phone editor's header shows it too; phones run it
  // from the editor's send arrow, as they generate.
  const proposalButtons = change && (
    <>
      <Badge variant="light" size="sm" aria-label="Proposed Action">
        {actionLabels[change.proposal.action]}
      </Badge>
      <Button size="compact-sm" variant="default" onPointerDown={keepFocus} onClick={undo}>
        Undo
      </Button>
      {!phone && (
        <Button size="compact-sm" disabled={submit.disabled} onClick={submit.onSubmit}>
          Run
        </Button>
      )}
    </>
  );
  return (
    <TextBox
      aria-label="Prompt"
      placeholder={`Describe the ${video ? "video" : "image"}, or ask for a change`}
      variant="unstyled"
      autosize
      minRows={1}
      maxRows={phone ? 2 : 4}
      className={change ? `${classes.prompt} ${classes.proposed}` : classes.prompt}
      value={prompt}
      readOnly={change?.proposal.action === "upscale"}
      onChange={setPrompt}
      onKeyDown={keys}
      // Phones send from the full-screen editor, and list Continue in Chat under More.
      rightSection={
        <Group gap={4} wrap="nowrap">
          {done && chatOn && !phone && (
            <Tooltip label={continueInChat.label}>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={continueInChat.label}
                loading={chat.isPending}
                onClick={() => chat.mutate(typed)}
              >
                <ContinueIcon size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          {askButton}
          {proposalButtons}
          {!phone && !change && (
            <Tooltip label="Generate">
              <ActionIcon
                variant="filled"
                aria-label="Generate"
                disabled={submit.disabled}
                loading={running}
                onClick={submit.onSubmit}
              >
                <ArrowUp size={18} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      }
      rightSectionWidth={
        change
          ? phone
            ? 124
            : 196
          : (done && chatOn && !phone ? 32 : 0) + (mayAsk ? 32 : 0) + (phone ? 4 : 40)
      }
      rightSectionPointerEvents="all"
      submit={submit}
    />
  );
}
