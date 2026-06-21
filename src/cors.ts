/**
 * CORS origin allow-listing for the FAACT assistant.
 *
 * Exactly two kinds of Origin are permitted — nothing else:
 *   1. An exact entry in the configured allow-list (the production site).
 *   2. A Netlify deploy-preview / branch deploy of OUR site, whose host ends in
 *      "--faact-academy.netlify.app" (e.g. deploy-preview-7--faact-academy.netlify.app).
 *
 * The preview check is a PRECISE host-suffix match — never a substring/includes
 * test. We parse the Origin with the URL API and inspect the parsed `hostname`
 * (no port, path, userinfo, or query), require https, and require a non-empty
 * deploy label before the suffix. This rejects lookalikes such as:
 *   https://evil--faact-academy.netlify.app.attacker.com  → host ends in .attacker.com
 *   https://faact-academy.netlify.app.evil.com            → host ends in .evil.com
 *
 * Trust model: only a page actually served from "<label>--faact-academy.netlify.app"
 * (i.e. our own Netlify account's deploy subdomain) can cause a browser to send
 * that Origin, so a precise suffix match is sufficient for previews without
 * enumerating per-PR origins.
 */

// The Netlify deploy-context suffix for our site: "<label>--<site>.netlify.app".
// The leading "--" is Netlify's deploy-context separator.
export const PREVIEW_HOST_SUFFIX = "--faact-academy.netlify.app";

export function isAllowedOrigin(origin: string, allowList: ReadonlySet<string>): boolean {
  // 1. Exact match — the production origin (and any other explicitly configured).
  if (allowList.has(origin)) return true;

  // 2. Netlify preview/branch deploy of our own site, matched precisely.
  let hostname: string;
  let protocol: string;
  try {
    const url = new URL(origin);
    hostname = url.hostname; // normalised, lower-cased, no port/path
    protocol = url.protocol;
  } catch {
    return false; // not a parseable absolute URL
  }
  if (protocol !== "https:") return false;
  if (!hostname.endsWith(PREVIEW_HOST_SUFFIX)) return false;
  // Require a non-empty deploy label before the suffix (reject the bare suffix).
  return hostname.length > PREVIEW_HOST_SUFFIX.length;
}
