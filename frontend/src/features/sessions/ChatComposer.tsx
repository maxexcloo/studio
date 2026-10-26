import { ActionIcon, Alert, Group, Select, Stack, Text, Textarea, Tooltip } from "@mantine/core";
import { ArrowUp, Square } from "lucide-react";
import { ComposerDock } from "../generation/ComposerDock";
import { usePromptIdeas } from "../generation/PromptIdeas";
import { ReferencePicker } from "../generation/ReferencePicker";
import { usePhone } from "../../ui/usePhone";
import { useChat } from "./ChatProvider";
import { useIsMutating } from "@tanstack/react-query";
import classes from "./ChatComposer.module.css";
function ChatComposer() {
  const { text, setText, send, sendingSession, stop, status, modelId, selectModel } = useChat();
  const uploadingReferences = useIsMutating({ mutationKey: ["reference-upload"] }) > 0;
  const unavailable =
    uploadingReferences || status.isPending || status.isError || status.data?.available === false;
  const models = status.data?.models || [];
  const phone = usePhone();
  const ideas = usePromptIdeas({
    kind: "image",
    empty: !text.trim(),
    onPick: setText,
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
      <Group wrap="nowrap" gap={4} align="center">
        <ReferencePicker compact />
        <div className={classes.message} {...ideas.focusProps}>
          <Textarea
            aria-label="Message"
            placeholder="Message Studio…"
            variant="unstyled"
            autosize
            minRows={1}
            maxRows={5}
            className={classes.writing}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (!sendingSession && !unavailable) void send();
              }
            }}
          />
          {ideas.ideas}
        </div>
        <Select
          aria-label="Chat Model"
          placeholder="Model"
          data={models.map((model) => ({ value: model.id, label: model.label }))}
          value={modelId || null}
          onChange={selectModel}
          allowDeselect={false}
          disabled={!models.length || !!sendingSession}
          variant="unstyled"
          size="xs"
          searchable={models.length > 8}
          // Sizes the field to the chosen model's name where `field-sizing` is unsupported.
          style={{
            "--model-chars": Math.max(
              5,
              models.find((model) => model.id === modelId)?.label.length || 0,
            ),
          }}
          maw={{ base: 112, sm: 220 }}
          miw={0}
          className={classes.model}
          comboboxProps={{ withinPortal: true, width: 280, position: "top-end" }}
          renderOption={({ option }) => (
            <Stack gap={0}>
              <Text size="sm">{option.label}</Text>
              {models.find((model) => model.id === option.value)?.provider && (
                <Text size="xs" c="dimmed">
                  {models.find((model) => model.id === option.value)?.provider}
                </Text>
              )}
            </Stack>
          )}
        />
        {sendingSession ? (
          <Tooltip label="Stop Response">
            <ActionIcon aria-label="Stop Response" variant="default" size={44} onClick={stop}>
              <Square size={17} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <Tooltip label="Send Message">
            <ActionIcon
              type="submit"
              aria-label="Send Message"
              disabled={!text.trim() || unavailable}
              size={44}
              variant="filled"
            >
              <ArrowUp size={20} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
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
