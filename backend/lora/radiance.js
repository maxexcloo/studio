import { loraCompatibility, loraFamilyId } from "../../shared/profiles.ts";
import { familyFromName, refinedFamily } from "../family-catalogue.js";
import { isFastH3, isRadianceNode } from "../providers/radiance.ts";
import { catalogueLoraInfo, loraCatalogue } from "./info.js";

const isNoct = (model) => /^noct(?:q)?(?:[-_. ]|$)/i.test(model.split(/[\\/]/).pop());

function radianceBase(model, family) {
  return {
    model,
    family: refinedFamily(familyFromName(model) || loraFamilyId(family), model),
    accepts: Boolean(model) && !isFastH3(model) && !/\biq8r\b/i.test(model),
  };
}

/**
 * Noct takes no optional LoRAs and stays on its own base; its profile's fixed adapters (Lightning)
 * still run where the base takes them. Other Radiance models may have a separate LoRA model.
 */
export function workflowLoraBase(workflow, modelName = "") {
  const { defaults, family, graph, loraStack } = workflow;
  const node =
    graph?.[loraStack?.node] ||
    Object.values(graph || {}).find((node) => isRadianceNode(node?.class_type));
  const declared = String(defaults?.model || node?.inputs?.model || "");
  const model = String(modelName || declared);
  const noct = [declared, model].find(isNoct);
  if (noct) return { model: noct, family, accepts: false };
  if (!isRadianceNode(node?.class_type)) return undefined;
  return radianceBase(String(loraStack?.model || model), family);
}

/** Fixed adapters may be acceleration/supporting files. Their base requirements still apply. */
export function radianceLorasForBase(loras, workflow, model) {
  if (!loras?.length) return [];
  const loraBase = radianceBase(String(model || ""), workflow.family);
  if (!loraBase.accepts) return [];
  const view = loraCatalogue().loraView();
  return loras.filter(({ name }) => {
    const file =
      Object.hasOwn(view.catalogue, name) || /\.safetensors$/i.test(name)
        ? name
        : `${name}.safetensors`;
    const info = catalogueLoraInfo(file, undefined, view);
    return (
      !info.unavailableReason &&
      loraCompatibility(info, { id: workflow.profileId, recipe: workflow.recipe, loraBase }) !==
        "other"
    );
  });
}
