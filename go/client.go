package audit

// ClientOptions configures a Client.
type ClientOptions struct {
	// Endpoint is the base URL of the audit ingest endpoint.
	Endpoint string
	// Token is the bearer token used to authenticate emit requests.
	Token string
}

// Client emits audit events to a configurable ingest endpoint over HTTPS.
//
// TODO(audit-impl): implement Emit — POST CanonicalJSON(event) to the endpoint
// with "Authorization: Bearer <token>", retry/backoff, and surface transport
// errors.
type Client struct {
	options ClientOptions
}

// NewClient returns a Client bound to the given endpoint + token.
func NewClient(options ClientOptions) *Client {
	return &Client{options: options}
}

// Emit sends a single audit event.
//
// TODO(audit-impl): implement the HTTP POST.
func (c *Client) Emit(event Event) error {
	_ = c.options
	_ = event
	return ErrNotImplemented
}
