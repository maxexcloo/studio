import { Alert, Button, Menu, Modal, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FolderUp, Import } from "lucide-react";
import { useRef, useState } from "react";

import { api, post } from "../../api";
import { menuWidth } from "../../theme";
import type { MediaKind } from "../../types";
import { ActionMenuItems } from "../../ui/ActionBar";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { plural } from "../../ui/plural";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { usePhone } from "../../ui/usePhone";
import { chipProps, iconChipProps } from "../generation/chip";
import { uploadTypes } from "../generation/references";
import { galleryKey } from "./queries";

const listedFailures = 5;

/** Every file a drop holds, walking into dropped folders; call it inside the drop handler. */
export async function droppedFiles(data: DataTransfer): Promise<File[]> {
  // Entries must be taken before the handler returns; the walk itself can wait.
  const entries = [...data.items].flatMap((item) => item.webkitGetAsEntry?.() || []);
  if (!entries.length) return [...data.files];
  return (await Promise.all(entries.map(entryFiles))).flat();
}

async function entryFiles(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile)
    return [
      await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      ),
    ];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  // A folder lists its entries in batches, ending with an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (!batch.length) break;
    children.push(...batch);
  }
  return (await Promise.all(children.map(entryFiles))).flat();
}

/**
 * Uploads each supported image and video in turn, with its progress and then any file that failed
 * or was skipped as one notification. `onUploaded` hears when at least one arrived.
 */
export function useGalleryUpload(onUploaded: () => void) {
  const client = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const added = () => {
    void client.invalidateQueries({ queryKey: galleryKey });
    onUploaded();
  };
  const reddit = useMutation({
    meta: { inlineError: true },
    mutationFn: (url: string) =>
      post<{ imported: number; failed: { image: number; error: string }[] }>(
        "/api/gallery/import/reddit",
        { url: url.trim() },
      ),
    onSuccess: (result) => {
      added();
      if (result.failed.length)
        notifications.show({
          color: "red",
          message: `${plural(result.imported, "image")} added to Uploads. ${result.failed.map((entry) => `Image ${entry.image}: ${entry.error}`).join(" ")}`,
        });
    },
  });
  async function upload(files: File[]) {
    const chosen = files.filter((file) => uploadTypes.includes(file.type));
    const skipped = files.length - chosen.length;
    if (!chosen.length) {
      notifications.show({
        color: "red",
        message: "Choose PNG, JPEG or WebP images, or MP4 or WebM videos.",
      });
      return;
    }
    setUploading(true);
    const id = `gallery-upload-${Date.now()}`;
    const progress = (done: number) => `Uploading ${done + 1} of ${chosen.length}…`;
    notifications.show({
      id,
      loading: true,
      autoClose: false,
      withCloseButton: false,
      message: progress(0),
    });
    const failed: string[] = [];
    for (const [index, file] of chosen.entries()) {
      notifications.update({ id, message: progress(index) });
      const form = new FormData();
      form.append("image", file);
      await api("/api/reference-assets/upload", { method: "POST", body: form }).catch(
        (error: Error) => failed.push(`${file.webkitRelativePath || file.name}: ${error.message}`),
      );
    }
    setUploading(false);
    const uploaded = chosen.length - failed.length;
    const summary = [
      uploaded ? `Uploaded ${plural(uploaded, "file")} to Uploads.` : "Nothing was uploaded.",
      failed.length && `${plural(failed.length, "file")} failed.`,
      skipped && `${plural(skipped, "other file")} skipped.`,
    ]
      .filter(Boolean)
      .join(" ");
    // The uploads show in the gallery; only what didn't arrive needs saying.
    if (!failed.length && !skipped) notifications.hide(id);
    else
      notifications.update({
        id,
        loading: false,
        withCloseButton: true,
        color: failed.length ? "red" : undefined,
        autoClose: failed.length ? false : 4000,
        message: (
          <Stack gap={2}>
            <Text size="sm">{summary}</Text>
            {failed.slice(0, listedFailures).map((line) => (
              <Text key={line} size="xs" c="dimmed">
                {line}
              </Text>
            ))}
            {failed.length > listedFailures && (
              <Text size="xs" c="dimmed">
                and {failed.length - listedFailures} more
              </Text>
            )}
          </Stack>
        ),
      });
    if (!uploaded) return;
    added();
  }
  return { upload, uploading, reddit };
}

/**
 * The gallery toolbar's Upload ▾: files, folders and Reddit images saved as the account's uploads.
 */
export function GalleryUpload({
  kind,
  upload,
}: {
  kind: MediaKind;
  upload: ReturnType<typeof useGalleryUpload>;
}) {
  const phone = usePhone();
  const [importing, setImporting] = useState(false);
  const [url, setUrl] = useState("");
  const closeImport = () => {
    if (!upload.reddit.isPending) setImporting(false);
  };
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const take = (input: HTMLInputElement) => {
    const files = [...(input.files || [])];
    // Choosing the same files again still fires a change.
    input.value = "";
    if (files.length) void upload.upload(files);
  };
  return (
    <>
      <Menu position="bottom-end" width={menuWidth}>
        <PopupTooltip label="Upload" disabled={!phone}>
          <Menu.Target>
            <Button
              {...(phone ? iconChipProps : chipProps)}
              aria-label="Upload"
              loading={upload.uploading}
              leftSection={phone ? undefined : <icons.upload size={15} />}
              rightSection={phone ? undefined : <ChevronDown size={14} />}
            >
              {phone ? <icons.upload size={16} /> : "Upload"}
            </Button>
          </Menu.Target>
        </PopupTooltip>
        <Menu.Dropdown>
          <ActionMenuItems
            groups={[
              [
                {
                  id: "upload-files",
                  label: "Upload Files…",
                  icon: icons.upload,
                  onClick: () => filesInput.current?.click(),
                },
                {
                  id: "upload-folder",
                  label: "Upload Folder…",
                  icon: FolderUp,
                  onClick: () => folderInput.current?.click(),
                },
              ],
              ...(kind === "image"
                ? [
                    [
                      {
                        id: "import-reddit",
                        label: "Import From Reddit…",
                        icon: Import,
                        onClick: () => {
                          upload.reddit.reset();
                          setImporting(true);
                        },
                      },
                    ],
                  ]
                : []),
            ]}
          />
        </Menu.Dropdown>
      </Menu>
      <Modal
        opened={importing}
        onClose={closeImport}
        title="Import From Reddit"
        size="md"
        fullScreen={phone}
        closeOnClickOutside={!upload.reddit.isPending}
        closeOnEscape={!upload.reddit.isPending}
        closeButtonProps={{ disabled: upload.reddit.isPending }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            upload.reddit.mutate(url, {
              onSuccess: () => {
                setImporting(false);
                setUrl("");
              },
            });
          }}
        >
          <Stack>
            <Text size="sm" c="dimmed">
              Save the post's images to your private Uploads.
            </Text>
            <TextInput
              label="Reddit Link"
              placeholder="https://www.reddit.com/r/…/comments/…"
              type="url"
              required
              value={url}
              onChange={(event) => setUrl(event.currentTarget.value)}
            />
            {upload.reddit.error && <Alert color="red">{upload.reddit.error.message}</Alert>}
            <DialogFooter onCancel={closeImport} pending={upload.reddit.isPending}>
              <Button type="submit" loading={upload.reddit.isPending} disabled={!url.trim()}>
                Import
              </Button>
            </DialogFooter>
          </Stack>
        </form>
      </Modal>
      <input
        ref={filesInput}
        type="file"
        multiple
        hidden
        accept={uploadTypes.join(",")}
        aria-label="Upload Files"
        onChange={(event) => take(event.currentTarget)}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        aria-label="Upload Folder"
        {...{ webkitdirectory: "" }}
        onChange={(event) => take(event.currentTarget)}
      />
    </>
  );
}
