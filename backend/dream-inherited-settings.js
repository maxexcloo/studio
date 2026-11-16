import { ownerDocuments, writeRuntimeDocument } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that lets accounts inherit the administrator's Dream defaults. Before
 * those defaults existed, every Dream save stored all of an account's settings, so values equal to
 * the then built-in defaults are dropped; any other value stays as the account's choice. Plans by
 * default; `apply` writes. A second run finds nothing.
 */
const builtIn = {
  enabled: false,
  paused: false,
  dailyImages: 40,
  dailyVideos: 4,
  images: true,
  videos: false,
  spicy: false,
};

export function dreamInheritedSettings(dataDir, { apply = false } = {}) {
  const documents = ownerDocuments(dataDir, "dream").flatMap(({ name, value }) => {
    const settings = value?.settings || {};
    const inherited = Object.keys(builtIn).filter((key) => settings[key] === builtIn[key]);
    return inherited.length ? [{ name, value, inherited }] : [];
  });
  if (apply)
    for (const { name, value, inherited } of documents)
      writeRuntimeDocument(dataDir, name, {
        ...value,
        settings: Object.fromEntries(
          Object.entries(value.settings).filter(([key]) => !inherited.includes(key)),
        ),
      });
  return {
    applied: apply,
    accounts: documents.length,
    settings: documents.reduce((count, { inherited }) => count + inherited.length, 0),
  };
}
