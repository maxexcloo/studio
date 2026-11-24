/** A formatter for dates and times in Australian English, whatever the browser's locale. */
export const dateFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-AU", options);

const date = dateFormat({ dateStyle: "medium" });
const dateTime = dateFormat({ dateStyle: "medium", timeStyle: "short" });

/** A date such as "14 Nov 2026". */
export const formatDate = (value: string | number | Date) => date.format(new Date(value));

/** A date and time such as "14 Nov 2026, 3:05 pm". */
export const formatDateTime = (value: string | number | Date) => dateTime.format(new Date(value));
