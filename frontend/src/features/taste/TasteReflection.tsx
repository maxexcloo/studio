import { Group, Image, Stack, Text } from "@mantine/core";
import { queryOptions, useQuery } from "@tanstack/react-query";

import { api } from "../../api";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";

/** How alike a window of images is (backend/domain/reflection.ts). */
interface Sameness {
  recent: number | null;
  earlier: number | null;
  converging: boolean;
  examples: { id: string; url: string; title: string }[];
}
interface Reflection {
  sameness: { made: Sameness; liked: Sameness };
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

/** Whether results are converging on one look. */
export function TasteVariety() {
  const reflection = useQuery(reflectionQuery);
  const data = reflection.data;
  if (!data || !(data.sameness.liked.converging || data.sameness.made.converging)) return null;
  return (
    <SettingGroup title="Variety">
      {data.sameness.liked.converging && (
        <VarietyRow label="Recent Likes" sameness={data.sameness.liked} />
      )}
      {data.sameness.made.converging && (
        <VarietyRow label="Recent Results" sameness={data.sameness.made} />
      )}
    </SettingGroup>
  );
}
