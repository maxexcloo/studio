/**
 * Folder and file names Studio keeps on disk from HEISS UI. Gallery records,
 * media folders and ComfyUI's output folder hold these paths, so they stay
 * until the explicit on-disk migration (CONFIGURATION.md#on-disk-names)
 * moves the files and rewrites the records. Studio writes the current names
 * and recognises the Studio names beside them, so files the migration has
 * already moved keep working.
 */

/** The folder in ComfyUI's output (and in Studio media) that Studio saves into. */
export const outputFolderName = "heiss-ui";
/** Every name that folder may have: the one written now, then the one the migration moves it to. */
export const outputFolderNames = Object.freeze([outputFolderName, "studio"]);

/** Where Delete All puts files for 30 days, beside them in the output or media folder. */
export const trashFolderName = ".heiss-trash";
export const trashFolderNames = Object.freeze([trashFolderName, ".studio-trash"]);

/** An account's own output folder, under each name the output folder may have; the first is written. */
export function accountFolders(ownerHash) {
  return outputFolderNames.map((name) => `${name}/accounts/${ownerHash}`);
}
