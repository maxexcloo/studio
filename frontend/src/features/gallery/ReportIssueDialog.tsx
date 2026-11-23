import { Alert, Button, Chip, Group, Modal, Stack, Text } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import type { ImageInspection } from "../../../../shared/suggestions";
import type { MediaItem } from "../../types";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { UndoButton, proposedClass } from "../generation/AskChange";
import { changeSummary } from "../generation/changeSummary";
import { inspectImage } from "../taste/suggestions";
import { mediaSource } from "./mediaSource";
import { askItemChange } from "./useItemChange";
import { useItemMutation } from "./useItemMutation";
import { type Iteration, useIterate } from "./useMediaAction";
import { showDisliked, useRatings } from "./useMediaRating";

/** Report's preset issues: its menu's choices and the dialog's chips. */
export const issues = ["Anatomy", "Artefacts", "Face", "Hands", "Text", "Wrong Subject"];

/**
 * Reports what is wrong with a finished item. Studio asks the assistant for a fix, an edit of the
 * image for a local fault or a run on its seed with a fixed prompt. Once the replacement queues,
 * the report dislikes the original with the issue and the viewer adds the run to its strip.
 */
export function useReportIssue(
  item: MediaItem,
  onQueued?: (jobId: string) => void,
  inlineError = false,
) {
  const iterate = useIterate();
  const client = useQueryClient();
  const ratings = useRatings();
  const video = item.type === "video";
  const queued = useRef<{ item: string; issue: string; job: string } | null>(null);
  return useItemMutation(item.id, "report", {
    meta: { inlineError },
    mutationFn: async (issue: string) => {
      let jobId =
        queued.current?.item === item.id && queued.current.issue === issue
          ? queued.current.job
          : undefined;
      if (!jobId) {
        const { answer, profileId } = await askItemChange(
          client,
          item,
          `Fix what is wrong, keeping everything else: ${issue}`,
          video ? ["recreate"] : ["edit", "recreate"],
        );
        const [change] = answer.suggestions;
        if (!change) throw new Error(answer.reason || "The assistant couldn't suggest a fix.");
        const next: Iteration = {
          kind: "prompt",
          prompt: change.prompt,
          operation: change.action === "edit" ? "refine" : video ? "animate" : "image",
          sameSeed: change.action === "recreate",
          ...(change.action === "edit" && { profileId, profileBackend: change.profileBackend }),
        };
        jobId = await iterate(item, next);
        queued.current = { item: item.id, issue, job: jobId };
      }
      const was = item.rating ?? null;
      await ratings.mutateAsync({ ids: [item.id], rating: "disliked", issue });
      queued.current = null;
      showDisliked(1, () => ratings.mutate({ ids: [item.id], rating: was }));
      onQueued?.(jobId);
    },
  });
}

/** Report's Other Issue…: the issue as toggle chips and words. */
export function ReportIssueDialog({
  item,
  onQueued,
  onClose,
}: {
  item: MediaItem;
  onQueued?: (jobId: string) => void;
  onClose: () => void;
}) {
  const phone = usePhone();
  const fix = useReportIssue(item, onQueued, true);
  const [picked, setPicked] = useState<string[]>([]);
  const [details, setDetails] = useState("");
  // An inspection's issue joins the details in place, with Undo until they next change.
  const [proposal, setProposal] = useState<{ before: string; after: string } | null>(null);
  const current = proposal?.after === details ? proposal : null;
  const [finding, setFinding] = useState<ImageInspection>();
  const upscaled = mediaSource(item).upscaled;
  const inspect = useItemMutation(item.id, `inspect:${upscaled}`, {
    meta: { inlineError: true },
    mutationFn: () => inspectImage(item.jobId!, item.id, upscaled),
  });
  const inspectImageIssue = () =>
    inspect.mutate(undefined, {
      onSuccess: (found) => {
        setFinding(found);
        if (found.status !== "issue") return;
        const before = current?.before ?? details;
        const after = [before.trim(), found.issue].filter(Boolean).join("\n");
        setProposal({ before, after });
        setDetails(after);
      },
    });
  const note =
    !inspect.isPending &&
    (inspect.error?.message ||
      (finding?.status === "clear"
        ? "The model found no clear visual issue."
        : finding?.status === "unavailable"
          ? finding.reason
          : undefined));
  const canInspect = item.type === "image" && Boolean(item.jobId);
  const issue = [picked.join(", "), details.trim()].filter(Boolean).join(": ");
  return (
    <Modal opened onClose={onClose} title="Report Issue" size="sm" fullScreen={phone}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (issue) fix.mutate(issue, { onSuccess: onClose });
        }}
      >
        <Stack>
          <Chip.Group multiple value={picked} onChange={setPicked}>
            <Group gap="xs" role="group" aria-label="What's Wrong">
              {issues.map((label) => (
                <Chip key={label} value={label} size="xs" variant="light">
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
            tools={
              canInspect
                ? [
                    {
                      id: "inspect",
                      label: "Inspect Image",
                      icon: icons.assistant,
                      disabled: inspect.isPending || fix.isPending,
                      onClick: inspectImageIssue,
                    },
                  ]
                : []
            }
            busy={inspect.isPending ? "Inspecting Image…" : undefined}
            className={current ? proposedClass : undefined}
            send={
              current && (
                <UndoButton
                  onClick={() => {
                    setDetails(current.before);
                    setProposal(null);
                  }}
                />
              )
            }
            below={
              current ? (
                <Text size="xs" c="dimmed">
                  {changeSummary(current.before, current.after, 160) || current.after}
                </Text>
              ) : (
                note && (
                  <Text size="xs" c="dimmed" role="status">
                    {note}
                  </Text>
                )
              )
            }
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
