import { Alert, SimpleGrid, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { SortMenu } from "../../ui/SortMenu";
import { CardThumbnails, LibraryCard } from "./CardImages";
import { cardSortGroups, listedCards, useCardListing } from "./cardListing";
import { characterDetail } from "./CharacterChoices";
import { CharacterMenu, useCharacterDialogs } from "./CharacterDialogs";
import { sheetViews } from "./CharacterEditor";
import { type CharacterCard, charactersQuery } from "./queries";
import { useCardFrom } from "./useCardFrom";
import { useCardInComposer } from "./useCardInComposer";
import { useCardSelection } from "./useCardSelection";

/**
 * Library › Characters: every card the account keeps, to search, edit and delete. Use as Character
 * opens here, starting a new card from its image (useCardFrom).
 */
export function LibraryCharacters({ heading }: { heading: ReactNode }) {
  const characters = useQuery(charactersQuery);
  const dialogs = useCharacterDialogs();
  const use = useCardInComposer();
  const [query, setQuery] = useState("");
  const order = useCardListing("library", "characters");
  const start = useCardFrom((asset, named) =>
    dialogs.edit(undefined, { references: [asset], ...named }),
  );
  const cards = listedCards(characters.data, query, order.sort);
  const selection = useCardSelection("characters", characters.data, cards);
  return (
    <>
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Characters"
          query={query}
          onQueryChange={setQuery}
          actions={
            <>
              <SortMenu
                label="Sort Characters"
                groups={cardSortGroups}
                value={order.sort}
                onChange={order.setSort}
                withinPortal
              />
              {selection.toggle}
              <ToolbarAction
                label="New Character"
                icon={icons.add}
                onClick={() => dialogs.edit()}
              />
            </>
          }
        />
      </SectionHeader>
      {selection.bar}
      {start.error && <Alert color="red">{start.error.message}</Alert>}
      {characters.isPending ? (
        <LoadingState fill label="Loading Characters" />
      ) : characters.error ? (
        <Alert color="red">{characters.error.message}</Alert>
      ) : !cards.length ? (
        <EmptyState>{query.trim() ? "No Matches" : "No Characters"}</EmptyState>
      ) : (
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} role="list" aria-label="Characters">
          {cards.map((card) => (
            <LibraryCard
              key={card.id}
              name={card.name}
              images={card.references}
              candidates={card.candidates}
              onUse={
                !selection.active && card.references.length ? () => use.character(card) : undefined
              }
              selection={selection.control(card)}
              menu={
                !selection.active && (
                  <CharacterMenu
                    card={card}
                    onEdit={() => dialogs.edit(card)}
                    onSheet={() => dialogs.sheet(card)}
                    onFaceCheck={() => dialogs.faceCheck(card)}
                    onDelete={() => dialogs.remove(card)}
                  />
                )
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
