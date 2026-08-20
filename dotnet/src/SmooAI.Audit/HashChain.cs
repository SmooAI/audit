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

    /// <summary>
    /// Verify an ordered chain: recompute every <see cref="AuditEvent.HashCurrent"/> and confirm
    /// each <see cref="AuditEvent.HashPrevious"/> matches the prior event's
    /// <see cref="AuditEvent.HashCurrent"/>.
    /// <para>
    /// <paramref name="genesisPreviousHash"/> is the hash the FIRST event must link to — pass the
    /// chain head you already have when verifying a slice that continues an existing chain. Leave it
    /// null only when <paramref name="events"/> starts at the true beginning of the chain (first
    /// event of the org's day), where <c>HashPrevious</c> must be null.
    /// </para>
    /// <para>
    /// <b>What replay cannot see:</b> removing events from the TAIL leaves a chain that still
    /// verifies — every remaining link is genuine. Detecting that needs an external anchor (a stored
    /// chain head, an expected count) compared against the last event's <c>HashCurrent</c>. An
    /// <c>Ok</c> verdict means "nothing here was altered", not "nothing is missing"; the corpus pins
    /// this as an explicit fixture so the limit stays visible.
    /// </para>
    /// </summary>
    public static ChainVerification Verify(IReadOnlyList<AuditEvent> events, string? genesisPreviousHash = null)
    {
        var previous = string.IsNullOrEmpty(genesisPreviousHash) ? null : genesisPreviousHash;
        for (var i = 0; i < events.Count; i++)
        {
            var @event = events[i];
            var stored = string.IsNullOrEmpty(@event.HashPrevious) ? null : @event.HashPrevious;
            if (stored != previous)
            {
                return new ChainVerification(false, i, VerifyFailureCode.HashPreviousMismatch);
            }

            var recomputed = ComputeEventHash(@event);
            if (@event.HashCurrent != recomputed)
            {
                return new ChainVerification(false, i, VerifyFailureCode.HashCurrentMismatch);
            }

            previous = recomputed;
        }
        return new ChainVerification(true, -1, null);
    }
}

/// <summary>
/// Why a chain failed to verify. These codes are the cross-language contract — every SDK returns
/// the same code for the same corruption, asserted by <c>chainFixtures</c> in
/// <c>spec/parity-corpus.json</c>.
/// </summary>
public enum VerifyFailureCode
{
    /// <summary>
    /// An event's <c>HashPrevious</c> is not the prior event's <c>HashCurrent</c> — the LINK is
    /// wrong: a reorder, a deletion, a truncated head, a rewritten link.
    /// </summary>
    HashPreviousMismatch,

    /// <summary>
    /// The event's own content no longer hashes to its stored <c>HashCurrent</c> — the event BODY
    /// was edited after sealing.
    /// </summary>
    HashCurrentMismatch,
}

/// <summary>
/// The verdict from <see cref="HashChain.Verify"/>. <paramref name="BrokenAt"/> is -1 and
/// <paramref name="Code"/> is null when <paramref name="Ok"/> is true.
/// </summary>
/// <param name="Ok">True when every link recomputed and matched.</param>
/// <param name="BrokenAt">Index of the first event that failed.</param>
/// <param name="Code">Why it failed.</param>
public sealed record ChainVerification(bool Ok, int BrokenAt, VerifyFailureCode? Code);
