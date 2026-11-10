import { useState } from "react";
import { Alert, Button, Card, Group, Image, Stack, Text } from "@mantine/core";
import { useOpenComposer } from "../generation/openComposer";
import type { GenerationInput } from "../../types";
import {
  compatibleSettings,
  inspirationInput,
  type LibraryPreset,
} from "../generation/inspiration";
import { isProfile } from "../generation/payload";
import { initialInput, inputForProfile, useGeneration } from "../generation/GenerationProvider";
import { ProfilePicker } from "../generation/ProfilePicker";

export function InspirationPreset({ preset }: { preset: LibraryPreset }) {
  const openComposer = useOpenComposer();
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
              changeKind(kind);
              setDraft((previous) => ({
                ...previous,
                input: { ...previous.input, prompt: preset.prompt },
              }));
              openComposer(kind);
            }}
          >
            Use Prompt
          </Button>
          <Button
            size="sm"
            disabled={!!fit.blockers.length}
            onClick={() => {
              if (!profile) return;
              setDraft((previous) => ({
                ...previous,
                input: inspirationInput(preset, previous.input, profile),
                references: [],
                operation: kind === "video" ? "animate" : "image",
                parentJobId: undefined,
                parentItemId: undefined,
                presetId: undefined,
                presetTitle: undefined,
              }));
              openComposer(kind);
            }}
          >
            Use Settings
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
