import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { type RuntimeOperation, type RuntimeSwap, waitsOnText } from "../../../../shared/runtime";
import { post } from "../../api";
import type { QueueJob } from "../../types";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { servicesStatusQuery } from "./RuntimePanel";
import { runtimeStatusQuery } from "./RuntimeWorkloads";

const kindLabel = (job: QueueJob) => (job.input?.kind === "video" ? "Videos" : "Images");
const swapPath = (job: QueueJob) => `/api/queue/${encodeURIComponent(job.id)}/swap`;

/**
 * The swap for waiting media work whose GPUs running text holds: `offer(job)` previews it and asks
 * first, naming what stops and starts. Administrators may always swap, ordinary accounts once
 * Let Everyone Swap Models is on; `allowed` is false otherwise, and the work just waits.
 */
export function useJobSwap() {
  const client = useQueryClient();
  const allowed = useQuery(servicesStatusQuery).data?.runtime.swap === true;
  const [job, setJob] = useState<QueueJob | null>(null);
  // A refused preview shows as the standard action notification.
  const preview = useMutation({
    mutationFn: (job: QueueJob) => post<RuntimeSwap>(swapPath(job)),
  });
  const close = () => {
    setJob(null);
    preview.reset();
    apply.reset();
  };
  const apply = useMutation({
    mutationFn: ({ job, signature }: { job: QueueJob; signature: string }) =>
      post<RuntimeOperation>(swapPath(job), { signature }),
    meta: { inlineError: true },
    onSuccess: () => {
      close();
      for (const queryKey of [["queue"], runtimeStatusQuery.queryKey, servicesStatusQuery.queryKey])
        void client.invalidateQueries({ queryKey });
    },
  });
  const plan = job && preview.data;
  const names = (ids: string[]) => ids.map((id) => plan?.labels[id] ?? id).join(", ");
  return {
    allowed,
    swappable: (job: QueueJob) => allowed && job.status === "waiting" && waitsOnText(job.reason),
    offer: (next: QueueJob) => {
      setJob(next);
      preview.mutate(next);
    },
    dialog: (
      <ConfirmDialog
        opened={Boolean(plan)}
        title={job ? `Swap to ${kindLabel(job)}` : ""}
        action="Swap"
        pending={apply.isPending}
        error={apply.error?.message}
        onConfirm={() => apply.mutate({ job: job!, signature: plan!.signature })}
        onClose={close}
      >
        {plan && (
          <>
            <Text size="sm">
              Stop {names(plan.stop)} and start {names(plan.start)}? The waiting work then runs.
            </Text>
            {plan.runWhenIdle && (
              <Text size="xs" c="dimmed" mt="xs">
                Run When Idle may start {plan.runWhenIdle} again once Studio is idle.
              </Text>
            )}
          </>
        )}
      </ConfirmDialog>
    ),
  };
}

/**
 * Says once when the account's queued work starts waiting on GPUs running text holds, with the
 * swap, for accounts that may swap. The queue row offers the same swap for as long as it waits.
 */
export function SwapNotice({ jobs }: { jobs?: QueueJob[] }) {
  const swap = useJobSwap();
  const seen = useRef(new Set<string>());
  const waiting = jobs?.find((job) => swap.swappable(job) && !seen.current.has(job.id));
  useEffect(() => {
    if (!waiting) return;
    seen.current.add(waiting.id);
    notifications.show({
      id: "swap-offer",
      title: "Waiting for a GPU",
      message: (
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm">A text model holds the GPUs this work needs.</Text>
          <Button
            variant="subtle"
            onClick={() => {
              notifications.hide("swap-offer");
              swap.offer(waiting);
            }}
          >
            Swap to {kindLabel(waiting)}
          </Button>
        </Group>
      ),
    });
  }, [waiting?.id]);
  return swap.dialog;
}
