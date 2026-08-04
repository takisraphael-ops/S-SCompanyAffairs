/**
 * URL canonicalisation — the first and cheapest stage of deduplication.
 *
 * The same article reaches us through several routes with different tracking
 * decoration. Reducing those to one key catches a large share of duplicates
 * before any text comparison is needed.
 */

/**
 * Query parameters that identify the referrer rather than the content.
 * Prefix rules cover the utm_* family and its imitators.
 */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "referrer",
  "source",
  "cmpid",
  "campaign",
  "ito",
  "ns_campaign",
  "ns_mchannel",
  "ns_source",
  "guccounter",
  "guce_referrer",
  "guce_referrer_sig",
  "sh",
  "yptr",
  "taid",
  "tsrc",
  "soc_src",
  "soc_trk",
  "smid",
  "partner",
  "sref",
]);

const TRACKING_PREFIXES = ["utm_", "at_", "pk_", "piwik_", "hsa_", "_hs"];

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return (
    TRACKING_PARAMS.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p))
  );
}

/**
 * Reduce a URL to a stable identity.
 *
 * Returns the input trimmed when it cannot be parsed — an unparseable URL is
 * still a usable dedup key, just a less effective one.
 */
export function canonicalizeUrl(input: string): string {
  const trimmed = input.trim();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return trimmed;

  // Publishers serve the same article over both schemes.
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";
  url.port = "";
  url.username = "";
  url.password = "";

  for (const key of [...url.searchParams.keys()]) {
    if (isTrackingParam(key)) url.searchParams.delete(key);
  }
  // Stable ordering so ?a=1&b=2 and ?b=2&a=1 collapse together.
  url.searchParams.sort();

  // AMP variants are the same article at a different path.
  url.pathname = url.pathname
    .replace(/\/amp\/?$/i, "")
    .replace(/\.amp$/i, "")
    .replace(/\/+$/, "");

  if (url.pathname === "") url.pathname = "/";

  return url.toString();
}

/** Publisher shown when a feed does not name one. */
export function hostnameOf(input: string): string | null {
  try {
    return new URL(input).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
