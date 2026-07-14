"""Canonical audit event schema (Python port of ``@smooai/audit``).

Mirrors the TypeScript ``AuditEvent`` interface field-for-field, including its
camelCase wire names. The model uses snake_case attributes with camelCase
aliases so it is Pythonic to construct yet serializes to the exact keys the
shared parity corpus (and every other language SDK) expects.

The schema is deliberately GENERIC — it carries identity, resource, outcome,
correlation, request-enrichment, and integrity fields, but ZERO customer
content beyond the free-form ``metadata`` / ``diff`` bags the emitter fills.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

AuditActorType = Literal["user", "agent", "system", "integration", "api_client"]
AuditOutcome = Literal["success", "failure", "denied"]


class _CamelModel(BaseModel):
    """Base: snake_case attributes, camelCase aliases, populated by either name."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class AuditResource(_CamelModel):
    """Resource an action was performed against (a CRM contact, an agent config…)."""

    type: str
    id: str


class AuditDiff(_CamelModel):
    """Structural diff captured at write time. Either side may be omitted (create
    has no ``before``, delete no ``after``). A PRESENT ``null`` is meaningful and
    is serialized; only an omitted side disappears."""

    before: Any = None
    after: Any = None


class AuditEvent(_CamelModel):
    """The full audit event shape as persisted — the shared shape every language
    SDK emits and hashes. Field names serialize to camelCase to match the corpus."""

    id: str
    organization_id: str
    actor_type: AuditActorType
    actor_id: str
    actor_email: str | None = None
    action: str
    resource: AuditResource
    outcome: AuditOutcome
    reason: str | None = None
    session_id: str | None = None
    conversation_id: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    geo_country: str | None = None
    diff: AuditDiff | None = None
    metadata: dict[str, Any] = {}  # noqa: RUF012 — plain dict default is fine; pydantic deep-copies per instance
    timestamp: str
    hash_previous: str | None = None
    hash_current: str | None = None


# Baseline generic action constants. Emitters are NOT limited to these — any
# consumer defines its own ``namespace.verb`` actions and emits them directly;
# the canonical serialization treats ``action`` as an opaque string. The
# dashboard/alerts pivot off these baseline names, so keep them stable.
AUDIT_ACTIONS: dict[str, str] = {
    # Identity
    "USER_SIGNIN": "user.signin",
    "USER_SIGNOUT": "user.signout",
    "USER_PASSWORD_CHANGED": "user.password_changed",
    "USER_INVITED": "user.invited",
    # Org
    "ORG_CREATED": "org.created",
    "ORG_MEMBER_ADDED": "org.member_added",
    "ORG_MEMBER_REMOVED": "org.member_removed",
    "ORG_ROLE_CHANGED": "org.role_changed",
    "ORG_SUBSCRIPTION_CHANGED": "org.subscription_changed",
    "ORG_PRODUCT_PURCHASED": "org.product_purchased",
    # Agent
    "AGENT_CONFIG_CHANGED": "agent.config_changed",
    "AGENT_KNOWLEDGE_DOC_ADDED": "agent.knowledge_doc_added",
    "AGENT_KNOWLEDGE_DOC_REMOVED": "agent.knowledge_doc_removed",
    "AGENT_ESCALATION_CREATED": "agent.escalation_created",
    "AGENT_TOOL_FAILED": "agent.tool_failed",
    # CRM
    "CRM_CONTACT_CREATED": "crm.contact_created",
    "CRM_CONTACT_MERGED": "crm.contact_merged",
    "CRM_CONTACT_DELETED": "crm.contact_deleted",
    # API auth
    "API_KEY_MINTED": "api.key_minted",
    "API_KEY_ROTATED": "api.key_rotated",
    "API_KEY_REVOKED": "api.key_revoked",
    # Integrations
    "INTEGRATION_CONNECTED": "integration.connected",
    "INTEGRATION_DISCONNECTED": "integration.disconnected",
    # Google write actions
    "GOOGLE_CALENDAR_EVENT_CREATED": "google.calendar.event_created",
    "GOOGLE_GMAIL_DRAFT_CREATED": "google.gmail.draft_created",
    "GOOGLE_GMAIL_MESSAGE_SENT": "google.gmail.message_sent",
    "GOOGLE_DRIVE_FOLDER_CREATED": "google.drive.folder_created",
    "GOOGLE_DRIVE_FILE_SHARED": "google.drive.file_shared",
    "GOOGLE_BUSINESS_REVIEW_REPLIED": "google.business_profile.review_replied",
    "GOOGLE_BUSINESS_POST_CREATED": "google.business_profile.post_created",
    "GOOGLE_FORMS_FORM_CREATED": "google.forms.form_created",
    "GOOGLE_ADS_CAMPAIGN_PAUSED": "google.ads.campaign_paused",
    "GOOGLE_ADS_CAMPAIGN_ENABLED": "google.ads.campaign_enabled",
    "GOOGLE_BOOKING_CREATED": "google.booking.created",
}

_NAMESPACED_ACTION = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]+)+$")


def is_namespaced_action(action: str) -> bool:
    """Validate the ``namespace.verb`` convention (a lowercase namespace + one or
    more lowercase verb segments, dot-separated). Assert this at your trust
    boundary; canonical serialization treats ``action`` as an opaque string."""
    return _NAMESPACED_ACTION.match(action) is not None
