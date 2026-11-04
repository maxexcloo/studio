import { useState, type KeyboardEvent } from "react";
import { ActionIcon, Group, Tooltip } from "@mantine/core";
import { ArrowUp } from "lucide-react";
import type { MediaItem } from "../../types";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { useGroupFeature } from "../auth/AccountGate";
import { AskButton, ProposalControls, proposalText, proposedClass } from "../generation/AskChange";
import type { ActionGroups } from "./ActionBar";
import { itemAction, useChatAction } from "./MediaActions";
import { typedPrompt, type Iteration } from "./useMediaAction";
import { useItemChange } from "./useItemChange";
import classes from "./MediaViewer.module.css";

/**
 * The viewer's prompt field, at the top of its action bar. It holds the item's prompt: editing it
 * and pressing Enter or Generate runs it with the item's settings as a new version. Ask sends the
 * text as a change in plain words instead (`useItemChange`), until Run runs it or Undo restores
 * what was typed. Continue in Chat (desktop; phones list it under More) takes the item, and any
 * change typed, to a new Chat.
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
  return (
    <TextBox
      aria-label="Prompt"
      placeholder={`Describe the ${video ? "video" : "image"}, or ask for a change`}
      variant="unstyled"
      autosize
      minRows={1}
      maxRows={phone ? 2 : 4}
      className={change ? `${classes.prompt} ${proposedClass}` : classes.prompt}
      value={prompt}
      readOnly={change?.action === "upscale"}
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
          {ask.available && !change && (
            <AskButton
              disabled={!prompt.trim()}
              loading={ask.pending}
              onClick={() => ask.send(prompt, prompt.trim())}
            />
          )}
          {/* The action's name rides with Undo, so the phone editor's header shows it too; phones
              run it from the editor's send arrow, as they generate. */}
          {change && (
            <ProposalControls
              proposal={change}
              onUndo={ask.undo}
              run={phone ? undefined : submit}
            />
          )}
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
          : (done && chatOn && !phone ? 32 : 0) + (ask.available ? 32 : 0) + (phone ? 4 : 40)
      }
      rightSectionPointerEvents="all"
      submit={submit}
    />
  );
}
