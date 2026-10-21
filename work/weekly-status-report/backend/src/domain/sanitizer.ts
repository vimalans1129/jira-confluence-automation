export const NEUTRAL_PLACEHOLDER = "the team";
export const DEFAULT_MITIGATION_LENGTH = 300;

export interface SanitizeOptions {
  names?: readonly string[];
  denylist?: readonly string[];
}

// A private-use sentinel keeps freshly inserted placeholders from being re-scanned for names.
const SENTINEL = "\uE000";

const ACCOUNT_MENTION = /\[~[^\]]*\]/g;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const PLAIN_MENTION = /@[\p{L}\p{N}](?:[\p{L}\p{N}._'-]*[\p{L}\p{N}])?/gu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(terms: readonly string[]): RegExp | null {
  const cleaned = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length > 0))];
  if (cleaned.length === 0) return null;
  cleaned.sort((a, b) => b.length - a.length);
  return new RegExp(cleaned.map(escapeRegExp).join("|"), "giu");
}

export function sanitizeText(text: string, options: SanitizeOptions = {}): string {
  let out = text
    .replace(ACCOUNT_MENTION, SENTINEL)
    .replace(EMAIL, SENTINEL)
    .replace(PLAIN_MENTION, SENTINEL);

  const pattern = termPattern([...(options.names ?? []), ...(options.denylist ?? [])]);
  if (pattern) out = out.replace(pattern, SENTINEL);

  return out.replaceAll(SENTINEL, NEUTRAL_PLACEHOLDER).replace(/\s+/gu, " ").trim();
}

export function truncateText(text: string, maxLength: number): string {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError("maxLength must be a positive integer");
  }
  const chars = Array.from(text);
  if (text.length <= maxLength) return text;
  const kept: string[] = [];
  let used = 1;
  for (const ch of chars) {
    if (used + ch.length > maxLength) break;
    kept.push(ch);
    used += ch.length;
  }
  return `${kept.join("").trimEnd()}…`;
}

// Sanitize before truncating so a cut can never leave a partial name behind.
export function sanitizeMitigation(
  text: string,
  options: SanitizeOptions,
  maxLength: number = DEFAULT_MITIGATION_LENGTH,
): string {
  return truncateText(sanitizeText(text, options), maxLength);
}
