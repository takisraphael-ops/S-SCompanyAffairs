/**
 * Result shape for the explain-a-figure server action.
 *
 * Kept out of the "use server" module for the same reason as FormState: such
 * files may only export async functions, so a type or a constant there fails
 * the build.
 */
export type ExplainState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      body: string;
      /** The model that wrote it; "mock" means placeholder text. */
      model: string;
      /** True when the figures have moved since this was written. */
      stale: boolean;
    };

export const initialExplainState: ExplainState = { status: "idle" };
