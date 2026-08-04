import { getConceptIndex, getUserLevel } from "@/services/concepts";
import { TermPopover } from "./term-popover";

/**
 * Wraps a piece of jargon so it explains itself.
 *
 *   <Term slug="pe-ratio" />              renders the concept's own name
 *   <Term slug="pe-ratio">P/E</Term>      renders custom text
 *
 * Reads from the request-cached concept index, so using this fifty times on a
 * page costs one query. That is what makes it viable as the default way to
 * render any financial term rather than something used sparingly.
 */
export async function Term({
  slug,
  children,
}: {
  slug: string;
  children?: React.ReactNode;
}) {
  const [index, level] = await Promise.all([getConceptIndex(), getUserLevel()]);
  const concept = index.bySlug.get(slug);

  if (!concept) {
    // Never break the page over a missing explanation. In development, make
    // the gap obvious; in production, degrade to plain text.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`<Term>: no concept for slug "${slug}"`);
      return (
        <span className="underline decoration-wavy decoration-red-500">
          {children ?? slug}
        </span>
      );
    }
    return <>{children ?? slug}</>;
  }

  return (
    <TermPopover
      slug={concept.slug}
      term={concept.term}
      oneLiner={concept.oneLiner}
      level={concept.level}
      emphasis={level === "beginner" ? "clear" : "subtle"}
    >
      {children ?? concept.term}
    </TermPopover>
  );
}
