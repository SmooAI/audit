using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace SmooAI.Audit;

/// <summary>Canonical JSON serialization for audit events.</summary>
/// <remarks>
/// Byte-for-byte identical to every other language SDK (verified against the shared
/// parity corpus). Mirrors <c>canonicalJsonStringify</c> in <c>packages/audit/src/hash-chain.ts</c>:
/// <list type="bullet">
/// <item>primitives use JS <c>JSON.stringify</c> semantics;</item>
/// <item>object keys sorted by UTF-16 code unit at every depth, no insignificant whitespace;</item>
/// <item>array order preserved (never sorted);</item>
/// <item>a PRESENT null renders as <c>null</c> (only JS <c>undefined</c> is omitted — which never
/// reaches the wire because absent optional fields aren't serialized).</item>
/// </list>
/// </remarks>
public static class Canonical
{
    private static readonly JsonSerializerOptions SerializeOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>Serialize an audit event to its canonical JSON string.</summary>
    public static string ToCanonicalJson(AuditEvent @event)
    {
        // Serialize the typed record (WhenWritingNull drops absent optionals, mirroring JS's
        // undefined-omission), then re-parse so we walk a uniform JsonElement tree and apply our
        // own JS-exact escaping/ordering — the intermediate string's escaping is irrelevant.
        var json = JsonSerializer.Serialize(@event, SerializeOptions);
        using var doc = JsonDocument.Parse(json);
        var sb = new StringBuilder();
        Write(sb, doc.RootElement);
        return sb.ToString();
    }

    private static void Write(StringBuilder sb, JsonElement el)
    {
        switch (el.ValueKind)
        {
            case JsonValueKind.Object:
                var props = new List<JsonProperty>();
                foreach (var p in el.EnumerateObject())
                {
                    props.Add(p);
                }
                // JS Object.keys(...).sort() is UTF-16 code-unit order; string.CompareOrdinal matches.
                props.Sort(static (a, b) => string.CompareOrdinal(a.Name, b.Name));
                sb.Append('{');
                for (var i = 0; i < props.Count; i++)
                {
                    if (i > 0)
                    {
                        sb.Append(',');
                    }
                    WriteString(sb, props[i].Name);
                    sb.Append(':');
                    Write(sb, props[i].Value);
                }
                sb.Append('}');
                break;

            case JsonValueKind.Array:
                sb.Append('[');
                var first = true;
                foreach (var item in el.EnumerateArray())
                {
                    if (!first)
                    {
                        sb.Append(',');
                    }
                    first = false;
                    Write(sb, item);
                }
                sb.Append(']');
                break;

            case JsonValueKind.String:
                WriteString(sb, el.GetString()!);
                break;

            case JsonValueKind.Number:
                // Raw source text. ponytail: matches JS for the integer/plain-decimal cases the
                // corpus uses; add explicit float normalization (1e2 -> 100, 1.0 -> 1) if a fixture
                // ever introduces non-canonical numeric literals.
                sb.Append(el.GetRawText());
                break;

            case JsonValueKind.True:
                sb.Append("true");
                break;

            case JsonValueKind.False:
                sb.Append("false");
                break;

            default: // Null / Undefined
                sb.Append("null");
                break;
        }
    }

    /// <summary>
    /// Escape a string exactly as JS <c>JSON.stringify</c> does: escape <c>"</c> and <c>\</c>,
    /// short escapes for <c>\b \t \n \f \r</c>, other control chars as lowercase <c>\uXXXX</c>,
    /// forward slash NOT escaped, non-ASCII emitted literally (encoded to UTF-8 downstream).
    /// </summary>
    private static void WriteString(StringBuilder sb, string s)
    {
        sb.Append('"');
        foreach (var c in s)
        {
            switch (c)
            {
                case '"':
                    sb.Append("\\\"");
                    break;
                case '\\':
                    sb.Append("\\\\");
                    break;
                case '\b':
                    sb.Append("\\b");
                    break;
                case '\f':
                    sb.Append("\\f");
                    break;
                case '\n':
                    sb.Append("\\n");
                    break;
                case '\r':
                    sb.Append("\\r");
                    break;
                case '\t':
                    sb.Append("\\t");
                    break;
                default:
                    if (c < 0x20)
                    {
                        sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        sb.Append(c);
                    }
                    break;
            }
        }
        sb.Append('"');
    }
}
