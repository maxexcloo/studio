import { Alert, SimpleGrid, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { LibraryCard } from "./CardImages";
import { CardSuggestions } from "./CardSuggestions";
import { PromptCardMenu, promptCardText, usePromptCardDialogs } from "./PromptCardDialogs";
import { type PromptCardKind, promptCardsQuery } from "./queries";
import { useCardFrom } from "./useCardFrom";
import { useCardInComposer } from "./useCardInComposer";

/**
 * Library › Outfits and Library › Scenes: every card of the kind, to search, edit and delete. Use as
 * Outfit and Use as Scene open here, starting a new card from their image (useCardFrom).
 */
export function LibraryPromptCards({
  kind,
  heading,
}: {
  kind: PromptCardKind;
  heading: ReactNode;
}) {
  const { noun } = promptCardText[kind];
  const label = `${noun}s`;
  const listing = useQuery(promptCardsQuery(kind));
  const dialogs = usePromptCardDialogs(kind);
  const start = useCardFrom((asset, named) => dialogs.edit(undefined, [asset], named));
  const use = useCardInComposer();
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();
  const cards = (listing.data || []).filter(
    (card) => !words || `${card.name} ${card.description}`.toLowerCase().includes(words),
  );
  return (
    <>
      <SectionHeader heading={heading}>
        <SectionToolbar
          label={label}
          query={query}
          onQueryChange={listing.data?.length ? setQuery : undefined}
          actions={
            <ToolbarAction label={`New ${noun}`} icon={icons.add} onClick={() => dialogs.edit()} />
          }
        />
      </SectionHeader>
      {start.error && <Alert color="red">{start.error.message}</Alert>}
      {!words && <CardSuggestions kind={kind} />}
      {listing.isPending ? (
        <LoadingState fill label={`Loading ${label}`} />
      ) : listing.error ? (
        <Alert color="red">{listing.error.message}</Alert>
      ) : !cards.length ? (
        <EmptyState>{words ? "No Matches" : `No ${label}`}</EmptyState>
      ) : (
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} role="list" aria-label={label}>
          {cards.map((card) => (
            <LibraryCard
              key={card.id}
              name={card.name}
              images={card.references}
              menu={
                <PromptCardMenu
                  kind={kind}
                  card={card}
                  onEdit={() => dialogs.edit(card)}
                  onDelete={() => dialogs.remove(card)}
                  onUse={() => use.promptCard(kind, card)}
                />
              }
            >
              <Text size="sm" c="dimmed" lineClamp={3}>
                {card.description}
              </Text>
            </LibraryCard>
          ))}
        </SimpleGrid>
      )}
      {dialogs.dialogs}
    </>
  );
}
