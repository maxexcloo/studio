import { ActionIcon, Alert, Group, Select, Stack, Text, Textarea, Tooltip } from "@mantine/core";
import { ArrowUp, Square } from "lucide-react";
import { ReferencePicker } from "../generation/ReferencePicker";
import { useChat } from "./ChatProvider";
import { useIsMutating } from "@tanstack/react-query";
export function ChatComposer() {
  const { text, setText, send, sendingSession, stop, status, modelId, selectModel } = useChat();
  const uploadingReferences = useIsMutating({ mutationKey: ["reference-upload"] }) > 0;
  const unavailable =
    uploadingReferences || status.isPending || status.isError || status.data?.available === false;
  const models = status.data?.models || [];
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Group wrap="nowrap" gap={4} align="center">
        <ReferencePicker compact />
        <Textarea
          aria-label="Message"
          placeholder="Message Studio…"
          variant="unstyled"
          autosize
          minRows={1}
          maxRows={5}
          className="studio-chat-writing"
          style={{ flex: 1, minWidth: 0 }}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!sendingSession && !unavailable) void send();
            }
          }}
        />
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
          w={{ base: 80, sm: 160 }}
          miw={0}
          className="studio-chat-model"
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
            <ActionIcon
              aria-label="Stop Response"
              variant="default"
              size={44}
              radius="xl"
              onClick={stop}
            >
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
              radius="xl"
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
export function ChatComposerStatus() {
  const { error } = useChat();
  return error ? (
    <Alert color="red" mt="xs">
      {error}
    </Alert>
  ) : null;
}
