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
  Title,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { api, failure, post } from "../../api";
import { WorkspaceSections, WorkspaceSectionSelect } from "../../ui/WorkspaceSections";
import { EmptyState } from "../../ui/EmptyState";
import { InspirationPreset, type LibraryPreset } from "./InspirationPreset";
import { LoadingState } from "../../ui/LoadingState";
import { SearchInput } from "../../ui/SearchInput";
interface ImportRecord {
  id: string;
  name?: string;
  state: string;
  input?: { url?: string };
  grade?: { value: string; reasons: string[] };
  resources?: { name: string; status: string }[];
  results?: { presetId?: string };
  image?: { name?: string; thumbnailUrl?: string };
  prompt?: string;
}
interface LibraryItem {
  key: string;
  title?: string;
  name?: string;
  file?: string;
  installed: boolean;
  note?: string;
  description?: string;
  families?: string[];
  type?: string;
  kind?: string;
  folder?: string;
}

const librarySections = {
  imports: { value: "imports", label: "Imports" },
  presets: { value: "presets", label: "Inspiration" },
  catalogue: { value: "catalogue", label: "Models & LoRAs" },
};
export function LibraryTitle() {
  return <WorkspaceSectionSelect label="Library" sections={Object.values(librarySections)} />;
}
export function LibraryPage() {
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const client = useQueryClient();
  const { hash } = useLocation();
  const importsActive = hash !== "#presets" && hash !== "#catalogue";
  const imports = useQuery({
    queryKey: ["imports"],
    queryFn: () => api<{ imports: ImportRecord[] }>("/api/library/imports"),
    enabled: importsActive,
    refetchInterval: importsActive ? 4000 : false,
  });
  const catalogue = useQuery({
    queryKey: ["library"],
    queryFn: () => api<{ items: LibraryItem[] }>("/api/library/items"),
  });
  const presets = useQuery({
    queryKey: ["presets"],
    queryFn: () => api<{ presets: LibraryPreset[] }>("/api/presets"),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["imports"] });
    void client.invalidateQueries({ queryKey: ["presets"] });
    void client.invalidateQueries({ queryKey: ["library"] });
  };
  const importing = useMutation({
    mutationFn: () => post("/api/library/imports", { url }),
    onSuccess: () => {
      setUrl("");
      refresh();
    },
    onError: failure,
  });
  const action = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      post(`/api/library/imports/${id}/${action}`),
    onSuccess: refresh,
    onError: failure,
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
      await post("/api/library/imports/image", { name: file.name, image: data });
      refresh();
    } catch (error) {
      failure(error);
    }
  }
  const groups = new Map<string, Map<string, LibraryItem[]>>();
  for (const item of catalogue.data?.items || []) {
    if (![item.title, item.name, item.file].join(" ").toLowerCase().includes(query.toLowerCase()))
      continue;
    for (const family of item.families?.length ? item.families : ["Unclassified"]) {
      if (!groups.has(family)) groups.set(family, new Map());
      const types = groups.get(family)!,
        type =
          item.kind === "lora" || item.folder === "loras"
            ? { slider: "Sliders", style: "Style", character: "Character", concept: "Concept" }[
                item.type || ("" as "style")
              ] || "Unclassified LoRAs"
            : "Models";
      if (!types.has(type)) types.set(type, []);
      types.get(type)!.push(item);
    }
  }
  return (
    <Stack gap="xl">
      <WorkspaceSections
        label="Library"
        sections={[
          {
            ...librarySections.imports,
            content: (
              <Stack>
                <Stack>
                  <Text size="sm" fw={600}>
                    Import a Link or Image
                  </Text>
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
                  </form>
                </Stack>
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
                                    {record.name ||
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
          },
          {
            ...librarySections.presets,
            content: (
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
          },
          {
            ...librarySections.catalogue,
            content: (
              <>
                <Stack>
                  <SearchInput
                    aria-label="Search Library"
                    placeholder="Search models and LoRAs…"
                    value={query}
                    onClear={() => setQuery("")}
                    onChange={(e) => setQuery(e.currentTarget.value)}
                  />
                  <Text c="dimmed" size="sm">
                    Definitions are managed in ai and mounted read-only. Imports and download
                    progress remain part of your runtime data.
                  </Text>
                  {catalogue.isPending ? (
                    <LoadingState label="Loading Catalogue" />
                  ) : catalogue.error ? (
                    <Alert color="red">{catalogue.error.message}</Alert>
                  ) : !groups.size ? (
                    <EmptyState>
                      {query.trim()
                        ? "No models or LoRAs match your search."
                        : "No models or LoRAs to show."}
                    </EmptyState>
                  ) : (
                    [...groups.entries()]
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([family, types]) => (
                        <Stack key={family} gap="sm">
                          <Title order={3}>{family}</Title>
                          <Table.ScrollContainer minWidth={520}>
                            <Table
                              aria-label={`${family} Models & LoRAs`}
                              verticalSpacing="sm"
                              highlightOnHover
                            >
                              <Table.Thead>
                                <Table.Tr>
                                  <Table.Th>Resource</Table.Th>
                                  <Table.Th>Type</Table.Th>
                                  <Table.Th>Status</Table.Th>
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                {[...types.entries()]
                                  .sort(([a], [b]) => a.localeCompare(b))
                                  .flatMap(([type, items]) =>
                                    items.map((item) => (
                                      <Table.Tr key={`${type}:${item.key}`}>
                                        <Table.Td>
                                          <Stack gap={4}>
                                            <Text fw={500}>
                                              {item.title || item.name || item.file || item.key}
                                            </Text>
                                            {item.description && (
                                              <Text size="sm" c="dimmed">
                                                {item.description}
                                              </Text>
                                            )}
                                            {item.note && (
                                              <Text size="sm" c="dimmed">
                                                {item.note}
                                              </Text>
                                            )}
                                          </Stack>
                                        </Table.Td>
                                        <Table.Td>
                                          <Text size="sm">{type}</Text>
                                        </Table.Td>
                                        <Table.Td>
                                          <Badge color={item.installed ? "green" : "gray"}>
                                            {item.installed ? "Installed" : "Not Installed"}
                                          </Badge>
                                        </Table.Td>
                                      </Table.Tr>
                                    )),
                                  )}
                              </Table.Tbody>
                            </Table>
                          </Table.ScrollContainer>
                        </Stack>
                      ))
                  )}
                </Stack>
              </>
            ),
          },
        ]}
      />
    </Stack>
  );
}
