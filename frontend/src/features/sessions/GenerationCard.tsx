import { useRef, useState } from "react";
import { CloseButton, Group, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import type { GenerationInput, ReferenceAsset } from "../../types";
import {
  initialInput,
  inputForProfile,
  useGenerationActions,
} from "../generation/GenerationProvider";
import { GenerationEditor } from "../generation/GenerationEditor";
import { PresetPicker, type PresetSelection } from "../generation/PresetPicker";
import { generationInput, isProfile, referencePatch } from "../generation/payload";
import type { ChatDraft } from "../../../../shared/chat";
import { useChatController } from "./ChatProvider";
import classes from "./SessionsPage.module.css";

/**
 * A timeline card's own editor: the gallery's chip composer with a Close action. Submitting sends
 * a Chat revision of `sourceJobId` (or a new generation without one) and leaves the card intact.
 */
export function GenerationCard({
  draft,
  sourceJobId,
  sessionId,
  title,
  request,
  onClose,
}: {
  draft: ChatDraft;
  sourceJobId?: string;
  sessionId: string;
  /** The editor's heading, such as "Edit Iteration 2". */
  title: string;
  /** The short user message recorded for this request, such as "Edit iteration 2". */
  request: string;
  /** Closes the editor; `submitted` once its request started a generation. */
  onClose?: (submitted?: boolean) => void;
}) {
  const submitting = useRef(false);
  const [preset, setPreset] = useState<PresetSelection>({});
  const { profiles } = useGenerationActions();
  const { send, sendingSession, status } = useChatController();
  const form = useForm<GenerationInput>({
    initialValues: { ...initialInput, ...draft.input } as GenerationInput,
  });
  const profile = profiles.find(
    (profile) => isProfile(profile, form.values.profileId) && profile.kind === form.values.kind,
  );
  const references = Array.isArray(form.values.referenceDetails)
    ? (form.values.referenceDetails as ReferenceAsset[])
    : [];
  const chatUnavailable =
    status.isPending || status.isError || status.data?.available === false
      ? "Chat is unavailable."
      : undefined;
  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const input = generationInput(form.getValues(), profile, references);
      const operation =
        input.kind === "video"
          ? "animate"
          : draft.operation === "animate"
            ? "image"
            : draft.operation;
      const source = sourceJobId || draft.parentJobId;
      // The card's own inputs replace the composer's references and settings for this request.
      const generated = await send(
        {
          content: request,
          references: [],
          generation: undefined,
          ...(source
            ? { revision: { sourceJobId: source, input, operation } }
            : { generation: { input, operation } }),
        },
        sessionId,
      );
      if (generated) {
        form.reset();
        onClose?.(true);
      }
    } finally {
      submitting.current = false;
    }
  }
  return (
    <div className={classes.editor}>
      <Group justify="space-between" wrap="nowrap" mb="xs">
        <Text size="sm" fw={600}>
          {title}
        </Text>
        {onClose && <CloseButton aria-label="Close Editor" onClick={() => onClose()} />}
      </Group>
      <GenerationEditor
        input={form.values}
        references={references}
        profile={profile}
        onChange={(patch) => form.setValues(patch)}
        onReferencesChange={(next) =>
          form.setValues(referencePatch(form.getValues(), references, next, profile))
        }
        onKindChange={(kind, next) =>
          form.setValues(next ? inputForProfile(form.getValues(), next) : { kind, profileId: "" })
        }
        onClear={() => form.reset()}
        onSubmit={() => void submit()}
        presets={(close, inline) => (
          <PresetPicker
            input={form.values}
            references={references}
            profile={profile}
            selection={preset}
            onDone={inline ? close : undefined}
            onSelectionChange={setPreset}
            onLoad={(loaded) => {
              setPreset({ presetId: loaded.id, presetTitle: loaded.title });
              form.setValues({
                ...initialInput,
                referenceDetails: [],
                inpaint: null,
                ...loaded.input,
              });
              close();
            }}
          />
        )}
        operation={draft.operation}
        pending={!!sendingSession}
        blockedReason={chatUnavailable}
        assistantScope={sourceJobId || draft.parentJobId || ""}
        focusPrompt
      />
    </div>
  );
}
