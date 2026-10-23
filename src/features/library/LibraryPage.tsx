import { useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  FileButton,
  Group,
  Image,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api, failure, post } from "../../api";
import { useGeneration } from "../generation/GenerationProvider";
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
interface Preset {
  id: string;
  name: string;
  prompt: string;
  negative: string;
  settings: Record<string, unknown>;
  thumbnailUrl?: string;
  resources?: { profileId?: string }[];
}
export function LibraryPage() {
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const client = useQueryClient();
  const navigate = useNavigate();
  const { update, profiles, selectProfile } = useGeneration();
  const imports = useQuery({
    queryKey: ["imports"],
    queryFn: () => api<{ imports: ImportRecord[] }>("/api/library/imports"),
    refetchInterval: 4000,
  });
  const catalogue = useQuery({
    queryKey: ["library"],
    queryFn: () => api<{ items: LibraryItem[] }>("/api/library/items"),
  });
  const presets = useQuery({
    queryKey: ["presets"],
    queryFn: () => api<{ presets: Preset[] }>("/api/presets"),
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
      <div>
        <Title order={1}>Library</Title>
        <Text c="dimmed">Models, LoRAs and inspiration, with their original settings.</Text>
      </div>
      <Paper>
        <Stack>
          <Text fw={600}>Import a Link or Image</Text>
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
      </Paper>
      <Tabs defaultValue="imports">
        <Tabs.List>
          <Tabs.Tab value="imports">Imports</Tabs.Tab>
          <Tabs.Tab value="presets">Inspiration</Tabs.Tab>
          <Tabs.Tab value="catalogue">Models & LoRAs</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="imports" pt="lg">
          <Stack>
            {imports.isPending ? (
              <Loader />
            ) : imports.error ? (
              <Alert color="red">{imports.error.message}</Alert>
            ) : imports.data.imports.length === 0 ? (
              <Text c="dimmed">
                Import an image or model to see its files and compatibility grade.
              </Text>
            ) : (
              imports.data.imports.map((record) => (
                <Card key={record.id} withBorder>
                  <Stack>
                    <Group justify="space-between">
                      <Text fw={500}>
                        {record.name || record.image?.name || record.input?.url || record.id}
                      </Text>
                      <Badge>{record.grade?.value || record.state}</Badge>
                    </Group>
                    <Text size="sm" c="dimmed">
                      {record.state}
                    </Text>
                    {record.grade?.reasons.map((reason) => (
                      <Text size="sm" key={reason}>
                        {reason}
                      </Text>
                    ))}
                    <Accordion>
                      <Accordion.Item value="files">
                        <Accordion.Control>Files</Accordion.Control>
                        <Accordion.Panel>
                          {record.resources?.map((file) => (
                            <Group key={file.name} justify="space-between">
                              <Text size="sm">{file.name}</Text>
                              <Badge color={file.status === "installed" ? "green" : "gray"}>
                                {file.status}
                              </Badge>
                            </Group>
                          ))}
                        </Accordion.Panel>
                      </Accordion.Item>
                    </Accordion>
                    <Group>
                      <Button
                        variant="default"
                        loading={action.isPending}
                        onClick={() => action.mutate({ id: record.id, action: "download" })}
                      >
                        Download Missing
                      </Button>
                    </Group>
                  </Stack>
                </Card>
              ))
            )}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="presets" pt="lg">
          {presets.error ? (
            <Alert color="red">{presets.error.message}</Alert>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
              {presets.data?.presets.map((preset) => (
                <Card key={preset.id} withBorder>
                  <Stack>
                    {preset.thumbnailUrl && (
                      <Image src={preset.thumbnailUrl} alt={preset.name} h={220} fit="cover" />
                    )}
                    <Text fw={500}>{preset.name}</Text>
                    <Text lineClamp={3} size="sm" c="dimmed">
                      {preset.prompt}
                    </Text>
                    <Group>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => {
                          update({ prompt: preset.prompt });
                          navigate("/?compose=1");
                        }}
                      >
                        Use Prompt
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          const target = profiles.find((profile) =>
                            preset.resources?.some((resource) => resource.profileId === profile.id),
                          );
                          if (target) selectProfile(target);
                          update({
                            ...preset.settings,
                            prompt: preset.prompt,
                            negative: preset.negative,
                          });
                          navigate("/?compose=1");
                        }}
                      >
                        Use Settings
                      </Button>
                    </Group>
                  </Stack>
                </Card>
              ))}
            </SimpleGrid>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="catalogue" pt="lg">
          <Stack>
            <TextInput
              aria-label="Search Library"
              placeholder="Search models and LoRAs…"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
            <Text c="dimmed" size="sm">
              Definitions are managed in ai and mounted read-only. Imports and download progress
              remain part of your runtime data.
            </Text>
            {catalogue.error ? (
              <Alert color="red">{catalogue.error.message}</Alert>
            ) : (
              [...groups.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([family, types]) => (
                  <Stack key={family} gap="sm">
                    <Title order={3}>{family}</Title>
                    {[...types.entries()]
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([type, items]) => (
                        <Stack key={type} gap="xs">
                          <Text size="sm" fw={600} c="dimmed">
                            {type}
                          </Text>
                          {items.map((item) => (
                            <Card key={item.key} withBorder>
                              <Group justify="space-between">
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
                                <Badge color={item.installed ? "green" : "gray"}>
                                  {item.installed ? "Installed" : "Not Installed"}
                                </Badge>
                              </Group>
                            </Card>
                          ))}
                        </Stack>
                      ))}
                  </Stack>
                ))
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
