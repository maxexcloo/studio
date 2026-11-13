import { useState, type ReactNode } from "react";
import { Alert, Group, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { CardThumbnails } from "./CardImages";
import { PromptCardMenu, promptCardText, usePromptCardDialogs } from "./PromptCardDialogs";
import { promptCardsQuery, type PromptCardKind } from "./queries";

/** Library › Outfits and Library › Scenes: every card of the kind, to search, edit and delete. */
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
            <ToolbarAction
              label={`New ${noun}`}
              icon={<icons.add size={16} />}
              onClick={() => dialogs.edit()}
            />
          }
        />
      </SectionHeader>
      {listing.isPending ? (
        <LoadingState fill label={`Loading ${label}`} />
      ) : listing.error ? (
        <Alert color="red">{listing.error.message}</Alert>
      ) : !cards.length ? (
        <EmptyState>{words ? "No Matches" : `No ${label}`}</EmptyState>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} role="list" aria-label={label}>
          {cards.map((card) => (
            <Paper key={card.id} p="sm" withBorder role="listitem" aria-label={card.name}>
              <Stack gap={4}>
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  {card.references.length ? (
                    <CardThumbnails
                      label={`${card.name}'s Images`}
                      images={card.references.map((asset, index) => ({
                        key: asset.id,
                        src: asset.url || asset.thumbnailUrl,
                        thumbnailUrl: asset.thumbnailUrl,
                        alt: `${card.name} ${index + 1}`,
                      }))}
                    />
                  ) : (
                    <Text size="sm" fw={500}>
                      {card.name}
                    </Text>
                  )}
                  <PromptCardMenu
                    kind={kind}
                    card={card}
                    onEdit={() => dialogs.edit(card)}
                    onDelete={() => dialogs.remove(card)}
                  />
                </Group>
                {card.references.length > 0 && (
                  <Text size="sm" fw={500}>
                    {card.name}
                  </Text>
                )}
                <Text size="sm" c="dimmed" lineClamp={3}>
                  {card.description}
                </Text>
              </Stack>
            </Paper>
          ))}
        </SimpleGrid>
      )}
      {dialogs.dialogs}
    </>
  );
}
