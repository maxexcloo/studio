import { Alert, Button, Group, Image, Stack, Text } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useNavigate } from "react-router";

import type { MediaItem } from "../../types";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable, TableRecord } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { useFlash } from "../../ui/useFlash";
import { mediaTitle } from "../gallery/mediaLabels";
import { mediaSource } from "../gallery/mediaSource";
import { characterResultsQuery } from "../gallery/queries";
import { useIterate } from "../gallery/useMediaAction";
import { viewerPath } from "../gallery/viewerLink";
import { CardDialog } from "./CardImages";
import { identityNote } from "./identity";
import type { CharacterCard } from "./queries";

/**
 * Face Check for one character: recent results made with its card and how closely each face
 * matches it, worst first. Recreate runs an off-character result again as Run Again does: its
 * prompt, card and settings with a new seed, as a version of it.
 */
export function CharacterFaceCheck({
  card,
  onClose,
}: {
  card: CharacterCard | null;
  onClose: () => void;
}) {
  return (
    <CardDialog opened={card !== null} onClose={onClose} title="Face Check">
      {card && <FaceCheckResults card={card} onClose={onClose} />}
    </CardDialog>
  );
}

function FaceCheckResults({ card, onClose }: { card: CharacterCard; onClose: () => void }) {
  const results = useQuery(characterResultsQuery(card.id));
  const navigate = useNavigate();
  const iterate = useIterate();
  const [queued, flashQueued] = useFlash<string>();
  const recreate = useMutation({
    mutationFn: (item: MediaItem) => iterate(item, { kind: "regenerate", count: 1 }),
    onSuccess: (_job, item) => flashQueued(item.id),
  });
  const items = results.data || [];
  const drifted = items.filter((item) => item.identity?.drifted).length;
  const missing = items.filter((item) => item.identity?.score == null).length;
  const checked = items.length - missing;
  return (
    <Stack gap="md">
      {results.error && <Alert color="red">{results.error.message}</Alert>}
      {results.data && items.length > 0 && (
        <Text size="sm" c="dimmed">
          {drifted > 0 && `${drifted} of ${checked} scored results off-character, worst first. `}
          {checked > 0 && !drifted && `All ${checked} scored results match ${card.name}. `}
          {missing > 0 && `${missing} with no face detected. `}
          {items.length === 200 && "Showing the 200 most recent results."}
        </Text>
      )}
      <DataTable
        label={`${card.name}'s Results`}
        rows={items}
        rowKey={(item) => item.id}
        rowName={mediaTitle}
        loading={results.isPending && "Loading Results"}
        empty="No Checked Results"
        columns={[
          {
            key: "result",
            header: "Result",
            main: true,
            cell: (item) => (
              <Group gap="sm" wrap="nowrap">
                <Image
                  src={mediaSource(item).thumbnailUrl || mediaSource(item).url}
                  alt=""
                  w={40}
                  h={40}
                  radius="sm"
                  fit="cover"
                  loading="lazy"
                />
                <Stack gap={0} miw={0}>
                  <TableRecord
                    name={mediaTitle(item)}
                    detail={item.identity && identityNote(item.identity, card.name)}
                    openLabel={`Open ${mediaTitle(item)}`}
                    onOpen={() => navigate(viewerPath(item), { state: { viewer: true } })}
                  />
                </Stack>
              </Group>
            ),
          },
          {
            key: "match",
            header: "Match",
            cell: ({ identity }) => (
              <Text
                size="sm"
                c={identity?.drifted ? "orange" : undefined}
                style={{ whiteSpace: "nowrap" }}
              >
                {identity?.score == null ? "No Face" : identity.score.toFixed(2)}
              </Text>
            ),
          },
          {
            key: "recreate",
            header: "",
            cell: (item) =>
              item.identity?.drifted && (
                <Group justify="flex-end" wrap="nowrap">
                  <Button
                    size="compact-sm"
                    variant="default"
                    leftSection={
                      queued === item.id ? <Check size={14} /> : <icons.recreate size={14} />
                    }
                    loading={recreate.isPending && recreate.variables?.id === item.id}
                    disabled={recreate.isPending}
                    aria-label={`Recreate ${mediaTitle(item)}`}
                    onClick={() => recreate.mutate(item)}
                  >
                    {queued === item.id ? "Queued" : "Recreate"}
                  </Button>
                </Group>
              ),
          },
        ]}
      />
      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </Stack>
  );
}
