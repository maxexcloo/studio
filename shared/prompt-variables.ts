export const promptVariable = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

export const promptVariables = (text: string) =>
  [...new Set(Array.from(text.matchAll(promptVariable), ([, name]) => name))].sort();
