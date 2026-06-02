export function chunkText(input: string, targetChars = 900): string[] {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?]+[.!?]?/g) ?? [normalized];
  const chunks: string[] = [];
  let current = "";

  const hardChunks = (segment: string): string[] => {
    const parts: string[] = [];
    for (let index = 0; index < segment.length; index += targetChars) {
      parts.push(segment.slice(index, index + targetChars));
    }
    return parts;
  };

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length > targetChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...hardChunks(trimmed));
      continue;
    }

    const next = current ? `${current} ${trimmed}` : trimmed;
    if (next.length <= targetChars) {
      current = next;
      continue;
    }

    chunks.push(current);
    current = trimmed;
  }

  if (current) chunks.push(current);
  return chunks;
}
