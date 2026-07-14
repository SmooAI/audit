package audit

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode/utf16"
)

// CanonicalJSON serializes a decoded JSON value — exactly the value domain
// json.Decoder with UseNumber produces (nil, bool, json.Number, string, []any,
// map[string]any) — to canonical JSON, byte-for-byte identical to the TS
// canonicalJsonStringify and the Rust canonical_json.
//
// Contract (must NOT drift across languages):
//   - primitives  → JSON.stringify semantics (see writeJSString / numbers)
//   - arrays      → "[" + items.join(",") + "]"   (order PRESERVED)
//   - objects     → keys SORTED by UTF-16 code-unit order at every depth, each
//     rendered  "key":value  joined by ","; no insignificant whitespace.
//
// A JSON null that is *present* in the value (e.g. diff.after on a delete)
// renders as "null" — it is NOT omitted. Absent optional fields never reach here:
// the emitter drops them (omitempty) before the value is built, mirroring the TS
// "value is undefined → key omitted" rule.
func CanonicalJSON(v any) (string, error) {
	var b strings.Builder
	if err := writeCanonical(&b, v); err != nil {
		return "", err
	}
	return b.String(), nil
}

func writeCanonical(b *strings.Builder, v any) error {
	switch val := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if val {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case json.Number:
		// ponytail: source-text passthrough. Matches JS integer rendering (the
		// audit value domain: counts, rates, ids-as-strings). A source exponent
		// form like "1e3" would need JS Number formatting ("1000") — such values
		// are not part of the event schema. Upgrade path: parse + reformat here
		// if a float/exponent field ever lands.
		b.WriteString(val.String())
	case string:
		writeJSString(b, val)
	case []any:
		b.WriteByte('[')
		for i, item := range val {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := writeCanonical(b, item); err != nil {
				return err
			}
		}
		b.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(val))
		for k := range val {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return lessUTF16(keys[i], keys[j]) })
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			writeJSString(b, k)
			b.WriteByte(':')
			if err := writeCanonical(b, val[k]); err != nil {
				return err
			}
		}
		b.WriteByte('}')
	default:
		return fmt.Errorf("audit: cannot canonicalize value of type %T", v)
	}
	return nil
}

// writeJSString reproduces ECMAScript JSON.stringify string quoting exactly, so
// the bytes match V8 (and the TS/Rust ports) rather than Go's encoding/json.
//
// Go's encoder is NOT usable here: even with SetEscapeHTML(false) it escapes
// U+2028/U+2029 (JSON.stringify does not), and by default escapes <,>,& . This
// escaper: quote + backslash escaped; \b \t \n \f \r short escapes; other
// control chars (<0x20) as lowercase \uXXXX; forward slash NOT escaped; every
// other rune (accented, astral emoji, …) emitted as literal UTF-8 — matching
// JSON.stringify, whose output encoded as UTF-8 is literal for non-ASCII.
func writeJSString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\t':
			b.WriteString(`\t`)
		case '\n':
			b.WriteString(`\n`)
		case '\f':
			b.WriteString(`\f`)
		case '\r':
			b.WriteString(`\r`)
		default:
			if r < 0x20 {
				fmt.Fprintf(b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}

// lessUTF16 compares two strings by UTF-16 code-unit order — the ordering JS
// String comparison (and thus sorting Object.keys) uses. For BMP text this
// equals code-point (and UTF-8 byte) order; it diverges only for astral
// characters, whose surrogate code units (0xD800–0xDBFF) sort BEFORE BMP chars
// ≥ 0xE000. Audit key names are ASCII in practice, but we match JS exactly so an
// arbitrary metadata key can never break cross-language hash parity.
func lessUTF16(a, b string) bool {
	au := utf16.Encode([]rune(a))
	bu := utf16.Encode([]rune(b))
	for i := 0; i < len(au) && i < len(bu); i++ {
		if au[i] != bu[i] {
			return au[i] < bu[i]
		}
	}
	return len(au) < len(bu)
}
