import { Select, Switch } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  FinishingSettings,
  FinishingStatus,
  UpscaleQuality,
} from "../../../../shared/upscale";
import { api } from "../../api";
import { SettingRow } from "./SettingRows";

const finishingQuery = queryOptions({
  queryKey: ["finishing"],
  queryFn: () => api<FinishingStatus>("/api/finishing"),
});
const qualities: { value: UpscaleQuality; label: string }[] = [
  { value: "fast", label: "Fast" },
  { value: "balanced", label: "Balanced" },
  { value: "high", label: "High" },
];

/** Settings › Studio: smart upscale of starred images while the GPU is idle. */
export function FinishStarredImages() {
  const client = useQueryClient();
  const finishing = useQuery(finishingQuery);
  const save = useMutation({
    mutationFn: (patch: Partial<FinishingSettings>) =>
      api<FinishingStatus>("/api/finishing/settings", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    // Controls follow the hand at once; the reply (or a refetch after a failure) settles them.
    onMutate: (patch) =>
      client.setQueryData(
        finishingQuery.queryKey,
        (status) => status && { ...status, settings: { ...status.settings, ...patch } },
      ),
    onSuccess: (status) => client.setQueryData(finishingQuery.queryKey, status),
    onError: () => client.invalidateQueries({ queryKey: finishingQuery.queryKey }),
  });
  const status = finishing.data;
  if (!status?.settings) return null;
  const { settings } = status;
  return (
    <>
      <SettingRow
        label="Finish Starred Images"
        description={
          settings.enabled && status.waiting
            ? `Upscale images you star while the GPU is idle. ${status.waiting} waiting.`
            : "Upscale images you star while the GPU is idle."
        }
      >
        <Switch
          aria-label="Finish Starred Images"
          checked={settings.enabled}
          onChange={(event) => save.mutate({ enabled: event.currentTarget.checked })}
        />
      </SettingRow>
      {settings.enabled && (
        <>
          <SettingRow label="Finishing Quality" wide>
            <Select
              aria-label="Finishing Quality"
              data={qualities}
              value={settings.quality}
              allowDeselect={false}
              onChange={(value) => value && save.mutate({ quality: value as UpscaleQuality })}
            />
          </SettingRow>
          <SettingRow
            label="Face Detail"
            description="Refine faces when the prompt shows a full-body person."
          >
            <Switch
              aria-label="Face Detail"
              checked={settings.faceDetail}
              onChange={(event) => save.mutate({ faceDetail: event.currentTarget.checked })}
            />
          </SettingRow>
        </>
      )}
    </>
  );
}
