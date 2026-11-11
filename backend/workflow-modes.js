// Keep validation and graph construction on the same image mode.
export function hasReferenceImage(body) {
  return Boolean(
    body.startImage ||
    body.startImageId ||
    (body.referenceAssets || []).some((item) => item?.assetId || item?.comfyName),
  );
}

export function resolveImageMode(workflow, body) {
  return workflow.imageModes?.[hasReferenceImage(body) ? "reference" : "generate"] || workflow;
}

export function selectImageMode(workflow, body) {
  const references = (body.referenceAssets || []).filter((item) => item?.comfyName);
  const hasImage = hasReferenceImage(body);
  const mode = resolveImageMode(workflow, body);
  if (mode === workflow && workflow.kind !== "video") return workflow;
  const selected = { ...workflow, ...mode, graph: structuredClone(mode.graph || workflow.graph) };
  if (!hasImage && selected.kind !== "video") return selected;

  const slots = selected.mediaInputs || [];
  const supplied = new Set(references.map((item) => item.slot));
  if (slots.length && (body.startImage || body.startImageId)) supplied.add(slots[0].id);
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

function omitReference(graph, loader) {
  if (!loader || !graph[loader]) return;
  const removed = [loader];
  delete graph[loader];
  while (removed.length) {
    const missing = removed.shift();
    for (const [id, node] of Object.entries(graph)) {
      const affected = Object.entries(node.inputs || {}).filter(([, value]) =>
        linkedTo(value, missing),
      );
      if (!affected.length) continue;
      if (node.class_type === "ReferenceLatent" && affected.every(([name]) => name === "latent")) {
        const replacement = node.inputs.conditioning;
        for (const consumer of Object.values(graph)) {
          for (const [name, value] of Object.entries(consumer.inputs || {})) {
            if (linkedTo(value, id)) consumer.inputs[name] = [...replacement];
          }
        }
        delete graph[id];
      } else if (
        ["ImageScaleToTotalPixels", "VAEEncode", "GetImageSize"].includes(node.class_type)
      ) {
        delete graph[id];
        removed.push(id);
      } else if (
        affected.every(
          ([name]) =>
            name.startsWith("images.") ||
            name.startsWith("ref_images.") ||
            name === "first_frame" ||
            name === "last_frame",
        )
      ) {
        for (const [name] of affected) delete node.inputs[name];
      } else {
        throw new Error(
          `Cannot omit optional reference from ${node.class_type}.${affected[0][0]}.`,
        );
      }
    }
  }
}
