export function slugify(input: string, fallback = "untitled"): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function shortId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase() || "unknown";
}

export function memoryPageSlug(memoryId: string, content: string): string {
  return `memory/${slugify(content)}-${shortId(memoryId)}`;
}

export function personPageSlug(name: string): string {
  return `person/${slugify(name)}`;
}
