using System.Diagnostics;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using SmooAI.Audit;

namespace SmooAI.Audit.Tests;

/// <summary>
/// The parity gate: every fixture in the shared corpus must produce the byte-exact
/// <c>expectedCanonical</c> and <c>expectedHash</c>. If any of the five language SDKs disagrees
/// here, the hash chain is broken across stores. Never "fix" a divergence by editing the corpus —
/// investigate the serializer.
/// </summary>
public class AuditTests
{
    private static readonly JsonSerializerOptions Relaxed = new(JsonSerializerDefaults.Web);

    public static IEnumerable<object[]> Fixtures()
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(CorpusPath()));
        foreach (var fixture in doc.RootElement.GetProperty("fixtures").EnumerateArray())
        {
            yield return new object[]
            {
                fixture.GetProperty("name").GetString()!,
                fixture.GetProperty("event").GetRawText(),
                fixture.GetProperty("expectedCanonical").GetString()!,
                fixture.GetProperty("expectedHash").GetString()!,
            };
        }
    }

    [Theory]
    [MemberData(nameof(Fixtures))]
    public void FixtureMatchesCanonicalAndHash(string name, string eventJson, string expectedCanonical, string expectedHash)
    {
        _ = name; // surfaces as the test-case display name
        var evt = JsonSerializer.Deserialize<AuditEvent>(eventJson, Relaxed)!;

        Assert.Equal(expectedCanonical, Canonical.ToCanonicalJson(evt));
        Assert.Equal(expectedHash, HashChain.ComputeEventHash(evt));
    }

    [Fact]
    public void BuildChainsHashPreviousAcrossEvents()
    {
        var e1 = new AuditEvent
        {
            Id = "01A",
            OrganizationId = "org-1",
            ActorType = "user",
            ActorId = "user-1",
            Action = "crm.contact_created",
            Resource = new AuditResource { Type = "crm.contact", Id = "c-1" },
            Outcome = "success",
            Metadata = new JsonObject(),
            Timestamp = "2026-05-17T12:00:00.000Z",
        };
        var e2 = e1 with { Id = "01B", Timestamp = "2026-05-17T12:00:01.000Z" };

        var chain = HashChain.Build(new[] { e1, e2 });

        Assert.Null(chain[0].HashPrevious);
        Assert.Equal(chain[0].HashCurrent, chain[1].HashPrevious);
        Assert.NotNull(chain[1].HashCurrent);
    }

    // --- Envelope trace correlation ---------------------------------------------------
    // traceId/spanId ride OUTSIDE the hashed event, so an Activity must never move a hash.

    private const string TraceIdHex = "4bf92f3577b34da6a3ce929d0e0e4736";

    /// <summary>Captures the POSTed body instead of hitting the network.</summary>
    private sealed class CapturingHandler : HttpMessageHandler
    {
        public string Body { get; private set; } = "";

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.Accepted);
        }
    }

    private static async Task<JsonObject> EmitAndCaptureAsync(AuditEvent evt)
    {
        using var handler = new CapturingHandler();
        using var http = new HttpClient(handler);
        var client = new AuditClient(new AuditClientOptions { Endpoint = "http://audit.test/ingest", Token = "t" }, http);
        await client.EmitAsync(evt);
        return JsonNode.Parse(handler.Body)!.AsObject();
    }

    /// <summary>Starts a real W3C Activity with a fixed trace id (listener required, no OTel SDK).</summary>
    private static (ActivityListener Listener, ActivitySource Source, Activity Activity) StartActivity()
    {
        var listener = new ActivityListener
        {
            ShouldListenTo = _ => true,
            Sample = static (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllData,
        };
        ActivitySource.AddActivityListener(listener);
        var source = new ActivitySource("SmooAI.Audit.Tests");
        var parent = new ActivityContext(ActivityTraceId.CreateFromString(TraceIdHex), ActivitySpanId.CreateRandom(), ActivityTraceFlags.Recorded);
        var activity = source.StartActivity("emit", ActivityKind.Internal, parent)!;
        return (listener, source, activity);
    }

    private static AuditEvent SampleEvent() => new()
    {
        Id = "01A",
        OrganizationId = "org-1",
        ActorType = "user",
        ActorId = "user-1",
        Action = "crm.contact_created",
        Resource = new AuditResource { Type = "crm.contact", Id = "c-1" },
        Outcome = "success",
        Metadata = new JsonObject(),
        Timestamp = "2026-05-17T12:00:00.000Z",
    };

    [Fact]
    public async Task EnvelopeCarriesTraceIdsWhenActivityIsActive()
    {
        var (listener, source, activity) = StartActivity();
        JsonObject body;
        try
        {
            body = await EmitAndCaptureAsync(SampleEvent());
        }
        finally
        {
            activity.Dispose();
            source.Dispose();
            listener.Dispose();
        }

        Assert.Equal(TraceIdHex, (string?)body["traceId"]);
        Assert.Equal(activity.SpanId.ToHexString(), (string?)body["spanId"]);
    }

    [Fact]
    public async Task EnvelopeOmitsTraceIdsWithoutActivity()
    {
        Activity.Current = null;

        var body = await EmitAndCaptureAsync(SampleEvent());

        // Omitted entirely — never an all-zero id, never an empty string.
        Assert.False(body.ContainsKey("traceId"));
        Assert.False(body.ContainsKey("spanId"));
    }

    /// <summary>
    /// The hash-chain regression gate: every corpus fixture must seal to its committed hash — and the
    /// envelope minus the trace ids must be the committed canonical bytes — with or without an Activity.
    /// </summary>
    [Theory]
    [MemberData(nameof(Fixtures))]
    public async Task CorpusHashUnchangedByActivity(string name, string eventJson, string expectedCanonical, string expectedHash)
    {
        _ = name;
        var evt = JsonSerializer.Deserialize<AuditEvent>(eventJson, Relaxed)!;

        Activity.Current = null;
        var withoutActivity = await EmitAndCaptureAsync(evt);

        var (listener, source, activity) = StartActivity();
        JsonObject withActivity;
        try
        {
            withActivity = await EmitAndCaptureAsync(evt);
        }
        finally
        {
            activity.Dispose();
            source.Dispose();
            listener.Dispose();
        }

        foreach (var body in new[] { withoutActivity, withActivity })
        {
            var sealedEvent = body["event"]!.DeepClone().AsObject();
            Assert.Equal(expectedHash, (string?)sealedEvent["hashCurrent"]);

            // The event minus its own hash must be the committed canonical bytes.
            sealedEvent.Remove("hashCurrent");
            var preimage = JsonSerializer.Deserialize<AuditEvent>(sealedEvent.ToJsonString(), Relaxed)!;
            Assert.Equal(expectedCanonical, Canonical.ToCanonicalJson(preimage));
        }

        Assert.Equal(TraceIdHex, (string?)withActivity["traceId"]);
        Assert.False(withoutActivity.ContainsKey("traceId"));
    }

    private static string CorpusPath()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "spec", "parity-corpus.json");
            if (File.Exists(candidate))
            {
                return candidate;
            }
            dir = dir.Parent;
        }
        throw new FileNotFoundException("spec/parity-corpus.json not found walking up from " + AppContext.BaseDirectory);
    }
}
