using System.Text.Json;
using SmooAI.Audit;

namespace SmooAI.Audit.Tests;

public class AuditTests
{
    private static AuditEvent SampleEvent() => new()
    {
        Id = "11111111-1111-1111-1111-111111111111",
        OrgId = "org_123",
        Timestamp = "2026-07-14T00:00:00.000Z",
        Actor = "user_abc",
        Action = "record.delete",
        Resource = "contact:xyz",
        PreviousHash = "",
    };

    [Fact]
    public void EventRoundtripsThroughJson()
    {
        var evt = SampleEvent();
        var json = JsonSerializer.Serialize(evt);
        var parsed = JsonSerializer.Deserialize<AuditEvent>(json);
        Assert.NotNull(parsed);
        Assert.Equal(evt.Action, parsed!.Action);
    }

    [Fact]
    public void ToCanonicalJsonIsStubbed()
    {
        Assert.Throws<NotImplementedException>(() => Canonical.ToCanonicalJson(SampleEvent()));
    }
}
