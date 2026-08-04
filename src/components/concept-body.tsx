import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a concept's markdown body.
 *
 * react-markdown builds a React tree rather than injecting HTML, so authored
 * content can never introduce script through `dangerouslySetInnerHTML`. The
 * indented blocks in the content become `pre` elements and are used for
 * formulas, which is why they are styled as display blocks rather than as
 * source code.
 */
export function ConceptBody({ markdown }: { markdown: string }) {
  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{children}</p>,
          /*
            Tailwind's preflight resets heading sizes, so a markdown `##` is
            body text until it is styled. Restored here rather than with a
            prose plugin: two rules is cheaper than a dependency, and the
            digest leans on them to be readable at all.
          */
          h2: ({ children }) => (
            <h3 className="pt-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="pt-1 text-[15px] font-semibold">{children}</h4>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-neutral-900 dark:text-neutral-100">
              {children}
            </strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5">{children}</ol>
          ),
          code: ({ children }) => (
            <code className="rounded bg-neutral-100 px-1 py-0.5 text-[13px] dark:bg-neutral-800">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="tnum overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-[13px] text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
              {children}
            </pre>
          ),
          a: ({ href, children }) => {
            const target = href ?? "#";
            // Internal concept links stay client-side; anything else opens out.
            if (target.startsWith("/")) {
              return (
                <Link
                  href={target}
                  className="font-medium text-neutral-900 underline underline-offset-2 hover:opacity-70 dark:text-neutral-100"
                >
                  {children}
                </Link>
              );
            }
            return (
              <a
                href={target}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2 hover:opacity-70"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
