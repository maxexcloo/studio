import { ActionIcon, Alert, Badge, CloseButton, Group, Loader, Text, Tooltip } from "@mantine/core";
import { ArrowUp, Square } from "lucide-react";
import { useIsMutating } from "@tanstack/react-query";
import type { ChatModel } from "../../../../shared/chat";
import type { WorkloadPhase } from "../../../../shared/runtime";
import { useIsAdmin } from "../auth/AccountGate";
import { ChipOption, ChipSelect } from "../generation/ChipSelect";
import { ComposerDock } from "../generation/ComposerDock";
import railClasses from "../generation/GenerationInputControls.module.css";
import { usePromptIdeas } from "../generation/PromptIdeas";
import { ReferencePicker } from "../generation/ReferencePicker";
import { phaseColour, phaseLabel } from "../runtime/RuntimeWorkloads";
import { useWorkloadStart } from "../runtime/WorkloadStart";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { useChat } from "./ChatProvider";
import classes from "./ChatComposer.module.css";

/**
 * The composer's text model chip. Administrators also see models whose Studio workloads are
 * stopped: choosing one starts it (asking first when that stops others) and selects it once ready.
 * Others see parked models marked Parked and cannot choose them.
 */
function ChatModelPicker({
  disabled,
  runtime,
}: {
  disabled: boolean;
  runtime: ReturnType<typeof useWorkloadStart>;
}) {
  const { status, modelId, selectModel } = useChat();
  const models = status.data?.models || [];
  const workloads = runtime.status.data?.workloads;
  /** A Studio-served model runs while any of its workloads does. */
  const phase = (model?: ChatModel): WorkloadPhase | undefined => {
    if (model?.parked) return "parked";
    if (!model?.workloads?.length || !workloads) return undefined;
    const phases = workloads
      .filter((item) => model.workloads!.includes(item.id))
      .map((item) => item.phase);
    return (
      (["running", "starting", "stopping", "down", "unknown"] as const).find((value) =>
        phases.includes(value),
      ) ?? "parked"
    );
  };
  const selected = models.find((model) => model.id === modelId);
  const selectedPhase = phase(selected);
  return (
    <>
      <ChipSelect
        name="Chat Model"
        target={{ disabled: !models.length || disabled }}
        searchable={models.length > 8}
        nothingFoundMessage="No Matching Models"
        data={models.map((model) => ({
          value: model.id,
          label: model.label,
          disabled: model.parked,
        }))}
        value={modelId || null}
        renderOption={({ option, checked }) => {
          const model = models.find((item) => item.id === option.value);
          const state = phase(model);
          return (
            <ChipOption
              label={option.label}
              description={model?.provider}
              checked={checked}
              badges={
                state &&
                state !== "running" && (
                  <Badge size="xs" color={phaseColour(state)}>
                    {phaseLabel(state)}
                  </Badge>
                )
              }
            />
          );
        }}
        onChange={(id) => {
          const model = models.find((item) => item.id === id);
          if (!model) return;
          if (model.workloads?.length && phase(model) !== "running")
            void runtime.start(model.workloads, model.label, () => selectModel(model.id));
          else selectModel(model.id);
        }}
        swatch={selectedPhase && phaseColour(selectedPhase)}
        title={[
          selected?.label,
          selected?.provider,
          selectedPhase && selectedPhase !== "running" && phaseLabel(selectedPhase),
        ]
          .filter(Boolean)
          .join(" · ")}
        label={selected?.label || "Model"}
      />
      {runtime.dialog}
    </>
  );
}

/** The Chat prompt box: the message above a short chip rail (References, Model) and Send/Stop. */
function ChatComposer() {
  const { text, setText, send, sendingSession, stop, status, modelId } = useChat();
  const uploadingReferences = useIsMutating({ mutationKey: ["reference-upload"] }) > 0;
  // Only an administrator can start a parked model, so others cannot send to one.
  const parked = status.data?.models.find((model) => model.id === modelId)?.parked;
  const unavailable =
    uploadingReferences ||
    status.isPending ||
    status.isError ||
    status.data?.available === false ||
    parked;
  const phone = usePhone();
  const admin = useIsAdmin();
  const runtime = useWorkloadStart(
    admin && !!status.data?.models.some((model) => model.workloads?.length),
  );
  const ideas = usePromptIdeas({
    kind: "image",
    empty: !text.trim(),
    // An idea is an image to make, so Chat asks for it rather than discussing it.
    onPick: (idea) => setText(`Create an image: ${idea}`),
    className: classes.ideas,
    stacked: phone,
  });
  return (
    <form
      className={classes.form}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className={classes.message} {...ideas.focusProps}>
        <TextBox
          aria-label="Message"
          placeholder="Message Studio…"
          variant="unstyled"
          autosize
          minRows={1}
          maxRows={6}
          className={classes.writing}
          value={text}
          onChange={setText}
          overlay={ideas.ideas}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!sendingSession && !unavailable) void send();
            }
          }}
        />
      </div>
      <Group wrap="nowrap" gap="xs" justify="space-between" align="flex-end">
        <div className={railClasses.rail} role="group" aria-label="Chat Inputs">
          <ReferencePicker />
          <ChatModelPicker disabled={!!sendingSession} runtime={runtime} />
        </div>
        {sendingSession ? (
          <Tooltip label="Stop Response">
            <ActionIcon aria-label="Stop Response" variant="default" onClick={stop}>
              <Square size={16} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <Tooltip label={parked ? "Model Parked by an Administrator" : "Send Message"}>
            <ActionIcon
              type="submit"
              aria-label="Send Message"
              disabled={!text.trim() || unavailable}
              variant="filled"
            >
              <ArrowUp size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      {runtime.starting && (
        <Group gap={6} wrap="nowrap" className={classes.starting} role="status">
          {runtime.starting.error ? (
            <>
              <Text size="xs" c="red" flex={1}>
                Couldn’t start {runtime.starting.label}: {runtime.starting.error}
              </Text>
              <CloseButton size="sm" aria-label="Dismiss" onClick={runtime.dismiss} />
            </>
          ) : (
            <>
              <Loader size={12} color="gray" />
              <Text size="xs" c="dimmed" flex={1} lineClamp={2}>
                Starting {runtime.starting.label}: {runtime.starting.progress}
              </Text>
            </>
          )}
        </Group>
      )}
    </form>
  );
}
function ChatComposerStatus() {
  const { error } = useChat();
  return error ? (
    <Alert color="red" mt="xs">
      {error}
    </Alert>
  ) : null;
}
export function ChatDock() {
  return (
    <>
      <ComposerDock chat={<ChatComposer />} />
      <ChatComposerStatus />
    </>
  );
}
