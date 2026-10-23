import { Alert, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { useSearchParams } from "react-router";
import type { ChatMessage } from "../../../shared/chat";
import { useGeneration } from "../generation/GenerationProvider";

export function ChatTurn({ message }: { message: ChatMessage }) {
  const { setDraft } = useGeneration();
  const [params, setParams] = useSearchParams();
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
        <Text size="sm" fw={600}>
          Studio
        </Text>
        {message.status === "streaming" && <Loader size="xs" aria-label="Studio Is Replying" />}
      </Group>
      {message.content && (
        <Text style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message.content}</Text>
      )}
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
          <Stack gap="sm">
            <Text size="sm">{message.actionError}</Text>
            <Button
              variant="default"
              size="sm"
              style={{ alignSelf: "start" }}
              onClick={() => {
                if (message.draft)
                  setDraft((previous) => ({
                    ...previous,
                    operation: message.draft!.operation,
                    parentJobId: message.draft!.parentJobId,
                    input: { ...previous.input, ...message.draft!.input },
                  }));
                const next = new URLSearchParams(params);
                next.set("compose", "1");
                setParams(next);
              }}
            >
              Edit Generation Inputs
            </Button>
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}
