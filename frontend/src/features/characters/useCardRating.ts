import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  type Card,
  type CardKind,
  type CardRating,
  cardKinds,
} from "../../../../shared/characters";
import { api } from "../../api";
import { itemAction } from "../gallery/itemActions";
import { showDisliked } from "../gallery/useMediaRating";
import { charactersQuery, promptCardsQuery } from "./queries";

export function useCardRating(kind: CardKind, card: Pick<Card, "id" | "rating">) {
  const client = useQueryClient();
  const { queryKey } = kind === "characters" ? charactersQuery : promptCardsQuery(kind);
  const mutationKey = ["card-rating", kind, card.id];
  const busy = useIsMutating({ mutationKey });
  const { mutate } = useMutation({
    mutationKey,
    mutationFn: async ({ rating }: { rating: CardRating | null; undo?: CardRating | null }) => {
      const result = await api<Record<string, Card>>(
        `/api/${kind}/${encodeURIComponent(card.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ rating }),
        },
      );
      return result[cardKinds[kind].name];
    },
    onSuccess: (saved, { undo }) => {
      client.setQueryData<Card[]>(queryKey, (cards) =>
        cards?.map((entry) => (entry.id === saved.id ? { ...entry, rating: saved.rating } : entry)),
      );
      if (undo !== undefined) showDisliked(1, () => mutate({ rating: undo }));
      return client.invalidateQueries({ queryKey });
    },
  });
  const before = card.rating ?? null;
  return (["liked", "disliked"] as const).map((rating) =>
    itemAction(rating === "liked" ? "like" : "dislike", {
      pressed: before === rating,
      disabled: Boolean(busy),
      onClick: () => {
        const next = before === rating ? null : rating;
        mutate({ rating: next, ...(next === "disliked" && { undo: before }) });
      },
    }),
  );
}
