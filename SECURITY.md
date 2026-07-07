# Security Policy

## Supported version

The `main` branch is the only supported version of LeadPulse.

Historical versions from the original LeadPulse Local prototype are intentionally excluded from this repository and should not be reintroduced.

## Intended deployment

LeadPulse is designed to run on a trusted local computer and bind to:

```text
127.0.0.1
```

It is not designed to be exposed directly to the public internet or an untrusted local network.

The application does not currently include:

- user authentication;
- role-based authorization;
- TLS termination;
- a production secret manager;
- persistent encrypted storage;
- multi-tenant isolation;
- a production-grade distributed rate limiter.

## Reporting a vulnerability

Do not publish credentials, private contact data, proof-of-concept payloads, or exploit details in a public GitHub issue.

Report suspected vulnerabilities privately to the repository owner through an appropriate private communication channel. Include:

- affected file and version;
- reproduction steps;
- expected and actual behaviour;
- security impact;
- suggested mitigation when available;
- whether any credential or private data may have been exposed.

Revoke and rotate any potentially exposed provider credential before waiting for a code fix.

## Secret handling

Provider credentials must be placed only in the local `.env` file or injected through process environment variables.

Never place credentials in:

- frontend JavaScript;
- HTML;
- CSS;
- screenshots;
- README examples containing real values;
- exported sessions;
- issue descriptions;
- pull request descriptions;
- test fixtures;
- shell-history excerpts;
- application logs.

Use provider-side restrictions, quotas, budget limits, and alerts wherever possible.

## Data handling

Research exports can contain aggregated business emails, phone numbers, AI responses, commercial notes, outreach drafts, and status information.

Treat all exported CSV and JSON files as private working data. They are ignored by the supplied `.gitignore`, but users remain responsible for where they copy or upload them.

Do not commit real research sessions.

## Network hardening

The contact-discovery endpoint applies best-effort SSRF controls, including:

- HTTP and HTTPS only;
- no URL credentials;
- localhost and `.local` rejection;
- private, loopback, link-local, reserved, and documentation IP blocking;
- DNS checks;
- redirect revalidation;
- content-type limits;
- body-size limits;
- timeouts;
- redirect limits.

These controls reduce risk but do not make the endpoint safe for unauthenticated public deployment. DNS rebinding, platform-specific network behaviour, parser inconsistencies, and future protocol changes require ongoing review.

## Browser hardening

The server sends a restrictive Content Security Policy and additional browser security headers.

Do not weaken the policy to permit:

- arbitrary inline scripts;
- arbitrary remote scripts;
- wildcard network destinations;
- framing by unknown origins;
- plugin content;
- untrusted form destinations.

When adding dependencies, prefer a local build process and committed lockfile over runtime CDN execution.

## Dependency policy

The current implementation has no runtime npm dependencies.

Before adding a dependency:

1. confirm it is necessary;
2. review its maintenance and security history;
3. pin an appropriate version;
4. commit a lockfile;
5. review transitive dependencies;
6. update the Content Security Policy when required;
7. add tests for the new data flow;
8. document any new external service.

## Required checks before release

Run:

```bash
npm test
```

Then verify manually that:

- `.env` is untracked;
- no real session exports are present;
- no API key appears in browser network responses;
- no API key appears in generated CSV or JSON;
- the server binds to `127.0.0.1` by default;
- contact discovery rejects private targets;
- external redirects are revalidated;
- request logging remains disabled unless deliberately enabled;
- provider model names are current and configured by environment variable.

## Security boundaries

LeadPulse cannot protect against:

- malware on the local computer;
- malicious browser extensions;
- a compromised operating system account;
- provider-side incidents;
- a user publishing exported data;
- a user exposing the local server to an untrusted network;
- unsafe changes made after cloning;
- recipients or email providers retaining outreach content.

Use a dedicated operating-system account or browser profile when stronger local separation is required.
