import { useState, type KeyboardEvent } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  CloseButton,
  Group,
  Loader,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUp, MessageCircle } from "lucide-react";
import type { Change, ChangeAction } from "../../../../shared/suggestions";
import type { MediaItem } from "../../types";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { assistantQuery } from "../generation/PromptAssistant";
import { askChange } from "../taste/suggestions";
import { findAction, type ActionGroups } from "./ActionBar";
import { itemAction, useChatAction } from "./MediaActions";
import { typedPrompt, type Iteration } from "./useMediaAction";
import classes from "./MediaViewer.module.css";

const actionLabels: Record<ChangeAction, string> = {
  edit: "Edit",
  recreate: "Recreate",
  animate: "Animate",
  upscale: "Upscale",
};

/**
 * The viewer's prompt field, at the top of its action bar. It holds the item's prompt: editing it
 * and pressing Enter or Generate runs it with the item's settings as a new version. Its chat icon
 * asks for a change in plain words instead; the text model picks Edit, Recreate, Animate or
 * Upscale and writes the prompt, which shows above the field until it runs. Continue in Chat
 * (desktop; phones list it under More) takes the item, and any change typed, to a new Chat.
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
  const [prompt, setPrompt] = useState(() => typedPrompt(item));
  const [asking, setAsking] = useState(false);
  const [request, setRequest] = useState("");
  const [change, setChange] = useState<Change | null>(null);
  const done = item.status === "done" && Boolean(item.url);
  const video = item.type === "video";
  // The ways this item can change: an image edits, recreates and animates; a video animates again.
  const upscale = findAction(groups, "upscale-balanced") ?? findAction(groups, "upscale-again");
  const actions: ChangeAction[] = [
    ...(video ? [] : (["edit", "recreate"] as const)),
    "animate" as const,
    ...(upscale ? (["upscale"] as const) : []),
  ];
  const ask = useMutation({
    mutationFn: (text: string) => askChange(item.jobId!, text, actions),
    onSuccess: (answer) => {
      if (answer.reason) notifications.show({ message: answer.reason });
      else setChange(answer.suggestions[0]);
    },
  });
  const running = pending?.kind === "prompt";
  const mayAsk = done && Boolean(assistant.data?.available);
  function run(next: Change) {
    if (next.action === "upscale") upscale?.onClick?.();
    else
      iterate({
        kind: "prompt",
        prompt: next.prompt,
        operation:
          next.action === "edit"
            ? "refine"
            : next.action === "animate" && !video
              ? "animate"
              : "image",
      });
    setChange(null);
    setRequest("");
    setAsking(false);
  }
  const submit = asking
    ? {
        label: "Ask",
        disabled: !request.trim() || ask.isPending,
        onSubmit: () => ask.mutate(request.trim()),
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
    } else if (event.key === "Escape" && (asking || change)) {
      // Leaving ask mode comes first; a second Escape closes the viewer.
      event.preventDefault();
      setChange(null);
      setAsking(false);
    }
  }
  const continueInChat = itemAction("chat");
  const ContinueIcon = continueInChat.icon;
  return (
    <>
      {change && (
        <div className={classes.change} role="group" aria-label="Proposed Change">
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <Badge variant="light" mt={2} className={classes.changeAction}>
              {actionLabels[change.action]}
            </Badge>
            <div className={classes.changeText}>
              <Text size="sm" fw={500}>
                {change.label}
              </Text>
              {change.action !== "upscale" && (
                <Text size="sm" c="dimmed" lineClamp={3}>
                  {change.prompt}
                </Text>
              )}
            </div>
            <CloseButton size="sm" aria-label="Dismiss Change" onClick={() => setChange(null)} />
          </Group>
          <Group justify="flex-end" gap="xs">
            <Button size="compact-sm" variant="light" onClick={() => run(change)}>
              {`Run ${actionLabels[change.action]}`}
            </Button>
          </Group>
        </div>
      )}
      <TextBox
        aria-label={asking ? "Ask for a Change" : "Prompt"}
        placeholder={
          asking
            ? "Ask for a change, like make it night"
            : `Describe the ${video ? "video" : "image"}`
        }
        variant="unstyled"
        autosize
        minRows={1}
        maxRows={phone ? 2 : 4}
        className={classes.prompt}
        value={asking ? request : prompt}
        onChange={asking ? setRequest : setPrompt}
        onKeyDown={keys}
        leftSection={
          mayAsk && (
            <Tooltip label={asking ? "Edit Prompt" : "Ask for a Change"}>
              <ActionIcon
                variant={asking ? "light" : "subtle"}
                color={asking ? undefined : "gray"}
                aria-label="Ask for a Change"
                aria-pressed={asking}
                onClick={() => {
                  setAsking((value) => !value);
                  setChange(null);
                }}
              >
                <MessageCircle size={18} />
              </ActionIcon>
            </Tooltip>
          )
        }
        leftSectionWidth={mayAsk ? 44 : undefined}
        leftSectionPointerEvents="all"
        // Phones send from the full-screen editor, and list Continue in Chat under More.
        rightSection={
          phone ? (
            ask.isPending && <Loader size="xs" color="gray" aria-label="Asking" />
          ) : (
            <Group gap={4} wrap="nowrap">
              {done && (
                <Tooltip label={continueInChat.label}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={continueInChat.label}
                    loading={chat.isPending}
                    onClick={() => chat.mutate(asking ? request.trim() : undefined)}
                  >
                    <ContinueIcon size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              <Tooltip label={submit.label}>
                <ActionIcon
                  variant="filled"
                  aria-label={submit.label}
                  disabled={submit.disabled}
                  loading={asking ? ask.isPending : running}
                  onClick={submit.onSubmit}
                >
                  <ArrowUp size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
          )
        }
        rightSectionWidth={phone ? undefined : done ? 84 : 44}
        rightSectionPointerEvents="all"
        submit={submit}
      />
    </>
  );
}
