import { Dropdown, type DropdownOption } from './Dropdown';

export type MultiSelectOption = DropdownOption;

/**
 * A dropdown that picks several values (UI-PATTERNS › Dropdowns): the trigger
 * names the one picked or counts them, the menu ticks values with All and
 * Clear in its head, a search field once the list is long (unless `searchFrom`
 * is Infinity), and disabled values say why. It opens in the dialog it sits
 * in, so focus and clicks stay there.
 *
 * All picks every enabled value. Where values are disabled only until another
 * is picked (References need Generation), pass `onAll` and `allPicked` so one
 * press picks everything at once rather than the enabled half.
 */
export function MultiSelect({ label, values, options, onChange, disabled, allLabel = 'All', noneLabel = 'None', searchFrom = 8, onAll, allPicked }: {
  label: string; values: string[]; options: MultiSelectOption[]; onChange: (values: string[]) => void;
  disabled?: boolean; allLabel?: string; noneLabel?: string; searchFrom?: number;
  onAll?: () => void; allPicked?: boolean;
}) {
  return <Dropdown multiple label={label} value={values} options={options} onChange={onChange} disabled={disabled} allLabel={allLabel} noneLabel={noneLabel} searchFrom={searchFrom} onAll={onAll} allPicked={allPicked} variant="field" className="multi-select-trigger" />;
}
