import { Alert, Button, Modal, Stack, TextInput } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { post } from "../../api";
import type { MediaItem } from "../../types";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { closeWhenTop } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import { GalleryChoices } from "../generation/GalleryChoices";
import { usePresets } from "../generation/PresetPicker";
import { useReferenceBrowser } from "../generation/useReferenceBrowser";
import { mediaTitle } from "./mediaLabels";
import { mediaDraft } from "./useMediaAction";

type ResultDialogProps = { item: MediaItem; onClose: () => void };

export function SaveResultPresetDialog({ item, onClose }: ResultDialogProps) {
  const phone = usePhone();
  const client = useQueryClient();
  const presets = usePresets(false, true);
  const [title, setTitle] = useState(() => mediaTitle(item).slice(0, 120));
  const save = useMutation({
    meta: { inlineError: true },
    mutationFn: async () => {
      const { draft, profile } = await mediaDraft(item, "image", client);
      return presets.save({ title: title.trim(), input: draft.input, family: profile.family });
    },
    onSuccess: onClose,
  });
  return (
    <Modal
      title="Save as Preset"
      id="save-result-preset"
      opened
      fullScreen={phone}
      onClose={closeWhenTop("save-result-preset", onClose)}
    >
      <Stack
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() && !save.isPending) save.mutate();
        }}
      >
        <TextInput
          aria-label="Preset Name"
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        {save.error && <Alert color="red">{save.error.message}</Alert>}
        <DialogFooter onCancel={onClose}>
          <Button type="submit" disabled={!title.trim() || save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </Stack>
    </Modal>
  );
}

export function CompareUploadDialog({ item, onClose }: ResultDialogProps) {
  const phone = usePhone();
  const navigate = useNavigate();
  const client = useQueryClient();
  const browser = useReferenceBrowser();
  const [upload, setUpload] = useState<string>();
  const compare = useMutation({
    meta: { inlineError: true },
    mutationFn: (uploadId: string) =>
      post<{ id: string }>("/api/comparisons", {
        jobIds: [item.jobId, ""],
        itemIds: [item.id, uploadId],
        labels: ["Generated", "Uploaded"],
      }),
    onSuccess: ({ id }) => {
      void client.invalidateQueries({ queryKey: ["comparisons"] });
      onClose();
      navigate(`/compare/${id}`);
    },
  });
  return (
    <Modal
      title="Compare With Upload"
      id="compare-upload"
      opened
      size="lg"
      fullScreen={phone}
      onClose={closeWhenTop("compare-upload", onClose)}
    >
      <Stack h={phone ? "100%" : 480} mih={0}>
        <GalleryChoices
          label="Uploads"
          browser={browser}
          enabled
          uploadsOnly
          tile={(candidate, name) => ({
            label: name,
            selected: upload === candidate.id,
            disabled: candidate.status !== "done" || !candidate.uploaded,
            onToggle: () => setUpload(candidate.id),
          })}
        />
        {compare.error && <Alert color="red">{compare.error.message}</Alert>}
        <DialogFooter onCancel={onClose}>
          <Button
            disabled={!upload || compare.isPending}
            onClick={() => upload && compare.mutate(upload)}
          >
            Compare
          </Button>
        </DialogFooter>
      </Stack>
    </Modal>
  );
}
