import { Alert, Group, Loader, Paper, Stack, Text } from "@mantine/core";
import { Pencil, Wand } from "lucide-react";
import type { ChatMessage } from "../../../../shared/chat";
import { WritingStream, WritingThinking } from "../generation/PromptWriting";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { GenerationCard } from "./GenerationCard";
import classes from "./SessionsPage.module.css";

/** What a reply asked for: a new image, or an edit of which image (`source`, its iteration). */
function requestLine(operation: string, source?: number) {
  if (operation === "refine")
    return source ? `Editing iteration ${source}` : "Editing the latest image";
  return operation === "animate" ? "Animation" : "New image";
}

/**
 * One message. A card's request (`quiet`, such as "Edited iteration 1") is one dimmed line, since
 * the new iteration below shows its prompt and settings.
 */
export function ChatTurn({
  message,
  quiet,
  source,
}: {
  message: ChatMessage;
  quiet?: string;
  source?: number;
}) {
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
      {message.thinking &&
        (message.status === "streaming" && !message.content ? (
          <WritingStream progress={{ thinking: message.thinking }} />
        ) : (
          <WritingThinking writing={{ kind: "chat", thinking: message.thinking }} />
        ))}
      {message.content && <AssistantMarkdown content={message.content} />}
      {message.draft && (
        <Group gap={6} c="dimmed">
          <Wand size={13} aria-hidden />
          <Text size="xs">{requestLine(message.draft.operation, source)}</Text>
        </Group>
      )}
      {message.status === "cancelled" && (
        <Text size="xs" c="dimmed">
          Response stopped.
        </Text>
      )}
      {message.status === "failed" && !message.actionError && (
        <Text size="sm" c="red">
          {message.error || "This response could not be completed."}
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
