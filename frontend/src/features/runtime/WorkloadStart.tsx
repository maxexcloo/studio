import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RuntimeOperation, RuntimePreview } from "../../../../shared/runtime";
import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { applyPlacement, PlacementChanges, runtimeStatusQuery } from "./RuntimeWorkloads";

interface StartRequest {
  label: string;
  onReady: () => void;
  preview?: RuntimePreview;
}

/**
 * An administrator's explicit start of a stopped workload, such as a Chat model: a free GPU starts
 * it at once, a switch that stops others asks first and names them. Progress follows the runtime
 * change until the workload is ready. `enabled` is the Settings › Workers permission.
 */
export function useWorkloadStart(enabled: boolean) {
  const client = useQueryClient();
  const status = useQuery({ ...runtimeStatusQuery, enabled });
  const [request, setRequest] = useState<StartRequest | null>(null);
  const [operationId, setOperationId] = useState("");
  const label = (id: string) => status.data?.workloads.find((item) => item.id === id)?.label ?? id;
  const apply = useMutation({
    mutationFn: applyPlacement,
    meta: { inlineError: true },
    onSuccess: (operation) => {
      setOperationId(operation.id);
      void client.invalidateQueries({ queryKey: runtimeStatusQuery.queryKey });
    },
  });
  const preview = useMutation({
    mutationFn: (candidates: string[]) =>
      post<RuntimePreview>("/api/runtime/preview", { start: candidates }),
  });
  const operation = useQuery({
    queryKey: ["runtime-operation", operationId],
    queryFn: () => api<RuntimeOperation>(`/api/runtime/operations/${operationId}`),
    enabled: !!operationId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  });
  const finished = useRef("");
  const outcome = operation.data?.status;
  useEffect(() => {
    if (!operationId || outcome === "running" || !outcome || finished.current === operationId)
      return;
    finished.current = operationId;
    void client.invalidateQueries({ queryKey: runtimeStatusQuery.queryKey });
    if (outcome === "completed") {
      request?.onReady();
      setRequest(null);
      setOperationId("");
    }
  }, [operationId, outcome]);

  async function start(candidates: string[], name: string, onReady: () => void) {
    apply.reset();
    setOperationId("");
    // A refused preview shows as the standard action notification.
    const plan = await preview.mutateAsync(candidates).catch(() => undefined);
    if (!plan) return;
    if (!plan.start.length && !plan.stop.length) return onReady();
    const next = { label: name, onReady, preview: plan };
    setRequest(next);
    // Nothing stops: choosing the model is the explicit request.
    if (!plan.stop.length) apply.mutate(plan);
  }
  const confirming = Boolean(request?.preview?.stop.length && !operationId && !apply.isSuccess);
  const failure =
    apply.error?.message ||
    (outcome && outcome !== "running" && outcome !== "completed"
      ? operation.data!.error || operation.data!.progress
      : "");
  return {
    status,
    start,
    /** The workload being started, its latest step and why it failed, if it did. */
    starting:
      request && !confirming
        ? {
            label: request.label,
            progress: operation.data?.progress ?? "Starting the change.",
            error: failure,
          }
        : undefined,
    dismiss: () => {
      setRequest(null);
      setOperationId("");
    },
    dialog: (
      <ConfirmDialog
        opened={confirming}
        title={`Switch to ${request?.label ?? ""}`}
        action="Switch"
        pending={apply.isPending}
        error={apply.error?.message}
        onConfirm={() => apply.mutate(request!.preview!)}
        onClose={() => {
          setRequest(null);
          apply.reset();
        }}
      >
        {request?.preview && <PlacementChanges preview={request.preview} label={label} />}
      </ConfirmDialog>
    ),
  };
}
