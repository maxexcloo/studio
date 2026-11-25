import { ActionIcon, Image } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { type ComponentProps, type ReactNode, type Ref, memo } from "react";

import type { ChangeAction } from "../../../../shared/suggestions";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import type { Action } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { pictureItem, useMediaPreview } from "../gallery/MediaPreview";
import {
  askDraftChange,
  askDraftSteps,
  draftStepsQuery,
  draftSuggestionContext,
} from "../taste/suggestions";
import { ProposalLabel, assistMenu, useAskChange, useChangeSuggestions } from "./AskChange";
import type { Draft } from "./GenerationProvider";
import { usePromptAssistant } from "./PromptAssistant";
import { usePromptHistory } from "./PromptHistory";
import type { usePromptIdeas } from "./PromptIdeas";
import { referenceKey, referenceLabel } from "./references";

import classes from "./PromptFields.module.css";

type Operation = Draft["operation"];
// The composer's Recreate is a fresh run of the draft.
const draftLabels = { recreate: "Generate" };

/**
 * A change to the composer's draft, asked for in Improve Prompt › Custom…: the prompt assistant
 * rewrites its prompt and, with a reference attached, picks between editing that reference and a
 * fresh image, which sets the draft's operation. Generate runs it; Undo restores the prompt and
 * operation it replaced.
 */
export function useDraftChange({
  input,
  references,
  operation,
  onChange,
  onOperationChange,
}: {
  input: GenerationInput;
  references: ReferenceAsset[];
  operation: Operation;
  onChange: (patch: Partial<GenerationInput>) => void;
  onOperationChange: (operation: Operation) => void;
}) {
  const ask = useAskChange<{ prompt: string; operation: Operation }>({
    ask: (request, typed) => {
      const actions: ChangeAction[] =
        input.kind === "video"
          ? ["animate"]
          : references.length
            ? ["edit", "recreate"]
            : ["recreate"];
      return askDraftChange(
        draftSuggestionContext(input, references),
        typed.prompt,
        request,
        actions,
      );
    },
    show: ({ action, prompt }, typed) => {
      onChange({ prompt, originalPrompt: typed.prompt });
      if (action === "edit" || action === "recreate")
        onOperationChange(action === "edit" ? "refine" : "image");
    },
    restore: (typed) => {
      onChange({ prompt: typed.prompt, originalPrompt: undefined });
      onOperationChange(typed.operation);
    },
  });
  return {
    ...ask,
    /** Asks for `request`, keeping the draft's prompt and operation for Undo. */
    sendRequest: (request: string) => ask.send(request, { prompt: input.prompt, operation }),
  };
}
export type DraftChange = ReturnType<typeof useDraftChange>;

export function useGenerationPromptAssistant({
  ask,
  ...options
}: Omit<Parameters<typeof usePromptAssistant>[0], "change"> & { ask?: DraftChange }) {
  return usePromptAssistant({
    ...options,
    change: ask?.available ? { send: ask.sendRequest, pending: ask.pending } : undefined,
  });
}

export function CompactPromptFields({
  assistantScope,
  ...props
}: Omit<Parameters<typeof PromptFields>[0], "assistant" | "compact" | "negative"> & {
  assistantScope: string;
}) {
  const assistant = useGenerationPromptAssistant({ ...props, scopeKey: assistantScope });
  return <PromptFields {...props} compact negative={false} assistant={assistant} />;
}

/**
 * The composer's prompt and negative prompt with their history and assistant.
 */
export function PromptFields({
  input,
  references,
  profile,
  onChange,
  assistant,
  negative,
  textareaRef,
  autoFocus = false,
  compact = false,
  fill = false,
  ideas,
  ask,
}: {
  input: GenerationInput;
  references: ReferenceAsset[];
  profile?: Profile;
  onChange: (patch: Partial<GenerationInput>) => void;
  assistant: ReturnType<typeof usePromptAssistant>;
  /** Shows the negative prompt, for profiles that use one. */
  negative: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** Lets the surrounding focus trap start in the prompt. */
  autoFocus?: boolean;
  compact?: boolean;
  /** Fills the phone Generate sheet: the prompt takes the room left above the settings, typed in place. */
  fill?: boolean;
  /** Offers ideas in the AI menu for an empty prompt or a draft with applied cards. */
  ideas: ReturnType<typeof usePromptIdeas>;
  /** Sends the assistant's Custom… as a change to the draft (`useDraftChange`). */
  ask?: DraftChange;
}) {
  const client = useQueryClient();
  const phone = usePhone();
  const proposal = ask?.proposal;
  // Suggestions change the prompt as it was before any proposal.
  const base = ask?.typed?.prompt ?? input.prompt;
  const context = draftSuggestionContext(input, references);
  const steps = draftStepsQuery(context, base.trim());
  const draftSuggestions = useChangeSuggestions({
    query: steps,
    fresh: () => askDraftSteps(context, base.trim(), true),
    enabled: false,
    disabled: ask?.pending,
    onPick: (request) => ask?.sendRequest(request),
  });
  // Suggestions load as the AI menu opens, so they are ready to open.
  const suggestions =
    ideas.suggestions ??
    (ask?.available && base.trim()
      ? { ...draftSuggestions, load: () => void client.fetchQuery(steps).catch(() => {}) }
      : undefined);
  const preview = useMediaPreview();
  const pictures = compact
    ? references.flatMap((reference, index) => {
        const url = reference.url || reference.thumbnailUrl;
        return url
          ? [
              pictureItem({
                ...reference,
                id: referenceKey(reference),
                name: referenceLabel(reference, index, profile),
                url,
              }),
            ]
          : [];
      })
    : [];
  const cover = pictures[0];
  const assistantTool =
    assistant.stop ??
    (assistant.templates || suggestions
      ? {
          id: "assistant",
          label: "Improve Prompt",
          heading: false,
          icon: icons.assistant,
          disabled: ask?.pending,
          onOpen: suggestions?.load,
          menu: assistMenu({
            suggestions,
            // An empty prompt has nothing to rewrite: its ideas stand alone.
            templates: ideas.suggestions ? [] : (assistant.templates ?? []),
            custom: assistant.custom,
            others: [assistant.more ?? []],
            last: [],
          }),
        }
      : undefined);
  return (
    <>
      <PromptBox
        name="prompt"
        label="Prompt"
        value={input.prompt}
        onChange={(prompt) => onChange({ prompt })}
        fill={fill}
        assistant={assistantTool}
        after={assistant.dialog}
        ref={textareaRef}
        busy={assistant.working}
        data-composer-prompt={compact || undefined}
        data-expanded-prompt={!compact || undefined}
        bare={compact}
        data-autofocus={autoFocus || undefined}
        autosize={!fill}
        minRows={compact ? 1 : negative ? 4 : 3}
        maxRows={compact ? 1 : negative ? 4 : 10}
        wrap={compact ? "off" : undefined}
        rightSection={
          cover && (
            <ActionIcon
              aria-label="Preview References"
              variant="transparent"
              size={44}
              onClick={() => preview.open(pictures)}
            >
              <Image
                src={cover.thumbnailUrl || cover.url}
                alt={cover.prompt || ""}
                w={34}
                h={34}
                radius="md"
              />
            </ActionIcon>
          )
        }
        rightSectionWidth={cover ? 44 : undefined}
        rightSectionPointerEvents={cover ? "all" : undefined}
        onClick={compact && phone ? (event) => event.preventDefault() : undefined}
        onKeyDown={(event) => {
          // Undoing the proposal comes first; a second Escape closes the composer.
          if (event.key === "Escape" && proposal && !event.nativeEvent.isComposing) {
            event.preventDefault();
            ask.undo();
          }
        }}
        below={
          proposal ? (
            <ProposalLabel proposal={proposal} before={base} labels={draftLabels} />
          ) : (
            ideas.label && <span>{ideas.label}</span>
          )
        }
      />
      {preview.element}
      {negative && (
        <NegativePrompt
          value={input.negative}
          onChange={onChange}
          fill={fill}
          assistant={assistant.negativeTool}
        />
      )}
    </>
  );
}

const NegativePrompt = memo(function NegativePrompt({
  value,
  onChange,
  fill,
  assistant,
}: {
  value: string;
  onChange: (patch: Partial<GenerationInput>) => void;
  fill: boolean;
  assistant?: Action;
}) {
  const history = usePromptHistory({
    kind: "negative",
    value,
    onPick: (negative) => onChange({ negative }),
  });
  return (
    <PromptBox
      name="negative"
      label="Negative Prompt"
      value={value}
      onChange={(negative) => onChange({ negative })}
      fill={fill}
      assistant={assistant}
      history={history}
      autosize={!fill}
      minRows={2}
      maxRows={4}
    />
  );
});

/**
 * The prompt and negative prompt share one box: its tools, the borderless
 * field and, in the phone Generate sheet, editing in place.
 */
function PromptBox({
  name,
  label,
  value,
  onChange,
  fill,
  assistant,
  history,
  after,
  bare = false,
  ...props
}: Omit<ComponentProps<typeof TextBox>, "inline" | "popups" | "tools"> & {
  name: "prompt" | "negative";
  label: string;
  fill: boolean;
  assistant?: Action;
  history?: ReturnType<typeof usePromptHistory>;
  /** Content after the box, such as the assistant's dialog. */
  after?: ReactNode;
  /** Keeps the field's own text styles (the compact composer). */
  bare?: boolean;
}) {
  return (
    <div
      className={name === "prompt" ? classes.area : classes.negative}
      data-fill={fill || undefined}
      data-text-box={name}
    >
      <TextBox
        {...props}
        tools={[...(assistant ? [assistant] : []), ...(history ? [history.action] : [])]}
        popups={history?.popup}
        classNames={bare ? undefined : { input: classes.input }}
        variant="unstyled"
        aria-label={label}
        placeholder={`${label}…`}
        inline={fill}
        value={value}
        onChange={onChange}
      />
      {after}
    </div>
  );
}
