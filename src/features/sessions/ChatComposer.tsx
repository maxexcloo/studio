import { Alert, Button, Group, Image, Stack, Text, Textarea } from "@mantine/core";
import { ArrowUp, Square } from "lucide-react";
import { useGeneration } from "../generation/GenerationProvider";
import { ReferencePicker } from "../generation/ReferencePicker";
import { useChat } from "./ChatProvider";

export function ChatComposer({ onControls }: { onControls: () => void }) {
  const { draft, profile } = useGeneration();
  const { text, setText, send, sendingSession, stop, error, status } = useChat();
  const unavailable = status.data?.available === false;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Stack gap="xs">
        {draft.references.length > 0 && (
          <Group gap="xs" wrap="nowrap" style={{ overflowX: "auto" }}>
            {draft.references.map((asset) => (
              <Image
                key={asset.id}
                src={asset.thumbnailUrl}
                alt={asset.name}
                h={36}
                w={36}
                radius="sm"
                style={{ flexShrink: 0 }}
              />
            ))}
          </Group>
        )}
        <Textarea
          aria-label="Message"
          placeholder="Talk it through, or ask Studio to create…"
          variant="unstyled"
          autosize
          minRows={1}
          maxRows={5}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!sendingSession && !unavailable) void send();
            }
          }}
        />
        <Group justify="space-between" wrap="nowrap" className="studio-composer-actions">
          <Group gap="xs" wrap="nowrap" className="studio-composer-tools">
            <ReferencePicker compact />
            <Button
              data-generation-controls
              variant="default"
              size="compact-sm"
              onClick={onControls}
            >
              {profile?.displayName || profile?.label || "Generation Inputs"}
            </Button>
          </Group>
          {sendingSession ? (
            <Button aria-label="Stop Response" variant="default" onClick={stop} size="sm">
              <Square size={16} />
            </Button>
          ) : (
            <Button
              type="submit"
              aria-label="Send Message"
              disabled={!text.trim() || unavailable}
              size="sm"
            >
              <ArrowUp size={18} />
            </Button>
          )}
        </Group>
        {error && <Alert color="red">{error}</Alert>}
        {unavailable && (
          <Text size="xs" c="dimmed">
            {status.data?.reason ||
              "The text assistant is unavailable. You can still use generation controls."}
          </Text>
        )}
      </Stack>
    </form>
  );
}
