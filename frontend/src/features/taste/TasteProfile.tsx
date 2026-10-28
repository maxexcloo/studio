import { useState } from "react";
import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { TextBox } from "../../ui/TextBox";
import { SettingGroup } from "../settings/SettingRows";

export interface Taste {
  summary: string;
  source: "studio" | "user";
  updatedAt: string;
  /** How many signals (stars, comparisons, iterations) the profile holds. */
  signals: number;
  /** Whether the text model may write this account's profile. */
  writer: boolean;
}
const tasteQuery = queryOptions({
  queryKey: ["taste"],
  queryFn: () => api<Taste>("/api/taste"),
});

const learnt = (taste: Taste) =>
  [
    taste.signals &&
      `Learnt from ${taste.signals} ${taste.signals === 1 ? "star, comparison or iteration" : "stars, comparisons and iterations"}`,
    taste.updatedAt &&
      `Updated ${new Date(taste.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`,
  ]
    .filter(Boolean)
    .join(" · ");

/** Settings › Account: the summary Studio keeps of what this account likes, editable by its owner. */
export function TasteProfile() {
  const client = useQueryClient();
  const taste = useQuery(tasteQuery);
  const [draft, setDraft] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const saved = (next: Taste) => {
    client.setQueryData(tasteQuery.queryKey, next);
    setDraft(null);
  };
  const save = useMutation({
    meta: { inlineError: true },
    mutationFn: (summary: string) =>
      api<Taste>("/api/taste", { method: "PUT", body: JSON.stringify({ summary }) }),
    onSuccess: saved,
  });
  const refresh = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post<Taste>("/api/taste/refresh"),
    onSuccess: saved,
  });
  const clear = useMutation({
    meta: { inlineError: true },
    mutationFn: () => api<Taste>("/api/taste", { method: "DELETE" }),
    onSuccess: (next) => {
      saved(next);
      setClearing(false);
    },
  });
  const data = taste.data;
  const value = draft ?? data?.summary ?? "";
  const changed = !!data && draft !== null && draft.trim() !== data.summary;
  const error = save.error || refresh.error || taste.error;
  return (
    <SettingGroup title="Taste Profile">
      <Stack gap="xs" pt="xs">
        {/* The autosized minimum reserves the field's height while the profile loads. */}
        <TextBox
          aria-label="Taste Profile"
          autosize
          minRows={4}
          maxLength={1000}
          disabled={!data || refresh.isPending}
          placeholder="Studio learns what you like from your stars, comparisons and iterations. You can also describe your taste here."
          value={value}
          onChange={setDraft}
        />
        <Text size="xs" c="dimmed" mih="1lh">
          {data &&
            (learnt(data) ||
              "Nothing learnt yet. Star, compare or iterate on results and Studio picks up your taste.")}
        </Text>
        {error && <Alert color="red">{error.message}</Alert>}
        <Group gap="xs">
          {changed && (
            <Button
              loading={save.isPending}
              onClick={() => {
                refresh.reset();
                save.mutate(value);
              }}
            >
              Save
            </Button>
          )}
          {data?.writer && (
            <Button
              variant="default"
              loading={refresh.isPending}
              disabled={changed || (!data.summary && !data.signals)}
              onClick={() => {
                save.reset();
                refresh.mutate();
              }}
            >
              Refresh
            </Button>
          )}
          <Button
            variant="subtle"
            color="red"
            disabled={!data?.summary && !data?.signals}
            onClick={() => setClearing(true)}
          >
            Clear
          </Button>
        </Group>
      </Stack>
      <ConfirmDialog
        opened={clearing}
        title="Clear Taste Profile"
        action="Clear"
        pending={clear.isPending}
        error={clear.error?.message}
        onConfirm={() => clear.mutate()}
        onClose={() => {
          setClearing(false);
          clear.reset();
        }}
      >
        Studio forgets this summary and everything it learnt from your stars, comparisons and
        iterations. Your gallery and stars stay as they are.
      </ConfirmDialog>
    </SettingGroup>
  );
}
