export const categories = [
  { id: "groceries", name: "Продукты" },
  { id: "snacks", name: "Снеки и сладости" },
  { id: "restaurants", name: "Рестораны" },
  { id: "entertainment", name: "Развлечения" },
  { id: "household", name: "Товары для дома" },
  { id: "electronics", name: "Техника" },
  { id: "documents", name: "Документы" },
  { id: "business", name: "Фирмы" },
  { id: "health", name: "Здоровье" },
  { id: "personal-care", name: "Гигиена и красота" },
  { id: "transport", name: "Транспорт" },
  { id: "clothes", name: "Одежда" },
  { id: "nicotine", name: "Никотин" },
  { id: "utilities", name: "Коммунальные услуги" },
  { id: "other", name: "Другое" },
  { id: "gifts", name: "Подарки" },
  { id: "lost-money", name: "Потерянные деньги" },
  { id: "subscriptions", name: "Подписки" },
  { id: "communication", name: "Связь" }
] as const;

export type CategoryId = (typeof categories)[number]["id"];

const plainCategoryTextPattern = /^[\p{L}\p{N} ]+$/u;

for (const category of categories)
  assertPlainCategoryText(category.name, `Category ${category.id}`);

export function assertPlainCategoryText(value: string, label: string): void {
  if (!plainCategoryTextPattern.test(value))
    throw new Error(`${label} must contain only letters, numbers and spaces: ${value}`);
}
