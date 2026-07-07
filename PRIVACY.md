# Privacy Notice

## Scope

This notice describes the data behaviour of the open-source LeadPulse code in this repository.

LeadPulse is intended to be run locally by the user. The repository owner does not operate a LeadPulse cloud service through this code and does not automatically receive the user's prompts, API keys, search results, contacts, drafts, or exports.

## Data handled in the browser

During use, the browser may hold the following data in page memory:

- search prompts;
- selected Google page depth;
- Google business results;
- raw OpenAI responses;
- raw Gemini responses;
- extracted and corrected business names;
- AI visibility comparison results;
- public business email candidates;
- public phone candidates;
- contact source pages;
- outreach templates;
- generated outreach drafts;
- manually recorded sent and replied states;
- local activity messages.

The application does not automatically store this data in `localStorage`, `sessionStorage`, IndexedDB, cookies, or a remote LeadPulse database.

Refreshing or closing the page normally clears the in-memory workspace.

## Data handled by the local server

The local Node.js process may hold:

- Serper API key;
- OpenAI API key;
- Gemini API key;
- configured model names;
- request data while processing a call;
- external provider responses while returning them to the browser;
- fetched public webpage content while extracting contact details;
- temporary in-memory rate-limit counters.

The server does not include a database or automatic research-data file store.

## Local environment file

Credentials are read from a local `.env` file or process environment variables.

The supplied `.gitignore` excludes `.env` and related environment files other than `.env.example`.

The user is responsible for:

- keeping `.env` private;
- restricting file-system access;
- using provider-specific key restrictions;
- rotating compromised credentials;
- not sharing terminal output that contains secrets.

## External services

LeadPulse can send data to external services selected and configured by the user.

### Serper.dev

Data may include:

- the search prompt;
- page number;
- result count;
- the user's Serper API key;
- normal network metadata.

### OpenAI

Data may include:

- the search prompt;
- configured model identifier;
- the user's OpenAI API key;
- normal network metadata.

The application currently requests `store: false`. Users should independently review current OpenAI API data controls and account settings.

### Google Gemini

Data may include:

- the search prompt;
- configured model identifier;
- the user's Gemini API key through the `x-goog-api-key` header;
- normal network metadata.

### Public business websites

When contact discovery is used, the local server requests publicly reachable pages on the selected business website.

The target website may receive:

- the server user's IP address;
- requested paths;
- request timing;
- the LeadPulse user-agent string;
- normal HTTP metadata.

LeadPulse does not submit contact forms or authenticate to target websites.

### Gmail or a local email application

After explicit user action, a compose URL may contain:

- recipient email;
- subject;
- complete draft body.

The relevant browser, email provider, operating system, and email application may retain this information according to their own policies.

## Data exports

LeadPulse allows explicit export of CSV and JSON files.

Exports may contain:

- prompts;
- business names and URLs;
- raw AI responses;
- public email addresses;
- public phone numbers;
- source-page URLs;
- draft content;
- sender information;
- sent and replied status.

Exports intentionally exclude provider API keys, but they can still contain sensitive commercial research and aggregated contact information.

Users should:

- store exports securely;
- avoid committing exports to Git;
- avoid sharing exports through public links;
- delete exports when no longer needed;
- apply appropriate access controls;
- comply with applicable retention and privacy requirements.

## Automatic collection by the repository owner

The code includes no owner-operated:

- analytics endpoint;
- telemetry endpoint;
- advertising tracker;
- tracking pixel;
- session replay;
- crash-reporting SaaS;
- user account service;
- remote LeadPulse database.

Normal GitHub activity related to viewing or cloning this repository is governed by GitHub's own services and policies, not by the LeadPulse runtime.

## Contact information and lawful use

LeadPulse extracts details that appear on publicly reachable business webpages. Public availability does not automatically establish consent for marketing or unrestricted reuse.

The user is responsible for determining:

- whether collection is permitted;
- whether retention is proportionate;
- whether contact is lawful;
- whether an address is intended for the proposed communication;
- whether an opt-out or suppression record applies;
- what disclosures are required;
- how long the data should be retained.

## Children and sensitive personal information

LeadPulse is not designed to collect information about children or sensitive personal information.

Do not use it to research, aggregate, profile, or contact private individuals regarding sensitive matters.

## Security

The application uses local-only defaults, server-side credentials, restrictive browser headers, request limits, SSRF filtering, and explicit export controls.

No security control is absolute. See [SECURITY.md](./SECURITY.md) for supported use and reporting guidance.

## Changes

This notice should be updated whenever LeadPulse adds:

- persistent storage;
- authentication;
- analytics;
- a hosted service;
- a new external provider;
- a new export destination;
- automated email delivery;
- CRM integration;
- team collaboration;
- public deployment support.
