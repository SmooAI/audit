//! Canonical JSON serialization — a faithful port of the TS `canonicalJsonStringify`
//! (`@smooai/audit`), byte-verified against `spec/parity-corpus.json`.
//!
//! # The contract, restated
//!
//! ```text
//! canonical(value):
//!   - null / primitive → JSON.stringify(value)
//!   - array            → "[" + items.map(canonical).join(",") + "]"   (ORDER preserved)
//!   - object           → keys with a non-`undefined` value, SORTED ascending by
//!                        JS string (UTF-16 code-unit) order, each rendered
//!                        JSON.stringify(key) ":" canonical(value), joined by ",".
//! ```
//!
//! We operate over [`serde_json::Value`]. Absent optionals are already dropped
//! by serde's `skip_serializing_if = "Option::is_none"` before the Value is
//! built (the TS "value is `undefined` → key omitted" rule); a *present* JSON
//! `null` renders as `"null"`, matching `JSON.stringify(null)`.
//!
//! `serde_json::to_string` matches `JSON.stringify` for the audit value domain:
//! `\"`/`\\` escaped, forward slash NOT escaped, control chars as `\uXXXX`,
//! non-ASCII emitted as literal UTF-8, and integers rendered identically. Object
//! keys are our own ASCII camelCase field names, so a byte `sort()` equals JS
//! UTF-16 order — no astral-plane key ever reaches the sort.

use serde_json::Value;

/// Serialize a [`serde_json::Value`] to its canonical JSON string, byte-matching
/// the TS `canonicalJsonStringify`: keys sorted at every depth, array order
/// preserved, no insignificant whitespace.
pub fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            // Infallible for a primitive Value; the "null" fallback only guards
            // the impossible error path so this never panics on the seal path.
            serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
        }
        Value::Array(items) => {
            let mut out = String::from("[");
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&canonical_json(item));
            }
            out.push(']');
            out
        }
        Value::Object(map) => {
            // Sort keys ascending — matches the TS `.sort()`. ASCII camelCase key
            // bytes == JS UTF-16 order.
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut out = String::from("{");
            for (i, key) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                let key_json = serde_json::to_string(*key).unwrap_or_else(|_| format!("\"{key}\""));
                out.push_str(&key_json);
                out.push(':');
                out.push_str(&canonical_json(&map[*key]));
            }
            out.push('}');
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn primitives_match_json_stringify() {
        assert_eq!(canonical_json(&json!(null)), "null");
        assert_eq!(canonical_json(&json!(true)), "true");
        assert_eq!(canonical_json(&json!(42)), "42");
        assert_eq!(canonical_json(&json!("a\"b\\c/d\n")), "\"a\\\"b\\\\c/d\\n\"");
    }

    #[test]
    fn objects_sort_arrays_preserve() {
        let v = json!({ "b": 1, "a": { "z": 2, "y": 3 }, "c": [3, 1, 2] });
        assert_eq!(canonical_json(&v), "{\"a\":{\"y\":3,\"z\":2},\"b\":1,\"c\":[3,1,2]}");
    }

    #[test]
    fn present_null_is_rendered() {
        assert_eq!(canonical_json(&json!({ "after": null, "before": 1 })), "{\"after\":null,\"before\":1}");
    }
}
