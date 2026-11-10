import { Select } from "@mantine/core";

/**
 * A gateway text model, from the models the gateway and Studio's text workloads offer; the current
 * `value` stays a choice where the list lacks it. `automatic` labels an empty choice where there is one.
 */
export function TextModelSelect({
  label,
  models,
  value,
  onChange,
  automatic,
  disabled,
}: {
  label: string;
  models: string[];
  value: string;
  onChange: (model: string) => void;
  automatic?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      aria-label={label}
      data={[
        ...(automatic ? [{ value: "", label: automatic }] : []),
        ...[...new Set([...models, value].filter(Boolean))].map((id) => ({ value: id, label: id })),
      ]}
      value={value}
      onChange={(choice) => onChange(choice || "")}
      disabled={disabled}
      allowDeselect={false}
      searchable
      nothingFoundMessage="No Matches"
      w={{ base: "100%", sm: 240 }}
    />
  );
}
