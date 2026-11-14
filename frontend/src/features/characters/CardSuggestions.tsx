import { Badge, Button, Group, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { post } from "../../api";
import { SettingGroup } from "../../ui/SettingRows";
import { useGroupFeature } from "../auth/AccountGate";
import { suggestionPath, suggestionsQuery, type CardSuggestion } from "../dream/queries";
import { CardThumbnails } from "./CardImages";

const kindLabels = { characters: "Character", outfits: "Outfit", scenes: "Scene" } as const;

/**
 * Characters, outfits and scenes Dream noticed recurring in liked results: Accept makes the card
 * from them, Dismiss turns it down. Nothing shows without Dream or a suggestion.
 */
export function CardSuggestions() {
  const client = useQueryClient();
  const suggestions = useQuery({ ...suggestionsQuery, enabled: useGroupFeature("dream") });
  const settle = useMutation({
    mutationFn: ({
      suggestion,
      action,
    }: {
      suggestion: CardSuggestion;
      action: "accept" | "dismiss";
    }) => post(suggestionPath(suggestion, action), {}),
    onSuccess: (_result, { suggestion, action }) => {
      void client.invalidateQueries({ queryKey: suggestionsQuery.queryKey });
      if (action === "accept") void client.invalidateQueries({ queryKey: [suggestion.kind] });
    },
  });
  if (!suggestions.data?.length) return null;
  return (
    <SettingGroup title="Suggestions">
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} role="list" aria-label="Suggestions">
        {suggestions.data.map((suggestion) => {
          const busy = settle.isPending && settle.variables?.suggestion.id === suggestion.id;
          return (
            <Paper
              key={suggestion.id}
              p="sm"
              withBorder
              role="listitem"
              aria-label={suggestion.name}
            >
              <Stack gap="xs">
                <CardThumbnails
                  label={`${suggestion.name}'s Results`}
                  images={suggestion.items.map((item, index) => ({
                    key: item.id,
                    src: item.url,
                    thumbnailUrl: item.thumbnailUrl,
                    alt: `${suggestion.name} ${index + 1}`,
                  }))}
                />
                <div>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" fw={500}>
                      {suggestion.name}
                    </Text>
                    <Badge size="sm" variant="default">
                      {kindLabels[suggestion.kind]}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed" lineClamp={3}>
                    {suggestion.description}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {`In ${suggestion.items.length} liked results`}
                  </Text>
                </div>
                <Group gap="xs" justify="flex-end">
                  <Button
                    variant="default"
                    size="compact-sm"
                    disabled={busy}
                    onClick={() => settle.mutate({ suggestion, action: "dismiss" })}
                  >
                    Dismiss
                  </Button>
                  <Button
                    variant="light"
                    size="compact-sm"
                    loading={busy && settle.variables?.action === "accept"}
                    disabled={busy}
                    onClick={() => settle.mutate({ suggestion, action: "accept" })}
                  >
                    Accept
                  </Button>
                </Group>
              </Stack>
            </Paper>
          );
        })}
      </SimpleGrid>
    </SettingGroup>
  );
}
