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
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { plural } from "../../ui/plural";
import { SectionHeader, SectionToolbar } from "../../ui/SectionToolbar";
import { SettingGroup } from "../../ui/SettingRows";
import { useFlash } from "../../ui/useFlash";
import { inspirationQuery } from "../generation/inspiration";
import {
  type ImportRecord,
  LibraryImportReview,
  gradeColours,
  importBusy,
  stateLabel,
} from "./LibraryImportReview";
import { catalogueQuery, downloadsQuery, importsQuery } from "./queries";

type Resource = NonNullable<ImportRecord["resources"]>[number];

/** The audit's groups, attention first. */
const groups: { audit: ImportRecord["audit"]; title: string }[] = [
  { audit: "needs-files", title: "Needs Files" },
  { audit: "substitute", title: "Substitutes" },
  { audit: "failed", title: "Failed" },
  { audit: "busy", title: "In Progress" },
  { audit: "ready", title: "Ready" },
];

/** Sorts the best grade first and unknown grades after the known ones. */
function gradeRank(grade: string) {
  const rank = Object.keys(gradeColours).indexOf(grade);
  return rank < 0 ? Infinity : rank;
}
const fileName = (resource: Resource) => resource.want?.file || resource.name;
const nameOf = (record: ImportRecord) =>
  record.title || record.name || record.input?.fileName || record.input?.url || record.id;
const required = (record: ImportRecord) =>
  (record.resources || []).filter((resource) => !resource.optional);
/** What an import lacks: each required file it has no copy or stand-in for, and why. */
const lacking = (record: ImportRecord) =>
  required(record)
    .filter((resource) => !["installed", "substitute", "downloading"].includes(resource.status))
    .map(
      (resource) =>
        `${fileName(resource)}: ${
          resource.downloadError ||
          resource.unavailable?.note ||
          resource.unavailable?.reason ||
          (resource.downloadable ? "Not downloaded yet" : stateLabel(resource.status))
        }`,
    );
const downloadable = (record: ImportRecord) =>
  required(record).some((resource) => resource.downloadable);

/** One stand-in, beside the file it stands in for. */
interface SubstituteRow {
  record: ImportRecord;
  resource: Resource;
  index: number;
}

/**
 * Library › Imports: shared model and recipe imports grouped by what they need, with Download
 * Missing, substitutes to accept or reject and Clear Stale; Library › Downloads follows the files.
 */
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
      downloadsQuery.queryKey,
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
    mutationFn: (id?: string) =>
      post<{ queued: number; failures?: string[] }>(
        id
          ? `/api/library/imports/${encodeURIComponent(id)}/download`
          : "/api/library/imports/download-missing",
      ),
    onSuccess: (result) => {
      refresh();
      if (result.failures?.length)
        notifications.show({
          color: "yellow",
          title: "Download Needs Attention",
          message: result.failures.join(" "),
        });
    },
  });
  const substitute = useMutation({
    mutationFn: ({ row, accept }: { row: SubstituteRow; accept: boolean }) =>
      post(`/api/library/imports/${encodeURIComponent(row.record.id)}/substitute`, {
        index: row.index,
        accept,
      }),
    onSuccess: refresh,
  });
  const clearStale = useMutation({
    mutationFn: () => post<{ cleared: number }>("/api/library/imports/clear-stale"),
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
  const stale = records.filter((record) => record.stale).length;
  const failed = importing.error || uploading.error;
  const substitutes = records
    .filter((record) => record.audit === "substitute")
    .flatMap((record) =>
      (record.resources || []).flatMap((resource, index) =>
        resource.status === "substitute" && !resource.optional && !resource.accepted
          ? [{ record, resource, index }]
          : [],
      ),
    );
  const importActions = (record: ImportRecord) => (
    <>
      <Menu.Item leftSection={<icons.details size={16} />} onClick={() => setReviewId(record.id)}>
        Review
      </Menu.Item>
      {downloadable(record) && (
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
        Delete
      </Menu.Item>
    </>
  );
  const importTable = (title: string, rows: ImportRecord[]) => (
    <DataTable
      label={`${title} Imports`}
      rows={rows}
      rowKey={(record) => record.id}
      rowName={nameOf}
      query={query}
      searchText={(record) => [
        nameOf(record),
        record.grade?.value,
        ...(record.grade?.reasons || []),
        ...lacking(record),
      ]}
      empty="No Matches"
      compact
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
              {(record.audit === "failed" && record.error
                ? [record.error]
                : record.audit === "needs-files"
                  ? lacking(record)
                  : record.grade?.reasons || []
              ).map((line) => (
                <Text size="xs" c={record.audit === "failed" ? "red" : "dimmed"} key={line}>
                  {line}
                </Text>
              ))}
            </>
          ),
        },
        {
          key: "grade",
          header: "Grade",
          sortValue: (record) => record.grade && gradeRank(record.grade.value),
          cell: (record) =>
            record.grade && (
              <Badge miw="max-content" color={gradeColours[record.grade.value] || "gray"}>
                {stateLabel(record.grade.value)}
              </Badge>
            ),
        },
      ]}
      rowActions={importActions}
    />
  );
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Imports"
          query={query}
          onQueryChange={records.length ? setQuery : undefined}
          actions={
            <>
              {stale > 0 && (
                <Tooltip label="Clear Stale">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label="Clear Stale"
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
      ) : imports.isPending ? (
        <LoadingState label="Loading Imports" />
      ) : !records.length ? (
        <EmptyState fill>No Imports</EmptyState>
      ) : (
        groups.map(({ audit, title }) => {
          const rows = records.filter((record) => record.audit === audit);
          if (!rows.length) return null;
          if (audit === "substitute")
            return (
              <SettingGroup key={audit} title={`${title} · ${substitutes.length}`}>
                <DataTable
                  label="Substitutes"
                  rows={substitutes}
                  rowKey={(row) => `${row.record.id}:${row.index}`}
                  rowName={(row) => `${nameOf(row.record)}: ${fileName(row.resource)}`}
                  query={query}
                  searchText={(row) => [
                    nameOf(row.record),
                    fileName(row.resource),
                    row.resource.substitute?.file,
                  ]}
                  empty="No Matches"
                  compact
                  columns={[
                    {
                      key: "original",
                      header: "Original",
                      main: true,
                      sortValue: (row) => fileName(row.resource),
                      cell: (row) => (
                        <>
                          <Text size="sm" fw={500} truncate>
                            {fileName(row.resource)}
                          </Text>
                          <Text size="xs" c="dimmed" truncate>
                            {nameOf(row.record)}
                          </Text>
                        </>
                      ),
                    },
                    {
                      key: "substitute",
                      header: "Substitute",
                      sortValue: (row) => row.resource.substitute?.file,
                      cell: (row) => (
                        <>
                          <Text size="sm" truncate>
                            {row.resource.substitute?.file}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {row.resource.substitute?.reason}
                          </Text>
                        </>
                      ),
                    },
                  ]}
                  rowActions={(row) => (
                    <>
                      <Menu.Item
                        leftSection={<Check size={16} />}
                        disabled={substitute.isPending}
                        onClick={() => substitute.mutate({ row, accept: true })}
                      >
                        Accept
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<X size={16} />}
                        disabled={substitute.isPending}
                        onClick={() => substitute.mutate({ row, accept: false })}
                      >
                        Reject
                      </Menu.Item>
                      <Menu.Divider />
                      <Menu.Item
                        leftSection={<icons.details size={16} />}
                        onClick={() => setReviewId(row.record.id)}
                      >
                        Review
                      </Menu.Item>
                    </>
                  )}
                />
              </SettingGroup>
            );
          return (
            <SettingGroup
              key={audit}
              title={`${title} · ${rows.length}`}
              toolbar={
                audit === "needs-files" &&
                rows.some(downloadable) && (
                  <Button
                    size="compact-sm"
                    variant="default"
                    leftSection={<icons.download size={16} />}
                    loading={download.isPending && !download.variables}
                    disabled={download.isPending}
                    onClick={() => download.mutate(undefined)}
                  >
                    Download All Missing
                  </Button>
                )
              }
            >
              {importTable(title, rows)}
            </SettingGroup>
          );
        })
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
        title="Clear Stale Imports"
        action="Clear Stale"
        pending={clearStale.isPending}
        onConfirm={() => clearStale.mutate()}
        onClose={() => setConfirming(false)}
      >
        {plural(stale, "import")} that failed or wait on files no provider gives leave Library ›
        Imports. Downloaded files stay.
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
