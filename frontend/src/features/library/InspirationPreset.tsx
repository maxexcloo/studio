import { useState } from "react";
import { Alert, Button, Card, Group, Image, Stack, Text } from "@mantine/core";
import { useNavigate } from "react-router";
import type { GenerationInput, Profile } from "../../types";
import { isProfile } from "../generation/payload";
import { initialInput, inputForProfile, useGeneration } from "../generation/GenerationProvider";
import { ProfilePicker } from "../generation/ProfilePicker";

interface Resource {
  folder?: string;
  localName?: string;
  nameOnly?: boolean;
  profileId?: string;
  status?: string;
  weight?: number | null;
}
export interface LibraryPreset {
  id: string;
  name: string;
  prompt: string;
  negative: string;
  settings: Record<string, unknown>;
  thumbnailUrl?: string;
  type?: "image" | "video";
  resources?: Resource[];
  warnings?: string[];
}

function compatibleSettings(preset: LibraryPreset, profile?: Profile) {
  const blockers: string[] = [];
  const warnings = [...(preset.warnings || [])];
  const resources = preset.resources || [];
  const loras = resources.filter((resource) => resource.folder === "loras");
  const settings = { ...preset.settings };
  if (!profile) blockers.push("Choose a profile before applying these settings.");
  if (!preset.prompt) blockers.push("This inspiration has no prompt to apply.");
  if (profile?.ready === false)
    blockers.push("This profile needs compatible model parts before it can run.");
  if (resources.some((resource) => resource.status === "unsupported"))
    blockers.push("Some source files need a compatible model or a local filename match.");
  if (loras.some((resource) => !resource.localName))
    blockers.push("Download the missing LoRAs first.");
  if (loras.some((resource) => resource.weight == null))
    blockers.push("The source did not include all LoRA weights.");
  if (profile) {
    if (loras.length && !profile.capabilities.lora)
      blockers.push("This profile does not support LoRAs.");
    if (
      loras.some(
        (resource) =>
          profile.options?.loras && !profile.options.loras.includes(resource.localName || ""),
      )
    )
      blockers.push("This profile cannot load all source LoRAs.");
    const maximum = profile.maxLoras ?? 8;
    if (loras.length > maximum) blockers.push(`This profile supports up to ${maximum} LoRAs.`);
    const checkpoint = resources.find((resource) =>
      ["checkpoints", "diffusion_models"].includes(resource.folder || ""),
    );
    if (checkpoint?.profileId && checkpoint.profileId !== profile.id)
      warnings.push("You selected a different profile from the source image.");
    for (const [field, options] of [
      ["sampler", "samplers"],
      ["scheduler", "schedulers"],
    ]) {
      const value = settings[field];
      if (
        typeof value === "string" &&
        profile.options?.[options] &&
        !profile.options[options].includes(value)
      ) {
        warnings.push(`${field} will use this profile’s default.`);
        delete settings[field];
      }
    }
    for (const field of ["cfg", "fps", "frames", "height", "steps", "width"]) {
      const value = settings[field];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const range = profile.constraints?.[field];
      if (!range) continue;
      const minimum = range.min ?? 0;
      const maximum = range.max ?? value;
      const step = range.step || 1;
      const last = Math.max(0, Math.floor((maximum - minimum) / step));
      const adjusted = Number(
        (
          minimum +
          Math.max(0, Math.min(last, Math.round((value - minimum) / step))) * step
        ).toFixed(6),
      );
      if (adjusted !== value)
        warnings.push(`${field} will use ${adjusted}, within this profile’s limits.`);
      settings[field] = adjusted;
    }
    if (
      resources.some(
        (resource) =>
          resource.folder === "vae" && (!resource.localName || !profile.capabilities.vae),
      )
    )
      blockers.push("This profile cannot use the source VAE.");
    if (resources.some((resource) => resource.folder === "text_encoders" && !resource.localName))
      blockers.push("Download the source text encoders first.");
    if (preset.negative && profile.capabilities.negativePrompt === false)
      warnings.push("This profile does not use a negative prompt.");
  }
  // The selected profile owns identity and routing; imported metadata cannot override them.
  for (const field of [
    "backendId",
    "kind",
    "model",
    "profileId",
    "referenceAssets",
    "referenceDetails",
    "startImage",
    "startImageId",
    "workflow",
  ])
    delete settings[field];
  settings.loras = loras.map((resource) => ({
    name: resource.localName!,
    strength: resource.weight!,
    enabled: true,
  }));
  return { blockers, settings, warnings: [...new Set(warnings)] };
}

export function InspirationPreset({ preset }: { preset: LibraryPreset }) {
  const navigate = useNavigate();
  const { profiles, setDraft, changeKind } = useGeneration();
  const [selection, setSelection] = useState<GenerationInput | null>(null);
  const kind = preset.type || "image";
  const exact = profiles.find(
    (profile) =>
      profile.kind === kind &&
      (isProfile(profile, preset.settings.profileId) ||
        preset.resources?.some((resource) => resource.profileId === profile.id) ||
        (profile.model === preset.settings.model &&
          (!preset.settings.workflow || profile.workflow === preset.settings.workflow))),
  );
  const input =
    selection || (exact ? inputForProfile(initialInput, exact) : { ...initialInput, kind });
  const profile = profiles.find(
    (profile) => profile.id === input.profileId && profile.kind === kind,
  );
  const fit = compatibleSettings(preset, profile);
  return (
    <Card withBorder>
      <Stack>
        {preset.thumbnailUrl && (
          <Image src={preset.thumbnailUrl} alt={preset.name} h={220} fit="cover" />
        )}
        <Text fw={500}>{preset.name}</Text>
        <Text lineClamp={3} size="sm" c="dimmed">
          {preset.prompt}
        </Text>
        <ProfilePicker value={input} onChange={setSelection} />
        {!!fit.blockers.length && (
          <Text size="sm" c="dimmed">
            {fit.blockers.join(" ")}
          </Text>
        )}
        {!!fit.warnings.length && (
          <Alert color="yellow" title="Review Settings">
            {fit.warnings.join(" ")}
          </Alert>
        )}
        <Group>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              changeKind(kind, "gallery");
              setDraft(
                (previous) => ({
                  ...previous,
                  input: { ...previous.input, prompt: preset.prompt },
                }),
                "gallery",
              );
              navigate(kind === "video" ? "/video?compose=1" : "/images?compose=1");
            }}
          >
            Use Prompt
          </Button>
          <Button
            size="sm"
            disabled={!!fit.blockers.length}
            onClick={() => {
              if (!profile) return;
              setDraft(
                (previous) => ({
                  ...previous,
                  input: {
                    ...inputForProfile(previous.input, profile),
                    ...fit.settings,
                    backendId: input.backendId,
                    prompt: preset.prompt,
                    negative: profile.capabilities.negativePrompt === false ? "" : preset.negative,
                    referenceAssets: [],
                    referenceDetails: undefined,
                  },
                  references: [],
                  operation: kind === "video" ? "animate" : "image",
                  parentJobId: undefined,
                  parentItemId: undefined,
                  presetId: undefined,
                  presetTitle: undefined,
                }),
                "gallery",
              );
              navigate(kind === "video" ? "/video?compose=1" : "/images?compose=1");
            }}
          >
            Use Settings
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
