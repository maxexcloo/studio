import { Alert, Button, Chip, Group, Modal, Stack } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import type { MediaItem } from "../../types";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { askChange } from "../taste/suggestions";
import { type Iteration, useMediaIteration } from "./useMediaAction";
import { showDisliked, useRatings } from "./useMediaRating";

const issues = ["Hands", "Face", "Anatomy", "Text", "Artefacts", "Wrong Subject", "Other"];

/**
 * Report Issue…: what is wrong with a finished item, as toggle chips and words. Studio asks the
 * assistant for a fix, an edit of the image for a local fault or a run on its seed with a fixed
 * prompt, runs it as a new version (the viewer's `iterate` joins its strip), and dislikes the
 * original with the issue, hiding it until restored.
 */
export function ReportIssueDialog({
  item,
  iterate,
  onClose,
}: {
  item: MediaItem;
  iterate?: (iteration: Iteration) => void;
  onClose: () => void;
}) {
  const phone = usePhone();
  const iteration = useMediaIteration(item);
  const ratings = useRatings();
  const [picked, setPicked] = useState<string[]>([]);
  const [details, setDetails] = useState("");
  const issue = [picked.join(", "), details.trim()].filter(Boolean).join(": ");
  const video = item.type === "video";
  const fix = useMutation({
    meta: { inlineError: true },
    mutationFn: async () => {
      const answer = await askChange(
        item.jobId!,
        `Fix what is wrong, keeping everything else: ${issue}`,
        video ? ["recreate"] : ["edit", "recreate"],
        undefined,
        item.id,
      );
      const [change] = answer.suggestions;
      if (!change) throw new Error(answer.reason || "The assistant couldn't suggest a fix.");
      const next: Iteration = {
        kind: "prompt",
        prompt: change.prompt,
        operation: change.action === "edit" ? "refine" : video ? "animate" : "image",
        sameSeed: change.action === "recreate",
      };
      if (iterate) iterate(next);
      else await iteration.mutateAsync(next);
      const was = item.rating ?? null;
      await ratings.mutateAsync({ ids: [item.id], rating: "disliked", issue });
      showDisliked(1, () => ratings.mutate({ ids: [item.id], rating: was }));
    },
    onSuccess: onClose,
  });
  return (
    <Modal opened onClose={onClose} title="Report Issue" size="sm" fullScreen={phone}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (issue) fix.mutate();
        }}
      >
        <Stack>
          <Chip.Group multiple value={picked} onChange={setPicked}>
            <Group gap="xs" role="group" aria-label="What's Wrong">
              {issues.map((label) => (
                <Chip key={label} value={label} size="sm">
                  {label}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
          <TextBox
            label="Details"
            placeholder="What's wrong, like “six fingers on the left hand”"
            autosize
            minRows={2}
            inline
            value={details}
            onChange={setDetails}
          />
          {fix.error && (
            <Alert color="red" title="Couldn't Fix">
              {fix.error.message}
            </Alert>
          )}
          <DialogFooter onCancel={onClose} pending={fix.isPending}>
            <Button type="submit" disabled={!issue} loading={fix.isPending}>
              Fix & Recreate
            </Button>
          </DialogFooter>
        </Stack>
      </form>
    </Modal>
  );
}
