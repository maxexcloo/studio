import type { Ref } from "react";
import { Stack } from "@mantine/core";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import { TextBox } from "../../ui/TextBox";
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
  /** Grows the prompt to fill a phone Drawer that owns scrolling. */
  fill?: boolean;
  /** Offers taste-led prompt ideas while the prompt is empty and focused. */
  ideas?: boolean;
}) {
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
          // The phone editor gives the prompt all the room above the chips.
          autosize={!fill}
          minRows={3}
          maxRows={10}
          rightSection={
            <Stack gap={4}>
              <PromptHistory
                kind="positive"
                value={input.prompt}
                onPick={(prompt) => onChange({ prompt })}
              />
              {assistant.action}
            </Stack>
          }
          rightSectionWidth={40}
          rightSectionPointerEvents="all"
          rightSectionProps={{ style: { alignItems: "flex-start" } }}
          value={input.prompt}
          onChange={(prompt) => onChange({ prompt })}
          overlay={offerIdeas && ideas.ideas}
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
          maxRows={4}
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
      {assistant.suggestions}
    </>
  );
}
