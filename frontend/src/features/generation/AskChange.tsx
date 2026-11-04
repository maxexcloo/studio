import { useState, type PointerEvent } from "react";
import { ActionIcon, Badge, Button, Group, TextInput, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Change, ChangeAction, Suggestions } from "../../../../shared/suggestions";
import { icons } from "../../ui/icons";
import { assistantQuery } from "./PromptAssistant";
import classes from "./AskChange.module.css";

// Pressing a field action keeps focus (and the phone keyboard) in the text.
const keepFocus = (event: PointerEvent) => event.preventDefault();

const actionLabels: Record<ChangeAction, string> = {
  edit: "Edit",
  recreate: "Recreate",
  animate: "Animate",
  upscale: "Upscale",
};

/** The tint of a field holding a proposed change. */
export const proposedClass = classes.proposed;

/** What a proposal puts in the field: an upscale keeps the prompt, so it names the change. */
export const proposalText = (proposal: Change) =>
  proposal.action === "upscale" ? proposal.label : proposal.prompt;

/**
 * Ask for a Change: the prompt assistant turns a change in plain words into the action it picks
 * and that action's prompt, which `show` puts in the field in place of `typed`; Undo hands `typed`
 * to `restore`. A field that isn't itself the request (the composer, Details) opens a request line
 * for it, which Undo reopens.
 */
export function useAskChange<T>({
  ask,
  show,
  restore,
}: {
  ask: (request: string) => Promise<Suggestions<Change>>;
  show?: (proposal: Change) => void;
  restore?: (typed: T) => void;
}) {
  const assistant = useQuery(assistantQuery);
  const [request, setRequest] = useState<string | null>(null);
  const [change, setChange] = useState<{ proposal: Change; typed: T; line?: string } | null>(null);
  const mutation = useMutation({
    mutationFn: ({ text }: { text: string; typed: T; line?: string }) => ask(text),
    onSuccess: (answer, { typed, line }) => {
      if (answer.reason) return void notifications.show({ message: answer.reason });
      const proposal = answer.suggestions[0];
      setRequest(null);
      setChange({ proposal, typed, line });
      show?.(proposal);
    },
  });
  return {
    available: Boolean(assistant.data?.available),
    proposal: change?.proposal,
    pending: mutation.isPending,
    /** The open request line's text, or null while it is closed. */
    request,
    setRequest,
    send: (text: string, typed: T) =>
      mutation.mutate({ text: text.trim(), typed, line: request ?? undefined }),
    undo() {
      if (change) restore?.(change.typed);
      if (change?.line !== undefined) setRequest(change.line);
      setChange(null);
    },
    /** Ends the review once the proposal runs. */
    done: () => setChange(null),
  };
}

/** The Sparkles action that asks; in a request line it sends the request. */
export function AskButton({
  disabled,
  loading,
  onClick,
}: {
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label="Ask for a Change">
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label="Ask for a Change"
        disabled={disabled}
        loading={loading}
        onPointerDown={keepFocus}
        onClick={onClick}
      >
        <icons.assistant size={18} />
      </ActionIcon>
    </Tooltip>
  );
}

/**
 * The request line of a field that isn't itself the request: Enter or Ask sends it, Escape or
 * Close closes it.
 */
export function ChangeRequest({
  ask,
  onSend,
}: {
  ask: Pick<ReturnType<typeof useAskChange>, "request" | "setRequest" | "pending">;
  onSend: () => void;
}) {
  if (ask.request === null) return null;
  const send = () => {
    if (ask.request?.trim()) onSend();
  };
  const close = () => ask.setRequest(null);
  return (
    <TextInput
      aria-label="Change"
      placeholder="Ask for a change, like “make it night”"
      size="sm"
      autoFocus
      data-autofocus
      value={ask.request}
      onChange={(event) => ask.setRequest(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          send();
        } else if (event.key === "Escape") {
          // Closing the line comes first; a second Escape closes what it sits in.
          event.preventDefault();
          close();
        }
      }}
      rightSection={
        <Group gap={0} wrap="nowrap">
          <AskButton disabled={!ask.request.trim()} loading={ask.pending} onClick={send} />
          <Tooltip label="Close">
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="Close Change"
              onPointerDown={keepFocus}
              onClick={close}
            >
              <icons.clear size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      }
      rightSectionWidth={64}
      rightSectionPointerEvents="all"
    />
  );
}

/**
 * A proposal's review: the chosen action's name, Undo and, where the surface has no send of its
 * own for it, `run`.
 */
export function ProposalControls({
  proposal,
  labels,
  onUndo,
  run,
}: {
  proposal: Change;
  /** Names an action differently where it means something else, such as the composer's Recreate. */
  labels?: Partial<Record<ChangeAction, string>>;
  onUndo: () => void;
  run?: { label: string; disabled: boolean; onSubmit: () => void };
}) {
  return (
    <>
      <Badge variant="light" size="sm" aria-label="Proposed Action">
        {labels?.[proposal.action] ?? actionLabels[proposal.action]}
      </Badge>
      <Button size="compact-sm" variant="default" onPointerDown={keepFocus} onClick={onUndo}>
        Undo
      </Button>
      {run && (
        <Button size="compact-sm" disabled={run.disabled} onClick={run.onSubmit}>
          {run.label}
        </Button>
      )}
    </>
  );
}
