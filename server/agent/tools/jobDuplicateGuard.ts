/** Lowercase, strip punctuation, collapse whitespace for comparison. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Two titles are considered similar if:
 * 1. Their normalized forms are exactly equal, OR
 * 2. The first 25 normalized characters match (catches minor suffix differences), OR
 * 3. They share ≥60% word overlap (catches reordered or paraphrased titles).
 */
export function titlesAreSimilar(a: string, b: string): boolean {
  if (a === b) return true;

  const prefixLen = 25;
  if (a.length >= prefixLen && b.length >= prefixLen && a.slice(0, prefixLen) === b.slice(0, prefixLen)) {
    return true;
  }

  const wordsA = new Set(a.split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  const similarity = overlap / Math.max(wordsA.size, wordsB.size);
  return similarity >= 0.6;
}
