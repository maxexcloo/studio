import { librarySections, useLibraryNavigation } from "./LibraryNavigation";
import { CatalogueEditor } from "./CatalogueEditor";
import { LibraryDefinitions } from "./LibraryDefinitions";
import { LibraryDownloads } from "./LibraryDownloads";
import { notifications } from "@mantine/notifications";
import { useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  FileButton,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { api, failure, post } from "../../api";
import { WorkspaceSections } from "../../ui/WorkspaceSections";
import { EmptyState } from "../../ui/EmptyState";
import { InspirationPreset, type LibraryPreset } from "./InspirationPreset";
import { LoadingState } from "../../ui/LoadingState";
import {
  LibraryCatalogueTable,
  libraryItemCategory,
  type LibraryItem,
} from "./LibraryCatalogueTable";
import { LibraryImportReview, type ImportRecord, type ImportVision } from "./LibraryImportReview";

export function LibraryPage() {
  const { admin, imports: importsEnabled, options } = useLibraryNavigation();
  const [editingCatalogue, setEditingCatalogue] = useState<"models" | "loras" | null>(null);
  const [url, setUrl] = useState("");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const client = useQueryClient();
  const { hash } = useLocation();
  const activeSection =
    options.find((section) => `#${section.value}` === hash)?.value || options[0].value;
  const importsActive = importsEnabled && activeSection === "imports";
  const catalogueActive = ["models", "loras"].includes(activeSection);
  const imports = useQuery({
    queryKey: ["imports"],
    queryFn: () => api<{ imports: ImportRecord[]; vision?: ImportVision }>("/api/library/imports"),
    enabled: importsActive,
    refetchInterval: importsActive ? 4000 : false,
  });
  const catalogue = useQuery({
    queryKey: ["library"],
    queryFn: () =>
      api<{ items: LibraryItem[]; updates?: { checkedAt?: string; available: number } }>(
        "/api/library/items",
      ),
    refetchInterval: (query) =>
      catalogueActive &&
      query.state.data?.items.some((item) => item.applied?.state === "downloading")
        ? 2000
        : false,
  });
  const presets = useQuery({
    queryKey: ["presets"],
    queryFn: () => api<{ presets: LibraryPreset[] }>("/api/presets"),
    enabled: importsEnabled,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["imports"] });
    void client.invalidateQueries({ queryKey: ["presets"] });
    void client.invalidateQueries({ queryKey: ["library"] });
  };
  const importing = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post<{ import: ImportRecord }>("/api/library/imports", { url }),
    onSuccess: (result) => {
      setReviewId(result.import.id);
      setUrl("");
      refresh();
    },
  });
  const action = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      post(`/api/library/imports/${id}/${action}`),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: (choice: { key: string; alternative?: boolean } | undefined) =>
      choice
        ? post<{ available: number }>("/api/library/updates/apply", choice)
        : post<{ available: number }>("/api/library/updates/check"),
    onSuccess: (result, choice) => {
      void client.invalidateQueries({ queryKey: ["library"] });
      void client.invalidateQueries({ queryKey: ["library-downloads"] });
      if (choice)
        notifications.show({
          message:
            "Update queued. The existing file stays until the replacement is verified and no longer in use.",
        });
      else
        notifications.show({
          message: result.available
            ? `${result.available} updates available.`
            : "Everything is up to date.",
        });
    },
  });
  async function upload(file: File | null) {
    if (!file) return;
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await post<{ import: ImportRecord }>("/api/library/imports/image", {
        name: file.name,
        image: data,
      });
      setReviewId(result.import.id);
      refresh();
    } catch (error) {
      failure(error);
    }
  }
  return (
    <Stack gap="xl">
      <WorkspaceSections
        label="Library"
        sections={options}
        content={{
          imports: reviewId ? (
            <LibraryImportReview
              id={reviewId}
              active={importsActive}
              vision={imports.data?.vision}
              admin={admin}
              onBack={() => setReviewId(null)}
              onOpen={setReviewId}
            />
          ) : (
            <Stack>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  importing.mutate();
                }}
              >
                <Group align="end">
                  <TextInput
                    label="Civitai or Hugging Face URL"
                    placeholder="https://…"
                    value={url}
                    onChange={(e) => setUrl(e.currentTarget.value)}
                    required
                    type="url"
                    style={{ flex: 1, minWidth: 200 }}
                  />
                  <Button type="submit" loading={importing.isPending}>
                    Import
                  </Button>
                  <FileButton
                    onChange={(file) => void upload(file)}
                    accept="image/png,image/jpeg,image/webp"
                  >
                    {(props) => (
                      <Button {...props} variant="default">
                        Upload Image
                      </Button>
                    )}
                  </FileButton>
                </Group>
                {importing.error && (
                  <Alert color="red" mt="sm">
                    {importing.error.message}
                  </Alert>
                )}
              </form>
              <Stack>
                {imports.isPending ? (
                  <LoadingState label="Loading Imports" />
                ) : imports.error ? (
                  <Alert color="red">{imports.error.message}</Alert>
                ) : imports.data.imports.length === 0 ? (
                  <EmptyState>Your imports and compatibility grades will appear here.</EmptyState>
                ) : (
                  <Table.ScrollContainer minWidth={620}>
                    <Table aria-label="Library Imports" verticalSpacing="sm" highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Import</Table.Th>
                          <Table.Th>Grade & Progress</Table.Th>
                          <Table.Th>Actions</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {imports.data.imports.map((record) => (
                          <Table.Tr key={record.id}>
                            <Table.Td>
                              <Stack gap="xs">
                                <Text fw={500}>
                                  {record.title ||
                                    record.name ||
                                    record.image?.name ||
                                    record.input?.url ||
                                    record.id}
                                </Text>
                                <Accordion variant="default">
                                  <Accordion.Item value="files">
                                    <Accordion.Control>Files</Accordion.Control>
                                    <Accordion.Panel>
                                      {record.resources?.map((file) => (
                                        <Group key={file.name} justify="space-between">
                                          <Text size="sm">{file.name}</Text>
                                          <Badge
                                            color={file.status === "installed" ? "green" : "gray"}
                                          >
                                            {file.status}
                                          </Badge>
                                        </Group>
                                      ))}
                                    </Accordion.Panel>
                                  </Accordion.Item>
                                </Accordion>
                              </Stack>
                            </Table.Td>
                            <Table.Td>
                              <Stack gap={4}>
                                <Badge style={{ alignSelf: "start" }}>
                                  {record.grade?.value || record.state}
                                </Badge>
                                <Text size="sm" c="dimmed">
                                  {record.state}
                                </Text>
                                {record.grade?.reasons.map((reason) => (
                                  <Text size="sm" key={reason}>
                                    {reason}
                                  </Text>
                                ))}
                              </Stack>
                            </Table.Td>
                            <Table.Td>
                              <Stack gap="xs">
                                <Button size="compact-sm" onClick={() => setReviewId(record.id)}>
                                  Review Import
                                </Button>
                                <Button
                                  variant="default"
                                  size="compact-sm"
                                  loading={action.isPending}
                                  onClick={() =>
                                    action.mutate({ id: record.id, action: "download" })
                                  }
                                >
                                  Download Missing
                                </Button>
                              </Stack>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
              </Stack>
            </Stack>
          ),
          presets: (
            <>
              {presets.isPending ? (
                <LoadingState label="Loading Inspiration" />
              ) : presets.error ? (
                <Alert color="red">{presets.error.message}</Alert>
              ) : !presets.data?.presets.length ? (
                <EmptyState>Your saved inspiration will appear here.</EmptyState>
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                  {presets.data?.presets.map((preset) => (
                    <InspirationPreset key={preset.id} preset={preset} />
                  ))}
                </SimpleGrid>
              )}
            </>
          ),
          ...Object.fromEntries(
            (["models", "loras"] as const).map((section) => [
              section,
              catalogue.isPending ? (
                <LoadingState label={`Loading ${librarySections[section].label}`} />
              ) : catalogue.error ? (
                <Alert color="red">{catalogue.error.message}</Alert>
              ) : (
                <Stack>
                  {admin && (
                    <Group justify="flex-end">
                      <Button
                        variant="default"
                        size="compact-sm"
                        loading={update.isPending && !update.variables}
                        disabled={update.isPending}
                        onClick={() => update.mutate(undefined)}
                      >
                        Check Updates
                      </Button>
                      <Button
                        variant="default"
                        size="compact-sm"
                        onClick={() => setEditingCatalogue(section)}
                      >
                        Edit Catalogue
                      </Button>
                    </Group>
                  )}
                  <LibraryCatalogueTable
                    label={librarySections[section].label as "Models" | "LoRAs"}
                    items={catalogue.data.items.filter((item) =>
                      section === "loras"
                        ? libraryItemCategory(item) === "loras"
                        : libraryItemCategory(item) !== "loras",
                    )}
                    onUpdate={
                      admin
                        ? (item, alternative) => update.mutate({ key: item.key, alternative })
                        : undefined
                    }
                    updatePending={update.isPending}
                  />
                </Stack>
              ),
            ]),
          ),
          downloads: <LibraryDownloads active={hash === "#downloads"} />,
          profiles: <LibraryDefinitions kind="profile" />,
          guides: <LibraryDefinitions kind="guide" />,
        }}
      />
      {editingCatalogue && (
        <CatalogueEditor
          close={() => setEditingCatalogue(null)}
          items={(catalogue.data?.items || []).filter((item) =>
            editingCatalogue === "loras"
              ? libraryItemCategory(item) === "loras"
              : libraryItemCategory(item) !== "loras",
          )}
        />
      )}
    </Stack>
  );
}
