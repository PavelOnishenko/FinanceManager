export const categories = [
  { id: "groceries", name: "Продукты", aliases: ["продукты", "продукт"] },
  { id: "snacks", name: "Снеки и сладости", aliases: ["снеки и сладости", "снеки", "сладости"] },
  { id: "restaurants", name: "Рестораны", aliases: ["рестораны", "ресторан", "кафе"] },
  { id: "entertainment", name: "Развлечения", aliases: ["развлечения", "развлечение"] },
  { id: "household", name: "Товары для дома", aliases: ["товары для дома", "для дома", "дом"] },
  { id: "electronics", name: "Техника", aliases: ["техника", "электроника"] },
  { id: "documents", name: "Документы", aliases: ["документы", "документ"] },
  { id: "business", name: "Фирмы", aliases: ["фирмы", "фирма", "ип", "бизнес"] },
  { id: "health", name: "Здоровье", aliases: ["здоровье", "медицина"] },
  { id: "personal-care", name: "Гигиена и красота", aliases: ["гигиена и красота", "гигиена", "красота"] },
  { id: "transport", name: "Транспорт", aliases: ["транспорт"] },
  { id: "clothes", name: "Одежда", aliases: ["одежда"] },
  { id: "nicotine", name: "Никотин", aliases: ["никотин"] },
  { id: "utilities", name: "Коммунальные услуги", aliases: ["коммунальные услуги", "коммуналка", "коммунальные"] },
  { id: "other", name: "Другое", aliases: ["другое", "прочее"] }
] as const;

export type CategoryId = (typeof categories)[number]["id"];

const plainCategoryTextPattern = /^[\p{L}\p{N} ]+$/u;

for (const category of categories) {
  assertPlainCategoryText(category.name, `Category ${category.id}`);
  for (const alias of category.aliases) assertPlainCategoryText(alias, `Alias of category ${category.id}`);
}

export function assertPlainCategoryText(value: string, label: string): void {
  if (!plainCategoryTextPattern.test(value))
    throw new Error(`${label} must contain only letters, numbers and spaces: ${value}`);
}
