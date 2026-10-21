import { Dropdown, type DropdownOption } from './Dropdown';

export type MultiSelectOption = DropdownOption;

/**
 * A dropdown that picks several values (UI-PATTERNS › Dropdowns): the trigger
 * names the one picked or counts them, the menu ticks values with All and
 * Clear in its head, a search field once the list is long, and disabled values
 * say why. It opens in the dialog it sits in, so focus and clicks stay there.
 */
export function MultiSelect({ label, values, options, onChange, disabled, allLabel = 'All', noneLabel = 'None', searchFrom = 8 }: {
  label: string; values: string[]; options: MultiSelectOption[]; onChange: (values: string[]) => void;
  disabled?: boolean; allLabel?: string; noneLabel?: string; searchFrom?: number;
}) {
  return <Dropdown multiple label={label} value={values} options={options} onChange={onChange} disabled={disabled} allLabel={allLabel} noneLabel={noneLabel} searchFrom={searchFrom} variant="field" className="multi-select-trigger" />;
}
