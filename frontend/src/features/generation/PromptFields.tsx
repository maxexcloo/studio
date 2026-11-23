import { ActionIcon, Image } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { type Ref, memo } from "react";

import type { ChangeAction } from "../../../../shared/suggestions";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import type { Action } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { pictureItem, useMediaPreview } from "../gallery/MediaPreview";
import { askDraftChange, askDraftSteps, draftStepsQuery } from "../taste/suggestions";
import {
  ChangeSuggestions,
  ProposalLabel,
  UndoButton,
  assistMenu,
  proposedClass,
  useAskChange,
  useChangeSuggestions,
} from "./AskChange";
import type { Draft } from "./GenerationProvider";
import { usePromptAssistant } from "./PromptAssistant";
import { usePromptHistory } from "./PromptHistory";
import { usePromptIdeas } from "./PromptIdeas";
import { referenceKey } from "./references";

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
      return askDraftChange(input.kind, typed.prompt, request, actions);
    },
    show: ({ action, prompt }) => {
      onChange({ prompt });
      if (action === "edit" || action === "recreate")
        onOperationChange(action === "edit" ? "refine" : "image");
    },
    restore: (typed) => {
      onChange({ prompt: typed.prompt });
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
  const { input } = options;
  const prompt = (ask?.typed?.prompt ?? input.prompt).trim();
  return usePromptAssistant({
    ...options,
    change: ask?.available
      ? {
          send: ask.sendRequest,
          pending: ask.pending,
          suggestions: (pick, render) => (
            <ChangeSuggestions
              query={draftStepsQuery(input.kind, prompt)}
              fresh={() => askDraftSteps(input.kind, prompt, true)}
              disabled={!prompt || ask.pending}
              onPick={pick}
            >
              {render}
            </ChangeSuggestions>
          ),
        }
      : undefined,
  });
}

export function CompactPromptFields({
  assistantScope,
  ...props
}: Omit<Parameters<typeof PromptFields>[0], "assistant" | "compact" | "negative"> & {
  profile?: Profile;
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
  onChange,
  assistant,
  negative,
  textareaRef,
  autoFocus = false,
  compact = false,
  fill = false,
  ideas: offerIdeas = false,
  ask,
}: {
  input: GenerationInput;
  references: ReferenceAsset[];
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
  ideas?: boolean;
  /** Sends the assistant's Custom… as a change to the draft (`useDraftChange`). */
  ask?: DraftChange;
}) {
  const client = useQueryClient();
  const phone = usePhone();
  const proposal = ask?.proposal;
  // Suggestions change the prompt as it was before any proposal.
  const base = ask?.typed?.prompt ?? input.prompt;
  const steps = draftStepsQuery(input.kind, base.trim());
  const draftSuggestions = useChangeSuggestions({
    query: steps,
    fresh: () => askDraftSteps(input.kind, base.trim(), true),
    enabled: false,
    disabled: ask?.pending,
    onPick: (request) => ask?.sendRequest(request),
  });
  const history = usePromptHistory({
    kind: "positive",
    value: input.prompt,
    onPick: (prompt) => onChange({ prompt }),
  });
  const ideas = usePromptIdeas({
    input,
    references,
    enabled: offerIdeas && !proposal && !ask?.pending,
    onChange: (prompt) => onChange({ prompt }),
  });
  const suggestions =
    ideas.suggestions ??
    (ask?.available && base.trim()
      ? {
          ...draftSuggestions,
          action: {
            ...draftSuggestions.action,
            onOpen: () => void client.fetchQuery(steps).catch(() => {}),
          },
        }
      : undefined);
  const preview = useMediaPreview();
  const pictures = compact
    ? references.flatMap((reference) => {
        const url = reference.url || reference.thumbnailUrl;
        return url ? [pictureItem({ ...reference, id: referenceKey(reference), url })] : [];
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
          menu: assistMenu({
            suggestions,
            templates: assistant.templates ?? [],
            custom: assistant.custom,
            others: [assistant.more ?? []],
            last: [],
          }),
        }
      : undefined);
  return (
    <>
      <div className={classes.area} data-fill={fill || undefined} data-text-box="prompt">
        <TextBox
          ref={textareaRef}
          tools={[assistantTool, history.action].filter((tool) => !!tool)}
          copyBefore={history.action.id}
          send={proposal ? <UndoButton onClick={ask.undo} /> : offerIdeas && ideas.undo}
          busy={assistant.working}
          popups={history.popup}
          data-composer-prompt={compact || undefined}
          data-expanded-prompt={!compact || undefined}
          classNames={compact ? undefined : { input: classes.input }}
          className={proposal ? proposedClass : undefined}
          variant="unstyled"
          aria-label="Prompt"
          data-autofocus={autoFocus || undefined}
          placeholder="Prompt…"
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
                <Image src={cover.thumbnailUrl || cover.url} alt="" w={34} h={34} radius="md" />
              </ActionIcon>
            )
          }
          rightSectionWidth={cover ? 44 : undefined}
          rightSectionPointerEvents={cover ? "all" : undefined}
          onClick={compact && phone ? (event) => event.preventDefault() : undefined}
          inline={fill}
          value={input.prompt}
          onChange={(prompt) => onChange({ prompt })}
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
              ideas.label
            )
          }
        />
        {assistant.dialog}
      </div>
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
    <div className={classes.negative} data-fill={fill || undefined} data-text-box="negative">
      <TextBox
        tools={assistant ? [assistant, history.action] : [history.action]}
        popups={history.popup}
        classNames={{ input: classes.input }}
        variant="unstyled"
        aria-label="Negative Prompt"
        placeholder="Negative Prompt…"
        rows={2}
        inline={fill}
        value={value}
        onChange={(negative) => onChange({ negative })}
      />
    </div>
  );
});
