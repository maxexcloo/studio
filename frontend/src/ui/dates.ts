/** A formatter for dates and times in Australian English, whatever the browser's locale. */
export const dateFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-AU", options);

const dateTime = dateFormat({ dateStyle: "medium", timeStyle: "short" });

/** A date and time such as "14 Nov 2026, 3:05 pm". */
export const formatDateTime = (value: string | number | Date) => dateTime.format(new Date(value));
