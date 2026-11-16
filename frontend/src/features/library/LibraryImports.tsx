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
import { type ReactNode, useState } from "react";

import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { SectionHeader, SectionToolbar } from "../../ui/SectionToolbar";
import { useFlash } from "../../ui/useFlash";
import { inspirationQuery } from "../generation/inspiration";
import {
  type ImportRecord,
  LibraryImportReview,
  gradeColours,
  importBusy,
  stateLabel,
} from "./LibraryImportReview";
import { catalogueQuery, importsQuery } from "./queries";

/** Sorts the best grade first and unknown grades after the known ones. */
function gradeRank(grade: string) {
  const rank = Object.keys(gradeColours).indexOf(grade);
  return rank < 0 ? Infinity : rank;
}
const views = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs Files" },
];

/** Shared model and recipe imports, curated by administrators. */
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
  const [deleting, setDeleting] = useState<ImportRecord | null>(null);
  const [cleared, flashCleared] = useFlash<number>();
  const imports = useQuery({
    ...importsQuery,
    enabled: active,
    refetchInterval: (query) =>
      active && query.state.data?.imports.some(importBusy) ? 4000 : false,
  });
  const refresh = () => {
    for (const queryKey of [
      importsQuery.queryKey,
      inspirationQuery.queryKey,
      catalogueQuery.queryKey,
    ])
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
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });
  const records = imports.data?.imports || [];
  const nameOf = (record: ImportRecord) =>
    record.title || record.name || record.image?.name || record.input?.url || record.id;
  const rows =
    view === "attention" ? records.filter((record) => record.state === "needs-files") : records;
  const failed = importing.error || uploading.error;
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
                  <Tooltip label="Import Recipe Image">
                    <ActionIcon
                      {...props}
                      variant="subtle"
                      color="gray"
                      aria-label="Import Recipe Image"
                      loading={uploading.isPending}
                    >
                      <icons.upload size={18} />
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
          importing.mutate();
        }}
      >
        <Group gap="xs" wrap="nowrap" align="start">
          <TextInput
            aria-label="Civitai or Hugging Face Link"
            placeholder="Civitai or Hugging Face link"
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
            required
            type="url"
            flex={1}
            miw={0}
          />
          <Button type="submit" loading={importing.isPending}>
            Import
          </Button>
        </Group>
      </form>
      {failed && <Alert color="red">{failed.message}</Alert>}
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
                      {stateLabel(record.grade.value)}
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
              <Menu.Item
                leftSection={<icons.details size={16} />}
                onClick={() => setReviewId(record.id)}
              >
                Review Import
              </Menu.Item>
              {record.state === "needs-files" && (
                <Menu.Item
                  leftSection={<icons.download size={16} />}
                  disabled={download.isPending}
                  onClick={() => download.mutate(record.id)}
                >
                  Download Missing
                </Menu.Item>
              )}
              <Menu.Divider />
              <Menu.Item
                color="red"
                leftSection={<icons.delete size={16} />}
                onClick={() => setDeleting(record)}
              >
                Delete Import
              </Menu.Item>
            </>
          )}
        />
      )}
      {reviewId && (
        <LibraryImportReview
          id={reviewId}
          active={active}
          vision={imports.data?.vision}
          admin={admin}
          onClose={() => setReviewId(null)}
          onOpen={setReviewId}
        />
      )}
      <ConfirmDialog
        opened={confirming}
        title="Clear Failed Imports"
        action="Clear Failed"
        pending={clearFailed.isPending}
        onConfirm={() => clearFailed.mutate()}
        onClose={() => setConfirming(false)}
      >
        Failed imports leave Library › Imports. Downloaded files stay.
      </ConfirmDialog>
      <ConfirmDialog
        opened={Boolean(deleting)}
        title="Delete Import"
        action="Delete"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      >
        Delete {deleting ? `"${nameOf(deleting)}"` : "this import"} from Library › Imports?
        Downloaded files stay.
      </ConfirmDialog>
    </Stack>
  );
}
