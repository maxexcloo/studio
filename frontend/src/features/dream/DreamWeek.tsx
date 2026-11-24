import { Alert, AspectRatio, Card, SimpleGrid, Stack, Text, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { DreamDigestRow, DreamPassReason } from "../../../../shared/dream";
import { DataTable } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { plural } from "../../ui/plural";
import { SettingGroup } from "../../ui/SettingRows";
import { MediaViewer } from "../gallery/MediaViewer";
import { Thumbnail } from "./DiscardedDreams";
import { weekQuery } from "./queries";

const reasonLabels: Record<DreamPassReason, string> = {
  glitch: "Glitch",
  similar: "Too Similar",
  skip: "No Reason",
  taste: "Not My Taste",
};
const kept = (row: DreamDigestRow) =>
  `${Math.round((row.kept / (row.kept + row.passed)) * 100)}% (${row.kept} of ${row.kept + row.passed})`;
const list = (names: string[]) => names.join(", ");

/**
 * Dream › This Week: the last seven days of verdicts, read from the account's records: the best kept
 * results, the models, LoRAs and themes kept most often, what was passed, and what Dream leans on next.
 */
export function DreamWeek() {
  const week = useQuery(weekQuery);
  const [viewing, setViewing] = useState<string | null>(null);
  if (week.isPending) return <LoadingState fill label="Loading This Week" />;
  if (week.isError)
    return (
      <Alert color="red" title="Couldn't Load This Week">
        {week.error.message}
      </Alert>
    );
  const { top, best, passedThemes, reasons, next } = week.data;
  if (!week.data.kept && !week.data.passed)
    return <EmptyState fill>No Verdicts This Week</EmptyState>;
  const current = viewing ? top.find((item) => item.id === viewing) : undefined;
  const rows = (["models", "loras", "themes"] as const).flatMap((kind) =>
    best[kind].map((row) => ({
      ...row,
      kind: { models: "Model", loras: "LoRA", themes: "Theme" }[kind],
    })),
  );
  const leaning = [
    next.models.length && `Models: ${list(next.models)}`,
    next.loras.length && `LoRAs: ${list(next.loras)}`,
    next.themes.length && `Themes: ${list(next.themes)}`,
    next.projects.length && `Projects: ${list(next.projects)}`,
    `Explores ${Math.round(next.explore * 100)}% of new ideas`,
  ].filter(Boolean);
  return (
    <Stack gap="lg" pb="md">
      <Text size="sm" c="dimmed">
        {plural(week.data.kept, "result")} kept and {week.data.passed.toLocaleString()} passed in
        the last seven days.
      </Text>
      {top.length > 0 && (
        <SettingGroup title="Top Kept">
          <SimpleGrid cols={{ base: 3, sm: 4, md: 6 }} spacing="sm">
            {top.map((item) => (
              <Card key={item.id} withBorder padding={0}>
                <UnstyledButton
                  aria-label={`View ${item.title || item.prompt || "Result"}`}
                  onClick={() => setViewing(item.id)}
                >
                  <AspectRatio ratio={1}>
                    <Thumbnail item={item} />
                  </AspectRatio>
                </UnstyledButton>
              </Card>
            ))}
          </SimpleGrid>
        </SettingGroup>
      )}
      <SettingGroup title="Worked Best">
        <DataTable
          label="Worked Best"
          compact
          rows={rows}
          rowKey={(row) => `${row.kind}:${row.name}`}
          rowName={(row) => row.name}
          empty="Too Few Verdicts Yet"
          columns={[
            {
              key: "name",
              header: "Name",
              main: true,
              cell: (row) => (
                <Text size="sm" truncate>
                  {row.name}
                </Text>
              ),
            },
            { key: "kind", header: "Kind", cell: (row) => row.kind },
            { key: "kept", header: "Kept", cell: kept },
          ]}
        />
      </SettingGroup>
      {reasons.length > 0 && (
        <SettingGroup title="Passed Most">
          <Text size="sm">
            {list(reasons.map(({ reason, count }) => `${reasonLabels[reason]} (${count})`))}
          </Text>
          {passedThemes.length > 0 && (
            <Text size="sm" c="dimmed">
              Themes: {list(passedThemes.map((row) => `${row.name} (${row.passed})`))}
            </Text>
          )}
        </SettingGroup>
      )}
      <SettingGroup title="Next">
        {leaning.map((line) => (
          <Text key={line} size="sm">
            {line}
          </Text>
        ))}
      </SettingGroup>
      {current && (
        <MediaViewer
          item={current}
          items={top}
          navigate={(item) => setViewing(item.id)}
          close={() => setViewing(null)}
        />
      )}
    </Stack>
  );
}
