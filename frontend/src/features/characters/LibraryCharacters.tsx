import { Alert, SimpleGrid, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { CardThumbnails, LibraryCard } from "./CardImages";
import { CardSuggestions } from "./CardSuggestions";
import { characterDetail } from "./CharacterChoices";
import { CharacterMenu, useCharacterDialogs } from "./CharacterDialogs";
import { sheetViews } from "./CharacterEditor";
import { type CharacterCard, charactersQuery } from "./queries";
import { useCardFrom } from "./useCardFrom";
import { useCardInComposer } from "./useCardInComposer";

/**
 * Library › Characters: every card the account keeps, to search, edit and delete, after the cards
 * Dream suggests (CardSuggestions). Use as Character opens here, starting a new card from its
 * image (useCardFrom).
 */
export function LibraryCharacters({ heading }: { heading: ReactNode }) {
  const characters = useQuery(charactersQuery);
  const dialogs = useCharacterDialogs();
  const use = useCardInComposer();
  const [query, setQuery] = useState("");
  const start = useCardFrom((asset, named) =>
    dialogs.edit(undefined, { references: [asset], ...named }),
  );
  const words = query.trim().toLowerCase();
  const cards = (characters.data || []).filter(
    (card) => !words || `${card.name} ${card.description}`.toLowerCase().includes(words),
  );
  return (
    <>
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Characters"
          query={query}
          onQueryChange={characters.data?.length ? setQuery : undefined}
          actions={
            <ToolbarAction label="New Character" icon={icons.add} onClick={() => dialogs.edit()} />
          }
        />
      </SectionHeader>
      {start.error && <Alert color="red">{start.error.message}</Alert>}
      {!words && <CardSuggestions kind="characters" />}
      {characters.isPending ? (
        <LoadingState fill label="Loading Characters" />
      ) : characters.error ? (
        <Alert color="red">{characters.error.message}</Alert>
      ) : !cards.length ? (
        <EmptyState>{words ? "No Matches" : "No Characters"}</EmptyState>
      ) : (
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} role="list" aria-label="Characters">
          {cards.map((card) => (
            <LibraryCard
              key={card.id}
              name={card.name}
              images={card.references}
              menu={
                <CharacterMenu
                  card={card}
                  onEdit={() => dialogs.edit(card)}
                  onSheet={() => dialogs.sheet(card)}
                  onDelete={() => dialogs.remove(card)}
                  onUse={() => use.character(card)}
                />
              }
            >
              {card.description && (
                <Text size="sm" c="dimmed" lineClamp={2}>
                  {card.description}
                </Text>
              )}
              <CharacterStory card={card} />
              <Text size="xs" c="dimmed">
                {[characterDetail(card), card.missing && `${card.missing} deleted from the gallery`]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {sheetViews(card).length > 0 && (
                <CardThumbnails label={`${card.name}'s Sheet`} images={sheetViews(card)} views />
              )}
            </LibraryCard>
          ))}
        </SimpleGrid>
      )}
      {dialogs.dialogs}
    </>
  );
}

/** A card's age, job, backstory, likes and dislikes, where it has them. */
function CharacterStory({ card }: { card: CharacterCard }) {
  const lines = [
    [card.age && `Age ${card.age}`, card.job].filter(Boolean).join(" · "),
    card.backstory,
    [
      card.likes && `Likes ${card.likes.split("\n").join(", ")}`,
      card.dislikes && `Dislikes ${card.dislikes.split("\n").join(", ")}`,
    ]
      .filter(Boolean)
      .join(" · "),
  ].filter(Boolean);
  return lines.map((line) => (
    <Text key={line} size="sm" c="dimmed" lineClamp={3}>
      {line}
    </Text>
  ));
}
