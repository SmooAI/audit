namespace SmooAI.Audit;

/// <summary>Canonical JSON serialization for audit events.</summary>
public static class Canonical
{
    /// <summary>
    /// Serialize an audit event to its canonical JSON string. Must be byte-for-byte
    /// identical to every other language SDK: deterministic recursive key ordering,
    /// no insignificant whitespace, stable number/unicode formatting.
    /// </summary>
    /// <remarks>TODO(audit-impl): implement against the shared parity corpus.</remarks>
    public static string ToCanonicalJson(AuditEvent @event)
    {
        _ = @event;
        throw new NotImplementedException("TODO(audit-impl): ToCanonicalJson not implemented");
    }
}
