const RAW_RESTRICTED_CONTENT_PATTERNS = [
  /\b(?:account|routing|card|debit|credit)\s*(?:number|no\.?|#|ending(?:\s+in)?|last\s+four)?\s*[:#-]?\s*(?:\d[\s-]?){4,}\b/i,
  /\b(?:ssn|social security)\b[\s\S]{0,40}\d{3}[\s-]?\d{2}[\s-]?\d{4}\b/i,
  /\b(?:available|current|ending)\s+balance\b[\s\S]{0,80}\$?\d[\d,]*(?:\.\d{2})?\b/i,
  /\b(?:bank|checking|savings|account)\s+balance\b[\s\S]{0,80}\$?\d[\d,]*(?:\.\d{2})?\b/i,
  /\bbalance\b[\s\S]{0,40}\b(?:bank|checking|savings|account)\b[\s\S]{0,80}\$?\d[\d,]*(?:\.\d{2})?\b/i,
  /^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+.{2,}\s+[-+]?\$?\d[\d,]*(?:\.\d{2})?\s*$/m,
];

export function containsRawRestrictedContent(content: string): boolean {
  return RAW_RESTRICTED_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
}
