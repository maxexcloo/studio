import { Alert, Button, Modal, Stack, Text } from "@mantine/core";
import { useId, useState } from "react";

import type { Profile } from "../../types";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { plural } from "../../ui/plural";
import { closeWhenTop } from "../../ui/popupClicks";
import { useGenerationActions } from "../generation/GenerationProvider";
import { ProfileSelect } from "../generation/ProfilePicker";
import { recreateOnLimit } from "./useRecreateOn";

/** Recreate On's model choice for `count` selected images; Recreate queues them on it. */
export function RecreateOnDialog({
  opened,
  count,
  pending,
  onRecreate,
  onClose,
}: {
  opened: boolean;
  count: number;
  pending: boolean;
  onRecreate: (profile: Profile) => void;
  onClose: () => void;
}) {
  const id = useId();
  const { profiles } = useGenerationActions();
  const [profile, setProfile] = useState<Profile | null>(null);
  const images = profiles.filter((each) => each.kind === "image");
  return (
    <Modal
      id={id}
      opened={opened}
      onClose={closeWhenTop(id, () => !pending && onClose())}
      title="Recreate On"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {`Each image runs again on this model with its prompt and seed, beside the original as a comparison.`}
        </Text>
        {count > recreateOnLimit && (
          <Alert color="yellow">{`Only the first ${plural(recreateOnLimit, "image")} run.`}</Alert>
        )}
        <ProfileSelect
          field
          name="Model"
          profiles={images}
          value={profile?.id ?? null}
          onChange={setProfile}
        />
        <DialogFooter pending={pending} onCancel={onClose}>
          <Button
            loading={pending}
            disabled={!profile}
            onClick={() => profile && onRecreate(profile)}
          >
            Recreate
          </Button>
        </DialogFooter>
      </Stack>
    </Modal>
  );
}
