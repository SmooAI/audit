using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;

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
public sealed class AuditClient
{
    // ponytail: one shared HttpClient (the documented reuse pattern); inject one via the
    // constructor overload for tests or custom handlers/timeouts.
    private static readonly HttpClient SharedHttp = new();

    private readonly AuditClientOptions _options;
    private readonly HttpClient _http;

    /// <summary>Create a client bound to the given endpoint + token.</summary>
    public AuditClient(AuditClientOptions options)
        : this(options, SharedHttp)
    {
    }

    /// <summary>Create a client with a caller-supplied <see cref="HttpClient"/>.</summary>
    public AuditClient(AuditClientOptions options, HttpClient http)
    {
        _options = options;
        _http = http;
    }

    /// <summary>
    /// Seal the event (compute + stamp <see cref="AuditEvent.HashCurrent"/>) and POST the canonical
    /// JSON envelope — the sealed event plus the current <see cref="Activity"/>'s W3C trace ids, when
    /// one is active — to the endpoint with an <c>Authorization: Bearer</c> header. Throws on a
    /// non-success status. ponytail: single POST, no retry/backoff — add it when a real transport SLA
    /// demands it.
    /// </summary>
    public async Task EmitAsync(AuditEvent @event, CancellationToken cancellationToken = default)
    {
        // Hash FIRST, from the event alone: the trace ids below ride in the envelope and can never
        // enter the preimage.
        var sealedEvent = @event with { HashCurrent = HashChain.ComputeEventHash(@event) };
        var (traceId, spanId) = CurrentTraceContext();
        var body = Canonical.ToCanonicalJsonEnvelope(sealedEvent, traceId, spanId);

        using var request = new HttpRequestMessage(HttpMethod.Post, _options.Endpoint)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.Token);

        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// W3C trace ids of the ambient <see cref="Activity"/>, or <c>(null, null)</c> when there is no
    /// activity or it is not W3C-formatted. No package needed — <c>System.Diagnostics.Activity</c> is
    /// in the BCL and is what the OpenTelemetry .NET SDK itself populates.
    /// </summary>
    private static (string? TraceId, string? SpanId) CurrentTraceContext()
    {
        var activity = Activity.Current;
        if (activity is null || activity.IdFormat != ActivityIdFormat.W3C || activity.TraceId == default)
        {
            return (null, null);
        }
        return (activity.TraceId.ToHexString(), activity.SpanId.ToHexString());
    }
}
