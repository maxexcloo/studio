import { Box, Button, Collapse, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MediaItem, QueueJob } from "../../types";
import classes from "./PromptWriting.module.css";

/**
 * A queue item's writing stage as it streams: the thinking so far, held at its latest line unless
 * scrolled back, then the prompt as it arrives.
 */
export function WritingStream({ progress }: { progress?: QueueJob["progress"] }) {
  const thinking = progress?.thinking?.trim();
  const prompt = progress?.prompt?.trim();
  if (!thinking && !prompt) return null;
  return (
    <Stack gap={4} aria-label="Prompt Being Written">
      {thinking && (
        <Box className={classes.thinking} tabIndex={0} aria-label="Thinking">
          <Text size="xs" c="dimmed" className={classes.text}>
            {thinking}
          </Text>
        </Box>
      )}
      {prompt && (
        <Text size="sm" className={classes.text}>
          {prompt}
        </Text>
      )}
    </Stack>
  );
}

/** How the prompt assistant wrote a result's prompt: its model, and its thinking collapsed until opened. */
export function WritingThinking({ writing }: { writing?: MediaItem["writing"] }) {
  const [opened, { toggle }] = useDisclosure(false);
  if (!writing?.thinking && !writing?.model) return null;
  const Chevron = opened ? ChevronDown : ChevronRight;
  return (
    <Stack gap={4}>
      {writing.model && (
        <Text size="xs" c="dimmed">
          Written by {writing.model}
        </Text>
      )}
      {writing.thinking && (
        <>
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            leftSection={<Chevron size={14} />}
            aria-expanded={opened}
            onClick={toggle}
            style={{ alignSelf: "start" }}
          >
            Thinking
          </Button>
          <Collapse expanded={opened}>
            <Text size="xs" c="dimmed" className={classes.text}>
              {writing.thinking}
            </Text>
          </Collapse>
        </>
      )}
    </Stack>
  );
}
