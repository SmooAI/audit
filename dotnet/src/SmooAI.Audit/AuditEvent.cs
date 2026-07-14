using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace SmooAI.Audit;

/// <summary>Resource an action was performed against (a CRM contact, an agent config, …).</summary>
public sealed record AuditResource
{
    /// <summary>Resource type, e.g. "crm.contact".</summary>
    [JsonPropertyName("type")]
    public required string Type { get; init; }

    /// <summary>Canonical identifier of the resource in its table.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }
}

/// <summary>
/// A single audit event — the shared shape every language SDK emits. Mirrors the TypeScript
/// <c>AuditEvent</c> (<c>packages/audit/src/schema.ts</c>) field-for-field and is verified
/// byte-for-byte against the shared parity corpus. Deliberately generic: <c>action</c> is an
/// opaque namespaced <c>namespace.verb</c> string and carries ZERO customer content beyond what
/// the emitter puts in <see cref="Metadata"/> / <see cref="Diff"/>.
/// </summary>
public sealed record AuditEvent
{
    /// <summary>Sortable unique id for this event (ULID-like).</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>Organization the event belongs to — hash chains are per-org-per-day.</summary>
    [JsonPropertyName("organizationId")]
    public required string OrganizationId { get; init; }

    /// <summary>Actor kind: user | agent | system | integration | api_client (opaque string).</summary>
    [JsonPropertyName("actorType")]
    public required string ActorType { get; init; }

    /// <summary>Actor identity — set from the request principal.</summary>
    [JsonPropertyName("actorId")]
    public required string ActorId { get; init; }

    /// <summary>Actor email, when known.</summary>
    [JsonPropertyName("actorEmail")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ActorEmail { get; init; }

    /// <summary>The action performed, as a dot-separated <c>namespace.verb</c> string.</summary>
    [JsonPropertyName("action")]
    public required string Action { get; init; }

    /// <summary>The thing acted upon.</summary>
    [JsonPropertyName("resource")]
    public required AuditResource Resource { get; init; }

    /// <summary>Outcome: success | failure | denied (opaque string).</summary>
    [JsonPropertyName("outcome")]
    public required string Outcome { get; init; }

    /// <summary>Optional human-readable reason (useful for failure / denied).</summary>
    [JsonPropertyName("reason")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Reason { get; init; }

    /// <summary>Conversation correlation for chat-driven actions.</summary>
    [JsonPropertyName("sessionId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SessionId { get; init; }

    /// <summary>Conversation correlation for chat-driven actions.</summary>
    [JsonPropertyName("conversationId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ConversationId { get; init; }

    /// <summary>Request enrichment — source IP.</summary>
    [JsonPropertyName("ipAddress")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? IpAddress { get; init; }

    /// <summary>Request enrichment — user agent.</summary>
    [JsonPropertyName("userAgent")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? UserAgent { get; init; }

    /// <summary>Request enrichment — geo country.</summary>
    [JsonPropertyName("geoCountry")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? GeoCountry { get; init; }

    /// <summary>
    /// Structural diff for create/update/delete actions. Arbitrary JSON; a present null side
    /// (e.g. delete's <c>after</c>) is rendered, never omitted.
    /// </summary>
    [JsonPropertyName("diff")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public JsonNode? Diff { get; init; }

    /// <summary>Arbitrary structured context. Always present (may be empty). Serializes canonically.</summary>
    [JsonPropertyName("metadata")]
    public required JsonNode Metadata { get; init; }

    /// <summary>ISO 8601 UTC timestamp.</summary>
    [JsonPropertyName("timestamp")]
    public required string Timestamp { get; init; }

    /// <summary>Previous event's hash in the per-org-per-day chain. Absent on the first event.</summary>
    [JsonPropertyName("hashPrevious")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? HashPrevious { get; init; }

    /// <summary>
    /// SHA-256 of canonical-JSON(this event minus <c>hashCurrent</c>). Stamped by the chain;
    /// excluded from its own hash input by <see cref="HashChain.ComputeEventHash"/>.
    /// </summary>
    [JsonPropertyName("hashCurrent")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? HashCurrent { get; init; }
}
