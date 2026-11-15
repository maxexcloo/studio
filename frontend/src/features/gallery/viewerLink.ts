/** Generated outputs use their permanent account number; uploads already have short IDs. */
export const viewerItemId = (item: { id: string; number?: number }) =>
  item.number ? String(item.number) : item.id;

export const isResultNumber = (id: string) => /^[1-9]\d{0,8}$/.test(id);
