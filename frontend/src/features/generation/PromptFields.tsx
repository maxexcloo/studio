import { Fragment, type Ref } from "react";
import type { ChangeAction } from "../../../../shared/suggestions";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { askDraftChange, askDraftSteps, draftStepsQuery } from "../taste/suggestions";
import {
  ChangeSuggestions,
  ProposalLabel,
  proposedClass,
  UndoButton,
  useAskChange,
} from "./AskChange";
import type { Draft } from "./GenerationProvider";
import { usePromptAssistant } from "./PromptAssistant";
import { usePromptIdeas } from "./PromptIdeas";
import { PromptHistory } from "./PromptHistory";
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
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** Lets the surrounding focus trap start in the prompt. */
  autoFocus?: boolean;
  /** Fills the phone Generate sheet: the prompt takes the room left above the settings, typed in place. */
  fill?: boolean;
  /** Offers taste-led prompt ideas while the prompt is empty and focused. */
  ideas?: boolean;
  /** Sends the assistant's Custom… as a change to the draft (`useDraftChange`). */
  ask?: DraftChange;
}) {
  const phone = usePhone();
  const proposal = ask?.proposal;
  // Suggestions change the prompt as it was before any proposal.
  const base = ask?.typed?.prompt ?? input.prompt;
  const assistant = usePromptAssistant({
    scopeKey: assistantScope,
    input,
    profile,
    references,
    onChange,
    change: ask?.available
      ? {
          send: ask.sendRequest,
          pending: ask.pending,
          suggestions: (pick) => (
            <ChangeSuggestions
              query={draftStepsQuery(input.kind, base.trim())}
              fresh={() => askDraftSteps(input.kind, base.trim(), true)}
              disabled={!base.trim() || ask.pending}
              onPick={pick}
            />
          ),
        }
      : undefined,
  });
  const ideas = usePromptIdeas({
    kind: input.kind,
    empty: !input.prompt.trim(),
    onPick: (prompt) => onChange({ prompt }),
    className: classes.ideas,
    stacked: fill,
  });
  return (
    <>
      <div
        className={classes.area}
        data-fill={fill || undefined}
        {...(offerIdeas ? ideas.focusProps : {})}
      >
        <TextBox
          ref={textareaRef}
          tools={[
            assistant.action && <Fragment key="assistant">{assistant.action}</Fragment>,
            <PromptHistory
              key="history"
              kind="positive"
              value={input.prompt}
              onPick={(prompt) => onChange({ prompt })}
            />,
            proposal && <UndoButton key="undo" onClick={ask.undo} />,
          ]}
          data-expanded-prompt
          classNames={{ root: classes.root, wrapper: classes.wrapper, input: classes.input }}
          className={proposal ? proposedClass : undefined}
          // The proposal's action names it over the prompt; Generate runs it.
          description={proposal && <ProposalLabel proposal={proposal} labels={draftLabels} />}
          variant="unstyled"
          aria-label="Prompt"
          data-autofocus={autoFocus || undefined}
          placeholder={
            input.kind === "image" ? "Describe the image" : "Describe the motion and camera"
          }
          // In the phone sheet the prompt fills the room above the settings instead of growing.
          autosize={!fill}
          minRows={3}
          maxRows={10}
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
          overlay={offerIdeas && ideas.ideas}
          below={assistant.suggestions}
        />
      </div>
      {negative && (
        <div className={classes.negative} data-fill={fill || undefined}>
          <TextBox
            tools={[
              <PromptHistory
                key="history"
                kind="negative"
                value={input.negative}
                onPick={(negative) => onChange({ negative })}
              />,
            ]}
            classNames={{ input: classes.input }}
            variant="unstyled"
            aria-label="Negative Prompt"
            placeholder="Negative prompt: what to leave out"
            // In the phone sheet it keeps two rows until edited, when it takes the room left.
            autosize={!fill}
            rows={fill ? 2 : undefined}
            minRows={1}
            maxRows={phone ? 2 : 4}
            inline={fill}
            value={input.negative}
            onChange={(negative) => onChange({ negative })}
          />
        </div>
      )}
    </>
  );
}
