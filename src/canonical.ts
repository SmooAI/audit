/**
 * Canonical JSON serialization for the audit hash chain.
 *
 * Canonical form must be byte-for-byte identical across every language SDK so
 * the hash chain is portable. The rules (asserted by `spec/parity-corpus.json`):
 *
 *   - Objects: keys whose value is `undefined` are dropped; remaining keys are
 *     sorted ascending by JS string (UTF-16 code-unit) order; each renders as
 *     `JSON.stringify(key) + ":" + canonicalJson(value)`, joined by ",".
 *   - Arrays: element order is PRESERVED (never sorted); each element is
 *     serialized recursively.
 *   - Everything else (null, string, number, boolean): `JSON.stringify(value)`,
 *     which fixes escaping, unicode, and integer/number formatting.
 *
 * IMPORTANT: keep this in lockstep with every other SDK. Hashes diverge if any
 * party serializes differently.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${parts.join(",")}}`;
}
