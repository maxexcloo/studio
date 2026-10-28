import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import type { GenerationInput } from "../../types";
type Loras = GenerationInput["loras"];
interface SavedStack {
  id: string;
  name: string;
  loras: Loras;
  savedAt?: string;
}
export interface LoraLibrary {
  snapshots: Record<string, SavedStack[]>;
  ratings?: Record<string, LoraRating>;
}
export type LoraRating = "up" | "down";
/** The account's saved stacks and LoRA ratings. */
export const loraLibraryQuery = queryOptions({
  queryKey: ["lora-library"],
  queryFn: () => api<{ found: boolean; library: LoraLibrary }>("/api/loras/library"),
});
type Operation =
  | { op: "stack.add"; key: string; stack: SavedStack }
  | { op: "stack.update"; key: string; id: string; loras: Loras }
  | { op: "stack.rename"; key: string; id: string; name: string }
  | { op: "stack.delete"; key: string; id: string };
/** A saved stack as the picker's saved list shows it. */
export interface StackRecord {
  id: string;
  name: string;
  savedAt?: string;
  detail?: string;
  key: string;
  stack: SavedStack;
}

/**
 * The saved stacks for this family, plus any an older build saved under the profile, and the
 * edits on them. Deleting offers Undo.
 */
export function useLoraStacks(family: string, profileId: string) {
  const cache = useQueryClient();
  const library = useQuery(loraLibraryQuery);
  const familyKey = `family:${family || "other"}`;
  const keys = [...new Set([familyKey, profileId].filter(Boolean))];
  const records: StackRecord[] = keys.flatMap((key) =>
    (library.data?.library.snapshots[key] || []).map((stack) => ({
      id: JSON.stringify([key, stack.id]),
      name: stack.name,
      savedAt: stack.savedAt,
      detail: key === familyKey ? undefined : "Saved for this profile by an older version",
      key,
      stack,
    })),
  );
  const change = useMutation({
    mutationFn: ({ ops }: { ops: Operation[]; deleted?: StackRecord; message?: string }) =>
      post<{ library: LoraLibrary }>("/api/loras/library/ops", { ops }),
    onSuccess: ({ library }, request) => {
      cache.setQueryData(loraLibraryQuery.queryKey, { found: true, library });
      if (request.deleted) {
        const { key, stack } = request.deleted;
        notifications.show({
          message: (
            <Group justify="space-between">
              <Text size="sm">LoRA stack deleted</Text>
              <Button
                variant="subtle"
                onClick={() => change.mutate({ ops: [{ op: "stack.add", key, stack }] })}
              >
                Undo
              </Button>
            </Group>
          ),
        });
      } else if (request.message) notifications.show({ message: request.message });
    },
  });
  const ready = !library.isPending && !library.isError;
  return {
    records,
    ready,
    save(name: string, loras: Loras) {
      // getRandomValues also works on plain HTTP LAN connections.
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (part) =>
        part.toString(16).padStart(2, "0"),
      ).join("");
      const stack = { id, name, loras, savedAt: new Date().toISOString() };
      change.mutate({
        ops: [{ op: "stack.add", key: familyKey, stack }],
        message: "LoRA stack saved",
      });
    },
    rename: (record: StackRecord, name: string) =>
      change.mutate({ ops: [{ op: "stack.rename", key: record.key, id: record.stack.id, name }] }),
    update: (record: StackRecord, loras: Loras) =>
      change.mutate({
        ops: [{ op: "stack.update", key: record.key, id: record.stack.id, loras }],
        message: "LoRA stack updated",
      }),
    remove: (record: StackRecord) =>
      change.mutate({
        ops: [{ op: "stack.delete", key: record.key, id: record.stack.id }],
        deleted: record,
      }),
  };
}
