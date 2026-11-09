import { useEffect, useRef, useState } from "react";
import { ActionIcon, Alert, Badge, CloseButton, Group, Loader, Text, Tooltip } from "@mantine/core";
import { ArrowUp } from "lucide-react";
import { icons } from "../../ui/icons";
import { useIsMutating } from "@tanstack/react-query";
import type { ChatModel } from "../../../../shared/chat";
import type { WorkloadPhase } from "../../../../shared/runtime";
import { useIsAdmin } from "../auth/AccountGate";
import { ChipOption, ChipSelect } from "../generation/ChipSelect";
import { ComposerDock, composerLayers } from "../generation/ComposerDock";
import { ChipRail } from "../generation/GenerationInputControls";
import { usePromptIdeas } from "../generation/PromptIdeas";
import { ReferencePicker } from "../generation/ReferencePicker";
import { phaseColour, phaseLabel } from "../runtime/RuntimeWorkloads";
import { useWorkloadStart } from "../runtime/WorkloadStart";
import { closingPopup, layerAbove } from "../../ui/popupClicks";
import { TextBox } from "../../ui/TextBox";
import { useGeneration } from "../generation/GenerationProvider";
import { useChat, useChatMessages } from "./ChatProvider";
import classes from "./ChatComposer.module.css";

/**
 * The composer's text model chip. Administrators also see models whose Studio workloads are
 * stopped: choosing one starts it (asking first when that stops others) and selects it once ready.
 * Others see parked models marked Stopped and cannot choose them.
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
    <ChipSelect
      name="Chat Model"
      target={{ disabled: !models.length || disabled }}
      searchable={models.length > 8}
      nothingFoundMessage="No Matches"
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
  );
}

/**
 * The Chat message box. Collapsed, it is the message and Send; focusing the message expands it as
 * the gallery composer: the text with its tools, then a chip rail of the text model (when there is
 * a choice) and References, with Send at its end. Pressing outside, Escape or tabbing away
 * collapses it.
 */
function ChatComposer() {
  const { text, setText, send, sendingSession, stop, status, modelId } = useChat();
  const { sessionId } = useGeneration().draft;
  const history = useChatMessages(sessionId);
  // A reply continues on the server after a reload or dropped connection, so Stop follows it too.
  const replying =
    !!sendingSession || !!history.data?.messages.some((message) => message.status === "streaming");
  const uploadingReferences = useIsMutating({ mutationKey: ["reference-upload"] }) > 0;
  // Only an administrator can start a parked model, so others cannot send to one.
  const parked = status.data?.models.find((model) => model.id === modelId)?.parked;
  const unavailable =
    uploadingReferences ||
    status.isPending ||
    status.isError ||
    status.data?.available === false ||
    parked;
  // The model chip shows only when there is another model to choose.
  const choosable = status.data?.models.some((model) => !model.parked && model.id !== modelId);
  const admin = useIsAdmin();
  const runtime = useWorkloadStart(
    admin && !!status.data?.models.some((model) => model.workloads?.length),
  );
  const form = useRef<HTMLFormElement>(null);
  const [expanded, setExpanded] = useState(false);
  // A layer over the composer, such as a chip's popup or its confirmation, is not outside it.
  const outside = (element: Element) =>
    !form.current?.contains(element) && !element.closest(composerLayers);
  useEffect(() => {
    if (!expanded) return;
    const press = (event: PointerEvent) => {
      if (outside(event.target as Element) && !closingPopup() && !layerAbove(form.current))
        setExpanded(false);
    };
    document.addEventListener("pointerdown", press);
    return () => document.removeEventListener("pointerdown", press);
  }, [expanded]);
  const ideas = usePromptIdeas({
    kind: "image",
    empty: !text.trim(),
    // An idea is an image to make, so Chat asks for it rather than discussing it.
    onPick: (idea) => setText(`Create an image: ${idea}`),
    className: classes.ideas,
  });
  return (
    <form
      ref={form}
      className={classes.form}
      data-expanded={expanded || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Element && outside(event.relatedTarget))
          setExpanded(false);
      }}
      onKeyDown={(event) => {
        if (
          expanded &&
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !(event.target as HTMLElement).closest('[role="combobox"][aria-expanded="true"]') &&
          !layerAbove(form.current, event)
        ) {
          event.preventDefault();
          setExpanded(false);
        }
      }}
    >
      <div
        className={classes.message}
        onFocus={(event) => {
          ideas.focusProps.onFocus(event);
          setExpanded(true);
        }}
        onBlur={ideas.focusProps.onBlur}
        onKeyDown={ideas.focusProps.onKeyDown}
      >
        <TextBox
          aria-label="Message"
          placeholder="Message Studio"
          variant="unstyled"
          autosize
          minRows={expanded ? 3 : 1}
          maxRows={expanded ? 10 : 5}
          className={classes.writing}
          tools={[]}
          hideTools={!expanded}
          value={text}
          onChange={setText}
          overlay={ideas.ideas}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!replying && !unavailable) void send();
            }
          }}
        />
      </div>
      {expanded && (
        <ChipRail label="Chat Inputs">
          {choosable && <ChatModelPicker disabled={replying} runtime={runtime} />}
          <ReferencePicker />
        </ChipRail>
      )}
      {replying ? (
        <Tooltip label="Stop Response">
          <ActionIcon
            aria-label="Stop Response"
            variant="default"
            size={44}
            ml="auto"
            onClick={() =>
              stop(sendingSession && sendingSession !== "new" ? sendingSession : sessionId!)
            }
          >
            <icons.stop size={18} />
          </ActionIcon>
        </Tooltip>
      ) : (
        <Tooltip label={parked ? "Model Stopped by an Administrator" : "Send Message"}>
          <ActionIcon
            type="submit"
            aria-label="Send Message"
            disabled={!text.trim() || unavailable}
            variant="filled"
            size={44}
            ml="auto"
          >
            <ArrowUp size={20} />
          </ActionIcon>
        </Tooltip>
      )}
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
      {runtime.dialog}
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
