export interface SentryConfig {
  enabled: boolean;
  baseUrl: string;
  organization: string;
  defaultProject: string;
}

export interface SentryProjectInfo {
  id: string;
  slug: string;
  name: string;
  platform: string | null;
  organization: { slug: string };
}

export interface SentryTestResponse {
  success: boolean;
  message: string;
  projects: SentryProjectInfo[] | null;
}

export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string | null;
  level: "error" | "warning" | "info" | "fatal" | "debug";
  status: "unresolved" | "resolved" | "ignored";
  platform: string | null;
  count: string | null;
  userCount: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  permalink: string | null;
  metadata: Record<string, unknown> | null;
  project?: { id: string; slug: string; name?: string };
}

export interface SentryIssueList {
  issues: SentryIssue[];
  nextCursor: string | null;
}

export interface SentryEvent {
  eventId: string | null;
  title: string | null;
  message: string | null;
  platform: string | null;
  tags: SentryTag[] | null;
  contexts: Record<string, unknown> | null;
  entries: Record<string, unknown>[] | null;
}

export interface SentryTag {
  key: string;
  value: string;
}
