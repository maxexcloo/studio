import { Alert, Button, Menu, Modal, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FolderUp } from "lucide-react";
import { useRef, useState } from "react";

import { api, failure, post } from "../../api";
import { menuWidth } from "../../theme";
import { ActionMenuItems } from "../../ui/ActionBar";
import { canReadClipboard, readClipboard } from "../../ui/clipboard";
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
 * or was skipped as one notification, and imports links (`/api/gallery/import/link`). `onUploaded`
 * hears when at least one upload arrived.
 */
export function useGalleryUpload(onUploaded: () => void) {
  const client = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const added = () => {
    void client.invalidateQueries({ queryKey: galleryKey });
    onUploaded();
  };
  // A Civitai or Hugging Face link becomes a Library import; anything else, uploads.
  const link = useMutation({
    meta: { inlineError: true },
    mutationFn: (url: string) =>
      post<{
        import?: { title?: string; state: string };
        imported?: number;
        failed?: { image: number; error: string }[];
      }>("/api/gallery/import/link", { url: url.trim() }),
    onSuccess: (result) => {
      if (result.import) {
        notifications.show({
          color: result.import.state === "failed" ? "red" : undefined,
          message:
            result.import.state === "failed"
              ? "The import failed. Library › Imports says why."
              : `${result.import.title || "The link"} is in Library › Imports.`,
        });
        return;
      }
      added();
      if (result.failed?.length)
        notifications.show({
          color: "red",
          message: `${plural(result.imported || 0, "image")} added to Uploads. ${result.failed.map((entry) => `Image ${entry.image}: ${entry.error}`).join(" ")}`,
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
  return { upload, uploading, link };
}

/**
 * The gallery toolbar's Import ▾: files and folders uploaded, a link (a Reddit post, an image or
 * video, or for administrators a Civitai or Hugging Face model) or the clipboard's images or link,
 * saved as the account's private uploads.
 */
export function GalleryImport({ upload }: { upload: ReturnType<typeof useGalleryUpload> }) {
  const phone = usePhone();
  const [importing, setImporting] = useState(false);
  const [url, setUrl] = useState("");
  const closeImport = () => {
    if (!upload.link.isPending) setImporting(false);
  };
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const take = (input: HTMLInputElement) => {
    const files = [...(input.files || [])];
    // Choosing the same files again still fires a change.
    input.value = "";
    if (files.length) void upload.upload(files);
  };
  const paste = () =>
    void readClipboard().then(({ files, text }) => {
      if (files.length) void upload.upload(files);
      else if (/^https?:\/\/\S+$/i.test(text)) upload.link.mutate(text, { onError: failure });
      else notifications.show({ message: "The clipboard has no image or link." });
    }, failure);
  return (
    <>
      <Menu position="bottom-end" width={menuWidth}>
        <PopupTooltip label="Import" disabled={!phone}>
          <Menu.Target>
            <Button
              {...(phone ? iconChipProps : chipProps)}
              aria-label="Import"
              loading={upload.uploading || (upload.link.isPending && !importing)}
              leftSection={phone ? undefined : <icons.import size={15} />}
              rightSection={phone ? undefined : <ChevronDown size={14} />}
            >
              {phone ? <icons.import size={16} /> : "Import"}
            </Button>
          </Menu.Target>
        </PopupTooltip>
        <Menu.Dropdown>
          <ActionMenuItems
            groups={[
              [
                ...(canReadClipboard()
                  ? [
                      {
                        id: "from-clipboard",
                        label: "From Clipboard",
                        icon: icons.paste,
                        onClick: paste,
                      },
                    ]
                  : []),
                {
                  id: "from-url",
                  label: "From URL…",
                  icon: icons.link,
                  onClick: () => {
                    upload.link.reset();
                    setImporting(true);
                  },
                },
              ],
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
            ]}
          />
        </Menu.Dropdown>
      </Menu>
      <Modal
        opened={importing}
        onClose={closeImport}
        title="Import From URL"
        size="md"
        fullScreen={phone}
        closeOnClickOutside={!upload.link.isPending}
        closeOnEscape={!upload.link.isPending}
        closeButtonProps={{ disabled: upload.link.isPending }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            upload.link.mutate(url, {
              onSuccess: () => {
                setImporting(false);
                setUrl("");
              },
            });
          }}
        >
          <Stack>
            <Text size="sm" c="dimmed">
              Save an image, a video or a Reddit post's images to your private Uploads.
              Administrators can also import Civitai and Hugging Face links into the Library.
            </Text>
            <TextInput
              label="Link"
              placeholder="https://…"
              type="url"
              required
              data-autofocus
              value={url}
              onChange={(event) => setUrl(event.currentTarget.value)}
            />
            {upload.link.error && <Alert color="red">{upload.link.error.message}</Alert>}
            <DialogFooter onCancel={closeImport} pending={upload.link.isPending}>
              <Button type="submit" loading={upload.link.isPending} disabled={!url.trim()}>
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
