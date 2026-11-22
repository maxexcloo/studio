import { Alert, Checkbox, Group, Text, getDefaultZIndex } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SquareCheck } from "lucide-react";
import { useState } from "react";

import {
  type Card,
  type CardKind,
  type CardRating,
  cardKinds,
} from "../../../../shared/characters";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { ToolbarAction } from "../../ui/SectionToolbar";
import { showDisliked } from "../gallery/useMediaRating";
import { charactersQuery, deleteCard, promptCardsQuery, saveCardRating } from "./queries";

type ListedCard = Pick<Card, "id" | "name" | "rating">;
type CardChange = { card: ListedCard; rating: CardRating | null | "delete" };

export function useCardSelection(
  kind: CardKind,
  cards: ListedCard[] | undefined,
  matches: ListedCard[],
) {
  const client = useQueryClient();
  const { queryKey } = kind === "characters" ? charactersQuery : promptCardsQuery(kind);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [failure, setFailure] = useState("");
  const selected = cards?.filter(({ id }) => selection?.has(id)) ?? [];
  const all = matches.length > 0 && matches.every(({ id }) => selection?.has(id));
  const batch = useMutation({
    scope: { id: `card-changes:${kind}` },
    mutationFn: async ({ changes, undo }: { changes: CardChange[]; undo?: boolean }) => {
      const saved = new Map<string, CardRating | null | undefined | "delete">();
      const failed: ListedCard[] = [];
      const stillDisliked = undo
        ? new Set(
            client
              .getQueryData<Card[]>(queryKey)
              ?.flatMap(({ id, rating }) => (rating === "disliked" ? [id] : [])),
          )
        : undefined;
      for (const { card, rating } of changes) {
        if (stillDisliked && !stillDisliked.has(card.id)) continue;
        try {
          if (rating === "delete") {
            await deleteCard(kind, card.id);
            saved.set(card.id, "delete");
          } else {
            const updated = await saveCardRating(kind, card.id, rating);
            saved.set(card.id, updated.rating);
          }
        } catch {
          failed.push(card);
        }
      }
      return { saved, failed };
    },
    onMutate: () => setFailure(""),
    onSuccess: ({ saved, failed }, { changes, undo }) => {
      client.setQueryData<Card[]>(queryKey, (entries) =>
        entries?.flatMap((card) => {
          const rating = saved.get(card.id);
          if (rating === "delete") return [];
          return saved.has(card.id) ? [{ ...card, rating }] : [card];
        }),
      );
      if (!undo) {
        setConfirm(false);
        setSelection(failed.length ? new Set(failed.map(({ id }) => id)) : null);
        const hidden = changes.flatMap(({ card, rating }) =>
          rating === "disliked" && saved.get(card.id) === "disliked"
            ? [{ card, rating: card.rating ?? null }]
            : [],
        );
        if (hidden.length)
          showDisliked(hidden.length, () => batch.mutate({ changes: hidden, undo: true }));
      }
      if (failed.length) {
        const names = failed
          .slice(0, 3)
          .map(({ name }) => name)
          .join(", ");
        const more = failed.length > 3 ? ` and ${failed.length - 3} more` : "";
        const action = undo
          ? "undo Dislike for"
          : changes[0]?.rating === "delete"
            ? "delete"
            : "rate";
        setFailure(`Couldn't ${action} ${names}${more}.`);
      }
      void client.invalidateQueries({ queryKey });
    },
  });
  const changeSelection = (ids: string[], checked: boolean) =>
    setSelection((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const apply = (rating: CardChange["rating"]) =>
    batch.mutate({
      changes: selected.filter((card) => card.rating !== rating).map((card) => ({ card, rating })),
    });
  const actionDisabled = !selected.length || batch.isPending;
  const noun = cardKinds[kind].name;
  return {
    active: selection !== null,
    toggle: (
      <ToolbarAction
        label="Select"
        icon={SquareCheck}
        variant="default"
        aria-pressed={selection !== null}
        disabled={(!selection && !cards?.length) || batch.isPending}
        onClick={() => {
          setFailure("");
          setSelection(selection ? null : new Set());
        }}
      />
    ),
    control: ({ id, name }: ListedCard) =>
      selection && (
        <Checkbox
          aria-label={`Select ${name}`}
          checked={selection.has(id)}
          disabled={batch.isPending}
          onChange={(event) => changeSelection([id], event.currentTarget.checked)}
        />
      ),
    bar: (
      <>
        {selection && (
          <Group
            gap="xs"
            justify="space-between"
            aria-label="Card Selection"
            role="group"
            aria-busy={batch.isPending}
          >
            <Group gap="xs">
              <Checkbox
                label="Select All"
                checked={all}
                indeterminate={!all && matches.some(({ id }) => selection.has(id))}
                disabled={!matches.length || batch.isPending}
                onChange={(event) =>
                  changeSelection(
                    matches.map(({ id }) => id),
                    event.currentTarget.checked,
                  )
                }
              />
              <Text size="sm" c="dimmed" aria-live="polite">
                {selected.length} selected
              </Text>
            </Group>
            <Group gap="xs">
              <ToolbarAction
                label="Like"
                icon={icons.like}
                variant="default"
                disabled={actionDisabled}
                onClick={() => apply("liked")}
              />
              <ToolbarAction
                label="Dislike"
                icon={icons.dislike}
                variant="default"
                disabled={actionDisabled}
                onClick={() => apply("disliked")}
              />
              <ToolbarAction
                label="Delete"
                icon={icons.delete}
                color="red"
                variant="subtle"
                disabled={actionDisabled}
                onClick={() => setConfirm(true)}
              />
            </Group>
          </Group>
        )}
        {failure && (
          <Alert color="red" role="alert">
            {failure}
          </Alert>
        )}
        <ConfirmDialog
          opened={confirm}
          title={`Delete ${kind[0].toUpperCase()}${kind.slice(1)}`}
          action="Delete"
          pending={batch.isPending}
          disabled={!selected.length}
          zIndex={getDefaultZIndex("overlay")}
          onConfirm={() => apply("delete")}
          onClose={() => setConfirm(false)}
        >
          Delete {selected.length} {selected.length === 1 ? noun : kind}? Their images stay in the
          gallery.
        </ConfirmDialog>
      </>
    ),
  };
}
