import { comparisonSet } from "./domain/compare.ts";
import { readRuntimeDocument } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that makes each compare run from before runs recorded their result set
 * one: its variants' gallery results take the set a run records now (`comparisonSet`), so the
 * gallery keeps them together and links back to the comparison. Only runs whose results are in no
 * set yet change; Compare Selected (chosen images) and MCP comparisons, whose results share their
 * call's set, keep theirs. It patches the running server's gallery, so it runs only through
 * POST /api/maintenance/migrations. A second run finds nothing.
 */
const offline =
  "Patches the running gallery, so it runs only in Studio: POST /api/maintenance/migrations.";
const letter = (index) => String.fromCharCode(65 + index);

/** `gallery`: `{ items(), update(jobId, patch) }`, the server's gallery and its job update. */
export function comparisonSets(dataDir, { apply = false, gallery } = {}) {
  const result = { applied: false, comparisons: 0, items: 0, examples: [] };
  if (!gallery) return { ...result, skipped: offline };
  let records;
  try {
    records = readRuntimeDocument(dataDir, "comparisons");
  } catch (error) {
    if (error.code === "ENOENT") return result;
    throw error;
  }
  const byJob = new Map();
  for (const item of gallery.items())
    if (item.jobId) byJob.set(item.jobId, [...(byJob.get(item.jobId) || []), item]);
  const plan = records.filter(
    (record) =>
      !record.itemIds &&
      record.jobIds.some((id) => byJob.has(id)) &&
      record.jobIds.every((id) => (byJob.get(id) || []).every((item) => !item.resultSet)),
  );
  result.comparisons = plan.length;
  result.items = plan.reduce(
    (total, record) => total + record.jobIds.flatMap((id) => byJob.get(id) || []).length,
    0,
  );
  result.examples = plan.slice(0, 5).map(({ id, createdAt }) => ({ id, createdAt }));
  if (!apply || !plan.length) return result;
  for (const record of plan)
    record.jobIds.forEach((jobId, index) =>
      gallery.update(jobId, {
        resultSet: comparisonSet(
          record.id,
          index,
          record.labels?.[index] || `Variant ${letter(index)}`,
        ),
      }),
    );
  result.applied = true;
  return result;
}
