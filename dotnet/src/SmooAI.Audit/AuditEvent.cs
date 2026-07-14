using System.Text.Json.Serialization;

namespace SmooAI.Audit;

/// <summary>
/// A single audit event — the shared shape every language SDK emits. Mirrors the
/// TypeScript <c>auditEventSchema</c> field-for-field and is verified byte-for-byte
/// against the shared parity corpus.
/// </summary>
/// <remarks>TODO(audit-impl): finalize the field set against the parity corpus.</remarks>
public sealed record AuditEvent
{
    /// <summary>Stable unique id for this event (UUID).</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>Organization the event belongs to — hash chains are per-org-per-day.</summary>
    [JsonPropertyName("orgId")]
    public required string OrgId { get; init; }

    /// <summary>RFC 3339 / ISO-8601 UTC timestamp.</summary>
    [JsonPropertyName("timestamp")]
    public required string Timestamp { get; init; }

    /// <summary>Who performed the action.</summary>
    [JsonPropertyName("actor")]
    public required string Actor { get; init; }

    /// <summary>What happened, e.g. "record.delete".</summary>
    [JsonPropertyName("action")]
    public required string Action { get; init; }

    /// <summary>The thing acted upon.</summary>
    [JsonPropertyName("resource")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Resource { get; init; }

    /// <summary>Arbitrary structured context. Must serialize canonically.</summary>
    [JsonPropertyName("metadata")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyDictionary<string, object?>? Metadata { get; init; }

    /// <summary>Hex SHA-256 of the previous event in this org/day chain ("" for genesis).</summary>
    [JsonPropertyName("previousHash")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PreviousHash { get; init; }
}
