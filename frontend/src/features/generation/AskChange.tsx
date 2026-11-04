import { useState, type CSSProperties, type PointerEvent, type ReactNode, type Ref } from "react";
import { ActionIcon, Badge, Group, Loader, Menu, Textarea, Tooltip } from "@mantine/core";
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
import { usePhone } from "../../ui/usePhone";
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
 * to `restore`. Asking again while a proposal shows replaces it and keeps the first `typed`. A field
 * that isn't itself the request (the composer) opens a request line for it, which stays open while
 * its proposal shows.
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
  const [request, setRequest] = useState<string | null>(null);
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
    /** The open request line's text, or null while it is closed. */
    request,
    setRequest,
    send: (text: string, typed: T) =>
      mutation.mutate({ text: text.trim(), typed: change ? change.typed : typed }),
    undo() {
      if (change) restore?.(change.typed);
      setChange(null);
    },
    /** Ends the review once the proposal runs. */
    done() {
      setChange(null);
      setRequest(null);
    },
  };
}

/**
 * A field's change actions in one column beside its text, as the composer's prompt tools stand:
 * Ask for a Change, Suggestions, Undo and the field's send last, showing only those that apply. A
 * `row` lines them up in one row instead, for a short phone field such as the viewer's, where the
 * column would stand taller than the text.
 */
export function ChangeActions({
  row = false,
  grid = false,
  children,
}: {
  row?: boolean;
  grid?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={classes.actions} data-row={row || undefined} data-grid={grid || undefined}>
      {children}
    </div>
  );
}

/** Text box props that keep a field's text at least as tall as `count` rows of actions. */
export const fitActions = (count: number) => ({
  classNames: { input: classes.fit },
  style: { "--change-actions": count } as CSSProperties,
});

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

/** The Sparkles action that asks for the change typed. */
export function AskButton(props: { disabled?: boolean; loading?: boolean; onClick: () => void }) {
  return <FieldAction label="Ask for a Change" icon={<icons.assistant size={16} />} {...props} />;
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
 * picked. They load when the menu opens and stay cached per item or prompt; Refresh asks for
 * different ones (`fresh`) in their place, and Custom… leaves the person to type their own change
 * (`onCustom`). A failed or empty answer just says there are none.
 */
export function ChangeSuggestions<K extends QueryKey>({
  query,
  fresh,
  disabled,
  onPick,
  onCustom,
}: {
  query: UseQueryOptions<Suggestions<NextStep>, Error, Suggestions<NextStep>, K>;
  fresh: () => Promise<Suggestions<NextStep>>;
  disabled?: boolean;
  onPick: (request: string) => void;
  onCustom: () => void;
}) {
  const client = useQueryClient();
  const [opened, setOpened] = useState(false);
  // Custom… focuses the field, which closing the menu mustn't take back.
  const [returnFocus, setReturnFocus] = useState(true);
  const steps = useQuery({ ...query, enabled: opened });
  const refresh = useMutation({
    mutationFn: fresh,
    onSuccess: (answer) => client.setQueryData<Suggestions<NextStep>>(query.queryKey, answer),
  });
  const list = steps.data?.suggestions ?? [];
  const loading = refresh.isPending || (steps.isFetching && !list.length);
  return (
    <Menu
      position="top-end"
      width={240}
      opened={opened}
      returnFocus={returnFocus}
      onChange={(open) => {
        if (open) setReturnFocus(true);
        setOpened(open);
      }}
    >
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
        {loading ? (
          <Menu.Item disabled leftSection={<Loader size={14} />}>
            Thinking of Changes
          </Menu.Item>
        ) : list.length ? (
          list.map((step) => (
            <Menu.Item key={step.label} title={step.request} onClick={() => onPick(step.request)}>
              {step.label}
            </Menu.Item>
          ))
        ) : (
          <Menu.Item disabled>No Suggestions</Menu.Item>
        )}
        <Menu.Divider />
        <Menu.Item closeMenuOnClick={false} disabled={loading} onClick={() => refresh.mutate()}>
          Refresh
        </Menu.Item>
        <Menu.Item
          onClick={() => {
            setReturnFocus(false);
            onCustom();
          }}
        >
          Custom…
        </Menu.Item>
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

/**
 * The request line of a field that isn't itself the request (the composer's prompt): Enter or Ask
 * sends it; Escape undoes a proposal first, then closes the line, as Close does.
 */
export function ChangeRequest({
  ask,
  label,
  suggestions,
  onSend,
  ref,
}: {
  ask: Pick<
    ReturnType<typeof useAskChange>,
    "request" | "setRequest" | "pending" | "proposal" | "undo"
  >;
  /** The proposal's name, over the line. */
  label?: ReactNode;
  suggestions?: ReactNode;
  onSend: (request: string) => void;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const phone = usePhone();
  if (ask.request === null) return null;
  const send = () => {
    if (ask.request?.trim()) onSend(ask.request);
  };
  const close = () => ask.setRequest(null);
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Textarea
        ref={ref}
        flex={1}
        aria-label="Change"
        description={label}
        placeholder="Ask for a change, like “make it night”"
        size="sm"
        {...(phone ? {} : fitActions(suggestions ? 3 : 2))}
        autosize
        minRows={2}
        maxRows={4}
        autoFocus
        data-autofocus
        value={ask.request}
        onChange={(event) => ask.setRequest(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          } else if (event.key === "Escape") {
            // The line's own Escape comes first; a second one closes what it sits in.
            event.preventDefault();
            if (ask.proposal) ask.undo();
            else close();
          }
        }}
      />
      <ChangeActions row={phone}>
        <AskButton disabled={!ask.request.trim()} loading={ask.pending} onClick={send} />
        {suggestions}
        {ask.proposal ? (
          <UndoButton onClick={ask.undo} />
        ) : (
          <FieldAction label="Close Change" icon={<icons.clear size={16} />} onClick={close} />
        )}
      </ChangeActions>
    </Group>
  );
}
