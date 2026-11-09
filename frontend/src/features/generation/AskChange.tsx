import { useState, type PointerEvent, type ReactNode } from "react";
import { ActionIcon, Badge, Menu, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import type { Change, ChangeAction, NextStep, Suggestions } from "../../../../shared/suggestions";
import { icons } from "../../ui/icons";
import { ActionMenuItems, type Action } from "../gallery/ActionBar";
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
 * to `restore`. Asking again while a proposal shows replaces it and keeps the first `typed`.
 */
export function useAskChange<T>({
  ask,
  show,
  restore,
}: {
  /** Asks for `request` to the text `typed`, as it was before any proposal. */
  ask: (request: string, typed: T) => Promise<Suggestions<Change>>;
  show?: (proposal: Change) => void;
  restore?: (typed: T) => void;
}) {
  const assistant = useQuery(assistantQuery);
  const [change, setChange] = useState<{ proposal: Change; typed: T } | null>(null);
  const mutation = useMutation({
    mutationFn: ({ text, typed }: { text: string; typed: T }) => ask(text, typed),
    onSuccess: (answer, { typed }) => {
      if (answer.reason) return void notifications.show({ message: answer.reason });
      const proposal = answer.suggestions[0];
      setChange({ proposal, typed });
      show?.(proposal);
    },
  });
  return {
    available: Boolean(assistant.data?.available),
    proposal: change?.proposal,
    /** What the proposal replaced, which Undo restores. */
    typed: change?.typed,
    pending: mutation.isPending,
    send: (text: string, typed: T) =>
      mutation.mutate({ text: text.trim(), typed: change ? change.typed : typed }),
    undo() {
      if (change) restore?.(change.typed);
      setChange(null);
    },
    /** Ends the review once the proposal runs. */
    done() {
      setChange(null);
    },
  };
}

function FieldAction({
  label,
  icon,
  ...props
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label={label}
        onPointerDown={keepFocus}
        {...props}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}

/** Undo: restores what the proposal replaced. */
export function UndoButton({ onClick }: { onClick: () => void }) {
  return <FieldAction label="Undo" icon={<icons.undo size={16} />} onClick={onClick} />;
}

/** The field's send (Generate, or Run for a proposal), last in its actions. */
export function SendButton({
  label,
  disabled,
  loading,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="filled"
        aria-label={label}
        disabled={disabled}
        loading={loading}
        onPointerDown={keepFocus}
        onClick={onClick}
      >
        <ArrowUp size={16} />
      </ActionIcon>
    </Tooltip>
  );
}

/**
 * Suggestions: short changes that fit the image or draft (`query`), asked for as soon as one is
 * picked, as an action whose options are the changes. They load once `enabled` and stay cached
 * per item or prompt; Refresh asks for different ones (`fresh`) in their place, and Custom…
 * (where `onCustom` is given) leaves the person to type their own change. A failed or empty answer
 * just says there are none.
 */
export function useChangeSuggestions<K extends QueryKey>({
  query,
  fresh,
  enabled,
  disabled,
  onPick,
  onCustom,
}: {
  query: UseQueryOptions<Suggestions<NextStep>, Error, Suggestions<NextStep>, K>;
  fresh: () => Promise<Suggestions<NextStep>>;
  enabled: boolean;
  disabled?: boolean;
  onPick: (request: string) => void;
  onCustom?: () => void;
}) {
  const client = useQueryClient();
  const steps = useQuery({ ...query, enabled });
  const refresh = useMutation({
    mutationFn: fresh,
    onSuccess: (answer) => client.setQueryData<Suggestions<NextStep>>(query.queryKey, answer),
  });
  const list = steps.data?.suggestions ?? [];
  const loading = refresh.isPending || (steps.isFetching && !list.length);
  const action: Action = {
    id: "suggestions",
    label: "Suggestions",
    icon: icons.suggestions,
    disabled,
    menu: [
      loading
        ? [{ id: "thinking", label: "Thinking of Changes", disabled: true }]
        : list.length
          ? list.map((step) => ({
              id: `step:${step.label}`,
              label: step.label,
              onClick: () => onPick(step.request),
            }))
          : [{ id: "none", label: "No Suggestions", disabled: true }],
      [
        {
          id: "refresh",
          label: "Refresh",
          icon: icons.refresh,
          // Never disabled while it works: a disabled item drops focus, which closes a submenu.
          keepOpen: true,
          onClick: () => refresh.mutate(),
        },
        ...(onCustom
          ? [{ id: "custom", label: "Custom…", icon: icons.edit, onClick: onCustom }]
          : []),
      ],
    ],
  };
  return { action, loading };
}

/** Suggestions as their own menu button, beside a field outside a text box's tools. */
export function ChangeSuggestions<K extends QueryKey>({
  disabled,
  ...props
}: Omit<Parameters<typeof useChangeSuggestions<K>>[0], "enabled">) {
  const [opened, setOpened] = useState(false);
  const { action, loading } = useChangeSuggestions({ ...props, disabled, enabled: opened });
  return (
    <Menu position="top-end" width={240} opened={opened} onChange={setOpened}>
      <Tooltip label="Suggestions">
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="Suggestions"
            disabled={disabled}
            onPointerDown={keepFocus}
          >
            <icons.suggestions size={16} />
          </ActionIcon>
        </Menu.Target>
      </Tooltip>
      <Menu.Dropdown data-composer-layer aria-busy={loading || undefined}>
        <Menu.Label>Suggestions</Menu.Label>
        <ActionMenuItems groups={action.menu!} />
      </Menu.Dropdown>
    </Menu>
  );
}

/** The proposed action's name, over the field it fills, so nothing beside the text can hide it. */
export function ProposalLabel({
  proposal,
  labels,
}: {
  proposal: Change;
  /** Names an action differently where it means something else, such as the composer's Recreate. */
  labels?: Partial<Record<ChangeAction, string>>;
}) {
  return (
    <Badge component="span" variant="light" size="xs" aria-label="Proposed Action">
      {labels?.[proposal.action] ?? actionLabels[proposal.action]}
    </Badge>
  );
}
