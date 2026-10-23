import type { ReactNode } from "react";
import { Box, Group } from "@mantine/core";
import type { GenerationInput, Profile } from "../../types";
import { ProfilePicker } from "./ProfilePicker";
import { SizePicker } from "./SizePicker";
import { LoraPicker, type LoraPickerState } from "./LoraPicker";

export function GenerationInputControls({
  input,
  profile,
  onChange,
  references,
  loraPicker,
}: {
  input: GenerationInput;
  profile?: Profile;
  onChange: (patch: Partial<GenerationInput>) => void;
  references?: ReactNode;
  loraPicker: LoraPickerState;
}) {
  return (
    <Group gap="xs" align="end" aria-label="Generation Inputs">
      <Box flex={{ base: "1 1 100%", sm: "1 1 180px" }} miw={0}>
        <ProfilePicker value={input} onChange={onChange} />
      </Box>
      <SizePicker input={input} profile={profile} onChange={onChange} />
      {references}
      {profile?.capabilities.lora && (
        <LoraPicker value={input} onChange={onChange} picker={loraPicker} />
      )}
    </Group>
  );
}
