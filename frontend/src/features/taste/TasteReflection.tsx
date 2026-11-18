import { Group, Image, Stack, Text } from "@mantine/core";
import { queryOptions, useQuery } from "@tanstack/react-query";

import { api } from "../../api";
import { DataTable } from "../../ui/DataTable";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";

/** How alike a window of images is (backend/domain/reflection.ts). */
interface Sameness {
  recent: number | null;
  earlier: number | null;
  converging: boolean;
  examples: { id: string; url: string; title: string }[];
}
interface Day {
  day: string;
  profileId: string;
  profileName: string;
  model: string;
  made: number;
  liked: number;
  disliked: number;
}
interface Reflection {
  sameness: { made: Sameness; liked: Sameness };
  days: Day[];
}
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const reflectionQuery = queryOptions({
  queryKey: ["taste", "reflection"],
  queryFn: () => api<Reflection>(`/api/taste/reflection?zone=${encodeURIComponent(zone)}`),
  staleTime: 5 * 60_000,
});

const percent = (share: number) => `${Math.round(share * 100)}%`;
/** A window's sameness as a sentence, such as "32% of pairs look alike, up from 12%". */
function alike({ recent, earlier }: Sameness) {
  if (recent === null) return "Not enough read yet.";
  return `${percent(recent)} of pairs look alike${earlier === null ? "" : `, against ${percent(earlier)} before`}.`;
}

function VarietyRow({ label, sameness }: { label: string; sameness: Sameness }) {
  return (
    <SettingRow
      label={label}
      description={
        <Stack gap={4} component="span">
          <span>{alike(sameness)}</span>
          {sameness.converging && (
            <>
              <Text span size="sm" c="text">
                Converging on one look. Dream and chats are asked to vary more.
              </Text>
              <Group gap={4} component="span">
                {sameness.examples.map((example) => (
                  <Image
                    key={example.id}
                    src={example.url}
                    alt={example.title}
                    w={48}
                    h={48}
                    radius="sm"
                    loading="lazy"
                  />
                ))}
              </Group>
            </>
          )}
        </Stack>
      }
    />
  );
}

/** Whether results are converging on one look, and how each model has fared day by day. */
export function TasteReflection() {
  const reflection = useQuery(reflectionQuery);
  const data = reflection.data;
  return (
    <>
      <SettingGroup title="Variety">
        {reflection.isPending && <LoadingState label="Loading Variety" />}
        {data && (
          <>
            <VarietyRow label="Recent Results" sameness={data.sameness.made} />
            <VarietyRow label="Recent Likes" sameness={data.sameness.liked} />
          </>
        )}
      </SettingGroup>
      <SettingGroup title="Results by Day">
        <DataTable
          label="Results by Day"
          compact
          rows={data?.days || []}
          rowKey={(row) => `${row.day} ${row.profileId} ${row.model}`}
          rowName={(row) => `${row.day} ${row.profileName || row.profileId}`}
          loading={reflection.isPending && "Loading Results"}
          empty="No Results in the Last 30 Days"
          columns={[
            {
              key: "day",
              header: "Day",
              cell: (row) => (
                <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                  {row.day}
                </Text>
              ),
              sortValue: (row) => row.day,
            },
            {
              key: "model",
              header: "Model",
              main: true,
              cell: (row) => (
                <Stack gap={0}>
                  <Text size="sm" truncate>
                    {row.profileName || row.profileId || "Unknown"}
                  </Text>
                  {row.model && (
                    <Text size="xs" c="dimmed" truncate>
                      {row.model}
                    </Text>
                  )}
                </Stack>
              ),
              sortValue: (row) => row.profileName || row.profileId,
            },
            {
              key: "made",
              header: "Made",
              cell: (row) => <Text size="sm">{row.made}</Text>,
              sortValue: (row) => row.made,
            },
            {
              key: "liked",
              header: "Liked",
              cell: (row) => <Text size="sm">{percent(row.liked / row.made)}</Text>,
              sortValue: (row) => row.liked / row.made,
            },
            {
              key: "disliked",
              header: "Disliked",
              cell: (row) => <Text size="sm">{percent(row.disliked / row.made)}</Text>,
              sortValue: (row) => row.disliked / row.made,
            },
          ]}
        />
      </SettingGroup>
    </>
  );
}
