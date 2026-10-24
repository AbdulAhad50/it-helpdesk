import type { Db } from "mongodb";

export interface FormOptionsSetting {
  _id: "form-options";
  departments: string[];
  categories: string[];
  /** Outlets for the item-transfer forms. Absent until an administrator saves them (defaults apply). */
  outlets?: string[];
  updatedAt: Date;
  updatedBy: string | null;
}

export const settingsCollection = (db: Db) => db.collection<FormOptionsSetting>("settings");
