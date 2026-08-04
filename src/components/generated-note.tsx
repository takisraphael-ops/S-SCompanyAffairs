import ReactMarkdown from "react-markdown";

/**
 * Generated prose, labelled as such wherever it appears.
 *
 * Every piece of model-written text in the app renders through this, for one
 * reason: a reader has to be able to tell, without thinking about it, which
 * words on the page came from a filing and which came from a model. The two
 * are worth different amounts of trust, and mixing them in the same voice is
 * the single most misleading thing this app could do.
 *
 * So the badge is not decoration. It names the model, and when the model is
 * the placeholder it says so in different words, because "AI" on text no
 * model wrote would be its own small lie.
 */
export function GeneratedNote({
  body,
  model,
  variant = "block",
  stale = false,
}: {
  body: string;
  model: string;
  /** `block` for a standalone panel, `inline` for a line inside a feed row. */
  variant?: "block" | "inline";
  stale?: boolean;
}) {
  const placeholder = model === "mock";

  const badge = (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        placeholder
          ? "border border-dashed border-neutral-400 text-neutral-400"
          : "border border-neutral-300 text-neutral-500 dark:border-neutral-700"
      }`}
      title={
        placeholder
          ? "Placeholder text — no model is configured"
          : `Written by ${model}. Grounded in the figures shown, but check anything that matters.`
      }
    >
      {placeholder ? "Placeholder" : "AI"}
    </span>
  );

  const prose = (
    <div
      className={`space-y-2 leading-relaxed ${
        variant === "inline"
          ? "text-sm text-neutral-500"
          : "text-[15px] text-neutral-700 dark:text-neutral-300"
      }`}
    >
      {/*
        A React tree, not injected HTML — the same reason concept bodies use
        react-markdown. Model output is untrusted text and must never be able
        to introduce markup of its own.
      */}
      <ReactMarkdown
        components={{
          p: ({ children }) => <p>{children}</p>,
          em: ({ children }) => (
            <em className="italic text-neutral-400">{children}</em>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          a: ({ children }) => <>{children}</>,
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );

  if (variant === "inline") {
    return (
      <div className="mt-1.5 flex items-start gap-2">
        {badge}
        {prose}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {badge}
        {stale && (
          <span className="text-[11px] text-neutral-400">
            The figures have changed since this was written.
          </span>
        )}
      </div>
      {prose}
    </div>
  );
}
