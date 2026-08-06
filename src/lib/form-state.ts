/**
 * Shared shape for server-action form results.
 *
 * Kept out of the "use server" module deliberately: such files may only
 * export async functions, so a plain constant there fails the build.
 */
export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  /**
   * The symbol a refusal was about, when the refusal is one the user is
   * entitled to overrule.
   *
   * Set only for a symbol no source recognised — a real possibility for a
   * foreign listing, which EDGAR has never heard of. A malformed symbol never
   * sets it: that is a typo, not a judgement call, and there is nothing to
   * overrule. Presence of this field is what puts the override on screen.
   */
  unrecognised?: string;
};

export const initialFormState: FormState = { status: "idle" };
