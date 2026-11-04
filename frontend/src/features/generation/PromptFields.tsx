import type { Ref } from "react";
import { Group } from "@mantine/core";
import type { ChangeAction } from "../../../../shared/suggestions";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { askDraftChange } from "../taste/suggestions";
import { ChangeRequest, ProposalControls, proposedClass, useAskChange } from "./AskChange";
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
    ask: (request) => {
      const actions: ChangeAction[] =
        input.kind === "video"
          ? ["animate"]
          : references.length
            ? ["edit", "recreate"]
            : ["recreate"];
      return askDraftChange(input.kind, input.prompt, request, actions);
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
    /** Sends the request line, keeping the draft's prompt and operation for Undo. */
    sendRequest: () => ask.send(ask.request ?? "", { prompt: input.prompt, operation }),
  };
}
export type DraftChange = ReturnType<typeof useDraftChange>;

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
  edit = false,
  fill = false,
  ideas: offerIdeas = false,
  ask,
  submit,
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
  /** Opens the phone's full-screen prompt editor. */
  edit?: boolean;
  /** Sizes the prompt for the phone Drawer, whose editor fills the screen while typing. */
  fill?: boolean;
  /** Offers taste-led prompt ideas while the prompt is empty and focused. */
  ideas?: boolean;
  /** Offers Ask for a Change on the draft (`useDraftChange`) in the assistant's menu. */
  ask?: DraftChange;
  /** The form's send action, offered in the phone prompt editor. */
  submit?: { label: string; disabled: boolean; onSubmit: () => void };
}) {
  const phone = usePhone();
  const assistant = usePromptAssistant({
    scopeKey: assistantScope,
    input,
    profile,
    references,
    onChange,
    onAsk: ask?.available ? () => ask.setRequest("") : undefined,
  });
  const proposal = ask?.proposal;
  // The proposal's action rides with Undo, under the prompt and in the phone editor; Generate runs it.
  const below = (assistant.suggestions || proposal) && (
    <>
      {assistant.suggestions}
      {proposal && (
        <Group gap="xs" mt={4}>
          <ProposalControls proposal={proposal} labels={draftLabels} onUndo={ask.undo} />
        </Group>
      )}
    </>
  );
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
          // The phone prompt leaves room for the settings below; its editor takes the screen to type.
          autosize
          minRows={fill ? 5 : 3}
          maxRows={10}
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
          below={below}
          edit={edit}
          submit={submit}
        />
      </div>
      {ask && <ChangeRequest ask={ask} onSend={ask.sendRequest} />}
      {negative && (
        <TextBox
          tools
          aria-label="Negative Prompt"
          placeholder="Negative prompt: what to leave out"
          size="sm"
          autosize
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
          value={input.negative}
          onChange={(negative) => onChange({ negative })}
        />
      )}
    </>
  );
}
