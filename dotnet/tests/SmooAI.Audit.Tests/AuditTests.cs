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
