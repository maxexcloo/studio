/** A listed profile as it runs on `backend`, with that backend's own reference slots. */
export const runProfile = (profile, backend) =>
  profile?.backendOptions?.find((option) => option.id === backend)?.profile || profile;

// Keep validation and graph construction on the same image mode.
export function hasReferenceImage(body) {
  return Boolean((body.referenceAssets || []).some((item) => item?.assetId || item?.comfyName));
}

export function resolveImageMode(workflow, body) {
  return workflow.imageModes?.[hasReferenceImage(body) ? "reference" : "generate"] || workflow;
}

export function selectImageMode(workflow, body) {
  const references = (body.referenceAssets || []).filter(
    (item) => item?.assetId || item?.comfyName,
  );
  const hasImage = hasReferenceImage(body);
  const mode = resolveImageMode(workflow, body);
  if (mode === workflow && workflow.kind !== "video") return workflow;
  const selected = { ...workflow, ...mode, graph: structuredClone(mode.graph || workflow.graph) };
  if (!hasImage && selected.kind !== "video") return selected;

  const slots = selected.mediaInputs || [];
  const supplied = new Set(references.map((item) => item.slot));
  for (const slot of slots) {
    if (supplied.has(slot.id)) {
      if (slot.follows && !supplied.has(slot.follows))
        throw new Error("Add the preceding reference image before additional references.");
      continue;
    }
    if (slot.required || slot.min > 0) continue;
    omitReference(selected.graph, slot.control?.node);
  }
  return selected;
}

function linkedTo(value, id) {
  return Array.isArray(value) && value.length === 2 && value[0] === id;
}

const referenceInput = (name) =>
  name.startsWith("images.") ||
  name.startsWith("ref_images.") ||
  name === "first_frame" ||
  name === "last_frame";

/** How omitting `node`'s inputs `affected` changes it, or nothing where it cannot do without them. */
function omission(node, affected) {
  if (node.class_type === "ReferenceLatent" && affected.every(([name]) => name === "latent"))
    return "bypass";
  if (["ImageScaleToTotalPixels", "VAEEncode", "GetImageSize"].includes(node.class_type))
    return "delete";
  if (affected.every(([name]) => referenceInput(name))) return "unlink";
}

const consumers = (graph, id) =>
  Object.entries(graph).flatMap(([consumer, node]) => {
    const affected = Object.entries(node.inputs || {}).filter(([, value]) => linkedTo(value, id));
    return affected.length ? [[consumer, node, affected]] : [];
  });

function omitReference(graph, loader) {
  // A slot on the generating node itself (Radiance), whose output is the work rather than a
  // reference, stays at its empty default.
  if (!graph[loader] || consumers(graph, loader).some(([, node, a]) => !omission(node, a))) return;
  const removed = [loader];
  delete graph[loader];
  while (removed.length) {
    const missing = removed.shift();
    for (const [id, node, affected] of consumers(graph, missing)) {
      const change = omission(node, affected);
      if (change === "bypass") {
        const replacement = node.inputs.conditioning;
        for (const consumer of Object.values(graph)) {
          for (const [name, value] of Object.entries(consumer.inputs || {})) {
            if (linkedTo(value, id)) consumer.inputs[name] = [...replacement];
          }
        }
        delete graph[id];
      } else if (change === "delete") {
        delete graph[id];
        removed.push(id);
      } else if (change === "unlink") {
        for (const [name] of affected) delete node.inputs[name];
      } else {
        throw new Error(
          `Cannot omit optional reference from ${node.class_type}.${affected[0][0]}.`,
        );
      }
    }
  }
}
