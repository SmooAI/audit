using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;

namespace SmooAI.Audit;

/// <summary>Configuration for <see cref="AuditClient"/>.</summary>
public sealed record AuditClientOptions
{
    /// <summary>
    /// Default retry behaviour, shared with every other language SDK. The numbers live in
    /// <c>spec/parity-corpus.json</c>'s <c>retryPolicy</c> and are asserted there, so they cannot
    /// drift apart across the five implementations.
    /// </summary>
    public const int DefaultMaxRetries = 3;

    /// <summary>Base backoff in milliseconds; doubles on each retry.</summary>
    public const int DefaultRetryBackoffMs = 100;

    /// <summary>Base URL of the audit ingest endpoint.</summary>
    public required string Endpoint { get; init; }

    /// <summary>Bearer token used to authenticate emit requests.</summary>
    public required string Token { get; init; }

    /// <summary>Total attempts on a transient failure (transport error or HTTP 5xx).</summary>
    public int MaxRetries { get; init; } = DefaultMaxRetries;

    /// <summary>Base backoff in milliseconds, doubled on each retry.</summary>
    public int RetryBackoffMs { get; init; } = DefaultRetryBackoffMs;
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
    /// one is active — to the endpoint with an <c>Authorization: Bearer</c> header.
    /// <para>
    /// Transient failures (transport errors and HTTP 5xx) are retried with exponential backoff; a
    /// 4xx throws immediately, since it will say the same thing on the next attempt. An audit event
    /// that silently fails to emit is a hole in the record, so the final failure always throws.
    /// </para>
    /// </summary>
    public async Task EmitAsync(AuditEvent @event, CancellationToken cancellationToken = default)
    {
        // Hash FIRST, from the event alone: the trace ids below ride in the envelope and can never
        // enter the preimage.
        var sealedEvent = @event with { HashCurrent = HashChain.ComputeEventHash(@event) };
        var (traceId, spanId) = CurrentTraceContext();
        // Built once, outside the retry loop: a retried POST must carry the SAME bytes, since
        // ingest dedupes on the event's hash.
        var body = Canonical.ToCanonicalJsonEnvelope(sealedEvent, traceId, spanId);

        var attempts = Math.Max(1, _options.MaxRetries);
        Exception? lastError = null;
        for (var attempt = 0; attempt < attempts; attempt++)
        {
            if (attempt > 0)
            {
                var wait = _options.RetryBackoffMs * (1 << (attempt - 1));
                await Task.Delay(wait, cancellationToken).ConfigureAwait(false);
            }

            try
            {
                await PostAsync(body, cancellationToken).ConfigureAwait(false);
                return;
            }
            catch (HttpRequestException error) when (IsTransient(error))
            {
                lastError = error;
            }
        }

        throw lastError!;
    }

    private async Task PostAsync(string body, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, _options.Endpoint)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.Token);

        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Retry only what a retry can fix: the request never reached a verdict (no status at all), or
    /// the server said it could not answer right now.
    /// </summary>
    private static bool IsTransient(HttpRequestException error) =>
        error.StatusCode is null || (int)error.StatusCode >= 500;

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
