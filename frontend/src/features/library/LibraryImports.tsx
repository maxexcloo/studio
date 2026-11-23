import {
  Alert,
  Badge,
  Button,
  FileButton,
  Menu,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { api, post } from "../../api";
import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable, TableRecord, filterTableRows } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { plural } from "../../ui/plural";
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
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

const wantedFile = (resource: Resource) => `${resource.want?.folder || ""}/${fileName(resource)}`;
const substituteKey = ({ record, resource }: SubstituteRow) =>
  JSON.stringify([record.id, wantedFile(resource), resource.substitute?.file]);
const substituteSearch = ({ record, resource }: SubstituteRow) => [
  nameOf(record),
  fileName(resource),
  resource.substitute?.file,
];
const chooseSubstitute = (row: SubstituteRow, accept: boolean, bulk = false) =>
  post<{ import: ImportRecord }>(
    `/api/library/imports/${encodeURIComponent(row.record.id)}/substitute`,
    {
      index: row.index,
      accept,
      ...(bulk && {
        expected: { file: wantedFile(row.resource), substitute: row.resource.substitute?.file },
      }),
    },
  );

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
  const [adding, setAdding] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
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
    setAdding(false);
    setUrl("");
    setReviewId(result.import.id);
    refresh();
  };
  const importing = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post<{ import: ImportRecord }>("/api/library/imports", { url }),
    onSuccess: opened,
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
        notifications.show({ color: "yellow", message: result.failures.join(" ") });
    },
  });
  const substitute = useMutation({
    mutationFn: ({ row, accept }: { row: SubstituteRow; accept: boolean }) =>
      chooseSubstitute(row, accept),
    onSuccess: (_result, { row }) => {
      selectSubstitutes([substituteKey(row)], false);
      refresh();
    },
  });
  const accept = useMutation({
    mutationFn: async (rows: SubstituteRow[]) => {
      const failed = new Map<string, string>();
      // Each decision saves the whole import. Finish one before writing the next.
      for (const row of rows) {
        try {
          await chooseSubstitute(row, true, true);
        } catch (error) {
          failed.set(substituteKey(row), error instanceof Error ? error.message : String(error));
        }
      }
      return failed;
    },
    onSuccess: (failed) => {
      setSelected(new Set(failed.keys()));
      refresh();
      if (failed.size)
        notifications.show({
          color: "red",
          message: `Couldn't accept substitutes: ${[...new Set(failed.values())].join(" ")}`,
        });
    },
  });
  const deciding = substitute.isPending || accept.isPending;
  function selectSubstitutes(keys: string[], checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }
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
  const offered = records
    .filter((record) => record.audit === "substitute")
    .flatMap((record) =>
      (record.resources || []).flatMap((resource, index) =>
        resource.status === "substitute" && !resource.optional && !resource.accepted
          ? [{ record, resource, index }]
          : [],
      ),
    );
  const substitutes = [...new Map(offered.map((row) => [substituteKey(row), row])).values()];
  const visibleSubstitutes = filterTableRows(substitutes, query, substituteSearch);
  const selectedSubstitutes = visibleSubstitutes.filter((row) => selected.has(substituteKey(row)));
  const review = (record: ImportRecord) => setReviewId(record.id);
  const importActions = (record: ImportRecord) => (
    <>
      <Menu.Item leftSection={<icons.details size={16} />} onClick={() => review(record)}>
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
      initialSort={{ key: "name", descending: false }}
      empty="No Matches"
      compact
      columns={[
        {
          key: "name",
          header: "Name",
          main: true,
          sortValue: nameOf,
          cell: (record) => (
            <>
              <TableRecord
                name={nameOf(record)}
                openLabel={`Review ${nameOf(record)}`}
                onOpen={() => review(record)}
              />
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
                <ToolbarAction
                  label="Clear Stale"
                  icon={icons.clear}
                  variant="subtle"
                  color="gray"
                  onClick={() => setConfirming(true)}
                />
              )}
              <ToolbarAction
                label="Import"
                icon={icons.import}
                onClick={() => {
                  importing.reset();
                  uploading.reset();
                  setAdding(true);
                }}
              />
            </>
          }
        />
      </SectionHeader>
      <Modal opened={adding} onClose={() => setAdding(false)} title="Import">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            importing.mutate();
          }}
        >
          <Stack>
            <TextInput
              label="Link"
              description="A Civitai or Hugging Face model or file, or upload a recipe image instead."
              placeholder="https://civitai.com/models/…"
              data-autofocus
              value={url}
              onChange={(event) => setUrl(event.currentTarget.value)}
              type="url"
            />
            {failed && <Alert color="red">{failed.message}</Alert>}
            <DialogFooter
              pending={importing.isPending || uploading.isPending}
              onCancel={() => setAdding(false)}
              leading={
                <FileButton
                  onChange={(file) => file && uploading.mutate(file)}
                  accept="image/png,image/jpeg,image/webp"
                >
                  {(props) => (
                    <Button
                      {...props}
                      variant="default"
                      loading={uploading.isPending}
                      disabled={importing.isPending}
                    >
                      Upload Image
                    </Button>
                  )}
                </FileButton>
              }
            >
              <Button
                type="submit"
                loading={importing.isPending}
                disabled={!url.trim() || uploading.isPending}
              >
                Import
              </Button>
            </DialogFooter>
          </Stack>
        </form>
      </Modal>
      {cleared !== undefined && (
        <Text c="dimmed" size="xs">
          {cleared} cleared
        </Text>
      )}
      {imports.error ? (
        <Alert color="red">{imports.error.message}</Alert>
      ) : !records.length ? (
        <DataTable
          label="Imports"
          rows={records}
          rowKey={(record) => record.id}
          rowName={nameOf}
          loading={imports.isPending && "Loading Imports"}
          empty="No Imports"
          columns={[]}
        />
      ) : (
        groups.map(({ audit, title }) => {
          const rows = records.filter((record) => record.audit === audit);
          if (!rows.length) return null;
          if (audit === "substitute")
            return (
              <SettingGroup
                key={audit}
                title={`${title} · ${substitutes.length}`}
                toolbar={
                  <Button
                    size="compact-sm"
                    variant="default"
                    loading={accept.isPending}
                    disabled={deciding || !selectedSubstitutes.length}
                    onClick={() => accept.mutate(selectedSubstitutes)}
                  >
                    Accept Selected
                  </Button>
                }
              >
                <DataTable
                  label="Substitutes"
                  rows={visibleSubstitutes}
                  rowKey={substituteKey}
                  rowName={(row) => `${nameOf(row.record)}: ${fileName(row.resource)}`}
                  selection={{ selected, onChange: selectSubstitutes, disabled: deciding }}
                  empty="No Matches"
                  compact
                  columns={[
                    {
                      key: "original",
                      header: "Original",
                      main: true,
                      sortValue: (row) => fileName(row.resource),
                      cell: (row) => (
                        <TableRecord name={fileName(row.resource)} detail={nameOf(row.record)} />
                      ),
                    },
                    {
                      key: "substitute",
                      header: "Substitute",
                      sortValue: (row) => row.resource.substitute?.file,
                      cell: (row) => (
                        <>
                          <Text size="sm">{row.resource.substitute?.file}</Text>
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
                        leftSection={<icons.accept size={16} />}
                        disabled={deciding}
                        onClick={() => substitute.mutate({ row, accept: true })}
                      >
                        Accept
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<icons.reject size={16} />}
                        disabled={deciding}
                        onClick={() => substitute.mutate({ row, accept: false })}
                      >
                        Reject
                      </Menu.Item>
                      <Menu.Divider />
                      <Menu.Item
                        leftSection={<icons.details size={16} />}
                        disabled={deciding}
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
