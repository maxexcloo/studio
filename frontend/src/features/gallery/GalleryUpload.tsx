import { useRef, useState } from "react";
import { Button, Menu, Stack, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FolderUp } from "lucide-react";
import { api } from "../../api";
import { icons } from "../../ui/icons";
import { usePhone } from "../../ui/usePhone";
import { chipProps, iconChipProps } from "../generation/chip";
import { uploadTypes } from "../generation/references";
import { ActionMenuItems } from "./ActionBar";
import { menuWidth } from "../../theme";

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
 * Uploads each supported image and video in turn, with its progress and then the outcome (listing
 * any file that failed) as one notification. `onUploaded` hears when at least one arrived.
 */
export function useGalleryUpload(onUploaded: () => void) {
  const client = useQueryClient();
  const [uploading, setUploading] = useState(false);
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
    const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
    const summary = [
      uploaded ? `Uploaded ${plural(uploaded, "file")} to Uploads.` : "Nothing was uploaded.",
      failed.length && `${plural(failed.length, "file")} failed.`,
      skipped && `${plural(skipped, "other file")} skipped.`,
    ]
      .filter(Boolean)
      .join(" ");
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
    void client.invalidateQueries({ queryKey: ["gallery"] });
    void client.invalidateQueries({ queryKey: ["reference-gallery"] });
    onUploaded();
  }
  return { upload, uploading };
}

/**
 * The gallery toolbar's Upload ▾: many files or a whole folder, saved as the account's own uploads.
 * Library › Import takes a Reddit post's images.
 */
export function GalleryUpload({ upload }: { upload: ReturnType<typeof useGalleryUpload> }) {
  const phone = usePhone();
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
        <Tooltip label="Upload" disabled={!phone}>
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
        </Tooltip>
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
            ]}
          />
        </Menu.Dropdown>
      </Menu>
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
