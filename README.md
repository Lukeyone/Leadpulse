# LeadPulse

LeadPulse is a privacy-first local application for finding businesses that rank in Google search but are absent from AI-generated recommendations.

It compares Google results with ChatGPT and Gemini responses, identifies AI visibility gaps, discovers public business contact details, prepares reviewable outreach drafts, and exports structured research data.

This repository is a **clean, security-hardened rewrite** of the original LeadPulse Local prototype. It intentionally contains:

- no real client or prospect sessions;
- no historical application snapshots;
- no committed credentials;
- no browser-side API keys;
- no automatic browser persistence;
- no public CORS proxy dependencies;
- no executable third-party CDN scripts;
- no automatic email sending.

## Contents

- [Why LeadPulse exists](#why-leadpulse-exists)
- [What it does](#what-it-does)
- [Security changes from the prototype](#security-changes-from-the-prototype)
- [Architecture](#architecture)
- [Data flow](#data-flow)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the application](#running-the-application)
- [Using LeadPulse](#using-leadpulse)
- [Exports and session files](#exports-and-session-files)
- [Contact discovery](#contact-discovery)
- [Security controls](#security-controls)
- [Privacy model](#privacy-model)
- [Responsible use](#responsible-use)
- [Testing](#testing)
- [Repository structure](#repository-structure)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Future improvements](#future-improvements)
- [Licence](#licence)

## Why LeadPulse exists

Businesses can rank well in conventional search while remaining absent from AI-generated recommendation lists. That creates a measurable visibility gap between:

- Google search results;
- ChatGPT recommendations;
- Gemini recommendations.

LeadPulse turns that gap into a structured research workflow. It is designed to answer:

> Which businesses are discoverable through Google but missing from one or more AI recommendation systems for the same customer-intent query?

Example prompts include:

```text
Best financial adviser Brisbane
Best family lawyer Sydney
Best childcare centre Canberra
Best buyers agent Melbourne
```

LeadPulse is a research and drafting aid. It does not prove why a model included or excluded a business, and it does not guarantee that repeated AI queries will produce identical results.

## What it does

A typical LeadPulse workflow is:

1. Enter a customer-intent search prompt.
2. Fetch organic Google results through Serper.dev.
3. Query the configured OpenAI and Gemini APIs through the local server.
4. Review and correct the detected business names.
5. Compare each Google business with the AI responses.
6. Identify businesses missing from ChatGPT, Gemini, or both.
7. Inspect publicly reachable business pages for contact details.
8. Review contact confidence and source pages.
9. Generate an outreach draft from editable templates.
10. Copy the draft or open it in Gmail or a local email application.
11. Manually mark sent or replied status.
12. Export CSV or a local session file when required.

LeadPulse never sends email automatically.

## Security changes from the prototype

The original browser-only prototype exposed several privacy and security risks. This repository addresses them as follows.

### API keys moved to the server

**Prototype:** Serper, OpenAI, and Gemini keys were entered into the page and stored as plain text in browser `localStorage`.

**Sanitized version:** Keys are loaded from a local `.env` file by `server.js`. The browser receives only boolean configuration status. Key values are never returned to the frontend.

### No automatic persistent browser storage

**Prototype:** API keys, search results, AI responses, leads, contacts, drafts, logs, and contact history persisted automatically in `localStorage`.

**Sanitized version:** Workspace state exists only in JavaScript memory for the current tab. Closing or refreshing the tab clears it unless the user explicitly exports a session file.

### No real saved sessions

**Prototype:** The repository contained exported research sessions with aggregated business emails, phone numbers, internal logs, AI responses, and outreach copy.

**Sanitized version:** No real session or prospect data is committed. `.gitignore` blocks common LeadPulse export patterns, and the security test rejects the legacy `Saved Sessions` directory.

### No public CORS proxies

**Prototype:** Public CORS proxy services were used to fetch business websites.

**Sanitized version:** Contact discovery runs directly from the local Node server. Target URLs are validated before requests, redirects are revalidated, private network addresses are blocked, response sizes are limited, and requests time out.

### No executable CDN dependencies

**Prototype:** React, ReactDOM, Babel, and other resources were executed from third-party CDNs in the same page context as stored API credentials.

**Sanitized version:** The frontend uses self-hosted vanilla HTML, CSS, and JavaScript. The default Content Security Policy permits scripts, styles, and network requests only from the local origin.

### Gemini key removed from the URL

**Prototype:** The Gemini key was included in an API URL query parameter.

**Sanitized version:** The local server sends it through the `x-goog-api-key` request header.

### Provider requests are server-side

The browser communicates only with the local LeadPulse server. Provider credentials and provider API calls remain server-side.

### OpenAI response storage is disabled

OpenAI requests include:

```json
{
  "store": false
}
```

Provider-side policies and retention controls can change, so users should still review their own provider account settings and current terms.

### Public-release history is clean

This repository was created separately rather than copying the original Git history. Sensitive files from the prototype are therefore not present in this repository's commits.

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                     │
│                                                             │
│  public/index.html                                          │
│  public/styles.css                                          │
│  public/app.js                                              │
│                                                             │
│  - no provider credentials                                  │
│  - in-memory workspace                                      │
│  - manual session export/import                             │
│  - human-reviewed draft workflow                            │
└──────────────────────────────┬──────────────────────────────┘
                               │ same-origin HTTP
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Local Node.js server                                        │
│                                                             │
│  server.js                                                  │
│                                                             │
│  - reads .env                                               │
│  - serves static files                                      │
│  - applies security headers                                 │
│  - validates API input                                      │
│  - rate limits requests                                     │
│  - calls provider APIs                                      │
│  - performs SSRF-filtered contact discovery                 │
└──────────────┬────────────────┬────────────────┬────────────┘
               │                │                │
               ▼                ▼                ▼
        Serper.dev         OpenAI API       Gemini API
               │
               ▼
       Public business websites
       for contact discovery
```

The application has no database, account system, cookies, analytics service, telemetry endpoint, or LeadPulse-owned cloud backend.

## Data flow

### Google search

The local server sends:

- the search prompt;
- requested page number;
- requested result count;
- the local user's Serper API key;

to Serper.dev.

The server returns a reduced result object to the browser containing:

- title;
- URL;
- snippet;
- page;
- position.

Sponsored results are counted but excluded from the working result list.

### OpenAI

The local server sends the search prompt to the configured OpenAI model. The browser never receives the API key.

The server returns:

- provider name;
- configured model name;
- generated text.

### Gemini

The local server sends the search prompt to the configured Gemini model using the `x-goog-api-key` header. The browser never receives the API key.

### Contact discovery

The local server receives a public business URL and may inspect:

- the supplied page;
- same-origin contact links;
- `/contact`;
- `/contact-us`;
- `/about`;
- `/about-us`;
- `/privacy-policy`.

The server extracts likely public email addresses and Australian phone numbers. It does not authenticate to target websites, submit forms, bypass access controls, or use public CORS proxy services.

### Gmail and local mail applications

When the user selects **Open Gmail**, the browser opens a Gmail compose URL containing:

- recipient;
- subject;
- draft body.

When the user selects **Open mail app**, the browser opens a `mailto:` URL with the same information.

Neither action confirms delivery or marks a message as sent automatically.

## Features

### Search research

- Google search through Serper.dev.
- One to ten result pages.
- Sponsored-result exclusion.
- URL validation.
- Domain-level deduplication.
- Basic directory, social-network, article, and listicle filtering.
- Business-name cleanup from noisy page titles.
- Manual business addition.
- Manual business-name correction.
- Manual result removal.

### AI comparison

- OpenAI Responses API support.
- Gemini Generate Content API support.
- Optional providers: either API can be omitted.
- Manual response paste when a provider is not configured.
- Markdown-aware name extraction.
- Normalized business-name comparison.
- Separate ChatGPT and Gemini presence indicators.
- Visibility-gap counts.

### Contact discovery

- Server-side direct page retrieval.
- Same-origin contact-page discovery.
- Email extraction.
- Cloudflare email-obfuscation decoding.
- Australian phone-number extraction.
- Email-domain comparison.
- General-inbox preference.
- Personal-address review flags.
- Department-address review flags.
- Domain-mismatch warnings.
- Source-page retention for review.
- Per-business or limited-concurrency bulk lookup.

### Outreach preparation

- Editable sender name.
- Editable sender company.
- Editable subject template.
- Editable message template.
- Template variables:

```text
{{COMPANY}}
{{PROMPT}}
{{MISSING_AI}}
{{SENDER}}
{{YOUR_COMPANY}}
```

- Individual draft generation.
- Bulk draft generation.
- Copy to clipboard.
- Gmail compose handoff.
- Local mail-application handoff.
- Manual sent tracking.
- Manual replied tracking.
- No automatic email delivery.

### Exports

- CSV export.
- Sanitized JSON session export.
- Session import with format validation and size limits.
- Spreadsheet-formula injection protection in CSV fields.
- No provider credentials in exports.

### Interface

- Responsive desktop and mobile layout.
- Keyboard-visible focus states.
- Reduced-motion support.
- Accessible labels and status regions.
- Local activity log.
- Clear privacy posture shown in the interface.

## Requirements

- Node.js 20 or newer.
- A modern browser.
- Internet access for external provider calls.
- A Serper.dev API key for automated Google results.
- Optional OpenAI API key.
- Optional Gemini API key.

No npm packages are required for the current implementation.

## Installation

Clone the repository:

```bash
git clone https://github.com/Lukeyone/Leadpulse.git
cd Leadpulse
```

Confirm Node.js is available:

```bash
node --version
```

The version should be Node.js 20 or newer.

There are no dependencies to install, but running the following is harmless and can validate `package.json`:

```bash
npm install
```

Because the package has no dependencies, this should not introduce runtime libraries.

## Configuration

Copy the example environment file:

### macOS or Linux

```bash
cp .env.example .env
```

### Windows PowerShell

```powershell
Copy-Item .env.example .env
```

Edit `.env`:

```dotenv
SERPER_API_KEY=your_serper_key

OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4.1-mini

GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-2.5-flash

HOST=127.0.0.1
PORT=8080
LOG_REQUESTS=false
```

Only `SERPER_API_KEY` is required for automatic Google search.

OpenAI and Gemini are independently optional. When one is not configured, its response can be pasted into the browser manually.

### Key recommendations

Use provider keys that are:

- created specifically for LeadPulse;
- restricted where the provider supports restrictions;
- protected by budget limits;
- protected by usage alerts;
- rotated when exposure is suspected;
- never committed to Git.

### Binding address

The default server binding is:

```dotenv
HOST=127.0.0.1
```

This limits access to the local computer.

Changing the host to `0.0.0.0` exposes the application to the surrounding network. The application does not include authentication, so network exposure is not recommended.

## Running the application

Start LeadPulse:

```bash
npm start
```

Open:

```text
http://127.0.0.1:8080
```

For automatic restarts during development:

```bash
npm run dev
```

The terminal should display:

```text
LeadPulse is running at http://127.0.0.1:8080
Provider keys remain server-side and are never returned to the browser.
```

## Using LeadPulse

### 1. Check provider status

The header shows whether Google, OpenAI, and Gemini are configured.

Possible states include:

- **Google configured**;
- **Google not configured**;
- **OpenAI configured**;
- **OpenAI manual**;
- **Gemini configured**;
- **Gemini manual**.

The status response contains only booleans and model names. It never contains API key values.

### 2. Enter a customer search prompt

Choose a prompt that reflects a realistic customer query.

Good:

```text
Best financial adviser Brisbane
```

Less useful:

```text
financial advice
```

More specific prompts generally create clearer geographic and commercial comparisons.

### 3. Choose Google depth

The page selector supports:

- 1 page;
- 2 pages;
- 3 pages;
- 5 pages;
- 10 pages.

Each page typically consumes a separate Serper request. Higher depth can uncover more businesses but also creates more noise and uses more quota.

### 4. Run the comparison

Select **Run comparison**.

LeadPulse runs Google and all configured AI providers concurrently.

The application clears the existing in-memory workspace before a new run. Export the current session first when it must be retained.

### 5. Review Google businesses

Automated filtering and title cleanup are heuristic. Before using the comparison:

- remove directories or editorial pages that remain;
- correct truncated or inaccurate business names;
- add missing businesses manually;
- open questionable URLs;
- confirm that each row represents an actual business.

### 6. Review AI responses

The complete OpenAI and Gemini response text is editable.

When an API is not configured:

1. copy the exact search prompt;
2. run it manually in the desired AI product;
3. paste the response into the relevant field;
4. select **Rebuild comparison**.

The extracted-name count updates while the text is edited.

### 7. Review visibility gaps

The table displays whether each Google business was detected in:

- ChatGPT;
- Gemini.

A visibility gap means the current name-matching logic did not detect the business in one or more pasted or generated responses. It is not a permanent ranking result.

AI outputs can vary between:

- model versions;
- accounts;
- locations;
- dates;
- system instructions;
- browsing settings;
- repeated runs.

### 8. Find public contacts

Use **Find contact** for an individual business or **Find all contacts** for visibility-gap businesses.

Review:

- selected email;
- confidence label;
- phone number;
- source pages in the exported session when needed.

Never assume that a detected personal email belongs to the correct decision-maker.

### 9. Configure outreach

Set:

- sender name;
- sender company;
- subject template;
- message template.

The default message avoids claiming that LeadPulse caused a competitor to appear in AI recommendations. Add only claims that can be substantiated.

### 10. Generate drafts

Select **Draft message** for one business or **Draft all**.

A draft can be created without a recipient so the wording can be reviewed while contact research continues.

### 11. Review every message

Before sending, confirm:

- business name;
- recipient;
- search prompt;
- current AI result;
- factual claims;
- sender identity;
- subject line;
- spelling and tone;
- legal and policy compliance.

### 12. Open the compose window

Use:

- **Copy**;
- **Open Gmail**;
- **Open mail app**.

LeadPulse does not detect whether the email was actually sent. Use **Mark sent** only after verifying delivery from the email application.

## Exports and session files

### CSV

The CSV includes:

- prompt;
- company;
- website;
- Google page and position;
- ChatGPT presence;
- Gemini presence;
- missing AI platform;
- contact email;
- confidence;
- phone;
- draft status;
- sent status;
- replied status;
- subject;
- message body.

Cells beginning with spreadsheet formula characters are prefixed to reduce formula-injection risk.

### Session JSON

The sanitized session format is:

```text
leadpulse-session-v2-sanitized
```

It can contain:

- search prompts;
- Google results;
- raw AI responses;
- contact information;
- contact-source pages;
- drafts;
- sent and replied states;
- sender settings.

It never intentionally contains provider API keys.

Session files remain sensitive because they can contain aggregated business contacts and commercial outreach material. Store them outside the repository.

### Import protections

Imports are limited to 5 MB and must have the expected sanitized format marker.

Imported JSON is data, not executable JavaScript. However, imported content may still be inaccurate or maliciously misleading, so it must be reviewed.

## Contact discovery

Contact lookup is deliberately conservative.

### URL restrictions

Only absolute `http://` and `https://` URLs are accepted.

The server rejects:

- URLs containing usernames or passwords;
- localhost names;
- `.local` names;
- private IP ranges;
- loopback addresses;
- link-local addresses;
- carrier-grade NAT ranges;
- reserved documentation ranges;
- multicast and reserved IPv4 ranges;
- private and link-local IPv6 ranges.

DNS results are checked before each request, and redirect destinations are validated again.

### Fetch restrictions

- maximum three redirects;
- ten-second timeout;
- approximately 1.5 MB maximum response body;
- HTML and plain-text content only;
- no cookies;
- no authentication headers;
- no browser credentials;
- no JavaScript execution;
- no form submission.

### Pages checked

LeadPulse checks no more than six pages per business during a lookup.

It prioritizes:

- the supplied URL;
- same-origin links containing contact, about, team, people, staff, privacy, enquiry, inquiry, or get-in-touch terms;
- standard contact and about paths.

### Email confidence

Possible confidence values include:

- `high` — general business inbox on the matching domain;
- `medium` — matching domain but less certain mailbox type;
- `review-person` — likely personal or staff address;
- `review-department` — department may not be suitable for outreach;
- `domain-mismatch` — address does not match the target website domain.

Confidence is heuristic and not proof of ownership, role, consent, deliverability, or suitability.

## Security controls

### Server-side secrets

The `.env` file is excluded through `.gitignore`.

The frontend has no key entry fields and no endpoint that returns key values.

### Content Security Policy

The server applies a restrictive policy equivalent to:

```text
default-src 'self'
script-src 'self'
style-src 'self'
img-src 'self' data:
font-src 'self'
connect-src 'self'
object-src 'none'
base-uri 'none'
frame-ancestors 'none'
form-action 'self'
```

### Additional headers

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- restrictive `Permissions-Policy`

### Input limits

- API request bodies: 100 KB maximum;
- query: 240 characters maximum;
- AI prompt: 8,000 characters maximum;
- imported session: 5 MB maximum;
- remote page: approximately 1.5 MB maximum.

### Rate limiting

The local server applies a simple in-memory request limit per remote address.

This is a safety control, not a replacement for authentication in a networked deployment.

### Minimal logging

Request logging is disabled by default.

When enabled, the server logs only:

- HTTP method;
- path;
- status;
- duration.

It does not deliberately log request bodies, prompts, target URLs, email contents, or provider keys.

### Automated repository check

Run:

```bash
npm test
```

The security check fails when it finds:

- common API credential patterns;
- private-key blocks;
- the old `Saved Sessions` directory;
- historical prototype folder names;
- a real `.env` file in the working tree.

This is a lightweight safeguard, not a complete secret-scanning platform.

## Privacy model

LeadPulse is intended for a single user on a trusted local computer.

### Data not collected by this repository

LeadPulse has no application analytics, tracking pixel, telemetry endpoint, advertising service, error-reporting SaaS, or owner-controlled data collection backend.

### Data held in browser memory

During a session, the browser can hold:

- the prompt;
- Google results;
- AI responses;
- extracted business names;
- contacts;
- drafts;
- sent and replied state;
- local activity logs.

This data is cleared when the page is refreshed or closed unless exported.

### Data held by the local server

The local server holds API keys in process environment memory. It does not include a database or file-based research store.

### External processors

Depending on configuration and use, data is sent to:

- Serper.dev;
- OpenAI;
- Google Gemini;
- public business websites;
- Gmail or the selected mail application after explicit user action.

Users are responsible for reviewing the privacy and retention practices of those services.

See [PRIVACY.md](./PRIVACY.md) for the dedicated privacy notice.

## Responsible use

LeadPulse should be used only for lawful, proportionate business research.

Before contacting anyone:

- verify that the contact was published for relevant business communication;
- avoid clearly unrelated personal or staff addresses;
- maintain suppression and opt-out records outside the tool;
- honour unsubscribe and do-not-contact requests;
- avoid misleading statements about AI visibility;
- avoid claiming causation from correlation;
- do not represent generated output as a formal audit without review;
- comply with applicable privacy, anti-spam, direct-marketing, consumer, and professional rules;
- respect website terms and provider terms;
- use reasonable request rates;
- obtain legal advice when required.

The presence of an email address on a public webpage does not automatically establish consent for marketing.

## Testing

Run all current checks:

```bash
npm test
```

This performs:

```text
node --check server.js
node --check public/app.js
node scripts/security-check.mjs
```

### Manual smoke test

1. Start the server without `.env`.
2. Confirm the interface loads and providers show unconfigured/manual.
3. Add a valid `.env` with a Serper key.
4. Restart the server.
5. Run a one-page search.
6. Paste synthetic AI responses.
7. rebuild the comparison;
8. correct and remove a Google business;
9. add a fictional manual business;
10. run contact discovery against a public test website;
11. generate a draft;
12. copy the draft;
13. export CSV;
14. export a session;
15. clear the workspace;
16. import the session;
17. confirm no provider key appears in browser developer tools responses or exports.

## Repository structure

```text
Leadpulse/
├── .env.example
├── .gitignore
├── package.json
├── server.js
├── README.md
├── PRIVACY.md
├── SECURITY.md
├── scripts/
│   └── security-check.mjs
└── public/
    ├── index.html
    ├── styles.css
    └── app.js
```

There are intentionally no directories for saved sessions, old releases, working copies, or client data.

## Troubleshooting

### Google shows “not configured”

Check:

- `.env` exists in the repository root;
- `SERPER_API_KEY` is populated;
- the server was restarted after editing `.env`;
- the key has quota;
- the key has not been revoked.

### OpenAI or Gemini remains manual

Check the corresponding environment variable and restart the server.

Model access differs by account. Change `OPENAI_MODEL` or `GEMINI_MODEL` when the configured model is unavailable.

### The application does not load

Confirm:

```bash
node --version
npm start
```

Then open the exact address printed by the server.

### Port 8080 is already in use

Change `.env`:

```dotenv
PORT=8081
```

Restart and open:

```text
http://127.0.0.1:8081
```

### Contact lookup rejects a URL

The target may:

- resolve to a private or reserved address;
- redirect to a blocked address;
- require authentication;
- return non-HTML content;
- exceed the size limit;
- time out;
- block automated requests.

LeadPulse intentionally does not bypass these controls.

### No email is found

The business may use:

- a contact form only;
- JavaScript-rendered details;
- anti-bot protection;
- image-based contact details;
- an external booking or directory platform;
- no published email.

Open the website manually and verify the appropriate contact channel. Do not guess personal addresses.

### A business is incorrectly marked missing

- review the AI response;
- correct the Google business name;
- remove legal suffix differences;
- check alternate brand names;
- rerun the AI request;
- edit the pasted response when formatting prevented extraction.

### The workspace disappeared

That is expected after refresh or tab closure. Automatic persistence was removed for privacy. Export a session file when the research must be retained.

## Known limitations

- Business-name extraction and matching are heuristic.
- AI output is non-deterministic.
- Search and AI results vary over time.
- Serper results may differ from a user's personalised Google results.
- The app does not emulate a specific ChatGPT or Gemini consumer-product configuration.
- Contact extraction does not execute target-site JavaScript.
- SSRF protection is best-effort and should still be independently reviewed before exposed deployment.
- The server has no authentication.
- The server is designed for localhost, not public hosting.
- No database means no cross-device history.
- Contact confidence does not establish consent.
- Phone extraction is currently oriented toward Australian formats.
- No automatic email delivery or delivery tracking.
- No unsubscribe management system.
- No CRM integration.
- No formal automated browser test suite yet.
- Model defaults may need updating as provider offerings change.

## Future improvements

Potential next steps include:

- TypeScript migration;
- unit tests for name matching and contact scoring;
- Playwright browser tests;
- optional encrypted local database;
- password-protected session exports;
- explicit retention controls;
- contact suppression lists;
- consent and lawful-basis annotations;
- better international phone parsing;
- provider adapter modules;
- configurable filtering rules;
- background job queue with cancellation;
- local-only audit-report generation;
- screenshot evidence capture;
- CRM export adapters;
- containerized local deployment;
- optional authenticated team deployment with a secret manager and encrypted database.

## Licence

This repository is currently marked `UNLICENSED`. No permission is granted to copy, redistribute, sublicense, or commercially deploy the software beyond rights that may otherwise apply by law.

Add an explicit licence before accepting external redistribution or contributions.
