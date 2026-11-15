import { Alert, Group, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { CardThumbnails } from "./CardImages";
import { CardSuggestions } from "./CardSuggestions";
import { characterDetail } from "./CharacterChoices";
import { CharacterMenu, useCharacterDialogs } from "./CharacterDialogs";
import { sheetViews } from "./CharacterEditor";
import { charactersQuery } from "./queries";
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
  const start = useCardFrom((asset) => dialogs.edit(undefined, { references: [asset] }));
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
      {!words && <CardSuggestions />}
      {characters.isPending ? (
        <LoadingState fill label="Loading Characters" />
      ) : characters.error ? (
        <Alert color="red">{characters.error.message}</Alert>
      ) : !cards.length ? (
        <EmptyState>{words ? "No Matches" : "No Characters"}</EmptyState>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} role="list" aria-label="Characters">
          {cards.map((card) => (
            <Paper key={card.id} p="sm" withBorder role="listitem" aria-label={card.name}>
              <Stack gap="xs">
                <Group gap={6} wrap="nowrap" align="flex-start">
                  <CardThumbnails
                    label={`${card.name}'s Images`}
                    images={card.references.map((asset, index) => ({
                      key: asset.id,
                      src: asset.url || asset.thumbnailUrl,
                      thumbnailUrl: asset.thumbnailUrl,
                      alt: `${card.name} ${index + 1}`,
                    }))}
                  />
                  <Group ml="auto">
                    <CharacterMenu
                      card={card}
                      onEdit={() => dialogs.edit(card)}
                      onSheet={() => dialogs.sheet(card)}
                      onDelete={() => dialogs.remove(card)}
                      onUse={() => use.character(card)}
                    />
                  </Group>
                </Group>
                <div>
                  <Text size="sm" fw={500}>
                    {card.name}
                  </Text>
                  {card.description && (
                    <Text size="sm" c="dimmed" lineClamp={2}>
                      {card.description}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed">
                    {[
                      characterDetail(card),
                      card.missing && `${card.missing} deleted from the gallery`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </div>
                {sheetViews(card).length > 0 && (
                  <CardThumbnails label={`${card.name}'s Sheet`} images={sheetViews(card)} views />
                )}
              </Stack>
            </Paper>
          ))}
        </SimpleGrid>
      )}
      {dialogs.dialogs}
    </>
  );
}
