import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { modelFamilyLabel } from "../../ui/modelFamily";
import { modelsQuery } from "../generation/GenerationProvider";
import { loraInfoQuery } from "../generation/LoraPicker";
import { libraryItemCategory, type LibraryItem } from "./LibraryCatalogueTable";
import { usePhone } from "../../ui/usePhone";
interface CatalogueItem extends LibraryItem {
  baseModel?: string;
  role?: string;
  triggers?: string[];
  tags?: string[];
  nsfw?: boolean;
  guidance?: string;
  strength?: { default?: number; min?: number; max?: number; step?: number };
}
function CatalogueForm({
  item,
  families,
  close,
}: {
  item: CatalogueItem;
  families: string[];
  close: () => void;
}) {
  const client = useQueryClient();
  const lora = libraryItemCategory(item) === "loras";
  const form = useForm({
    initialValues: {
      title: item.title || "",
      baseModel: item.baseModel || "",
      families: item.families || [],
      modelType: item.modelType || "",
      type: item.type || "",
      role: item.role || "",
      triggers: item.triggers || [],
      tags: item.tags || [],
      description: item.description || "",
      note: item.note || "",
      guidance: item.guidance || "",
      nsfw: item.nsfw === true ? "nsfw" : item.nsfw === false ? "general" : "unknown",
      default: item.strength?.default ?? ("" as number | string),
      min: item.strength?.min ?? ("" as number | string),
      max: item.strength?.max ?? ("" as number | string),
      step: item.strength?.step ?? ("" as number | string),
    },
  });
  const refresh = () => {
    for (const queryKey of [["library"], loraInfoQuery.queryKey, modelsQuery.queryKey])
      void client.invalidateQueries({ queryKey });
    close();
  };
  const save = useMutation({
    meta: { inlineError: true },
    mutationFn: () => {
      const patch: Record<string, unknown> = {};
      for (const key of [
        "title",
        "baseModel",
        "families",
        "modelType",
        "type",
        "role",
        "triggers",
        "tags",
        "description",
        "note",
        "guidance",
        "nsfw",
      ] as const) {
        if (!form.isDirty(key)) continue;
        const value = form.values[key];
        patch[key] =
          key === "nsfw"
            ? value === "unknown"
              ? null
              : value === "nsfw"
            : value === ""
              ? null
              : value;
      }
      if (["default", "min", "max", "step"].some((key) => form.isDirty(key)))
        patch.strength = {
          ...item.strength,
          ...Object.fromEntries(
            ["default", "min", "max", "step"].map((key) => [
              key,
              form.values[key as "default"] === "" ? null : form.values[key as "default"],
            ]),
          ),
        };
      return api("/api/library/catalogue", {
        method: "PATCH",
        body: JSON.stringify({ key: item.key, patch }),
      });
    },
    onSuccess: refresh,
  });
  const undo = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post("/api/library/catalogue/undo", { key: item.key }),
    onSuccess: refresh,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Stack>
        <Text size="xs" c="dimmed">
          {item.key}
        </Text>
        <TextInput label="Title" {...form.getInputProps("title")} />
        <TextInput label="Base Model" {...form.getInputProps("baseModel")} />
        <TagsInput
          label="Families"
          data={families.map((family) => ({ value: family, label: modelFamilyLabel(family) }))}
          description="Use the exact family identifiers declared by your profiles."
          {...form.getInputProps("families")}
        />
        <Select
          label={lora ? "LoRA Type" : "Model Type"}
          clearable
          placeholder="Inherit Source Classification"
          data={
            lora
              ? ["slider", "style", "character", "concept"].map((value) => ({
                  value,
                  label: value[0].toUpperCase() + value.slice(1),
                }))
              : [
                  { value: "original", label: "Original" },
                  { value: "finetune", label: "Finetune" },
                ]
          }
          value={form.values[lora ? "type" : "modelType"] || null}
          onChange={(value) => form.setFieldValue(lora ? "type" : "modelType", value || "")}
        />
        {lora && (
          <>
            <Select
              label="Runtime Role"
              clearable
              data={["effect", "acceleration", "supporting"]}
              value={form.values.role || null}
              onChange={(value) => form.setFieldValue("role", value || "")}
            />
            <TagsInput label="Trigger Words" {...form.getInputProps("triggers")} />
            <Text size="sm" c="dimmed">
              Suggested Strength — these values guide generation controls without restricting expert
              input.
            </Text>
            <SimpleGrid cols={2}>
              {(["default", "min", "max", "step"] as const).map((key) => (
                <NumberInput
                  key={key}
                  label={
                    key === "default"
                      ? "Default Strength"
                      : key === "min"
                        ? "Minimum"
                        : key === "max"
                          ? "Maximum"
                          : "Step"
                  }
                  clampBehavior="none"
                  {...form.getInputProps(key)}
                />
              ))}
            </SimpleGrid>
          </>
        )}
        <Select
          label="Content Classification"
          data={[
            { value: "unknown", label: "Inherit Source Classification" },
            { value: "general", label: "General" },
            { value: "nsfw", label: "NSFW" },
          ]}
          allowDeselect={false}
          {...form.getInputProps("nsfw")}
        />
        <TagsInput label="Tags" {...form.getInputProps("tags")} />
        {(["description", "note", "guidance"] as const).map((key) => (
          <Textarea
            key={key}
            label={key[0].toUpperCase() + key.slice(1)}
            autosize
            minRows={2}
            {...form.getInputProps(key)}
          />
        ))}
        {save.error && <Alert color="red">{save.error.message}</Alert>}
        {undo.error && <Alert color="red">{undo.error.message}</Alert>}
        <Group justify="space-between">
          <Button
            variant="default"
            disabled={form.isDirty() || save.isPending}
            loading={undo.isPending}
            onClick={() => undo.mutate()}
          >
            Undo Last Catalogue Change
          </Button>
          <Button
            type="submit"
            disabled={!form.isDirty() || undo.isPending}
            loading={save.isPending}
          >
            Save Catalogue Entry
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
export function CatalogueEditor({ items, close }: { items: LibraryItem[]; close: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const phone = usePhone();
  const item = items.find((entry) => entry.key === selected);
  return (
    <Modal opened onClose={close} title="Edit Catalogue" size="lg" fullScreen={phone}>
      <Stack>
        <Select
          label="Catalogue Resource"
          searchable
          data={items.map((entry) => ({
            value: entry.key,
            label: entry.title || entry.name || entry.file || entry.key,
          }))}
          value={selected}
          onChange={setSelected}
        />
        {item && (
          <CatalogueForm
            key={item.key}
            item={item}
            families={[...new Set(items.flatMap((entry) => entry.families || []))].sort()}
            close={close}
          />
        )}
      </Stack>
    </Modal>
  );
}
