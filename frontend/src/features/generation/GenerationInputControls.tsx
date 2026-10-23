import type { ReactNode } from "react";
import { Box, Group } from "@mantine/core";
import type { GenerationInput, Profile } from "../../types";
import { ProfilePicker } from "./ProfilePicker";
import { SizePicker } from "./SizePicker";

export function GenerationInputControls({
  input,
  profile,
  onChange,
  references,
}: {
  input: GenerationInput;
  profile?: Profile;
  onChange: (patch: Partial<GenerationInput>) => void;
  references?: ReactNode;
}) {
  return (
    <Group gap="xs" align="end" aria-label="Generation Inputs">
      <Box flex={{ base: "1 1 100%", sm: "1 1 180px" }} miw={0}>
        <ProfilePicker value={input} onChange={onChange} />
      </Box>
      <SizePicker input={input} profile={profile} onChange={onChange} />
      {references}
    </Group>
  );
}
