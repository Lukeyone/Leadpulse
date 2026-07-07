'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns').promises;
const net = require('node:net');

loadLocalEnv();

const HOST = process.env.HOST || '127.0.0.1';
const PORT = clampNumber(process.env.PORT, 1, 65535, 8080);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_JSON_BYTES = 100_000;
const MAX_REMOTE_BYTES = 1_500_000;
const REMOTE_TIMEOUT_MS = 10_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 90;
const rateBuckets = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();
  applySecurityHeaders(response);

  try {
    if (!consumeRateLimit(request)) {
      return sendJson(response, 429, { error: 'Too many requests. Try again shortly.' });
    }

    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
    } else {
      await serveStatic(response, url.pathname);
    }
  } catch (error) {
    const message = publicErrorMessage(error);
    if (!response.headersSent) sendJson(response, error.statusCode || 500, { error: message });
    else response.end();
  } finally {
    if (process.env.LOG_REQUESTS === 'true') {
      const duration = Date.now() - startedAt;
      console.log(`${request.method} ${safeLogPath(request.url)} ${response.statusCode || 200} ${duration}ms`);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`LeadPulse is running at http://${HOST}:${PORT}`);
  console.log('Provider keys remain server-side and are never returned to the browser.');
});

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

async function handleApi(request, response, url) {
  if (url.pathname === '/api/status' && request.method === 'GET') {
    return sendJson(response, 200, {
      serperConfigured: Boolean(process.env.SERPER_API_KEY),
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      openaiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      persistence: 'memory-only',
      contactLookup: 'server-side-direct',
    });
  }

  if (request.method !== 'POST') {
    return sendJson(response, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  }

  const body = await readJsonBody(request);

  if (url.pathname === '/api/search') {
    return handleSearch(response, body);
  }

  if (url.pathname === '/api/ai') {
    return handleAi(response, body);
  }

  if (url.pathname === '/api/contact') {
    return handleContact(response, body);
  }

  return sendJson(response, 404, { error: 'API route not found.' });
}

async function handleSearch(response, body) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return sendJson(response, 503, { error: 'Serper is not configured on the local server.' });

  const query = requireText(body.query, 'query', 2, 240);
  const pages = clampNumber(body.pages, 1, 10, 3);
  const results = [];
  let sponsoredCount = 0;

  for (let page = 1; page <= pages; page += 1) {
    const upstream = await fetchJson('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify({ q: query, num: 10, page }),
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });

    sponsoredCount += Array.isArray(upstream.ads) ? upstream.ads.length : 0;
    const organic = Array.isArray(upstream.organic) ? upstream.organic : [];

    organic.forEach((item, index) => {
      results.push({
        title: safeText(item.title, 300),
        url: safeHttpUrl(item.link),
        snippet: safeText(item.snippet, 800),
        page,
        position: Number.isFinite(item.position) ? item.position : ((page - 1) * 10) + index + 1,
      });
    });

    if (organic.length < 5) break;
  }

  return sendJson(response, 200, {
    query,
    pagesRequested: pages,
    sponsoredExcluded: sponsoredCount,
    results: results.filter((item) => item.url),
  });
}

async function handleAi(response, body) {
  const provider = String(body.provider || '').toLowerCase();
  const prompt = requireText(body.prompt, 'prompt', 2, 8_000);

  if (provider === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      return sendJson(response, 503, { error: 'OpenAI is not configured on the local server.' });
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const upstream = await fetchJson('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        input: prompt,
        max_output_tokens: 1_800,
        store: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    return sendJson(response, 200, {
      provider,
      model,
      text: extractOpenAiText(upstream),
    });
  }

  if (provider === 'gemini') {
    if (!process.env.GEMINI_API_KEY) {
      return sendJson(response, 503, { error: 'Gemini is not configured on the local server.' });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const upstream = await fetchJson(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1_800 },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    return sendJson(response, 200, {
      provider,
      model,
      text: extractGeminiText(upstream),
    });
  }

  return sendJson(response, 400, { error: 'provider must be either openai or gemini.' });
}

async function handleContact(response, body) {
  const targetUrl = requirePublicUrl(body.url);
  const result = await discoverPublicContacts(targetUrl);
  return sendJson(response, 200, result);
}

async function discoverPublicContacts(initialUrl) {
  const initial = new URL(initialUrl);
  const queued = [initial.href];
  const visited = new Set();
  const pageRecords = [];
  const emailRecords = new Map();
  const phoneRecords = new Map();

  while (queued.length && visited.size < 6) {
    const nextUrl = queued.shift();
    if (!nextUrl || visited.has(nextUrl)) continue;
    visited.add(nextUrl);

    try {
      const page = await fetchPublicText(nextUrl);
      const pageUrl = new URL(page.finalUrl);
      pageRecords.push({ url: page.finalUrl, status: page.status });

      extractEmails(page.text).forEach((email) => {
        if (!emailRecords.has(email)) emailRecords.set(email, new Set());
        emailRecords.get(email).add(page.finalUrl);
      });

      extractPhones(page.text).forEach((phone) => {
        if (!phoneRecords.has(phone)) phoneRecords.set(phone, new Set());
        phoneRecords.get(phone).add(page.finalUrl);
      });

      if (pageRecords.length === 1) {
        const links = extractContactLinks(page.text, pageUrl, initial.origin);
        links.forEach((link) => {
          if (!visited.has(link) && !queued.includes(link)) queued.push(link);
        });

        ['/contact', '/contact-us', '/about', '/about-us', '/privacy-policy'].forEach((suffix) => {
          const candidate = new URL(suffix, initial.origin).href;
          if (!visited.has(candidate) && !queued.includes(candidate)) queued.push(candidate);
        });
      }
    } catch (error) {
      pageRecords.push({ url: redactUrl(nextUrl), error: publicErrorMessage(error) });
    }
  }

  const hostname = initial.hostname.replace(/^www\./, '').toLowerCase();
  const emails = [...emailRecords.entries()]
    .map(([email, sources]) => ({
      email,
      sources: [...sources],
      confidence: classifyEmail(email, hostname),
    }))
    .sort(compareEmailCandidates);

  const phones = [...phoneRecords.entries()]
    .map(([phone, sources]) => ({ phone, sources: [...sources] }))
    .slice(0, 20);

  return {
    target: initial.href,
    emails: emails.slice(0, 30),
    phones,
    pagesChecked: pageRecords,
    notice: 'Contacts were collected from publicly reachable pages. Human verification is required before use.',
  };
}

async function fetchPublicText(inputUrl, redirectCount = 0) {
  if (redirectCount > 3) throw httpError(400, 'Too many redirects from the target website.');
  const validated = await validatePublicNetworkUrl(inputUrl);

  const response = await fetch(validated.href, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    headers: {
      Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
      'User-Agent': 'LeadPulse-Local/1.0 (+local research tool; contact discovery)',
    },
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw httpError(502, 'The target returned a redirect without a destination.');
    const redirected = new URL(location, validated).href;
    return fetchPublicText(redirected, redirectCount + 1);
  }

  if (!response.ok) throw httpError(502, `Target page returned HTTP ${response.status}.`);

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType && !contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml+xml')) {
    throw httpError(415, 'Target page is not HTML or plain text.');
  }

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_REMOTE_BYTES) throw httpError(413, 'Target page is too large to inspect safely.');

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_REMOTE_BYTES) throw httpError(413, 'Target page exceeded the inspection size limit.');

  return {
    finalUrl: validated.href,
    status: response.status,
    text: buffer.toString('utf8'),
  };
}

async function validatePublicNetworkUrl(value) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw httpError(400, 'Only HTTP and HTTPS targets are allowed.');
  if (parsed.username || parsed.password) throw httpError(400, 'URLs containing credentials are not allowed.');
  if (!parsed.hostname || parsed.hostname.length > 253) throw httpError(400, 'Invalid target hostname.');

  const lowerHost = parsed.hostname.toLowerCase();
  if (lowerHost === 'localhost' || lowerHost.endsWith('.localhost') || lowerHost.endsWith('.local')) {
    throw httpError(400, 'Local and private hostnames are not allowed.');
  }

  if (net.isIP(lowerHost)) {
    if (isBlockedAddress(lowerHost)) throw httpError(400, 'Private, local, reserved, and documentation addresses are not allowed.');
  } else {
    const addresses = await dns.lookup(lowerHost, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) {
      throw httpError(400, 'The target resolves to a private, local, reserved, or unavailable address.');
    }
  }

  parsed.hash = '';
  return parsed;
}

function isBlockedAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 2) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0) ||
      a >= 224
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    if (normalized.startsWith('2001:db8:')) return true;
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length);
      return net.isIPv4(mapped) ? isBlockedAddress(mapped) : true;
    }
  }

  return false;
}

function extractEmails(html) {
  const decoded = decodeHtml(String(html || ''))
    .replace(/\s*\[\s*at\s*\]\s*/gi, '@')
    .replace(/\s*\(\s*at\s*\)\s*/gi, '@')
    .replace(/\s*\[\s*dot\s*\]\s*/gi, '.')
    .replace(/\s*\(\s*dot\s*\)\s*/gi, '.');

  const candidates = decoded.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}/g) || [];
  const cloudflare = [...String(html || '').matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)]
    .map((match) => decodeCloudflareEmail(match[1]))
    .filter(Boolean);

  return [...new Set([...candidates, ...cloudflare]
    .map((email) => email.toLowerCase().replace(/[),.;:]+$/, '').trim())
    .filter(isPlausibleBusinessEmail))];
}

function extractPhones(html) {
  const text = htmlToText(html);
  const matches = text.match(/(?:\+?61\s?[2-478]|0[2-478])(?:[\s().-]*\d){8}|(?:1300|1800)\s?\d{3}\s?\d{3}/g) || [];
  return [...new Set(matches.map((phone) => phone.replace(/\s+/g, ' ').trim()))].slice(0, 20);
}

function extractContactLinks(html, pageUrl, requiredOrigin) {
  const links = [];
  const regex = /href\s*=\s*["']([^"'#]+)["']/gi;
  let match;

  while ((match = regex.exec(html)) !== null && links.length < 30) {
    try {
      const candidate = new URL(decodeHtml(match[1]), pageUrl);
      if (candidate.origin !== requiredOrigin) continue;
      if (!['http:', 'https:'].includes(candidate.protocol)) continue;
      if (!/(contact|about|team|people|staff|privacy|enquir|inquir|get-in-touch)/i.test(`${candidate.pathname} ${candidate.search}`)) continue;
      candidate.hash = '';
      links.push(candidate.href);
    } catch {
      // Ignore malformed page links.
    }
  }

  return [...new Set(links)].slice(0, 8);
}

function classifyEmail(email, websiteHost) {
  const [local, host] = email.toLowerCase().split('@');
  const rootHost = websiteHost.replace(/^www\./, '');
  const sameDomain = host === rootHost || host.endsWith(`.${rootHost}`) || rootHost.endsWith(`.${host}`);
  const official = /^(contact|contactus|hello|info|office|admin|reception|enquir|inquir|mail|team|sales|support)/.test(local);
  const risky = /^(privacy|careers?|jobs?|media|press|billing|accounts?|payroll|noreply|no-reply|webmaster|abuse)/.test(local);
  const likelyPerson = /^[a-z]+[._-][a-z]+$/.test(local) || /^[a-z][a-z]{4,}$/.test(local);

  if (!sameDomain) return 'domain-mismatch';
  if (risky) return 'review-department';
  if (official) return 'high';
  if (likelyPerson) return 'review-person';
  return 'medium';
}

function compareEmailCandidates(a, b) {
  const weight = {
    high: 0,
    medium: 1,
    'review-person': 2,
    'review-department': 3,
    'domain-mismatch': 4,
  };
  return (weight[a.confidence] ?? 9) - (weight[b.confidence] ?? 9) || a.email.localeCompare(b.email);
}

function isPlausibleBusinessEmail(email) {
  if (email.length > 254) return false;
  if (/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i.test(email)) return false;
  if (/(example\.com|domain\.com|yourcompany|yourdomain|sentry\.io|w3\.org|schema\.org)$/i.test(email)) return false;
  if (/^(noreply|no-reply|do-not-reply|donotreply|mailer-daemon|postmaster)@/i.test(email)) return false;
  return true;
}

function decodeCloudflareEmail(encoded) {
  try {
    const key = parseInt(encoded.slice(0, 2), 16);
    let output = '';
    for (let index = 2; index < encoded.length; index += 2) {
      output += String.fromCharCode(parseInt(encoded.slice(index, index + 2), 16) ^ key);
    }
    return output;
  } catch {
    return '';
  }
}

function htmlToText(html) {
  return decodeHtml(String(html || ''))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_match, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extractOpenAiText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const parts = [];
  for (const output of Array.isArray(payload.output) ? payload.output : []) {
    for (const content of Array.isArray(output.content) ? output.content : []) {
      if (typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function extractGeminiText(payload) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  return candidates
    .flatMap((candidate) => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    if (!response.ok) throw httpError(502, `Upstream service returned HTTP ${response.status}.`);
    throw httpError(502, 'Upstream service returned invalid JSON.');
  }

  if (!response.ok) {
    const upstreamMessage = safeText(payload?.error?.message || payload?.message || '', 300);
    throw httpError(502, upstreamMessage || `Upstream service returned HTTP ${response.status}.`);
  }

  return payload;
}

async function serveStatic(response, requestPath) {
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(normalizedPath);
  } catch {
    throw httpError(400, 'Invalid URL encoding.');
  }

  const relativePath = decodedPath.replace(/^\/+/, '');
  const resolved = path.resolve(PUBLIC_DIR, relativePath);
  if (!resolved.startsWith(`${PUBLIC_DIR}${path.sep}`) && resolved !== PUBLIC_DIR) {
    throw httpError(403, 'Forbidden.');
  }

  let stat;
  try {
    stat = await fs.promises.stat(resolved);
  } catch {
    throw httpError(404, 'File not found.');
  }

  const filePath = stat.isDirectory() ? path.join(resolved, 'index.html') : resolved;
  const extension = path.extname(filePath).toLowerCase();
  const content = await fs.promises.readFile(filePath);
  response.statusCode = 200;
  response.setHeader('Content-Type', MIME_TYPES[extension] || 'application/octet-stream');
  response.setHeader('Cache-Control', extension === '.html' ? 'no-store' : 'public, max-age=3600');
  response.end(content);
}

function applySecurityHeaders(response) {
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '));
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
}

function consumeRateLimit(request) {
  const key = request.socket.remoteAddress || 'local';
  const now = Date.now();
  const current = rateBuckets.get(key);

  if (!current || now - current.startedAt > RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }

  current.count += 1;
  if (rateBuckets.size > 500) {
    for (const [bucketKey, bucket] of rateBuckets) {
      if (now - bucket.startedAt > RATE_WINDOW_MS) rateBuckets.delete(bucketKey);
    }
  }
  return current.count <= RATE_MAX_REQUESTS;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_JSON_BYTES) {
        reject(httpError(413, 'Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(httpError(400, 'JSON body must be an object.'));
        }
        resolve(parsed);
      } catch {
        reject(httpError(400, 'Request body contains invalid JSON.'));
      }
    });

    request.on('error', reject);
  });
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  Object.entries(extraHeaders).forEach(([name, value]) => response.setHeader(name, value));
  response.end(body);
}

function requireText(value, field, minimum, maximum) {
  const text = String(value || '').trim();
  if (text.length < minimum || text.length > maximum) {
    throw httpError(400, `${field} must contain between ${minimum} and ${maximum} characters.`);
  }
  return text;
}

function requirePublicUrl(value) {
  const text = requireText(value, 'url', 8, 2_000);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw httpError(400, 'url must be a valid absolute URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw httpError(400, 'url must use HTTP or HTTPS.');
  return parsed.href;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function safeText(value, maximum) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function safeLogPath(value) {
  try {
    return new URL(value || '/', 'http://localhost').pathname.slice(0, 200);
  } catch {
    return '/';
  }
}

function publicErrorMessage(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'The external request timed out.';
  return safeText(error?.message || 'Unexpected server error.', 400) || 'Unexpected server error.';
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
