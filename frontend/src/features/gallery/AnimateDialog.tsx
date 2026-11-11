import { useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { MediaItem } from "../../types";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { LoadingState } from "../../ui/LoadingState";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { useChangeSuggestions } from "../generation/AskChange";
import { assistantQuery } from "../generation/PromptAssistant";
import { askMotionIdeas, motionIdeasQuery } from "../taste/suggestions";
import {
  useAnimateReview,
  useAnimateWriter,
  useMediaIteration,
  type AnimateTheme,
  type Iteration,
} from "./useMediaAction";

/**
 * Animate's dialog for a theme. Custom Animation first asks for the instruction, with Suggestions
 * of what could happen written from the image; under Review
 * Prompt First the assistant then writes the motion prompt for editing (a full-screen sheet on
 * phones), and Run queues exactly the prompt shown. Otherwise the theme queues as the menu would.
 */
export function AnimateDialog({
  item,
  iterate,
  theme,
  onClose,
}: {
  item: MediaItem;
  iterate?: (iteration: Iteration) => void;
  theme: AnimateTheme;
  onClose: () => void;
}) {
  const phone = usePhone();
  const iteration = useMediaIteration(item);
  const run = iterate ?? iteration.mutate;
  const [review] = useAnimateReview();
  const writer = useAnimateWriter(item);
  const [instruction, setInstruction] = useState("");
  const [prompt, setPrompt] = useState("");
  const writing = useRef<AbortController>(null);
  const asking = theme === "custom" && writer.isIdle;
  const assistant = useQuery(assistantQuery);
  const offered = Boolean(assistant.data?.available && item.jobId) && item.type === "image";
  const ideas = useChangeSuggestions({
    query: motionIdeasQuery(item.jobId ?? ""),
    fresh: () => askMotionIdeas(item.jobId!, true),
    enabled: asking && offered,
    onPick: setInstruction,
  });
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
              tools={offered ? [ideas.action] : undefined}
            />
            <DialogFooter onCancel={onClose}>
              <Button type="submit" disabled={!instruction.trim()}>
                {review ? "Write Prompt" : "Animate"}
              </Button>
            </DialogFooter>
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
            <DialogFooter onCancel={onClose}>
              {written ? (
                <Button type="submit" disabled={!prompt.trim()}>
                  Run
                </Button>
              ) : (
                <Button onClick={write}>Retry</Button>
              )}
            </DialogFooter>
          </Stack>
        </form>
      )}
    </Modal>
  );
}
