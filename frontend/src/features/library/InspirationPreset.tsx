import { Alert, Button, Card, Group, Image, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { GenerationInput } from "../../types";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import {
  type Draft,
  defaultProfile,
  initialInput,
  inputForProfile,
  useGeneration,
} from "../generation/GenerationProvider";
import {
  type LibraryPreset,
  compatibleSettings,
  inspirationInput,
} from "../generation/inspiration";
import { useOpenComposer } from "../generation/openComposer";
import { generationInput, isProfile } from "../generation/payload";
import { presetsQuery } from "../generation/PresetPicker";
import { presetReplacesUnsaved } from "../generation/presets";
import { ProfilePicker } from "../generation/ProfilePicker";

export function InspirationPreset({ preset }: { preset: LibraryPreset }) {
  const openComposer = useOpenComposer();
  const { draft, draftForKind, models, profiles, setDraft } = useGeneration();
  const presets = useQuery(presetsQuery).data?.presets;
  const [selection, setSelection] = useState<GenerationInput | null>(null);
  const [replacement, setReplacement] = useState<{ draft: Draft; promptOnly: boolean } | null>(
    null,
  );
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
  const apply = (next: Draft) => {
    setDraft(next);
    openComposer(kind);
  };
  const load = (promptOnly: boolean) => {
    const previous = draftForKind(kind);
    const next: Draft = promptOnly
      ? { ...previous, input: { ...previous.input, prompt: preset.prompt } }
      : {
          ...draft,
          input: inspirationInput(preset, draft.input, profile),
          references: [],
          operation: kind === "video" ? "animate" : "image",
          parentJobId: undefined,
          parentItemId: undefined,
          presetId: undefined,
          presetTitle: undefined,
        };
    const saved = (value: Draft) =>
      generationInput(
        value.input,
        profiles.find((profile) => profile.id === value.input.profileId),
        value.references,
      );
    const preferred = defaultProfile(models.data, kind);
    const defaults = generationInput(
      preferred ? inputForProfile(initialInput, preferred) : { ...initialInput, kind },
      preferred,
      [],
    );
    const selected = presets?.find(({ id }) => id === previous.presetId);
    if (presetReplacesUnsaved(saved(previous), saved(next), defaults, selected)) {
      setReplacement({ draft: next, promptOnly });
    } else apply(next);
  };
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
          <Button variant="default" size="sm" onClick={() => load(true)}>
            Use Prompt
          </Button>
          <Button size="sm" disabled={!!fit.blockers.length} onClick={() => load(false)}>
            Use Settings
          </Button>
        </Group>
      </Stack>
      <ConfirmDialog
        opened={Boolean(replacement)}
        title="Load Inspiration"
        action="Replace"
        pending={false}
        onClose={() => setReplacement(null)}
        onConfirm={() => {
          if (replacement) apply(replacement.draft);
          setReplacement(null);
        }}
      >
        Replace the draft's {replacement?.promptOnly ? "prompt" : "prompt, settings and references"}{" "}
        with {preset.name}?
      </ConfirmDialog>
    </Card>
  );
}
