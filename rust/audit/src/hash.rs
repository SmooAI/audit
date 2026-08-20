//! Per-event SHA-256 + the per-org-per-day hash chain.
//!
//! `hashCurrent = SHA-256(canonical-JSON(event minus hashCurrent))`, linked via
//! `hashPrevious`. Byte-verified against `spec/parity-corpus.json`.

use sha2::{Digest, Sha256};

use crate::canonical::canonical_json;
use crate::schema::AuditEvent;

/// Lowercase-hex SHA-256 of the canonical JSON of `value`.
///
/// `value` MUST be the event object **without** `hashCurrent` (and with
/// `hashPrevious` already set to the chain head, or omitted on the first event
/// of a day). See [`AuditEvent::event_for_hash`].
pub fn compute_event_hash(value: &serde_json::Value) -> String {
    let digest = Sha256::digest(canonical_json(value).as_bytes());
    // Lowercase hex without pulling in the `hex` crate.
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Fold events into a per-org-per-day hash chain, stamping each with its
/// `hashPrevious` (the prior event's hash) and `hashCurrent`.
///
/// `chain_head` is the hash of the last event already in today's chain, or
/// `None` for the first event of the day (which gets no `hashPrevious`). Returns
/// the events with both hash fields set, in order.
pub fn build_hash_chain(events: Vec<AuditEvent>, chain_head: Option<String>) -> Vec<AuditEvent> {
    let mut head = chain_head;
    events
        .into_iter()
        .map(|mut event| {
            event.hash_previous = head.clone();
            let hash = event.compute_hash();
            event.hash_current = Some(hash.clone());
            head = Some(hash);
            event
        })
        .collect()
}

/// Why a chain failed to verify.
///
/// These codes are the cross-language contract — every SDK returns the same code
/// for the same corruption, asserted by `chainFixtures` in
/// `spec/parity-corpus.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerifyFailureCode {
    /// An event's `hashPrevious` is not the prior event's `hashCurrent` — the
    /// LINK is wrong: a reorder, a deletion, a truncated head, a rewritten link.
    HashPreviousMismatch,
    /// The event's own content no longer hashes to its stored `hashCurrent` —
    /// the event BODY was edited after sealing.
    HashCurrentMismatch,
}

/// The verdict from [`verify_chain`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChainVerification {
    /// Every link recomputed and matched.
    Ok,
    /// The first event that failed, and why.
    Broken { broken_at: usize, code: VerifyFailureCode },
}

impl ChainVerification {
    /// `true` when the chain verified intact.
    pub fn is_ok(&self) -> bool {
        matches!(self, ChainVerification::Ok)
    }
}

/// Verify an ordered chain: recompute every `hashCurrent` and confirm each
/// `hashPrevious` matches the prior event's `hashCurrent`.
///
/// `genesis_previous_hash` is the hash the FIRST event must link to — pass the
/// chain head you already have when verifying a slice that continues an existing
/// chain. `None` means `events` starts at the true beginning of the chain (first
/// event of the org's day), where `hashPrevious` must be absent.
///
/// **What replay cannot see:** removing events from the TAIL leaves a chain that
/// still verifies — every remaining link is genuine. Detecting that needs an
/// external anchor (a stored chain head, an expected count) compared against the
/// last event's `hashCurrent`. [`ChainVerification::Ok`] means "nothing here was
/// altered", not "nothing is missing"; the corpus pins this as an explicit
/// fixture so the limit stays visible.
pub fn verify_chain(events: &[AuditEvent], genesis_previous_hash: Option<&str>) -> ChainVerification {
    let mut previous: Option<String> = genesis_previous_hash.map(str::to_owned);
    for (index, event) in events.iter().enumerate() {
        if event.hash_previous != previous {
            return ChainVerification::Broken {
                broken_at: index,
                code: VerifyFailureCode::HashPreviousMismatch,
            };
        }
        let recomputed = event.compute_hash();
        if event.hash_current.as_deref() != Some(recomputed.as_str()) {
            return ChainVerification::Broken {
                broken_at: index,
                code: VerifyFailureCode::HashCurrentMismatch,
            };
        }
        previous = Some(recomputed);
    }
    ChainVerification::Ok
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hash_is_64_hex_lowercase() {
        let h = compute_event_hash(&json!({ "a": 1 }));
        assert_eq!(h.len(), 64);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn chain_links_previous_to_prior_current() {
        let base = AuditEvent {
            id: "id".into(),
            organization_id: "org".into(),
            actor_type: crate::schema::ActorType::System,
            actor_id: "sys".into(),
            actor_email: None,
            action: "x.y".into(),
            resource: crate::schema::AuditResource {
                type_: "t".into(),
                id: "i".into(),
            },
            outcome: crate::schema::Outcome::Success,
            reason: None,
            session_id: None,
            conversation_id: None,
            ip_address: None,
            user_agent: None,
            geo_country: None,
            diff: None,
            metadata: Default::default(),
            timestamp: "2026-01-01T00:00:00.000Z".into(),
            hash_previous: None,
            hash_current: None,
        };
        let mut second = base.clone();
        second.id = "id2".into();
        let chain = build_hash_chain(vec![base, second], None);
        assert_eq!(chain[0].hash_previous, None, "first event has no hashPrevious");
        assert_eq!(chain[1].hash_previous, chain[0].hash_current, "link to prior current");
        assert!(chain[0].hash_current.is_some());
    }
}
