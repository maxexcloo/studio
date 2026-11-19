import { type Ref, memo } from "react";

import type { ChangeAction } from "../../../../shared/suggestions";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import { TextBox } from "../../ui/TextBox";
import { askDraftChange, askDraftSteps, draftStepsQuery } from "../taste/suggestions";
import {
  ChangeSuggestions,
  ProposalLabel,
  UndoButton,
  proposedClass,
  useAskChange,
} from "./AskChange";
import type { Draft } from "./GenerationProvider";
import { usePromptAssistant } from "./PromptAssistant";
import { usePromptHistory } from "./PromptHistory";
import { usePromptIdeas } from "./PromptIdeas";

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
type DraftChange = ReturnType<typeof useDraftChange>;

/**
 * The composer's prompt and negative prompt with their history and assistant, and the assistant's
 * suggestions below; Compare uses the same fields.
 */
export function PromptFields({
  input,
  profile,
  references,
  onChange,
  assistantScope,
  negative,
  onNegativeWritten,
  textareaRef,
  autoFocus = false,
  fill = false,
  ideas: offerIdeas = false,
  ask,
}: {
  input: GenerationInput;
  profile?: Profile;
  references: ReferenceAsset[];
  onChange: (patch: Partial<GenerationInput>) => void;
  assistantScope: string;
  /** Shows the negative prompt, for profiles that use one. */
  negative: boolean;
  onNegativeWritten?: () => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** Lets the surrounding focus trap start in the prompt. */
  autoFocus?: boolean;
  /** Fills the phone Generate sheet: the prompt takes the room left above the settings, typed in place. */
  fill?: boolean;
  /** Offers ideas in the AI menu for an empty prompt or a draft with applied cards. */
  ideas?: boolean;
  /** Sends the assistant's Custom… as a change to the draft (`useDraftChange`). */
  ask?: DraftChange;
}) {
  const proposal = ask?.proposal;
  // Suggestions change the prompt as it was before any proposal.
  const base = ask?.typed?.prompt ?? input.prompt;
  const assistant = usePromptAssistant({
    scopeKey: assistantScope,
    input,
    profile,
    references,
    onChange,
    onNegativeWritten,
    change: ask?.available
      ? {
          send: ask.sendRequest,
          pending: ask.pending,
          suggestions: (pick, render) => (
            <ChangeSuggestions
              query={draftStepsQuery(input.kind, base.trim())}
              fresh={() => askDraftSteps(input.kind, base.trim(), true)}
              disabled={!base.trim() || ask.pending}
              onPick={pick}
            >
              {render}
            </ChangeSuggestions>
          ),
        }
      : undefined,
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
  return (
    <>
      <div
        className={classes.area}
        data-split={negative || undefined}
        data-fill={fill || undefined}
        data-text-box="prompt"
      >
        <TextBox
          ref={textareaRef}
          tools={[ideas.tool, assistant.action, history.action].filter((tool) => !!tool)}
          send={proposal ? <UndoButton onClick={ask.undo} /> : offerIdeas && ideas.undo}
          busy={assistant.working}
          popups={history.popup}
          data-expanded-prompt
          classNames={{ input: classes.input }}
          className={proposal ? proposedClass : undefined}
          // The proposal's action names it over the prompt; Generate runs it.
          description={
            proposal ? (
              <ProposalLabel proposal={proposal} before={base} labels={draftLabels} />
            ) : (
              ideas.label
            )
          }
          variant="unstyled"
          aria-label="Prompt"
          data-autofocus={autoFocus || undefined}
          placeholder={
            input.kind === "image" ? "Describe the image" : "Describe the motion and camera"
          }
          autosize={!fill}
          minRows={negative ? 4 : 3}
          maxRows={negative ? 4 : 10}
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
          below={assistant.suggestions}
        />
        {assistant.dialog}
      </div>
      {negative && <NegativePrompt value={input.negative} onChange={onChange} fill={fill} />}
    </>
  );
}

const NegativePrompt = memo(function NegativePrompt({
  value,
  onChange,
  fill,
}: {
  value: string;
  onChange: (patch: Partial<GenerationInput>) => void;
  fill: boolean;
}) {
  const history = usePromptHistory({
    kind: "negative",
    value,
    onPick: (negative) => onChange({ negative }),
  });
  return (
    <div className={classes.negative} data-fill={fill || undefined} data-text-box="negative">
      <TextBox
        tools={[history.action]}
        popups={history.popup}
        classNames={{ input: classes.input }}
        variant="unstyled"
        aria-label="Negative Prompt"
        placeholder="Negative prompt: what to leave out"
        rows={2}
        inline={fill}
        value={value}
        onChange={(negative) => onChange({ negative })}
      />
    </div>
  );
});
