import { checkAccess, ApplicationResultKind, type AccessDenied, type InvalidInput } from "./financeApplication";
import type { CategoryOption } from "../config/categories";
import type { Category, D1FinanceRepository, RepositoryResult } from "../storage/D1FinanceRepository";
import { repositoryFailureToInvalidInput } from "./repositoryFailure";

export type CategoryCommand =
  | { kind: "list"; active: boolean }
  | { kind: "details"; categoryId: string }
  | { kind: "add"; name: string }
  | { kind: "rename"; categoryId: string; name: string }
  | { kind: "active"; categoryId: string; active: boolean };

export type CategoryManagementResult =
  | AccessDenied
  | InvalidInput
  | { kind: "categories"; categories: CategoryOption[] }
  | { kind: "category"; category: Category }
  | { kind: "category-saved" };

// Every enabled member has the same category permissions.
export async function manageCategories(repository: D1FinanceRepository, telegramUserId: string, command: CategoryCommand): Promise<CategoryManagementResult> {
  const access = await checkAccess(repository, telegramUserId);
  if (access.kind === ApplicationResultKind.AccessDenied)
    return access;
  if (command.kind === "list")
    return { kind: "categories", categories: await repository.getCategories(command.active) };
  if (command.kind === "details") {
    const category = await repository.getCategory(command.categoryId);
    return category ? { kind: "category", category } : repositoryFailureToInvalidInput({ kind: "category-not-found" });
  }
  let result: RepositoryResult<CategoryOption | void>;
  if (command.kind === "add")
    result = await repository.addCategory(command.name);
  else if (command.kind === "rename")
    result = await repository.renameCategory(command.categoryId, command.name);
  else
    result = await repository.setCategoryActive(command.categoryId, command.active);
  return result.kind === "success" ? { kind: "category-saved" } : repositoryFailureToInvalidInput(result);
}
