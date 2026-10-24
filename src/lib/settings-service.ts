import type { Db } from "mongodb";
import { DEFAULT_CATEGORIES, DEFAULT_DEPARTMENTS, DEFAULT_OUTLETS } from "@/lib/constants";
import { getDb } from "@/lib/mongodb";
import type { FormOptions } from "@/lib/validation";
import { settingsCollection } from "@/models/Setting";

/** Outlets for the item-transfer forms (configurable in Settings; defaults until saved). */
export async function getOutlets(db?: Db): Promise<readonly string[]> {
  const database = db ?? (await getDb());
  const doc = await settingsCollection(database).findOne({ _id: "form-options" }, { projection: { outlets: 1 } });
  return doc?.outlets?.length ? doc.outlets : [...DEFAULT_OUTLETS];
}

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

import { log } from "@/lib/logger";
import type { FormOptionsInput } from "@/lib/validation-admin";

/**
 * Replace the public form's departments and categories. Existing complaints keep whatever value they
 * were submitted with, and the admin edit form still tolerates a value that has since been removed.
 */
export async function saveFormOptions(db: Db, args: { adminId: string; input: FormOptionsInput; correlationId: string }) {
  const now = new Date();
  await settingsCollection(db).updateOne(
    { _id: "form-options" },
    {
      $set: {
        departments: args.input.departments,
        categories: args.input.categories,
        ...(args.input.outlets ? { outlets: args.input.outlets } : {}), // untouched when not supplied
        updatedAt: now,
        updatedBy: args.adminId,
      },
    },
    { upsert: true },
  );
  log("info", "settings.form_options_saved", {
    adminId: args.adminId,
    correlationId: args.correlationId,
    departments: args.input.departments.length,
    categories: args.input.categories.length,
    outlets: args.input.outlets?.length,
  });
  return { departments: args.input.departments, categories: args.input.categories, outlets: args.input.outlets, updatedAt: now };
}
