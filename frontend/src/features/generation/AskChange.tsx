import { ActionIcon, Badge, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  type QueryKey,
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { type PointerEvent, type ReactNode, useMemo, useState } from "react";

import {
  type Change,
  type ChangeAction,
  type NextStep,
  type Suggestions,
  maxSuggestions,
} from "../../../../shared/suggestions";
import { type Action, type ActionGroups } from "../../ui/ActionBar";
import { compareNames } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { changeSummary } from "./changeSummary";
import { type AssistantOption, assistantQuery } from "./PromptAssistant";

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
 * Suggestions as a submenu and Refresh beside it. Neither spins: Suggestions greys until it has
 * options, saying why once an answer brings none, and keeps them while Refresh asks for others.
 */
export function suggested(
  list: Action[],
  {
    loading,
    answered,
    failure,
    disabled,
    onRefresh,
  }: {
    loading: boolean;
    /** An answer or failure arrived, so an empty list has a reason to show. */
    answered: boolean;
    failure?: string;
    disabled?: boolean;
    onRefresh: () => void;
  },
): { action: Action; refresh: Action } {
  const empty = !list.length;
  return {
    action: {
      id: "suggestions",
      label: "Suggestions",
      icon: icons.assistant,
      disabled: disabled || empty,
      description: !empty
        ? undefined
        : loading
          ? "Loading…"
          : answered
            ? failure || "No suggestions."
            : undefined,
      menu: [list],
    },
    refresh: {
      id: "refresh",
      label: "Refresh",
      icon: icons.refresh,
      keepOpen: true,
      disabled: disabled || loading,
      onClick: onRefresh,
    },
  };
}

/**
 * Changes that fit the image or draft, loaded once enabled and cached per item or prompt.
 */
export function useChangeSuggestions<K extends QueryKey>({
  query,
  fresh,
  enabled,
  disabled,
  onPick,
}: {
  query: UseQueryOptions<Suggestions<NextStep>, Error, Suggestions<NextStep>, K>;
  fresh: () => Promise<Suggestions<NextStep>>;
  enabled: boolean;
  disabled?: boolean;
  onPick: (request: string) => void;
}) {
  const client = useQueryClient();
  const steps = useQuery({ ...query, enabled });
  const refresh = useMutation({
    mutationFn: fresh,
    onSuccess: (answer) => client.setQueryData<Suggestions<NextStep>>(query.queryKey, answer),
  });
  const options = [...(steps.data?.suggestions ?? [])]
    .slice(0, maxSuggestions)
    .sort((a, b) => compareNames(a.label, b.label))
    .map((step): Action => ({
      id: `step:${step.label}`,
      label: step.label,
      onClick: () => onPick(step.request),
    }));
  const { action, refresh: again } = suggested(options, {
    loading: refresh.isPending || steps.isFetching,
    answered: Boolean(steps.data || steps.error || refresh.error),
    failure: refresh.error?.message || steps.error?.message || steps.data?.reason,
    disabled,
    onRefresh: () => refresh.mutate(),
  });
  return { action, options, refresh: again };
}

/**
 * An assistant menu's settings, Suggestions and Templates, then their actions and the run. Either
 * alone lists its options inline; both together open as submenus.
 */
export const assistMenu = ({
  loading,
  settings = [],
  suggestions,
  templates,
  custom = [],
  others = [],
  last,
}: {
  loading?: boolean;
  settings?: Action[];
  suggestions?: { action: Action; refresh: Action };
  templates: Action[];
  custom?: Action[];
  others?: ActionGroups;
  last: Action[];
}): ActionGroups => {
  if (loading) return [[{ id: "loading", label: "Loading…", disabled: true }]];
  const choices = [...templates].sort((a, b) => compareNames(a.label, b.label));
  const tail = [...custom, ...(suggestions ? [suggestions.refresh] : [])];
  if (suggestions && choices.length) {
    const nested = { id: "templates", label: "Templates", icon: icons.templates, menu: [choices] };
    return [settings, [suggestions.action, nested, ...tail], ...others, last];
  }
  const inline = suggestions ? suggestionItems(suggestions.action) : choices;
  return [settings, inline, tail, ...others, last];
};

/** Suggestions' options listed in place, or one greyed item saying why there are none yet. */
export function suggestionItems(action: Action): Action[] {
  const ideas = action.menu?.[0] ?? [];
  if (!ideas.length)
    return [
      {
        ...action,
        menu: undefined,
        label: action.description ?? action.label,
        description: undefined,
      },
    ];
  return action.disabled ? ideas.map((idea) => ({ ...idea, disabled: true })) : ideas;
}

export function changeTemplates(
  options: (AssistantOption & { instruction: string })[],
  pick: (request: string) => void,
  openCustom: () => void,
  disabled?: boolean,
) {
  return {
    templates: options.map((change): Action => ({
      id: `change:${change.id}`,
      label: change.label,
      disabled,
      onClick: () => pick(change.instruction),
    })),
    custom: [
      {
        id: "custom",
        label: "Custom…",
        icon: icons.custom,
        disabled,
        onClick: openCustom,
      },
    ],
  };
}

/** A text box's AI menu holding only Suggestions and Refresh. */
export const suggestionsTool = (
  suggestions: { action: Action; refresh: Action },
  onOpen?: () => void,
): Action => ({
  id: "assistant",
  label: "Suggestions",
  icon: icons.assistant,
  heading: false,
  menu: assistMenu({ suggestions, templates: [], last: [] }),
  onOpen,
});

/** Supplies a text box's suggestions, loading once its AI menu opens. */
export function ChangeSuggestions<K extends QueryKey>({
  children,
  ...props
}: Omit<Parameters<typeof useChangeSuggestions<K>>[0], "enabled"> & {
  children: (action: Action) => ReactNode;
}) {
  const [requested, setRequested] = useState(false);
  const suggestions = useChangeSuggestions({ ...props, enabled: requested });
  return children(suggestionsTool(suggestions, () => setRequested(true)));
}

/**
 * The proposed action and the words it changes, below the prompt it fills.
 */
export function ProposalLabel({
  proposal,
  before = "",
  labels,
}: {
  proposal: Change;
  before?: string;
  /** Names an action differently where it means something else, such as the composer's Recreate. */
  labels?: Partial<Record<ChangeAction, string>>;
}) {
  const { action, label, prompt } = proposal;
  const changed = useMemo(
    () => (action !== "upscale" && changeSummary(before, prompt, 160)) || label,
    [action, before, label, prompt],
  );
  return (
    <Text component="span" size="xs" className={classes.change}>
      <Badge component="span" size="xs" aria-label="Proposed Action">
        {labels?.[action] ?? actionLabels[action]}
      </Badge>
      <span>{changed}</span>
    </Text>
  );
}
