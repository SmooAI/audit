// Package audit is a polyglot client SDK for tamper-evident, SQL-queryable
// audit logging — the Go port of @smooai/audit. It provides a canonical event
// schema, canonical JSON serialization, a per-org-per-day SHA-256 hash chain,
// and an emit client, all verified byte-for-byte against a shared parity corpus.
package audit

// Version is the current version of the smooai-audit Go package.
const Version = "0.2.1"
