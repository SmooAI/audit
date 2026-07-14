using System.Security.Cryptography;
using System.Text;

namespace SmooAI.Audit;

/// <summary>SHA-256 hash chain over audit events.</summary>
public static class HashChain
{
    /// <summary>
    /// Return the lowercase hex SHA-256 of an event, taken over
    /// <see cref="Canonical.ToCanonicalJson"/> of the event with its own
    /// <see cref="AuditEvent.HashCurrent"/> excluded — mirrors <c>computeEventHash</c> in
    /// <c>packages/audit/src/hash-chain.ts</c>.
    /// </summary>
    public static string ComputeEventHash(AuditEvent @event)
    {
        var canonical = Canonical.ToCanonicalJson(@event with { HashCurrent = null });
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(canonical));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    /// <summary>
    /// Fold events into a hash chain, stamping each with its <see cref="AuditEvent.HashPrevious"/>
    /// and <see cref="AuditEvent.HashCurrent"/>. <paramref name="genesisHash"/> seeds the chain
    /// (empty = first event has no previous hash, matching the TS <c>sealEvent(undefined)</c> case).
    /// </summary>
    public static IReadOnlyList<AuditEvent> Build(IReadOnlyList<AuditEvent> events, string genesisHash = "")
    {
        var result = new List<AuditEvent>(events.Count);
        var previous = genesisHash;
        foreach (var @event in events)
        {
            var withPrev = @event with { HashPrevious = string.IsNullOrEmpty(previous) ? null : previous };
            var current = ComputeEventHash(withPrev);
            result.Add(withPrev with { HashCurrent = current });
            previous = current;
        }
        return result;
    }
}
