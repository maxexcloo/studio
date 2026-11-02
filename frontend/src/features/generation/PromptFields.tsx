import type { Ref } from "react";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { usePromptAssistant } from "./PromptAssistant";
import { usePromptIdeas } from "./PromptIdeas";
import { PromptHistory } from "./PromptHistory";
import classes from "./PromptFields.module.css";

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
}) {
  const phone = usePhone();
  const assistant = usePromptAssistant({
    scopeKey: assistantScope,
    input,
    profile,
    references,
    onChange,
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
          tools
          data-expanded-prompt
          classNames={{ root: classes.root, wrapper: classes.wrapper, input: classes.input }}
          variant="unstyled"
          aria-label="Prompt"
          data-autofocus={autoFocus || undefined}
          placeholder={
            input.kind === "image"
              ? "Describe the image you want to create…"
              : "Describe the motion and camera…"
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
          overlay={offerIdeas && ideas.ideas}
          below={assistant.suggestions}
          edit={edit}
        />
      </div>
      {negative && (
        <TextBox
          tools
          aria-label="Negative Prompt"
          placeholder="Negative prompt: what to leave out…"
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
