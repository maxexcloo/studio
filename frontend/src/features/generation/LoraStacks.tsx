import { useState } from "react";
import {
  Accordion,
  ActionIcon,
  Alert,
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Trash2 } from "lucide-react";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import type { GenerationInput } from "../../types";
type Loras = GenerationInput["loras"];
interface SavedStack {
  id: string;
  name: string;
  loras: Loras;
}
interface Library {
  snapshots: Record<string, SavedStack[]>;
}
type Operation =
  | { op: "stack.add"; key: string; stack: SavedStack }
  | { op: "stack.update"; key: string; id: string; loras: Loras }
  | { op: "stack.rename"; key: string; id: string; name: string }
  | { op: "stack.delete"; key: string; id: string };
export function LoraStacks({
  family,
  profileId,
  loras,
  onLoad,
}: {
  family: string;
  profileId: string;
  loras: Loras;
  onLoad: (loras: Loras) => void;
}) {
  const [opened, setOpened] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const cache = useQueryClient();
  const library = useQuery({
    queryKey: ["lora-library"],
    queryFn: () => api<{ found: boolean; library: Library }>("/api/loras/library"),
    enabled: opened === "stacks",
  });
  const familyKey = `family:${family || "other"}`;
  const keys = [...new Set([familyKey, profileId].filter(Boolean))];
  const records = keys.flatMap((key) =>
    (library.data?.library.snapshots[key] || []).map((stack) => ({
      key,
      stack,
      value: JSON.stringify([key, stack.id]),
    })),
  );
  const current = records.find((record) => record.value === selected);
  const change = useMutation({
    meta: { inlineError: true },
    mutationFn: ({ ops }: { ops: Operation[]; deleted?: typeof current }) =>
      post<{ library: Library }>("/api/loras/library/ops", { ops }),
    onSuccess: ({ library }, request) => {
      cache.setQueryData(["lora-library"], { found: true, library });
      if (request.deleted) {
        const { key, stack } = request.deleted;
        setSelected(null);
        notifications.show({
          message: (
            <Group justify="space-between">
              <Text size="sm">LoRA stack deleted</Text>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => change.mutate({ ops: [{ op: "stack.add", key, stack }] })}
              >
                Undo
              </Button>
            </Group>
          ),
        });
      } else {
        const edit = request.ops.find((operation) => operation.op !== "stack.delete");
        if (edit) {
          const id = edit.op === "stack.add" ? edit.stack.id : edit.id;
          const saved = library.snapshots[edit.key]?.find((stack) => stack.id === id);
          if (saved) setName(saved.name);
        }
        notifications.show({ message: "LoRA stack saved" });
      }
    },
  });
  function saveNew() {
    if (!name.trim() || !loras.length || change.isPending || library.isPending || library.isError)
      return;
    // getRandomValues also works on plain HTTP LAN connections.
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (part) =>
      part.toString(16).padStart(2, "0"),
    ).join("");
    change.mutate(
      { ops: [{ op: "stack.add", key: familyKey, stack: { id, name: name.trim(), loras } }] },
      { onSuccess: () => setSelected(JSON.stringify([familyKey, id])) },
    );
  }
  function updateCurrent() {
    if (!current || !name.trim() || change.isPending) return;
    change.mutate({
      ops: [
        { op: "stack.update", key: current.key, id: current.stack.id, loras },
        ...(name.trim() !== current.stack.name
          ? [
              {
                op: "stack.rename" as const,
                key: current.key,
                id: current.stack.id,
                name: name.trim(),
              },
            ]
          : []),
      ],
    });
  }
  return (
    <Accordion value={opened} onChange={setOpened} transitionDuration={0}>
      <Accordion.Item value="stacks">
        <Accordion.Control>Saved LoRA Stacks</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            <Select
              comboboxProps={{ withinPortal: false }}
              label="Saved LoRA Stack"
              searchable
              clearable
              placeholder={
                library.isPending
                  ? "Loading Stacks…"
                  : records.length
                    ? "Choose a Stack"
                    : "No Saved Stacks"
              }
              disabled={library.isPending || change.isPending}
              data={keys
                .map((key) => ({
                  group: key === familyKey ? "This Family" : "Current Profile (Legacy)",
                  items: records
                    .filter((record) => record.key === key)
                    .map((record) => ({ value: record.value, label: record.stack.name })),
                }))
                .filter((group) => group.items.length)}
              value={current?.value || null}
              onChange={(value) => {
                setSelected(value);
                setName(records.find((record) => record.value === value)?.stack.name || "");
              }}
            />
            {library.error && (
              <Alert color="red">
                {library.error.message}
                <Button variant="subtle" size="compact-xs" onClick={() => void library.refetch()}>
                  Reload Stacks
                </Button>
              </Alert>
            )}
            <Group justify="space-between">
              <Button
                variant="default"
                size="sm"
                disabled={!current || change.isPending}
                onClick={() => {
                  if (current) onLoad(current.stack.loras.map((lora) => ({ ...lora })));
                }}
              >
                Load LoRA Stack
              </Button>
              <Tooltip label="Delete LoRA Stack">
                <ActionIcon
                  aria-label="Delete LoRA Stack"
                  color="red"
                  variant="subtle"
                  disabled={!current || change.isPending}
                  onClick={() => {
                    if (current)
                      change.mutate({
                        ops: [{ op: "stack.delete", key: current.key, id: current.stack.id }],
                        deleted: current,
                      });
                  }}
                >
                  <Trash2 size={17} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <TextInput
              label="LoRA Stack Name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (
                  event.key !== "Enter" ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.nativeEvent.isComposing
                )
                  return;
                event.preventDefault();
                if (current) updateCurrent();
                else saveNew();
              }}
            />
            {change.error && <Alert color="red">{change.error.message}</Alert>}
            <Group gap="xs">
              {current && (
                <Button
                  size="sm"
                  disabled={!name.trim()}
                  loading={change.isPending}
                  onClick={updateCurrent}
                >
                  Update LoRA Stack
                </Button>
              )}
              <Button
                size="sm"
                variant="default"
                disabled={!name.trim() || !loras.length || library.isPending || library.isError}
                loading={change.isPending}
                onClick={saveNew}
              >
                {current ? "Save as New LoRA Stack" : "Save LoRA Stack"}
              </Button>
            </Group>
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
