// LinkedIn post commentary uses "Little Text Format": these characters are reserved
// and must be backslash-escaped, otherwise the post is rejected or silently truncated.
const RESERVED = /[\\|{}@\[\]()<>#*_~]/g;

export function escapeLittleText(text: string): string {
  return text.replace(RESERVED, (ch) => `\\${ch}`);
}

/**
 * Convert plain user text into LinkedIn commentary.
 * `#word` becomes a real hashtag; every other reserved character is escaped literally.
 */
export function toCommentary(text: string): string {
  const out: string[] = [];
  const hashtag = /(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]+)/gu;
  let last = 0;
  for (const m of text.matchAll(hashtag)) {
    const start = m.index + m[1]!.length;
    out.push(escapeLittleText(text.slice(last, start)));
    out.push(`{hashtag|\\#|${escapeLittleText(m[2]!)}}`);
    last = start + 1 + m[2]!.length;
  }
  out.push(escapeLittleText(text.slice(last)));
  return out.join("");
}

/** LinkedIn's documented limit for post commentary. */
export const MAX_COMMENTARY_CHARS = 3000;
