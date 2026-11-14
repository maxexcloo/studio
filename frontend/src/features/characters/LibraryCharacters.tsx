import { Alert, Button, Group, Paper, Progress, SimpleGrid, Stack, Text } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { post } from "../../api";
import type { ReferenceAsset } from "../../types";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { CardThumbnails } from "./CardImages";
import { CardSuggestions } from "./CardSuggestions";
import { characterDetail } from "./CharacterChoices";
import { CharacterMenu, useCharacterDialogs } from "./CharacterDialogs";
import { sheetViews } from "./CharacterEditor";
import { type CharacterCard, charactersQuery } from "./queries";
import { useCardInComposer } from "./useCardInComposer";

/**
 * Library › Characters: every card the account keeps, to search, edit and delete, after the cards
 * Dream suggests (CardSuggestions). Use as Character
 * opens here with `characterFrom` (a gallery image's ID) in the route state, starting a new card
 * from that image.
 */
export function LibraryCharacters({ heading }: { heading: ReactNode }) {
  const characters = useQuery(charactersQuery);
  const dialogs = useCharacterDialogs();
  const use = useCardInComposer();
  const [query, setQuery] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as { characterFrom?: string } | null)?.characterFrom;
  const start = useMutation({
    mutationFn: (galleryItemId: string) =>
      post<{ asset: ReferenceAsset }>("/api/reference-assets/from-gallery", { galleryItemId }),
    onSuccess: ({ asset }) => dialogs.edit(undefined, { references: [asset] }),
  });
  const started = useRef("");
  useEffect(() => {
    if (!from || started.current === from) return;
    started.current = from;
    start.mutate(from);
    // The image is taken; a reload or Back opens the section without starting another card.
    navigate(location, { replace: true, state: { ...location.state, characterFrom: undefined } });
  }, [from]);
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
                      onGenerate={() => dialogs.generate(card)}
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
                {card.generated && (
                  <GeneratedFooter generated={card.generated} onPick={() => dialogs.edit(card)} />
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

/**
 * Generate References on a card: a progress line while they run, then how many wait to be picked,
 * with Pick References wrapping under it where the card is too narrow for both.
 */
function GeneratedFooter({
  generated,
  onPick,
}: {
  generated: NonNullable<CharacterCard["generated"]>;
  onPick: () => void;
}) {
  const done = generated.results.filter((result) => result.status === "done").length;
  const ended = generated.results.filter((result) =>
    ["done", "failed"].includes(result.status),
  ).length;
  const total = generated.jobIds.length;
  const running = ended < total;
  return (
    <Group gap="xs" justify="space-between">
      <Group gap="xs" wrap="nowrap" flex="1 1 8rem">
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {running ? `References ${done}/${total}` : `${done} References to Pick`}
        </Text>
        {running && (
          <Progress
            flex={1}
            size="sm"
            value={total ? (done / total) * 100 : 0}
            aria-label="Generating References"
          />
        )}
      </Group>
      <Button variant="default" size="compact-sm" style={{ flexShrink: 0 }} onClick={onPick}>
        Pick References
      </Button>
    </Group>
  );
}
