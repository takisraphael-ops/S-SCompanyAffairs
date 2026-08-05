/**
 * Shared shape for server-action form results.
 *
 * Kept out of the "use server" module deliberately: such files may only
 * export async functions, so a plain constant there fails the build.
 */
export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
};

export const initialFormState: FormState = { status: "idle" };
