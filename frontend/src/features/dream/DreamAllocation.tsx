import { ActionIcon, Button, Group, Popover, Progress, Stack, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";

import { dreamLimitReached } from "../../../../shared/dream";
import { post } from "../../api";
import { icons } from "../../ui/icons";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { type Dream, type DreamMedia, dreamQuery } from "./queries";

export function DreamAllocation({ dream }: { dream: Dream }) {
  const title = useId();
  const client = useQueryClient();
  const reset = useMutation({
    mutationFn: (kind: DreamMedia) => post<Dream>("/api/dream/reset-limit", { kind }),
    onSuccess: async (data) => {
      await client.cancelQueries({ queryKey: dreamQuery.queryKey, exact: true });
      client.setQueryData(dreamQuery.queryKey, data);
    },
    onError: () => void client.invalidateQueries({ queryKey: dreamQuery.queryKey, exact: true }),
  });
  const { settings, today, usage = today } = dream;
  const allocations = (
    [
      {
        kind: "image",
        label: "Images",
        enabled: settings.images,
        limit: settings.dailyImages,
        used: usage.images,
        today: today.images,
      },
      {
        kind: "video",
        label: "Videos",
        enabled: settings.videos,
        limit: settings.dailyVideos,
        used: usage.videos,
        today: today.videos,
      },
    ] as const
  )
    .filter(({ enabled, limit }) => enabled && limit > 0)
    .map((allocation) => ({
      ...allocation,
      capped: dreamLimitReached(settings, usage, allocation.kind),
    }));
  if (!allocations.some(({ capped }) => capped)) return null;

  return (
    <Popover position="bottom-end" width="var(--studio-popup-width)" trapFocus returnFocus>
      <PopupTooltip label="Daily Dream Limit Reached">
        <Popover.Target>
          <ActionIcon variant="subtle" color="yellow" aria-label="Dream Allocation">
            <icons.details size={18} />
          </ActionIcon>
        </Popover.Target>
      </PopupTooltip>
      <Popover.Dropdown aria-labelledby={title}>
        <Stack gap="sm">
          <Text id={title} fw={500}>
            Daily Dream Allocation
          </Text>
          {allocations.map(({ kind, label, limit, used, today, capped }) => (
            <Stack key={kind} gap={4}>
              <Group gap="xs" justify="space-between" wrap="nowrap">
                <Text size="sm">{label}</Text>
                <Text size="xs" c="dimmed">
                  {used} of {limit} {used === today ? "today" : "since reset"}
                </Text>
              </Group>
              <Progress
                size="xs"
                value={Math.min(100, (used / limit) * 100)}
                aria-label={`${label} Allocation`}
              />
              {capped && (
                <Group justify="flex-end">
                  <Button
                    size="compact-sm"
                    variant="default"
                    aria-label={kind === "image" ? "Reset Image Limit" : "Reset Video Limit"}
                    loading={reset.isPending && reset.variables === kind}
                    disabled={reset.isPending && reset.variables !== kind}
                    onClick={() => reset.mutate(kind)}
                  >
                    Reset Limit
                  </Button>
                </Group>
              )}
            </Stack>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
