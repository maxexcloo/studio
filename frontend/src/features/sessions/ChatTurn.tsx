import { Alert, Button, Collapse, Group, Loader, Paper, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Check, ChevronDown, ChevronRight, Pencil, Wand, X } from "lucide-react";
import type { ChatMessage, ChatStep } from "../../../../shared/chat";
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

const titled = (value: unknown) => {
  const text = String(value ?? "");
  return text.charAt(0).toUpperCase() + text.slice(1);
};
/** A tool call as the trail names it: what it made or looked at, such as "New images (3)". */
function stepLabel({ tool, input }: ChatStep) {
  const ref = titled(input.job_id);
  if (tool === "Generate") {
    const prompts = Array.isArray(input.prompts) ? input.prompts.length : 1;
    const count = prompts * (Number(input.count) || 1);
    const what = input.kind === "video" ? "video" : "image";
    const model = input.profile_id ? ` on ${input.profile_id}` : "";
    return `New ${count > 1 ? `${what}s (${count})` : what}${model}${input.preview ? " (preview)" : ""}`;
  }
  if (tool === "Reuse")
    return input.mode === "animate"
      ? `Animating ${ref}${input.theme ? ` (${titled(input.theme)})` : ""}`
      : input.mode === "reference"
        ? `Using ${ref} as a reference`
        : `Editing ${ref}`;
  if (tool === "Models")
    return input.profile_id ? `Reading ${input.profile_id}` : "Looking up models";
  if (["Status", "Result"].includes(tool)) return `Checking ${ref}`;
  if (tool === "Review") return `Reviewing ${ref}`;
  if (tool === "Cancel") return `Cancelling ${ref}`;
  return tool;
}

/** One tool call: its label and state, with what the tool answered under it once opened. */
function Step({ step }: { step: ChatStep }) {
  const [opened, { toggle }] = useDisclosure(false);
  const Chevron = opened ? ChevronDown : ChevronRight;
  const State =
    step.status === "running" ? null : step.status === "failed" ? X : step.output ? Check : null;
  return (
    <Stack gap={2}>
      <Button
        variant="subtle"
        color={step.status === "failed" ? "red" : "gray"}
        size="compact-sm"
        leftSection={<Chevron size={14} />}
        rightSection={
          step.status === "running" ? (
            <Loader size={12} aria-label="Running" />
          ) : (
            State && <State size={14} aria-label={step.status === "failed" ? "Failed" : "Done"} />
          )
        }
        aria-expanded={opened}
        onClick={toggle}
        style={{ alignSelf: "start" }}
      >
        {stepLabel(step)}
      </Button>
      <Collapse expanded={opened}>
        <Text size="xs" c="dimmed" style={{ whiteSpace: "pre-wrap" }} pl="lg">
          {step.output || "Running…"}
        </Text>
      </Collapse>
    </Stack>
  );
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
      {!!message.steps?.length && (
        <Stack gap={0} aria-label="Tools">
          {message.steps.map((step) => (
            <Step key={step.id} step={step} />
          ))}
        </Stack>
      )}
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
