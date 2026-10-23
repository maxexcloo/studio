import { Alert, Group, Loader, Stack, Text } from "@mantine/core";
import type { ChatMessage } from "../../../../shared/chat";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { GenerationCard } from "./GenerationCard";

export function ChatTurn({ message }: { message: ChatMessage }) {
  if (message.role === "user")
    return (
      <div className="studio-thread-prompt">
        <Text style={{ whiteSpace: "pre-wrap" }}>{message.content}</Text>
      </div>
    );
  return (
    <Stack
      gap="sm"
      className="studio-assistant-turn"
      aria-label="Studio Reply"
      aria-busy={message.status === "streaming"}
    >
      <Group gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          Studio
        </Text>
        {message.status === "streaming" && <Loader size="xs" aria-label="Studio Is Replying" />}
      </Group>
      {message.content && <AssistantMarkdown content={message.content} />}
      {message.status === "cancelled" && (
        <Text size="xs" c="dimmed">
          Response stopped.
        </Text>
      )}
      {message.status === "failed" && !message.actionError && (
        <Text size="sm" c="red">
          This response could not be completed.
        </Text>
      )}
      {message.actionError && (
        <Alert color="yellow" title="Choose Generation Inputs">
          {message.actionError}
        </Alert>
      )}
      {message.actionError && message.draft && (
        <GenerationCard draft={message.draft} sessionId={message.sessionId} />
      )}
    </Stack>
  );
}
