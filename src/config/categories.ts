export type CategoryId = string;
export type CategoryOption = { id: CategoryId; name: string };

export function isValidCategoryId(value: string): boolean {
  return /^(?:[a-z][a-z0-9-]{0,19}|u_[A-Za-z0-9_-]{12})$/.test(value);
}

export type InvalidCategoryName = { kind: "invalid-category-name"; reason: "invalid-format" | "missing-letter" };
export type CategoryNameValidationResult = { kind: "valid-category-name"; name: string; nameKey: string } | InvalidCategoryName;

export function validateCategoryName(value: string): CategoryNameValidationResult {
  const name = value.trim().replace(/ +/g, " ");
  if (!name || name.length > 80 || /[^A-Za-zА-Яа-яЁё0-9 -]/.test(value))
    return { kind: "invalid-category-name", reason: "invalid-format" };
  if (!/[A-Za-zА-Яа-яЁё]/.test(name))
    return { kind: "invalid-category-name", reason: "missing-letter" };
  return { kind: "valid-category-name", name, nameKey: name.toLowerCase() };
}
