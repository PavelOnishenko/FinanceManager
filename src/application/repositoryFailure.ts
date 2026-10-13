import type { RepositoryFailure } from "../storage/D1FinanceRepository";
import type { InvalidInput } from "./financeApplication";

export function repositoryFailureToInvalidInput(failure: RepositoryFailure): InvalidInput {
  if (failure.kind === "invalid-category-name")
    return { kind: "invalid-input", message: {
      "missing-letter": "Название должно содержать хотя бы одну букву.",
      "invalid-format": "Название: 1–80 символов, русские или английские буквы, цифры 0–9, пробелы и дефис «-»."
    }[failure.reason] };
  return { kind: "invalid-input", message: {
      "invalid-category-id": "Некорректный идентификатор категории.",
      "category-not-found": "Категория не найдена. Откройте «Категории» заново.",
      "category-name-taken": "Категория с таким названием уже существует, в том числе в архиве.",
      "category-unavailable": "Категория недоступна. Выберите активную категорию заново.",
      "expense-not-found": "Расход не найден."
  }[failure.kind] };
}
