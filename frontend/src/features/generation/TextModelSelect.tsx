import { titleCase } from "../../../../shared/titles";
import { ChipOption, ChipSelect } from "./ChipSelect";

const brands: Record<string, string> = { deepseek: "DeepSeek", glm: "GLM", mimo: "MiMo" };
const titled = (word: string) => brands[word] ?? titleCase(word);
/** A gateway alias by its readable name. */
export const textModelName = (id: string) => {
  const [side, name = ""] = id.split("/");
  const words = name.split("-");
  if (words.at(-1) === "uncensored") {
    words.pop();
    const location = `${titled(side)} - Uncensored`;
    return words.length ? `${words.map(titled).join(" ")} · ${location}` : location;
  }
  return `${words.map(titled).join(" ")} · ${titled(side)}`;
};

export function TextModelSelect({
  name,
  models,
  value,
  unset,
  onChange,
  disabled,
}: {
  name: string;
  models: string[];
  value: string | null;
  unset: string;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <ChipSelect
      field
      name={name}
      searchable
      nothingFoundMessage="No Matches"
      data={[
        { value: "", label: unset },
        ...models.map((model) => ({ value: model, label: textModelName(model) })),
      ]}
      value={value ?? ""}
      renderOption={({ option, checked }) => <ChipOption label={option.label} checked={checked} />}
      onChange={onChange}
      label={value ? textModelName(value) : unset}
      disabled={disabled}
    />
  );
}
