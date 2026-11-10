import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Group, Image, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { post } from "../../api";
import type { ReferenceAsset } from "../../types";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { characterDetail } from "./CharacterChoices";
import { CharacterMenu, useCharacterDialogs } from "./CharacterDialogs";
import { charactersQuery } from "./queries";

/**
 * Library › Characters: every card the account keeps, to search, edit and delete. Make Character
 * opens here with `characterFrom` (a gallery image's ID) in the route state, starting a new card
 * from that image.
 */
export function LibraryCharacters({ heading }: { heading: ReactNode }) {
  const characters = useQuery(charactersQuery);
  const dialogs = useCharacterDialogs();
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
            <ToolbarAction
              label="New Character"
              icon={<icons.add size={16} />}
              onClick={() => dialogs.edit()}
            />
          }
        />
      </SectionHeader>
      {start.error && <Alert color="red">{start.error.message}</Alert>}
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
                <Group gap={6} wrap="nowrap">
                  {card.references.map((asset, index) => (
                    <Image
                      key={asset.id}
                      src={asset.thumbnailUrl || asset.url}
                      alt={`${card.name} ${index + 1}`}
                      w={56}
                      h={56}
                      radius="md"
                      fallbackSrc=""
                    />
                  ))}
                  <Group ml="auto" style={{ alignSelf: "flex-start" }}>
                    <CharacterMenu
                      card={card}
                      onEdit={() => dialogs.edit(card)}
                      onDelete={() => dialogs.remove(card)}
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
              </Stack>
            </Paper>
          ))}
        </SimpleGrid>
      )}
      {dialogs.dialogs}
    </>
  );
}
