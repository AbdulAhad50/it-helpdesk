import { z } from "zod";
import { PASSWORD_MAX } from "@/lib/password-policy";

export const loginSchema = z.object({
  email: z
    .string({ error: "Enter your email." })
    .trim()
    .toLowerCase()
    .min(1, "Enter your email.")
    .max(254, "Enter a valid email.")
    .pipe(z.email("Enter a valid email.")),
  // Not policy-checked on login (old passwords must still work). Capped so nobody can make us hash megabytes.
  password: z.string({ error: "Enter your password." }).min(1, "Enter your password.").max(PASSWORD_MAX, "Password is too long."),
});
export type LoginInput = z.input<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string({ error: "Enter your current password." }).min(1, "Enter your current password.").max(PASSWORD_MAX),
  newPassword: z.string({ error: "Enter a new password." }).min(1, "Enter a new password.").max(PASSWORD_MAX, `Use ${PASSWORD_MAX} characters or fewer.`),
});
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
