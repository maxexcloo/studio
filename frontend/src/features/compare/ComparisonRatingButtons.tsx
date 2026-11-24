import { ActionIcon, Group, Tooltip } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { ComparisonRating } from "../../../../shared/compare";
import { api } from "../../api";
import { icons } from "../../ui/icons";
import { ratingLabel } from "../gallery/itemActions";
import { type Comparison, comparisonQuery, comparisonsQuery } from "./queries";

export function ComparisonRatingButtons({ comparison }: { comparison: Comparison }) {
  const client = useQueryClient();
  const { id } = comparison;
  const detail = comparisonQuery(id).queryKey;
  const list = comparisonsQuery.queryKey;
  const save = useMutation({
    mutationFn: (rating: ComparisonRating | null) =>
      api<{ id: string; rating: ComparisonRating | null }>(
        `/api/comparisons/${encodeURIComponent(id)}/rating`,
        { method: "PUT", body: JSON.stringify({ rating }) },
      ),
    onSuccess: ({ rating }) => {
      client.setQueryData<Comparison>(detail, (current) => current && { ...current, rating });
      client.setQueryData<{ comparisons: Comparison[] }>(
        list,
        (current) =>
          current && {
            comparisons: current.comparisons.map((entry) =>
              entry.id === id ? { ...entry, rating } : entry,
            ),
          },
      );
    },
  });
  return (
    <Group role="group" aria-label="Comparison Rating" gap={0} wrap="nowrap">
      {(["liked", "disliked"] as const).map((rating) => {
        const action = rating === "liked" ? "like" : "dislike";
        const Icon = icons[action];
        const label = ratingLabel(action);
        const pressed = comparison.rating === rating;
        return (
          <Tooltip key={rating} label={label}>
            <ActionIcon
              variant="subtle"
              color={pressed ? undefined : "gray"}
              aria-label={`${label} Comparison`}
              aria-pressed={pressed}
              disabled={save.isPending}
              onClick={() => save.mutate(pressed ? null : rating)}
            >
              <Icon size={16} fill={pressed ? "currentColor" : "none"} />
            </ActionIcon>
          </Tooltip>
        );
      })}
    </Group>
  );
}
