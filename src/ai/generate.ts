import type { AiGeneration } from "@/db/schema";
import { getLlmProvider, isLlmConfigured } from "@/providers/registry";
import { inputHash, readFresh, storeGeneration } from "./cache";
import { specFor } from "./kinds";
import type { PromptSpec } from "./prompts";

/**
 * One call: cache, generate, store.
 *
 * Everything that generates text goes through here rather than touching a
 * provider directly, so the cache cannot be bypassed by accident and the
 * token accounting has one place to happen.
 */

export interface GenerateOptions {
  subjectKey: string;
  securityId?: string | null;
  /**
   * Regenerate even when the stored answer matches its inputs. For the
   * "regenerate" affordance in the UI, not for ordinary reads.
   */
  force?: boolean;
}

export interface GenerateResult {
  body: string;
  model: string;
  /** True when this call paid for the text rather than reading it back. */
  generated: boolean;
  inputTokens: number;
  outputTokens: number;
}

export async function generate(
  spec: PromptSpec,
  opts: GenerateOptions,
): Promise<GenerateResult> {
  if (!opts.force) {
    const { row, fresh } = await readFresh(spec, opts.subjectKey);
    if (row && fresh && !isSuperseded(row)) {
      return {
        body: row.body,
        model: row.model,
        generated: false,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
  }

  const kind = specFor(spec.kind);
  const result = await getLlmProvider().complete({
    kind: spec.kind,
    subject: spec.subject,
    system: spec.system,
    user: spec.user,
    maxTokens: kind.maxTokens,
    tier: kind.tier,
  });

  await storeGeneration({
    spec,
    subjectKey: opts.subjectKey,
    body: result.text,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    securityId: opts.securityId,
  });

  return {
    body: result.text,
    model: result.model,
    generated: true,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

/**
 * Whether a stored answer still describes its subject.
 *
 * Exported so a read path can show what it has *and* say that the figures
 * have moved since — which is more useful than either hiding stale text or
 * presenting it as current.
 */
export function isStale(row: AiGeneration, spec: PromptSpec): boolean {
  return row.inputHash !== inputHash(spec);
}

/**
 * Placeholder text left over from before a key was configured.
 *
 * The upgrade path this exists for: someone runs the app keyless, decides
 * they want the real thing, sets `ANTHROPIC_API_KEY` and re-runs the ingest.
 * Without this the prompts would be unchanged, every hash would still match,
 * and the app would keep serving "no API key is configured" indefinitely — a
 * cache hit is exactly the wrong answer there.
 *
 * Deliberately narrower than "regenerate when the model changes". Moving
 * between real models is not a reason to re-buy every summary the previous
 * one wrote; a placeholder is not an answer at all.
 */
export function isSuperseded(row: AiGeneration): boolean {
  return row.model === "mock" && isLlmConfigured();
}
