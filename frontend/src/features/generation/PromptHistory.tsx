import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Box,
  Combobox,
  Group,
  Popover,
  ScrollArea,
  Stack,
  Switch,
  Text,
  Tooltip,
  useCombobox,
} from "@mantine/core";
import { History, Pin, PinOff, Trash2 } from "lucide-react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api, post } from "../../api";
import { useAccount, useIsAdmin } from "../auth/AccountGate";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { SearchInput } from "../../ui/SearchInput";
import { PickerFooter } from "./Picker";

type PromptKind = "positive" | "negative";
interface PromptEntry {
  text: string;
  at: string;
  uses: number;
  pinned?: boolean;
}
interface HistoryData {
  prompts: PromptEntry[];
  enabled: boolean;
}
type HistoryEdit =
  | { action: "pin"; text: string; pinned: boolean }
  | { action: "forget"; text: string }
  | { action: "clear" };

/** One account's recent prompts of a kind, and whether new ones are kept. */
const promptHistoryQuery = (kind: PromptKind) =>
  queryOptions({
    queryKey: ["prompt-history", kind],
    queryFn: () => api<HistoryData>(`/api/prompts?kind=${kind}`),
  });
const promptKey = (text: string) => text.replace(/\s+/g, " ").trim().toLocaleLowerCase();

/** The edit applied locally, as the server applies it, so pins and forgets show at once. */
function editHistory(data: HistoryData, edit: HistoryEdit): HistoryData {
  if (edit.action === "clear")
    return { ...data, prompts: data.prompts.filter((entry) => entry.pinned) };
  const key = promptKey(edit.text);
  const found = data.prompts.some((entry) => promptKey(entry.text) === key);
  if (edit.action === "forget")
    return { ...data, prompts: data.prompts.filter((entry) => promptKey(entry.text) !== key) };
  if (!found)
    return edit.pinned
      ? {
          ...data,
          prompts: [
            { text: edit.text.trim(), at: new Date().toISOString(), uses: 0, pinned: true },
            ...data.prompts,
          ],
        }
      : data;
  return {
    ...data,
    prompts: data.prompts.map((entry) =>
      promptKey(entry.text) === key ? { ...entry, pinned: edit.pinned || undefined } : entry,
    ),
  };
}

/**
 * Applies a change to the cached histories at once and rolls it back if the server refuses.
 * Changes run in order; only the last one to settle writes the server's copy back.
 */
function optimistic<T>(
  client: QueryClient,
  kinds: PromptKind[],
  change: (data: HistoryData, input: T) => HistoryData,
) {
  const keys = kinds.map((kind) => promptHistoryQuery(kind).queryKey);
  return {
    mutationKey: ["prompt-history"],
    scope: { id: "prompt-history" },
    // Synchronous, so a switch moves in the same frame as the tap.
    onMutate: (input: T) => {
      const previous = keys.map((queryKey) => client.getQueryData<HistoryData>(queryKey));
      keys.forEach((queryKey) => {
        void client.cancelQueries({ queryKey }, { revert: false });
        client.setQueryData<HistoryData>(queryKey, (data) => data && change(data, input));
      });
      return previous;
    },
    onError: (_error: unknown, _input: T, previous?: (HistoryData | undefined)[]) =>
      keys.forEach((queryKey, index) => client.setQueryData(queryKey, previous?.[index])),
    onSettled: () => {
      if (client.isMutating({ mutationKey: ["prompt-history"] }) <= 1)
        void client.invalidateQueries({ queryKey: ["prompt-history"] });
    },
  };
}

/** Keep Recent Prompts, shared by the composer's history and Settings. Off forgets unpinned prompts. */
export function useKeepRecentPrompts(enabled = true) {
  const client = useQueryClient();
  const history = useQuery({ ...promptHistoryQuery("positive"), enabled });
  const change = useMutation({
    mutationFn: (on: boolean) => post("/api/prompts/enabled", { enabled: on }),
    ...optimistic<boolean>(client, ["positive", "negative"], (data, on) => ({
      enabled: on,
      prompts: on ? data.prompts : data.prompts.filter((entry) => entry.pinned),
    })),
  });
  return { history, change };
}

export function PromptHistory({
  kind,
  value,
  onPick,
  withinPortal = true,
}: {
  kind: PromptKind;
  value: string;
  onPick: (text: string) => void;
  /** False inside another popover, so picking keeps that popover open. */
  withinPortal?: boolean;
}) {
  const account = useAccount();
  const admin = useIsAdmin();
  const allowed = admin || account.data?.account?.features?.promptHistory === true;
  const [opened, setOpened] = useState(false),
    [query, setQuery] = useState("");
  const combobox = useCombobox({ opened });
  const client = useQueryClient();
  const history = useQuery({ ...promptHistoryQuery(kind), enabled: allowed && opened });
  const keep = useKeepRecentPrompts(allowed && opened);
  const edit = useMutation({
    mutationFn: (input: HistoryEdit) =>
      post<HistoryData>(`/api/prompts/${input.action}`, {
        ...input,
        action: undefined,
        kind,
        ...(input.action === "clear" ? { keepPinned: true } : {}),
      }),
    ...optimistic<HistoryEdit>(client, [kind], editHistory),
  });
  const pin = (text: string, pinned: boolean) => edit.mutate({ action: "pin", text, pinned });
  const title = kind === "negative" ? "Recent Negative Prompts" : "Recent Prompts";
  const filtered = (history.data?.prompts || [])
    .filter((entry) => entry.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort(
      (a, b) =>
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
        Date.parse(b.at) - Date.parse(a.at),
    );
  const visible = query.trim()
    ? filtered.slice(0, 60)
    : [
        ...filtered.filter((entry) => entry.pinned),
        ...filtered.filter((entry) => !entry.pinned).slice(0, 60),
      ];
  const currentPinned = history.data?.prompts.some(
    (entry) => entry.pinned && promptKey(entry.text) === promptKey(value),
  );
  const optionsKey = visible.map((entry) => entry.text).join("\n");
  useEffect(() => {
    if (opened) combobox.selectFirstOption();
  }, [opened, optionsKey]);
  if (!allowed) return null;
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={500}
      position="top-end"
      shadow="md"
      withinPortal={withinPortal}
      trapFocus
      returnFocus
    >
      <Popover.Target>
        <Box component="span" style={{ display: "inline-flex" }}>
          <Tooltip label={title}>
            <ActionIcon
              aria-label={title}
              aria-expanded={opened}
              variant="subtle"
              color="gray"
              onClick={() => setOpened((previous) => !previous)}
            >
              <History size={16} />
            </ActionIcon>
          </Tooltip>
        </Box>
      </Popover.Target>
      <Popover.Dropdown
        data-composer-layer
        aria-labelledby=""
        aria-label={title}
        maw="calc(100vw - 24px)"
        onFocusCapture={(event) =>
          (event.target as HTMLElement).setAttribute("data-mantine-stop-propagation", "true")
        }
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            if (value.trim() && !currentPinned) pin(value, true);
          }
        }}
      >
        <Combobox
          store={combobox}
          onOptionSubmit={(text) => {
            onPick(text);
            setOpened(false);
          }}
        >
          <Stack gap="sm">
            <Group justify="space-between" wrap="nowrap">
              <Text fw={500}>{title}</Text>
              <Switch
                // Remounts once loaded so the saved state appears without the thumb sliding.
                key={keep.history.data ? "loaded" : "loading"}
                label="Save Recent Prompts"
                labelPosition="left"
                checked={keep.history.data?.enabled ?? false}
                disabled={!keep.history.data}
                onChange={(event) => keep.change.mutate(event.currentTarget.checked)}
              />
            </Group>
            <Combobox.EventsTarget>
              <SearchInput
                aria-label="Search Prompt History"
                placeholder="Search prompts…"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                onClear={() => setQuery("")}
                data-autofocus
              />
            </Combobox.EventsTarget>
            {history.isPending ? (
              <LoadingState label="Loading Prompt History" fill />
            ) : history.error ? (
              <Alert color="red">{history.error.message}</Alert>
            ) : (
              <>
                <ScrollArea.Autosize mah="min(45dvh, 400px)">
                  <Combobox.Options aria-label={title}>
                    {visible.map((entry) => (
                      <Group key={entry.text} gap={4} wrap="nowrap">
                        <Combobox.Option
                          value={entry.text}
                          py="xs"
                          px="xs"
                          flex={1}
                          miw={0}
                          aria-label={`Use Prompt: ${entry.text}`}
                        >
                          <Text size="sm" lineClamp={3}>
                            {entry.text}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {entry.pinned ? "Pinned · " : ""}
                            {entry.uses} {entry.uses === 1 ? "Use" : "Uses"}
                          </Text>
                        </Combobox.Option>
                        <Tooltip label={entry.pinned ? "Unpin Prompt" : "Pin Prompt"}>
                          <ActionIcon
                            aria-label={entry.pinned ? "Unpin Prompt" : "Pin Prompt"}
                            variant={entry.pinned ? "light" : "subtle"}
                            color={entry.pinned ? undefined : "gray"}
                            onClick={() => pin(entry.text, !entry.pinned)}
                          >
                            {entry.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Forget Prompt">
                          <ActionIcon
                            aria-label="Forget Prompt"
                            color="gray"
                            variant="subtle"
                            onClick={() => edit.mutate({ action: "forget", text: entry.text })}
                          >
                            <Trash2 size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    ))}
                    {!filtered.length && (
                      <EmptyState fill>
                        {query.trim() ? "No Matching Prompts" : "No Saved Prompts"}
                      </EmptyState>
                    )}
                  </Combobox.Options>
                </ScrollArea.Autosize>
                <PickerFooter
                  start={
                    <Button
                      variant="default"
                      disabled={!value.trim() || currentPinned}
                      onClick={() => pin(value, true)}
                    >
                      Pin Current Prompt
                    </Button>
                  }
                  end={
                    <Button
                      variant="default"
                      disabled={!history.data?.prompts.some((entry) => !entry.pinned)}
                      onClick={() => edit.mutate({ action: "clear" })}
                    >
                      Clear Recent
                    </Button>
                  }
                />
              </>
            )}
          </Stack>
        </Combobox>
      </Popover.Dropdown>
    </Popover>
  );
}
