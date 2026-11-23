import { titleCase } from "../../../../shared/titles";
import { compareNames } from "../../ui/DataTable";
import { ChipOption, ChipSelect } from "./ChipSelect";

const brands: Record<string, string> = { deepseek: "DeepSeek", glm: "GLM", mimo: "MiMo" };
// Parameter counts read 31B; other tokens with a letter after a digit (quantisations such as iq4r)
// keep their own casing.
const titled = (word: string) =>
  brands[word] ??
  (/^\d+(\.\d+)?[bm]$/i.test(word)
    ? word.toUpperCase()
    : /\d\p{L}/u.test(word)
      ? word
      : titleCase(word));
const modelTitle = (id: string) => id.split("/")[1]?.split("-").map(titled).join(" ") || id;
/** A gateway alias by its side and readable model name. */
export const textModelName = (id: string) => `${titled(id.split("/")[0])} · ${modelTitle(id)}`;

export function TextModelSelect({
  name,
  models,
  value,
  unset,
  clearable,
  onChange,
  disabled,
}: {
  name: string;
  models: string[];
  value: string | null;
  unset: string;
  clearable?: boolean;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const groups = ["cloud", "local"].flatMap((side) => {
    const items = models
      .filter((model) => model.startsWith(`${side}/`))
      .map((model) => ({ value: model, label: modelTitle(model) }))
      .sort((a, b) => compareNames(a.label, b.label));
    return items.length ? [{ group: titled(side), items }] : [];
  });
  return (
    <ChipSelect
      field
      name={name}
      searchable
      clearable={clearable}
      nothingFoundMessage="No Matches"
      data={[...(clearable ? [] : [{ value: "", label: unset }]), ...groups]}
      value={value ?? (clearable ? null : "")}
      renderOption={({ option, checked }) => <ChipOption label={option.label} checked={checked} />}
      onChange={onChange}
      label={value ? textModelName(value) : unset}
      disabled={disabled}
    />
  );
}
