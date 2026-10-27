import { Alert, List, Stack, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { LoadingState } from "../../ui/LoadingState";

interface Merge {
  from: string;
  to: string;
  name: string;
}
interface DuplicatePreview {
  hash: string;
  merges: Merge[];
  differing: { name: string; ids: string[]; differences: string[] }[];
  unresolved: { name: string; ids: string[]; reason: string }[];
}
const duplicateProfilesQuery = queryOptions({
  queryKey: ["profile-duplicates"],
  queryFn: () => api<DuplicatePreview>("/api/profiles/duplicates"),
});

/**
 * Settings › Profiles › Merge Duplicate Profiles: previews same-named profiles that run the same
 * definition, then keeps the newer id and records the older one as its alias (profile-merge.js).
 */
export function MergeDuplicateProfiles({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const preview = useQuery({ ...duplicateProfilesQuery, enabled: opened, staleTime: 0 });
  const merge = useMutation({
    meta: { inlineError: true },
    mutationFn: (hash: string) =>
      post<{ merged: Merge[]; backup: string }>("/api/profiles/duplicates/merge", { hash }),
    onSuccess: () =>
      Promise.all(
        [["profile-duplicates"], ["definition-list"], ["models"], ["profile-stats"]].map(
          (queryKey) => client.invalidateQueries({ queryKey }),
        ),
      ),
  });
  const data = preview.data;
  const count = data?.merges.length || 0;
  return (
    <ConfirmDialog
      opened={opened}
      title="Merge Duplicate Profiles"
      action={count ? `Merge ${count} ${count === 1 ? "Profile" : "Profiles"}` : "Merge Profiles"}
      pending={merge.isPending}
      disabled={!count}
      error={merge.error?.message || preview.error?.message}
      onConfirm={() => data && merge.mutate(data.hash)}
      onClose={() => {
        merge.reset();
        onClose();
      }}
    >
      {preview.isPending ? (
        <LoadingState label="Finding Duplicates" />
      ) : (
        <Stack gap="sm">
          {merge.data && (
            <Alert color="green">
              Merged {merge.data.merged.length}. The removed definitions are kept in{" "}
              {merge.data.backup || "their version history"}.
            </Alert>
          )}
          {count ? (
            <>
              <Text size="sm">
                Each older profile is removed and its id becomes an alias of the kept one, so
                results, presets and links that name it keep working.
              </Text>
              <List size="sm" spacing={4}>
                {data!.merges.map((item) => (
                  <List.Item key={item.from}>
                    <Text size="sm" fw={500} span>
                      {item.name}
                    </Text>
                    <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                      Keeps {item.to}, removes {item.from}
                    </Text>
                  </List.Item>
                ))}
              </List>
            </>
          ) : (
            !merge.data && <Text size="sm">No duplicate profiles to merge.</Text>
          )}
          {!!data?.differing.length && (
            <>
              <Text size="sm" fw={500}>
                Same Name, Different Definitions
              </Text>
              <List size="sm" spacing={4}>
                {data.differing.map((item) => (
                  <List.Item key={item.ids.join()}>
                    <Text size="sm" span>
                      {item.name}
                    </Text>
                    <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                      {item.ids.join(", ")} differ in {item.differences.join(", ")}
                    </Text>
                  </List.Item>
                ))}
              </List>
            </>
          )}
          {!!data?.unresolved.length && (
            <>
              <Text size="sm" fw={500}>
                Duplicates Without an Id to Keep
              </Text>
              <List size="sm" spacing={4}>
                {data.unresolved.map((item) => (
                  <List.Item key={item.ids.join()}>
                    <Text size="sm" span>
                      {item.name}
                    </Text>
                    <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                      {item.ids.join(", ")}: {item.reason}
                    </Text>
                  </List.Item>
                ))}
              </List>
            </>
          )}
        </Stack>
      )}
    </ConfirmDialog>
  );
}
