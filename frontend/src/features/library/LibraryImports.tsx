import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  FileButton,
  Group,
  Menu,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, ImageUp } from "lucide-react";
import { api, post } from "../../api";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { SectionToolbar } from "../../ui/SectionToolbar";
import { LibraryImportReview, type ImportRecord, type ImportVision } from "./LibraryImportReview";

const gradeColours: Record<string, string> = { Exact: "green", Close: "yellow", Partial: "orange" };
const stateLabels: Record<string, string> = {
  failed: "Failed",
  "needs-files": "Needs Files",
  ready: "Ready",
  resolving: "Resolving",
};
const stateLabel = (state: string) =>
  stateLabels[state] ||
  state.replace(/(^|-)([a-z])/g, (_, gap, letter) => `${gap ? " " : ""}${letter.toUpperCase()}`);
const views = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs Files" },
];

/** Library › Imports: a link or an image becomes a graded import that can be reviewed. */
export function LibraryImports({ active, admin }: { active: boolean; admin: boolean }) {
  const client = useQueryClient();
  const [url, setUrl] = useState("");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [view, setView] = useState("all");
  const [query, setQuery] = useState("");
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
  if (reviewId)
    return (
      <LibraryImportReview
        id={reviewId}
        active={active}
        vision={imports.data?.vision}
        admin={admin}
        onBack={() => setReviewId(null)}
        onOpen={setReviewId}
      />
    );
  const records = imports.data?.imports || [];
  const nameOf = (record: ImportRecord) =>
    record.title || record.name || record.image?.name || record.input?.url || record.id;
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = records.filter((record) => {
    if (view === "attention" && record.state !== "needs-files") return false;
    const text = [nameOf(record), record.grade?.value, ...(record.grade?.reasons || [])]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const failed = importing.error || uploading.error;
  return (
    <Stack gap="md">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          importing.mutate();
        }}
      >
        <Group gap="xs" wrap="nowrap" align="start">
          <TextInput
            aria-label="Civitai or Hugging Face URL"
            placeholder="Civitai or Hugging Face link…"
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
          <FileButton
            onChange={(file) => file && uploading.mutate(file)}
            accept="image/png,image/jpeg,image/webp"
          >
            {(props) => (
              <Tooltip label="Upload Image">
                <ActionIcon
                  {...props}
                  size={42}
                  variant="default"
                  aria-label="Upload Image"
                  loading={uploading.isPending}
                >
                  <ImageUp size={18} />
                </ActionIcon>
              </Tooltip>
            )}
          </FileButton>
        </Group>
      </form>
      {failed && <Alert color="red">{failed.message}</Alert>}
      {records.length > 0 && (
        <SectionToolbar
          label="Imports"
          views={views}
          view={view}
          onViewChange={setView}
          query={query}
          onQueryChange={setQuery}
        />
      )}
      {imports.isPending ? (
        <LoadingState label="Loading Imports" />
      ) : imports.error ? (
        <Alert color="red">{imports.error.message}</Alert>
      ) : !rows.length ? (
        <EmptyState title={records.length ? "No Matching Imports" : "No Imports"}>
          {records.length
            ? "Try another search or view."
            : "Your imports and compatibility grades will appear here."}
        </EmptyState>
      ) : (
        <Table aria-label="Library Imports" verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Import</Table.Th>
              <Table.Th>Grade</Table.Th>
              <Table.Th w={44}>
                <VisuallyHidden>Actions</VisuallyHidden>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((record) => (
              <Table.Tr key={record.id}>
                <Table.Td maw={0} w="100%">
                  <Text size="sm" fw={500} truncate>
                    {nameOf(record)}
                  </Text>
                  {record.grade?.reasons.map((reason) => (
                    <Text size="xs" c="dimmed" key={reason}>
                      {reason}
                    </Text>
                  ))}
                </Table.Td>
                <Table.Td>
                  <Stack gap={4} align="start">
                    {record.grade && (
                      <Badge
                        miw="max-content"
                        variant="light"
                        size="sm"
                        color={gradeColours[record.grade.value] || "gray"}
                      >
                        {record.grade.value}
                      </Badge>
                    )}
                    <Text size="xs" c={record.state === "failed" ? "red" : "dimmed"}>
                      {stateLabel(record.state)}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Menu position="bottom-end">
                    <Menu.Target>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label={`Actions for ${nameOf(record)}`}
                      >
                        <Ellipsis size={18} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => setReviewId(record.id)}>Review Import</Menu.Item>
                      {record.state === "needs-files" && (
                        <Menu.Item
                          disabled={download.isPending}
                          onClick={() => download.mutate(record.id)}
                        >
                          Download Missing
                        </Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
