import { useState, type ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  FileButton,
  Group,
  Menu,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageUp } from "lucide-react";
import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { SectionHeader, SectionToolbar } from "../../ui/SectionToolbar";
import { useFlash } from "../../ui/useFlash";
import { LibraryImportReview, type ImportRecord, type ImportVision } from "./LibraryImportReview";

const gradeColours: Record<string, string> = { Exact: "green", Close: "yellow", Partial: "orange" };
/** Sorts the best grade first and unknown grades after the known ones. */
function gradeRank(grade: string) {
  const rank = Object.keys(gradeColours).indexOf(grade);
  return rank < 0 ? Infinity : rank;
}
const stateLabels: Record<string, string> = {
  failed: "Failed",
  "needs-files": "Needs Files",
  ready: "Ready",
  resolving: "Resolving",
};
interface RedditImport {
  title: string;
  imported: number;
  failed: { image: number; error: string }[];
}
const isRedditLink = (url: string) => {
  try {
    return /(^|\.)(reddit\.com|redd\.it|reddit\.excloo\.com)$/.test(new URL(url.trim()).hostname);
  } catch {
    return false;
  }
};
const stateLabel = (state: string) =>
  stateLabels[state] ||
  state.replace(/(^|-)([a-z])/g, (_, gap, letter) => `${gap ? " " : ""}${letter.toUpperCase()}`);
const views = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs Files" },
];

/** Library › Imports: a link or an image becomes a graded import that can be reviewed. */
export function LibraryImports({
  heading,
  active,
  admin,
}: {
  heading: ReactNode;
  active: boolean;
  admin: boolean;
}) {
  const client = useQueryClient();
  const [url, setUrl] = useState("");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [view, setView] = useState("all");
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [cleared, flashCleared] = useFlash<number>();
  const imports = useQuery({
    queryKey: ["imports"],
    queryFn: () => api<{ imports: ImportRecord[]; vision?: ImportVision }>("/api/library/imports"),
    enabled: active,
    refetchInterval: active ? 4000 : false,
  });
  const refresh = () => {
    for (const queryKey of [["imports"], ["presets"], ["library"]])
      void client.invalidateQueries({ queryKey });
  };
  const opened = (result: { import: ImportRecord }) => {
    setReviewId(result.import.id);
    refresh();
  };
  const importing = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post<{ import: ImportRecord }>("/api/library/imports", { url }),
    onSuccess: (result) => {
      setUrl("");
      opened(result);
    },
  });
  // A Reddit post's images become the account's uploads (backend/gallery/reddit.js), not an import.
  const reddit = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post<RedditImport>("/api/gallery/import/reddit", { url: url.trim() }),
    onSuccess: () => {
      setUrl("");
      void client.invalidateQueries({ queryKey: ["gallery"] });
      void client.invalidateQueries({ queryKey: ["reference-gallery"] });
    },
  });
  const redditLink = isRedditLink(url);
  const uploading = useMutation({
    meta: { inlineError: true },
    mutationFn: async (file: File) => {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      return post<{ import: ImportRecord }>("/api/library/imports/image", {
        name: file.name,
        image,
      });
    },
    onSuccess: opened,
  });
  const download = useMutation({
    mutationFn: (id: string) => post(`/api/library/imports/${id}/download`),
    onSuccess: refresh,
  });
  const clearFailed = useMutation({
    mutationFn: () => post<{ cleared: number }>("/api/library/imports/clear-failed"),
    onSuccess: (result) => {
      setConfirming(false);
      flashCleared(result.cleared);
      refresh();
    },
  });
  // Downloaded files stay; only the record goes.
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/api/library/imports/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  if (reviewId)
    return (
      <Stack gap="md">
        {heading}
        <LibraryImportReview
          id={reviewId}
          active={active}
          vision={imports.data?.vision}
          admin={admin}
          onBack={() => setReviewId(null)}
          onOpen={setReviewId}
        />
      </Stack>
    );
  const records = imports.data?.imports || [];
  const nameOf = (record: ImportRecord) =>
    record.title || record.name || record.image?.name || record.input?.url || record.id;
  const rows =
    view === "attention" ? records.filter((record) => record.state === "needs-files") : records;
  const failed = importing.error || uploading.error || reddit.error;
  const added = reddit.data;
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Imports"
          views={records.length ? views : undefined}
          view={view}
          onViewChange={setView}
          query={query}
          onQueryChange={records.length ? setQuery : undefined}
          actions={
            <>
              {records.some((record) => record.state === "failed") && (
                <Tooltip label="Clear Failed">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label="Clear Failed"
                    onClick={() => setConfirming(true)}
                  >
                    <icons.clear size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              <FileButton
                onChange={(file) => file && uploading.mutate(file)}
                accept="image/png,image/jpeg,image/webp"
              >
                {(props) => (
                  <Tooltip label="Upload Image">
                    <ActionIcon
                      {...props}
                      variant="subtle"
                      color="gray"
                      aria-label="Upload Image"
                      loading={uploading.isPending}
                    >
                      <ImageUp size={18} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </FileButton>
            </>
          }
        />
      </SectionHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          reddit.reset();
          if (redditLink) reddit.mutate();
          else importing.mutate();
        }}
      >
        <Group gap="xs" wrap="nowrap" align="start">
          <TextInput
            aria-label="Civitai, Hugging Face or Reddit URL"
            placeholder="Civitai, Hugging Face or Reddit link"
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
            required
            type="url"
            flex={1}
            miw={0}
          />
          <Button type="submit" loading={importing.isPending || reddit.isPending}>
            Import
          </Button>
        </Group>
      </form>
      {failed && <Alert color="red">{failed.message}</Alert>}
      {added && (
        <Text size="sm" c={added.failed.length ? "red" : "dimmed"}>
          {added.imported} {added.imported === 1 ? "image" : "images"} added to Uploads
          {added.failed.length > 0 &&
            `; ${added.failed.length} couldn’t be saved: ${added.failed.map((entry) => entry.error).join(" ")}`}
          .
        </Text>
      )}
      {cleared !== undefined && (
        <Text c="dimmed" size="xs">
          {cleared} cleared
        </Text>
      )}
      {imports.error ? (
        <Alert color="red">{imports.error.message}</Alert>
      ) : (
        <DataTable
          label="Library Imports"
          rows={rows}
          rowKey={(record) => record.id}
          rowName={nameOf}
          loading={imports.isPending && "Loading Imports"}
          query={query}
          searchText={(record) => [
            nameOf(record),
            record.grade?.value,
            ...(record.grade?.reasons || []),
          ]}
          empty={records.length ? "No Matches" : "No Imports"}
          columns={[
            {
              key: "import",
              header: "Import",
              main: true,
              sortValue: nameOf,
              cell: (record) => (
                <>
                  <Text size="sm" fw={500} truncate>
                    {nameOf(record)}
                  </Text>
                  {record.grade?.reasons.map((reason) => (
                    <Text size="xs" c="dimmed" key={reason}>
                      {reason}
                    </Text>
                  ))}
                </>
              ),
            },
            {
              key: "grade",
              header: "Grade",
              sortValue: (record) => record.grade && gradeRank(record.grade.value),
              cell: (record) => (
                <Stack gap={4} align="start">
                  {record.grade && (
                    <Badge miw="max-content" color={gradeColours[record.grade.value] || "gray"}>
                      {record.grade.value}
                    </Badge>
                  )}
                  <Text size="xs" c={record.state === "failed" ? "red" : "dimmed"}>
                    {stateLabel(record.state)}
                  </Text>
                </Stack>
              ),
            },
          ]}
          rowActions={(record) => (
            <>
              <Menu.Item onClick={() => setReviewId(record.id)}>Review Import</Menu.Item>
              {record.state === "needs-files" && (
                <Menu.Item disabled={download.isPending} onClick={() => download.mutate(record.id)}>
                  Download Missing
                </Menu.Item>
              )}
              <Menu.Item
                color="red"
                disabled={remove.isPending}
                onClick={() => remove.mutate(record.id)}
              >
                Remove
              </Menu.Item>
            </>
          )}
        />
      )}
      <ConfirmDialog
        opened={confirming}
        title="Clear Failed Imports?"
        action="Clear Failed"
        pending={clearFailed.isPending}
        onConfirm={() => clearFailed.mutate()}
        onClose={() => setConfirming(false)}
      >
        Failed imports leave Library › Imports. Downloaded files stay.
      </ConfirmDialog>
    </Stack>
  );
}
