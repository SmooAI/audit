namespace SmooAI.Audit;

/// <summary>Configuration for <see cref="AuditClient"/>.</summary>
public sealed record AuditClientOptions
{
    /// <summary>Base URL of the audit ingest endpoint.</summary>
    public required string Endpoint { get; init; }

    /// <summary>Bearer token used to authenticate emit requests.</summary>
    public required string Token { get; init; }
}

/// <summary>
/// Emits audit events to a configurable ingest endpoint over HTTPS.
/// </summary>
/// <remarks>
/// TODO(audit-impl): implement <see cref="EmitAsync"/> — POST canonical JSON of the
/// event to the endpoint with "Authorization: Bearer &lt;token&gt;", retry/backoff, and
/// surface transport errors.
/// </remarks>
public sealed class AuditClient
{
    private readonly AuditClientOptions _options;

    /// <summary>Create a client bound to the given endpoint + token.</summary>
    public AuditClient(AuditClientOptions options)
    {
        _options = options;
    }

    /// <summary>Emit a single audit event.</summary>
    /// <remarks>TODO(audit-impl): implement the HTTP POST.</remarks>
    public Task EmitAsync(AuditEvent @event, CancellationToken cancellationToken = default)
    {
        _ = _options;
        _ = @event;
        _ = cancellationToken;
        throw new NotImplementedException("TODO(audit-impl): AuditClient.EmitAsync not implemented");
    }
}
