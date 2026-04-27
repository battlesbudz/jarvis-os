import type { ChannelAttachment } from "./types";

/**
 * Converts an image or file attachment to a Buffer for channel delivery.
 * Handles three source formats:
 *   1. `data` field — raw base64 blob
 *   2. `url` as a data URI (`data:<mime>;base64,<data>`)
 *   3. `url` as a regular HTTP/HTTPS URL (fetched at send-time)
 *
 * Returns null when the attachment carries no usable source.
 */
export async function attachmentToBuffer(
  att: { url?: string; data?: string },
): Promise<Buffer | null> {
  if (att.data) {
    return Buffer.from(att.data, "base64");
  }
  if (att.url) {
    if (att.url.startsWith("data:")) {
      const comma = att.url.indexOf(",");
      if (comma !== -1) {
        return Buffer.from(att.url.slice(comma + 1), "base64");
      }
      return null;
    }
    try {
      const res = await fetch(att.url);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Collect all `markdown` kind attachments and return their text concatenated
 * together with double-newlines, ready to be appended to the main reply.
 * Returns an empty string when there are no markdown attachments.
 */
export function collectMarkdownExtras(attachments: ChannelAttachment[]): string {
  return attachments
    .filter((a): a is Extract<ChannelAttachment, { kind: "markdown" }> => a.kind === "markdown")
    .map((a) => a.text)
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Derive a safe filename for an image attachment based on its MIME type.
 * Falls back to `image.png` when the MIME type is absent or unrecognised.
 */
export function imageFilename(mimeType?: string): string {
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      return "image.jpg";
    case "image/gif":
      return "image.gif";
    case "image/webp":
      return "image.webp";
    default:
      return "image.png";
  }
}
