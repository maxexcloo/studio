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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { useAccount, useIsAdmin } from "../auth/AccountGate";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { SearchInput } from "../../ui/SearchInput";

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
type HistoryAction =
  | { action: "pin"; text: string; pinned: boolean }
  | { action: "forget"; text: string }
  | { action: "clear" }
  | { action: "enabled"; enabled: boolean };

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
  const key = ["prompt-history", kind];
  const history = useQuery({
    queryKey: key,
    queryFn: () => api<HistoryData>(`/api/prompts?kind=${kind}`),
    enabled: allowed && opened,
  });
  const action = useMutation({
    meta: { inlineError: true },
    mutationFn: (input: HistoryAction) =>
      post<HistoryData>(`/api/prompts/${input.action}`, {
        ...input,
        action: undefined,
        kind,
        ...(input.action === "clear" ? { keepPinned: true } : {}),
      }),
    onSuccess: (data, input) => {
      if (input.action === "enabled")
        void client.invalidateQueries({ queryKey: ["prompt-history"] });
      else
        client.setQueryData<HistoryData>(key, (previous) => ({
          prompts: data.prompts,
          enabled: previous?.enabled ?? true,
        }));
    },
  });
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
    (entry) =>
      entry.pinned && entry.text.trim().toLocaleLowerCase() === value.trim().toLocaleLowerCase(),
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
              onClick={() => {
                action.reset();
                setOpened((previous) => !previous);
              }}
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
            if (value.trim() && !currentPinned && !action.isPending)
              action.mutate({ action: "pin", text: value, pinned: true });
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
            <Group justify="space-between">
              <Text size="sm" fw={500}>
                {title}
              </Text>
              <Switch
                // Remounts once loaded so the saved state appears without the thumb sliding.
                key={history.data ? "loaded" : "loading"}
                label="Save Recent Prompts"
                description="Off forgets recent prompts; pinned prompts stay."
                size="xs"
                checked={history.data?.enabled ?? false}
                disabled={history.isPending || action.isPending}
                onChange={(event) =>
                  action.mutate({ action: "enabled", enabled: event.currentTarget.checked })
                }
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
            {action.error && <Alert color="red">{action.error.message}</Alert>}
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
                            disabled={action.isPending}
                            onClick={() =>
                              action.mutate({
                                action: "pin",
                                text: entry.text,
                                pinned: !entry.pinned,
                              })
                            }
                          >
                            {entry.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Forget Prompt">
                          <ActionIcon
                            aria-label="Forget Prompt"
                            color="gray"
                            variant="subtle"
                            disabled={action.isPending}
                            onClick={() => action.mutate({ action: "forget", text: entry.text })}
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
                <Group justify="space-between">
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    disabled={!value.trim() || currentPinned || action.isPending}
                    onClick={() => action.mutate({ action: "pin", text: value, pinned: true })}
                  >
                    Pin Current Prompt
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    disabled={
                      !history.data?.prompts.some((entry) => !entry.pinned) || action.isPending
                    }
                    onClick={() => action.mutate({ action: "clear" })}
                  >
                    Clear Recent
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Combobox>
      </Popover.Dropdown>
    </Popover>
  );
}
