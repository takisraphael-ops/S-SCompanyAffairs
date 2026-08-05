/**
 * Plain-English descriptions of SEC form types.
 *
 * "8-K" tells you nothing unless you already know. Since this app exists to
 * explain rather than assume, every filing row carries a sentence saying what
 * the form actually is, and links to the concept where P1 explains it more
 * fully.
 */

export interface FormInfo {
  label: string;
  description: string;
  /** Concept slug from src/content/concepts, where one exists. */
  concept?: string;
  /** Roughly how much this form usually matters. Drives emphasis. */
  weight: number;
}

const FORMS: Record<string, FormInfo> = {
  "10-K": {
    label: "Annual report",
    description:
      "The full yearly report: audited accounts, a description of the business, and what management thinks could go wrong.",
    concept: "form-10-k",
    weight: 1,
  },
  "10-Q": {
    label: "Quarterly report",
    description:
      "Quarterly financial update. Shorter than the annual report and not fully audited.",
    concept: "form-10-q",
    weight: 0.9,
  },
  "8-K": {
    label: "Material event",
    description:
      "Something significant happened that shareholders should not wait for the next quarterly report to hear about.",
    concept: "form-8-k",
    weight: 0.95,
  },
  "4": {
    label: "Insider trade",
    description:
      "A director, officer or major shareholder bought or sold company stock.",
    concept: "form-4",
    weight: 0.6,
  },
  "3": {
    label: "Initial insider holding",
    description:
      "First declaration of stock held by someone who has just become an insider.",
    concept: "form-4",
    weight: 0.4,
  },
  "5": {
    label: "Annual insider summary",
    description: "Year-end summary of insider transactions not reported earlier.",
    concept: "form-4",
    weight: 0.4,
  },
  "DEF 14A": {
    label: "Proxy statement",
    description:
      "What shareholders vote on at the annual meeting, including exactly how executives are paid.",
    concept: "proxy-statement",
    weight: 0.7,
  },
  "S-1": {
    label: "Registration statement",
    description:
      "Filed before selling new shares to the public, typically ahead of a listing.",
    weight: 0.8,
  },
  "S-3": {
    label: "Shelf registration",
    description:
      "Registers securities the company may sell later without filing again each time.",
    weight: 0.5,
  },
  "SC 13D": {
    label: "Activist stake",
    description:
      "Someone acquired more than 5% of the company and intends to influence how it is run.",
    weight: 0.85,
  },
  "SC 13G": {
    label: "Passive stake",
    description:
      "Someone acquired more than 5% of the company as a passive investment.",
    weight: 0.5,
  },
  "11-K": {
    label: "Employee plan report",
    description: "Annual report for an employee share purchase or savings plan.",
    weight: 0.2,
  },
  "20-F": {
    label: "Annual report (foreign issuer)",
    description:
      "The annual report filed by a company based outside the United States.",
    concept: "form-10-k",
    weight: 1,
  },
  "6-K": {
    label: "Foreign issuer update",
    description:
      "An interim report from a foreign issuer, roughly equivalent to an 8-K.",
    concept: "form-8-k",
    weight: 0.7,
  },
};

/**
 * Look up a form, tolerating the amendment suffix.
 *
 * SEC appends "/A" for amendments — "10-K/A" is a corrected annual report. It
 * is the same kind of document, so it resolves to the same description with
 * the amendment noted.
 */
export function describeForm(formType: string): FormInfo {
  const trimmed = formType.trim().toUpperCase();
  const isAmendment = trimmed.endsWith("/A");
  const base = isAmendment ? trimmed.slice(0, -2) : trimmed;

  const info = FORMS[base];
  if (!info) {
    return {
      label: formType,
      description: "An SEC filing.",
      weight: 0.3,
    };
  }

  if (!isAmendment) return info;
  return {
    ...info,
    label: `${info.label} (amended)`,
    description: `${info.description} This version corrects an earlier filing.`,
  };
}

/** Forms worth surfacing prominently rather than listing exhaustively. */
export function isMaterialForm(formType: string): boolean {
  return describeForm(formType).weight >= 0.7;
}
