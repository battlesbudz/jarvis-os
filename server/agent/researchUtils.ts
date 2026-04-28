export function researchHasSourceUrls(body: string): boolean {
  const idx = body.search(/^##\s*Sources\b/im);
  if (idx === -1) return false;
  const afterSources = body.slice(idx);
  const firstNewline = afterSources.indexOf("\n");
  if (firstNewline === -1) return false;
  const sectionBody = afterSources.slice(firstNewline + 1);
  const nextHeadingOffset = sectionBody.search(/^##/m);
  const section = nextHeadingOffset === -1 ? sectionBody : sectionBody.slice(0, nextHeadingOffset);
  return /https?:\/\/\S+/.test(section);
}
