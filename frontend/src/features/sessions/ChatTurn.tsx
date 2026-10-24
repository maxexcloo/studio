import { Alert, Group, Loader, Paper, Stack, Text } from "@mantine/core";
import { Pencil } from "lucide-react";
import type { ChatMessage } from "../../../../shared/chat";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { GenerationCard } from "./GenerationCard";
import classes from "./SessionsPage.module.css";

/**
 * One message. A card's request (`quiet`, such as "Edited iteration 1") is one dimmed line, since
 * the new iteration below shows its prompt and settings.
 */
export function ChatTurn({ message, quiet }: { message: ChatMessage; quiet?: string }) {
  if (message.role === "user")
    return quiet ? (
      <Group gap={6} justify="flex-end" c="dimmed" className={classes.quiet}>
        <Pencil size={13} aria-hidden />
        <Text size="xs">{quiet}</Text>
      </Group>
    ) : (
      <div className={classes.message}>
        <Text style={{ whiteSpace: "pre-wrap" }}>{message.content}</Text>
      </div>
    );
  return (
    <Stack
      gap="sm"
      aria-label="Studio Reply"
      aria-busy={message.status === "streaming"}
      className={classes.reply}
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
        <Paper withBorder radius="lg" p="md">
          <GenerationCard
            draft={message.draft}
            sessionId={message.sessionId}
            title="New Generation"
            request="Generate with these settings"
          />
        </Paper>
      )}
    </Stack>
  );
}
