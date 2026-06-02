export type BrainScope = {
  userId: string;
  tenantId?: string;
  sourceIds?: string[];
  actorId: string;
  runId?: string;
  approvalMode?: "auto" | "review_required";
};

export type ProvenanceRef = {
  kind: "user_memory" | "chat" | "email" | "telegram" | "document" | "voice" | "goal" | "plan" | "people";
  id: string;
  sourceType?: string;
  sourceRef?: string;
  timestamp?: string;
};

export type BrainLinkInput = {
  verb: string;
  toSlug: string;
  confidence?: number;
};

export type UpsertEvidenceInput = BrainScope & {
  pageType: string;
  slug: string;
  title: string;
  compiledTruth?: string;
  sourceKind: string;
  sourceId: string;
  timelineAppend?: Array<{
    at?: string;
    summary: string;
    detail?: string;
    provenance: ProvenanceRef[];
  }>;
  links?: BrainLinkInput[];
  provenance: ProvenanceRef[];
};

export type QueryBrainInput = BrainScope & {
  query: string;
  topK?: number;
  timeWindow?: { start?: string; end?: string };
  entityHints?: string[];
  includeTimeline?: boolean;
  includeLinks?: boolean;
  approvalFilter?: "approved_only" | "include_pending";
};

export type QueryBrainResult = {
  answerDraft?: string;
  pages: Array<{
    slug: string;
    title: string;
    score: number;
    citations: ProvenanceRef[];
  }>;
  chunks: Array<{
    pageSlug: string;
    content: string;
    score: number;
    citations: ProvenanceRef[];
  }>;
  links?: Array<{ from: string; verb: string; to: string }>;
  warnings?: string[];
};

export interface JarvisBrainAdapter {
  upsertEvidence(input: UpsertEvidenceInput): Promise<{ pageId: string; versionId?: string }>;
  projectApprovedMemories(userId: string, limit?: number): Promise<{ scanned: number; projected: number; skipped: number }>;
  query(input: QueryBrainInput): Promise<QueryBrainResult>;
  refreshIndex(scope: BrainScope & { staleOnly?: boolean }): Promise<{ embedded: number; linked: number }>;
  queueMaintenance(scope: BrainScope & { job: "citation_fix" | "link_refresh" | "compact" | "daily_synthesis" }): Promise<{ jobId: string }>;
}
