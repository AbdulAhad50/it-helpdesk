import type { Db } from "mongodb";
import { DEFAULT_CATEGORIES, DEFAULT_DEPARTMENTS } from "@/lib/constants";
import { getDb } from "@/lib/mongodb";
import type { FormOptions } from "@/lib/validation";
import { settingsCollection } from "@/models/Setting";

/**
 * Departments and problem categories. The company can change them later (Settings page, Phase 5);
 * until an administrator saves a change, the built-in defaults apply.
 */
export async function getFormOptions(db?: Db): Promise<FormOptions> {
  const database = db ?? (await getDb());
  const doc = await settingsCollection(database).findOne({ _id: "form-options" });
  return {
    departments: doc?.departments?.length ? doc.departments : [...DEFAULT_DEPARTMENTS],
    categories: doc?.categories?.length ? doc.categories : [...DEFAULT_CATEGORIES],
  };
}
