import type { Page } from "playwright";
import type { Evidence } from "./evidence";

export type ApplyOutcome = "APPLIED" | "NEEDS_MANUAL" | "FAILED";

export interface ApplyFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export interface ApplyProfile {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  linkedInUrl: string | null;
  githubUrl: string | null;
  city: string | null;
  country: string;
  cv: ApplyFile | null;
  cvText: string | null;
}

export interface ApplyJob {
  id: string;
  title: string;
  company: string;
  sourceUrl: string;
  source: string;
  description: string;
  skills: string[];
}

export type ApplyEvent =
  | { type: "progress"; message: string }
  | { type: "screenshot"; url: string }
  | { type: "done"; status: ApplyOutcome; evidenceUrl: string; message?: string }
  | { type: "error"; message: string };

export interface ApplyContext {
  page: Page;
  profile: ApplyProfile;
  job: ApplyJob;
  evidence: Evidence;
  emit: (event: ApplyEvent) => void;
  autoSubmit: boolean;
}

export interface ApplyResult {
  status: ApplyOutcome;
  message?: string;
  submitted?: Record<string, string>;
}

export interface ApplyAdapter {
  id: string;
  matches(url: URL): boolean;
  run(ctx: ApplyContext): Promise<ApplyResult>;
}

export class ApplyAbort extends Error {
  submitted?: Record<string, string>;

  constructor(
    public readonly status: ApplyOutcome,
    message: string,
  ) {
    super(message);
    this.name = "ApplyAbort";
  }
}
