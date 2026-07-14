import type { AuditEvent } from "./schema";

export interface AuditClientOptions {
  /** Base URL of the audit ingest endpoint. */
  endpoint: string;
  /** Bearer token used to authenticate emit requests. */
  token: string;
}

/**
 * Client that emits audit events to a configurable ingest endpoint over HTTPS
 * with a bearer token. The server assigns each event its place in the per-org
 * hash chain; the client's job is canonicalization + transport.
 *
 * TODO(audit-impl): implement emit — POST canonicalJson(event) to `${endpoint}`
 * with `Authorization: Bearer <token>`, retry/backoff, and surface transport
 * errors. Use the global fetch (Node 20+).
 */
export class AuditClient {
  constructor(private readonly options: AuditClientOptions) {}

  async emit(_event: AuditEvent): Promise<void> {
    void this.options;
    throw new Error("TODO(audit-impl): AuditClient.emit not implemented");
  }
}
