export type DiffLine =
  | { type: 'same' | 'add' | 'remove'; text: string; oldLine: number; newLine: number }
  | { type: 'skip'; count: number };
export function lineDiff(before: string, after: string, options?: { context?: number }): { lines: DiffLine[]; added: number; removed: number };
