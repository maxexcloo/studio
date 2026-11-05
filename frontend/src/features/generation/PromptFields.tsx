import { useRef, type Ref } from "react";
import type { ChangeAction } from "../../../../shared/suggestions";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { askDraftChange, askDraftSteps, draftStepsQuery } from "../taste/suggestions";
import {
  ChangeRequest,
  ChangeSuggestions,
  ProposalLabel,
  proposedClass,
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
 * Ask for a Change on the composer's draft: the prompt assistant rewrites its prompt and, with a
 * reference attached, picks between editing that reference and a fresh image, which sets the
 * draft's operation. Generate runs it; Undo restores the prompt and operation it replaced.
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
  /** Offers Ask for a Change on the draft (`useDraftChange`) in the assistant's menu. */
  ask?: DraftChange;
}) {
  const phone = usePhone();
  const requestRef = useRef<HTMLTextAreaElement>(null);
  const assistant = usePromptAssistant({
    scopeKey: assistantScope,
    input,
    profile,
    references,
    onChange,
    onAsk: ask?.available ? () => ask.setRequest("") : undefined,
  });
  const proposal = ask?.proposal;
  // Suggestions change the prompt as it was before any proposal.
  const base = ask?.typed?.prompt ?? input.prompt;
  const ideas = usePromptIdeas({
    kind: input.kind,
    empty: !input.prompt.trim(),
    onPick: (prompt) => onChange({ prompt }),
    className: classes.ideas,
    stacked: fill,
  });
  return (
    <>
      {/* The prompt and its change request are one field, shown together while either is edited. */}
      <div className={classes.prompt} data-fill={fill || undefined}>
        <div
          className={classes.area}
          data-fill={fill || undefined}
          {...(offerIdeas ? ideas.focusProps : {})}
        >
          <TextBox
            ref={textareaRef}
            tools
            data-expanded-prompt
            classNames={{ root: classes.root, wrapper: classes.wrapper, input: classes.input }}
            className={proposal ? proposedClass : undefined}
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
            rightSection={
              <>
                <PromptHistory
                  kind="positive"
                  value={input.prompt}
                  onPick={(prompt) => onChange({ prompt })}
                />
                {assistant.action}
              </>
            }
            rightSectionWidth={40}
            rightSectionPointerEvents="all"
            rightSectionProps={{ style: { alignItems: "flex-start" } }}
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
        {ask && (
          <ChangeRequest
            ref={requestRef}
            ask={ask}
            onSend={ask.sendRequest}
            // The proposal's action names it over the request; Generate runs it.
            label={proposal && <ProposalLabel proposal={proposal} labels={draftLabels} />}
            suggestions={
              <ChangeSuggestions
                query={draftStepsQuery(input.kind, base.trim())}
                fresh={() => askDraftSteps(input.kind, base.trim(), true)}
                disabled={!base.trim() || ask.pending}
                onPick={(request) => {
                  ask.setRequest(request);
                  ask.sendRequest(request);
                }}
                // As Ask for a Change opens it: an empty request line to type in.
                onCustom={() => {
                  ask.setRequest("");
                  requestRef.current?.focus();
                }}
              />
            }
          />
        )}
      </div>
      {negative && (
        <TextBox
          tools
          aria-label="Negative Prompt"
          placeholder="Negative prompt: what to leave out"
          size="sm"
          // In the phone sheet it keeps two rows until edited, when it takes the room left.
          autosize={!fill}
          rows={fill ? 2 : undefined}
          rightSectionProps={fill ? { style: { alignItems: "flex-start" } } : undefined}
          classNames={
            fill ? { root: classes.negative, wrapper: classes.negativeWrapper } : undefined
          }
          minRows={1}
          maxRows={phone ? 2 : 4}
          rightSection={
            <PromptHistory
              kind="negative"
              value={input.negative}
              onPick={(negative) => onChange({ negative })}
            />
          }
          rightSectionPointerEvents="all"
          inline={fill}
          value={input.negative}
          onChange={(negative) => onChange({ negative })}
        />
      )}
    </>
  );
}
