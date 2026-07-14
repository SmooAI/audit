namespace SmooAI.Audit;

/// <summary>SHA-256 hash chain over audit events.</summary>
public static class HashChain
{
    /// <summary>
    /// Return the lowercase hex SHA-256 of an event, taken over
    /// <see cref="Canonical.ToCanonicalJson"/> with <see cref="AuditEvent.PreviousHash"/>
    /// folded in, forming a per-org-per-day tamper-evident chain.
    /// </summary>
    /// <remarks>
    /// TODO(audit-impl): implement — sha256(previousHash || canonicalJson(event)).
    /// </remarks>
    public static string ComputeEventHash(AuditEvent @event)
    {
        _ = @event;
        throw new NotImplementedException("TODO(audit-impl): ComputeEventHash not implemented");
    }

    /// <summary>
    /// Fold events into a hash chain, stamping each with its
    /// <see cref="AuditEvent.PreviousHash"/>. <paramref name="genesisHash"/> seeds the chain.
    /// </summary>
    /// <remarks>TODO(audit-impl): implement the chain fold over ComputeEventHash.</remarks>
    public static IReadOnlyList<AuditEvent> Build(IReadOnlyList<AuditEvent> events, string genesisHash = "")
    {
        _ = events;
        _ = genesisHash;
        throw new NotImplementedException("TODO(audit-impl): HashChain.Build not implemented");
    }
}
