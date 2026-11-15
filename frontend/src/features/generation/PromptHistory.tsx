import {
  ActionIcon,
  Alert,
  Button,
  Combobox,
  Group,
  ScrollArea,
  Stack,
  Switch,
  Text,
  Tooltip,
  useCombobox,
} from "@mantine/core";
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { History } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { api, post } from "../../api";
import type { Action } from "../../ui/ActionBar";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { SearchInput } from "../../ui/SearchInput";
import { ChipPopup } from "./Picker";

type PromptKind = "positive" | "negative";
interface PromptEntry {
  text: string;
  at: string;
  uses: number;
  liked?: boolean;
}
interface HistoryData {
  prompts: PromptEntry[];
  enabled: boolean;
}
type HistoryEdit =
  | { action: "like"; text: string; liked: boolean }
  | { action: "forget"; text: string }
  | { action: "clear" };

/** One account's recent prompts of a kind, and whether new ones are kept. */
const promptHistoryQuery = (kind: PromptKind) =>
  queryOptions({
    queryKey: ["prompt-history", kind],
    queryFn: () => api<HistoryData>(`/api/prompts?kind=${kind}`),
  });
const promptKey = (text: string) => text.replace(/\s+/g, " ").trim().toLocaleLowerCase();

/** The edit applied locally, as the server applies it, so likes and forgets show at once. */
function editHistory(data: HistoryData, edit: HistoryEdit): HistoryData {
  if (edit.action === "clear")
    return { ...data, prompts: data.prompts.filter((entry) => entry.liked) };
  const key = promptKey(edit.text);
  const found = data.prompts.some((entry) => promptKey(entry.text) === key);
  if (edit.action === "forget")
    return { ...data, prompts: data.prompts.filter((entry) => promptKey(entry.text) !== key) };
  if (!found)
    return edit.liked
      ? {
          ...data,
          prompts: [
            { text: edit.text.trim(), at: new Date().toISOString(), uses: 0, liked: true },
            ...data.prompts,
          ],
        }
      : data;
  return {
    ...data,
    prompts: data.prompts.map((entry) =>
      promptKey(entry.text) === key ? { ...entry, liked: edit.liked || undefined } : entry,
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

/** Keep Recent Prompts, shared by the composer's history and Settings. Off forgets unliked prompts. */
export function useKeepRecentPrompts(enabled = true) {
  const client = useQueryClient();
  const history = useQuery({ ...promptHistoryQuery("positive"), enabled });
  const change = useMutation({
    mutationFn: (on: boolean) => post("/api/prompts/enabled", { enabled: on }),
    ...optimistic<boolean>(client, ["positive", "negative"], (data, on) => ({
      enabled: on,
      prompts: on ? data.prompts : data.prompts.filter((entry) => entry.liked),
    })),
  });
  return { history, change };
}

/**
 * A prompt box's Recent Prompts: its tool, and the popup the tool opens, which the box anchors
 * where the tool stands (`TextBox` `popups`).
 */
export function usePromptHistory({
  kind,
  value,
  onPick,
}: {
  kind: PromptKind;
  value: string;
  onPick: (text: string) => void;
}): { action: Action; popup: ReactNode } {
  const [opened, setOpened] = useState(false),
    [query, setQuery] = useState("");
  const combobox = useCombobox({ opened });
  const client = useQueryClient();
  const history = useQuery({ ...promptHistoryQuery(kind), enabled: opened });
  const keep = useKeepRecentPrompts(opened);
  const edit = useMutation({
    mutationFn: (input: HistoryEdit) =>
      // Like's route keeps its earlier name.
      post<HistoryData>(`/api/prompts/${input.action === "like" ? "pin" : input.action}`, {
        ...input,
        action: undefined,
        kind,
        ...(input.action === "clear" ? { keepLiked: true } : {}),
      }),
    ...optimistic<HistoryEdit>(client, [kind], editHistory),
  });
  const like = (text: string, liked: boolean) => edit.mutate({ action: "like", text, liked });
  const title = kind === "negative" ? "Recent Negative Prompts" : "Recent Prompts";
  const filtered = (history.data?.prompts || [])
    .filter((entry) => entry.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort(
      (a, b) =>
        Number(Boolean(b.liked)) - Number(Boolean(a.liked)) || Date.parse(b.at) - Date.parse(a.at),
    );
  const visible = query.trim()
    ? filtered.slice(0, 60)
    : [
        ...filtered.filter((entry) => entry.liked),
        ...filtered.filter((entry) => !entry.liked).slice(0, 60),
      ];
  const currentLiked = history.data?.prompts.some(
    (entry) => entry.liked && promptKey(entry.text) === promptKey(value),
  );
  const optionsKey = visible.map((entry) => entry.text).join("\n");
  useEffect(() => {
    if (opened) combobox.selectFirstOption();
  }, [opened, optionsKey]);
  const action: Action = {
    id: "history",
    label: title,
    icon: History,
    onClick: () => setOpened(true),
  };
  const popup = (
    <ChipPopup
      title={title}
      position="top-end"
      width={500}
      opened={opened}
      onOpenedChange={setOpened}
      target={<span />}
      headerEnd={
        <>
          <Switch
            // Remounts once loaded so the saved state appears without the thumb sliding.
            key={keep.history.data ? "loaded" : "loading"}
            label="Save Recent Prompts"
            labelPosition="left"
            checked={keep.history.data?.enabled ?? false}
            disabled={!keep.history.data}
            onChange={(event) => keep.change.mutate(event.currentTarget.checked)}
          />
          <Button
            size="compact-sm"
            variant="subtle"
            aria-label="Clear Recent"
            disabled={!history.data?.prompts.some((entry) => !entry.liked)}
            onClick={() => edit.mutate({ action: "clear" })}
          >
            Clear
          </Button>
        </>
      }
      footer={{
        start: (
          <Button
            variant="default"
            disabled={!value.trim() || currentLiked}
            onClick={() => like(value, true)}
          >
            Like Current Prompt
          </Button>
        ),
      }}
    >
      <Combobox
        store={combobox}
        onOptionSubmit={(text) => {
          onPick(text);
          setOpened(false);
        }}
      >
        <Stack
          flex={1}
          gap="sm"
          mih={0}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
              event.preventDefault();
              if (value.trim() && !currentLiked) like(value, true);
            }
          }}
        >
          <Combobox.EventsTarget>
            <SearchInput
              aria-label="Search Prompt History"
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
                        {entry.liked ? "Liked · " : ""}
                        {entry.uses} {entry.uses === 1 ? "Use" : "Uses"}
                      </Text>
                    </Combobox.Option>
                    <Tooltip label={entry.liked ? "Unlike Prompt" : "Like Prompt"}>
                      <ActionIcon
                        aria-label={entry.liked ? "Unlike Prompt" : "Like Prompt"}
                        aria-pressed={Boolean(entry.liked)}
                        variant={entry.liked ? "light" : "subtle"}
                        color={entry.liked ? undefined : "gray"}
                        onClick={() => like(entry.text, !entry.liked)}
                      >
                        <icons.like size={16} fill={entry.liked ? "currentColor" : "none"} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Forget Prompt">
                      <ActionIcon
                        aria-label="Forget Prompt"
                        color="gray"
                        variant="subtle"
                        onClick={() => edit.mutate({ action: "forget", text: entry.text })}
                      >
                        <icons.delete size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                ))}
                {!filtered.length && (
                  <EmptyState fill>{query.trim() ? "No Matches" : "No Saved Prompts"}</EmptyState>
                )}
              </Combobox.Options>
            </ScrollArea.Autosize>
          )}
        </Stack>
      </Combobox>
    </ChipPopup>
  );
  return { action, popup };
}
