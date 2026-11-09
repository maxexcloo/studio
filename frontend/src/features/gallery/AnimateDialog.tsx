import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { MediaItem } from "../../types";
import { LoadingState } from "../../ui/LoadingState";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import {
  useAnimateReview,
  useAnimateWriter,
  useMediaIteration,
  type AnimateTheme,
  type Iteration,
} from "./useMediaAction";

/**
 * Animate's dialog for a theme. Custom Animation first asks for the instruction; under Review
 * Prompt First the assistant then writes the motion prompt for editing (a full-screen sheet on
 * phones), and Run queues exactly the prompt shown. Otherwise the theme queues as the menu would.
 */
export function AnimateDialog({
  item,
  sessionId,
  iterate,
  theme,
  onClose,
}: {
  item: MediaItem;
  sessionId?: string;
  iterate?: (iteration: Iteration) => void;
  theme: AnimateTheme;
  onClose: () => void;
}) {
  const phone = usePhone();
  const iteration = useMediaIteration(item, sessionId);
  const run = iterate ?? iteration.mutate;
  const [review] = useAnimateReview();
  const writer = useAnimateWriter(item, sessionId);
  const [instruction, setInstruction] = useState("");
  const [prompt, setPrompt] = useState("");
  const writing = useRef<AbortController>(null);
  const asking = theme === "custom" && writer.isIdle;
  const write = () => {
    writing.current?.abort();
    writing.current = new AbortController();
    writer.mutate(
      { theme, instruction: instruction.trim() || undefined, signal: writing.current.signal },
      { onSuccess: (written) => setPrompt(written.prompt) },
    );
  };
  useEffect(() => {
    if (theme !== "custom") write();
    return () => writing.current?.abort();
  }, []);
  const written = writer.data;
  return (
    <Modal
      opened
      onClose={onClose}
      title={asking ? "Custom Animation" : "Review Prompt"}
      centered
      size={asking ? "sm" : "md"}
      fullScreen={phone}
    >
      {asking ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!instruction.trim()) return;
            if (review) return write();
            run({ kind: "animate", theme, instruction: instruction.trim() });
            onClose();
          }}
        >
          <Stack>
            <TextBox
              label="Instruction"
              placeholder="What should happen in the video?"
              autosize
              minRows={3}
              data-autofocus
              value={instruction}
              onChange={setInstruction}
            />
            <Group justify="flex-end">
              <Button type="submit" disabled={!instruction.trim()}>
                {review ? "Write Prompt" : "Animate"}
              </Button>
            </Group>
          </Stack>
        </form>
      ) : writer.isPending ? (
        <LoadingState label="Writing Prompt…" />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!written || !prompt.trim()) return;
            run({
              kind: "animate",
              theme,
              instruction: instruction.trim() || undefined,
              written: { prompt: prompt.trim(), model: written.model, thinking: written.thinking },
            });
            onClose();
          }}
        >
          <Stack>
            {writer.error && (
              <Alert color="red" title="Couldn’t Write the Prompt">
                {writer.error.message}
              </Alert>
            )}
            {written && (
              <>
                <TextBox
                  label="Prompt"
                  autosize
                  minRows={4}
                  data-autofocus
                  value={prompt}
                  onChange={setPrompt}
                />
                <Text size="sm" c="dimmed">
                  {written.profileLabel}
                  {written.tier ? ` · ${written.tier === "fast" ? "Fast" : "Quality"}` : ""}
                  {written.cloud ? " · Cloud" : ""}
                </Text>
              </>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              {written ? (
                <Button type="submit" disabled={!prompt.trim()}>
                  Run
                </Button>
              ) : (
                <Button onClick={write}>Retry</Button>
              )}
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}
