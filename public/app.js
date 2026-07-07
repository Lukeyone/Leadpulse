'use strict';

const state = {
  status: {
    serperConfigured: false,
    openaiConfigured: false,
    geminiConfigured: false,
  },
  query: '',
  pages: 3,
  googleResults: [],
  openaiRaw: '',
  geminiRaw: '',
  leads: [],
  contacts: {},
  drafts: {},
  sent: {},
  replied: {},
  logs: [],
};

const elements = {};

window.addEventListener('DOMContentLoaded', init);

function init() {
  [
    'provider-status', 'clear-workspace', 'run-search', 'search-query', 'search-pages',
    'search-progress', 'compare-results', 'google-count', 'google-results',
    'manual-result-form', 'manual-name', 'manual-url', 'openai-response', 'openai-count',
    'gemini-response', 'gemini-count', 'find-all-contacts', 'draft-all', 'export-csv',
    'comparison-summary', 'lead-table-body', 'sender-name', 'sender-company',
    'subject-template', 'message-template', 'export-session', 'import-session', 'session-file',
    'draft-count', 'draft-list', 'activity-log', 'clear-logs',
  ].forEach((id) => { elements[id] = document.getElementById(id); });

  elements['run-search'].addEventListener('click', runComparison);
  elements['compare-results'].addEventListener('click', buildComparison);
  elements['manual-result-form'].addEventListener('submit', addManualResult);
  elements['openai-response'].addEventListener('input', handleResponseEdit);
  elements['gemini-response'].addEventListener('input', handleResponseEdit);
  elements['find-all-contacts'].addEventListener('click', findAllContacts);
  elements['draft-all'].addEventListener('click', draftAll);
  elements['export-csv'].addEventListener('click', exportCsv);
  elements['export-session'].addEventListener('click', exportSession);
  elements['import-session'].addEventListener('click', () => elements['session-file'].click());
  elements['session-file'].addEventListener('change', importSession);
  elements['clear-workspace'].addEventListener('click', clearWorkspace);
  elements['clear-logs'].addEventListener('click', clearLogs);

  fetchStatus();
  renderAll();
}

async function fetchStatus() {
  try {
    const response = await fetch('/api/status', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Local server returned HTTP ${response.status}.`);
    state.status = await response.json();
    renderProviderStatus();
    addLog('success', 'Connected to the local LeadPulse server.');
  } catch (error) {
    renderProviderStatus(true);
    addLog('error', error.message || 'Could not connect to the local server.');
  }
}

async function runComparison() {
  const query = elements['search-query'].value.trim();
  const pages = Number(elements['search-pages'].value);

  if (query.length < 2) {
    setProgress('Enter a search prompt first.', 'error');
    elements['search-query'].focus();
    return;
  }

  state.query = query;
  state.pages = pages;
  state.googleResults = [];
  state.openaiRaw = '';
  state.geminiRaw = '';
  state.leads = [];
  state.contacts = {};
  state.drafts = {};
  state.sent = {};
  state.replied = {};
  elements['openai-response'].value = '';
  elements['gemini-response'].value = '';

  setBusy(true);
  setProgress('Running Google and configured AI providers…');
  addLog('info', `Started comparison for “${query}”.`);

  const tasks = [runGoogleSearch(query, pages)];
  if (state.status.openaiConfigured) tasks.push(runAiProvider('openai', query));
  if (state.status.geminiConfigured) tasks.push(runAiProvider('gemini', query));

  const outcomes = await Promise.allSettled(tasks);
  const failures = outcomes.filter((item) => item.status === 'rejected');
  failures.forEach((item) => addLog('error', item.reason?.message || 'A provider request failed.'));

  elements['openai-response'].value = state.openaiRaw;
  elements['gemini-response'].value = state.geminiRaw;
  buildComparison();
  setBusy(false);

  if (failures.length) {
    setProgress(`Completed with ${failures.length} provider error${failures.length === 1 ? '' : 's'}. Review the activity log.`, 'error');
  } else {
    setProgress('Comparison completed. Review the names and contacts before outreach.', 'success');
  }
}

async function runGoogleSearch(query, pages) {
  if (!state.status.serperConfigured) {
    throw new Error('Serper is not configured in the local .env file.');
  }

  const payload = await apiPost('/api/search', { query, pages });
  state.googleResults = processGoogleResults(payload.results || []);
  addLog('success', `Google returned ${state.googleResults.length} unique business results; ${payload.sponsoredExcluded || 0} sponsored result(s) were excluded.`);
  renderGoogleResults();
}

async function runAiProvider(provider, prompt) {
  const payload = await apiPost('/api/ai', { provider, prompt });
  const text = String(payload.text || '');

  if (provider === 'openai') {
    state.openaiRaw = text;
    addLog('success', `OpenAI response received using ${payload.model || 'the configured model'}.`);
  } else {
    state.geminiRaw = text;
    addLog('success', `Gemini response received using ${payload.model || 'the configured model'}.`);
  }
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    throw new Error(`The local server returned invalid data for ${path}.`);
  }

  if (!response.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}.`);
  return payload;
}

function processGoogleResults(input) {
  const seenDomains = new Set();
  const output = [];
  const blockedDomains = [
    'facebook.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'tiktok.com',
    'reddit.com', 'quora.com', 'wikipedia.org', 'yellowpages.com', 'yellowpages.com.au',
    'truelocal.com.au', 'hotfrog.com.au', 'oneflare.com.au', 'yelp.com',
    'productreview.com.au', 'tripadvisor.com', 'findlaw.com', 'lawyers.com',
    'lawtap.com', 'threebestrated.com', 'bestinhood.com',
  ];
  const articlePattern = /\b(top|best)\s+\d+|\d+\s+(top|best)|comparison|directory|guide|reviews?|how to choose/i;
  const articlePathPattern = /\/(blog|article|articles|news|post|posts|guide|guides|review|reviews|category|tag)\b/i;

  input.forEach((raw) => {
    const url = safeUrl(raw.url);
    if (!url) return;
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (seenDomains.has(domain)) return;
    if (blockedDomains.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) return;
    if (articlePattern.test(raw.title || '') || articlePathPattern.test(parsed.pathname)) return;

    seenDomains.add(domain);
    output.push({
      id: makeId(domain),
      name: cleanBusinessName(raw.title, url),
      rawTitle: String(raw.title || ''),
      url,
      snippet: String(raw.snippet || '').slice(0, 800),
      page: Number(raw.page) || 1,
      position: Number(raw.position) || output.length + 1,
    });
  });

  return output;
}

function cleanBusinessName(title, url) {
  const raw = String(title || '').replace(/\s+/g, ' ').trim();
  const domainFallback = domainToName(new URL(url).hostname.replace(/^www\./, '').split('.')[0]);
  if (!raw) return domainFallback;

  const segments = raw
    .split(/\s+[|–—»]\s+|\s+::\s+|\s+-\s+(?=[A-Z])/)
    .map((part) => part.trim())
    .filter(Boolean);

  const generic = /^(home|welcome|official site|contact|about us|services|best|top|find|search)$/i;
  const scored = segments.map((segment, index) => {
    let score = 100 - index * 8;
    if (generic.test(segment)) score -= 80;
    if (segment.length < 3 || segment.length > 90) score -= 40;
    if (/\b(best|top|guide|review|directory|near me|in sydney|in brisbane|in melbourne|in perth|in adelaide)\b/i.test(segment)) score -= 25;
    if (/\b(lawyers?|advisers?|advisors?|consulting|group|services|solutions|agency|partners|centre|center|clinic|company|co)\b/i.test(segment)) score += 8;
    return { segment, score };
  });

  scored.sort((a, b) => b.score - a.score);
  let name = scored[0]?.segment || domainFallback;
  name = name
    .replace(/\s*[|–—»].*$/, '')
    .replace(/\s+-\s+(official|home|contact|about).*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return name || domainFallback;
}

function domainToName(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim() || 'Unknown business';
}

function handleResponseEdit() {
  state.openaiRaw = elements['openai-response'].value;
  state.geminiRaw = elements['gemini-response'].value;
  renderAiCounts();
}

function parseAiNames(text) {
  const raw = String(text || '').replace(/\r/g, '');
  if (!raw.trim()) return [];

  const candidates = [];
  const boldMatches = [...raw.matchAll(/\*\*([^*\n]{2,120})\*\*/g)].map((match) => match[1]);
  candidates.push(...boldMatches);

  raw.split('\n').forEach((line) => {
    let value = line.trim();
    if (!value) return;
    value = value
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*•]\s+/, '')
      .replace(/^\d{1,3}[.)]\s+/, '')
      .replace(/^\*\*|\*\*$/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .trim();

    if (value.includes(' — ')) value = value.split(' — ')[0].trim();
    if (value.includes(' – ')) value = value.split(' – ')[0].trim();
    if (value.includes(':') && value.split(':')[0].split(/\s+/).length <= 8) value = value.split(':')[0].trim();

    if (isLikelyBusinessName(value)) candidates.push(value);
  });

  return [...new Map(candidates
    .map((name) => name.replace(/^['"“”]|['"“”]$/g, '').replace(/\s+/g, ' ').trim())
    .filter(isLikelyBusinessName)
    .map((name) => [normalizeName(name), name])).values()];
}

function isLikelyBusinessName(value) {
  const text = String(value || '').trim();
  if (text.length < 2 || text.length > 120) return false;
  if (text.split(/\s+/).length > 14) return false;
  if (/[?!]$/.test(text)) return false;
  if (/^(how|why|what|where|when|if you|tell me|here are|some options|consider|important|note|disclaimer|the best depends|finding the)/i.test(text)) return false;
  if (/\b(ask directly|initial consultation|fee structure|your budget|your situation|court experience|communication style)\b/i.test(text)) return false;
  return /[a-zA-Z]/.test(text);
}

function buildComparison() {
  state.openaiRaw = elements['openai-response'].value;
  state.geminiRaw = elements['gemini-response'].value;
  const openaiNames = parseAiNames(state.openaiRaw);
  const geminiNames = parseAiNames(state.geminiRaw);

  state.leads = state.googleResults.map((result) => {
    const inOpenAi = openaiNames.some((name) => namesMatch(result.name, name));
    const inGemini = geminiNames.some((name) => namesMatch(result.name, name));
    return {
      ...result,
      inOpenAi,
      inGemini,
      missingAi: [!inOpenAi ? 'ChatGPT' : '', !inGemini ? 'Gemini' : ''].filter(Boolean),
    };
  });

  addLog('info', `Comparison rebuilt: ${state.leads.filter((lead) => lead.missingAi.length).length} visibility gap(s) across ${state.leads.length} Google business(es).`);
  renderAll();
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(pty|ltd|limited|inc|llc|plc|group|holdings|australia|australian|official|website)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 7 && b.length >= 7 && (a.includes(b) || b.includes(a))) return true;

  const aTokens = new Set(a.split(' ').filter((token) => token.length > 2));
  const bTokens = new Set(b.split(' ').filter((token) => token.length > 2));
  if (!aTokens.size || !bTokens.size) return false;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return intersection >= 2 && intersection / union >= 0.62;
}

function addManualResult(event) {
  event.preventDefault();
  const name = elements['manual-name'].value.trim();
  const url = safeUrl(elements['manual-url'].value.trim());

  if (!name || !url) {
    addLog('error', 'Manual results require a business name and a valid HTTP or HTTPS URL.');
    return;
  }

  const hostname = new URL(url).hostname.replace(/^www\./, '');
  if (state.googleResults.some((item) => new URL(item.url).hostname.replace(/^www\./, '') === hostname)) {
    addLog('error', 'That website is already in the Google result list.');
    return;
  }

  state.googleResults.push({
    id: makeId(hostname),
    name,
    rawTitle: name,
    url,
    snippet: 'Manually added result',
    page: 1,
    position: state.googleResults.length + 1,
  });
  elements['manual-name'].value = '';
  elements['manual-url'].value = '';
  buildComparison();
}

function renderAll() {
  renderProviderStatus();
  renderGoogleResults();
  renderAiCounts();
  renderLeadTable();
  renderDrafts();
  renderLog();
}

function renderProviderStatus(connectionError = false) {
  if (!elements['provider-status']) return;
  elements['provider-status'].replaceChildren();

  if (connectionError) {
    elements['provider-status'].append(makeBadge('Local server unavailable', 'bad'));
    return;
  }

  elements['provider-status'].append(
    makeBadge(`Google ${state.status.serperConfigured ? 'configured' : 'not configured'}`, state.status.serperConfigured ? 'good' : 'warn'),
    makeBadge(`OpenAI ${state.status.openaiConfigured ? 'configured' : 'manual'}`, state.status.openaiConfigured ? 'good' : 'neutral'),
    makeBadge(`Gemini ${state.status.geminiConfigured ? 'configured' : 'manual'}`, state.status.geminiConfigured ? 'good' : 'neutral'),
  );
}

function renderGoogleResults() {
  if (!elements['google-results']) return;
  elements['google-count'].textContent = String(state.googleResults.length);
  elements['google-results'].replaceChildren();

  if (!state.googleResults.length) {
    elements['google-results'].className = 'result-list empty-state';
    elements['google-results'].textContent = 'Run a search to load businesses.';
    return;
  }

  elements['google-results'].className = 'result-list';
  state.googleResults.forEach((result) => {
    const row = createElement('div', 'result-row');
    const content = createElement('div');
    const name = createElement('strong', '', result.name);
    const link = createElement('a', '', compactUrl(result.url));
    link.href = result.url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.title = result.url;
    content.append(name, link);

    const controls = createElement('div', 'button-row');
    const edit = createElement('button', 'icon-button', '✎');
    edit.type = 'button';
    edit.title = `Edit ${result.name}`;
    edit.setAttribute('aria-label', `Edit ${result.name}`);
    edit.addEventListener('click', () => editGoogleResult(result.id));

    const remove = createElement('button', 'icon-button', '×');
    remove.type = 'button';
    remove.title = `Remove ${result.name}`;
    remove.setAttribute('aria-label', `Remove ${result.name}`);
    remove.addEventListener('click', () => removeGoogleResult(result.id));

    controls.append(edit, remove);
    row.append(content, controls);
    elements['google-results'].append(row);
  });
}

function editGoogleResult(id) {
  const result = state.googleResults.find((item) => item.id === id);
  if (!result) return;
  const updated = window.prompt('Correct business name', result.name);
  if (!updated || !updated.trim()) return;
  result.name = updated.trim().slice(0, 200);
  buildComparison();
}

function removeGoogleResult(id) {
  state.googleResults = state.googleResults.filter((item) => item.id !== id);
  delete state.contacts[id];
  delete state.drafts[id];
  delete state.sent[id];
  delete state.replied[id];
  buildComparison();
}

function renderAiCounts() {
  const openaiNames = parseAiNames(elements['openai-response']?.value || state.openaiRaw);
  const geminiNames = parseAiNames(elements['gemini-response']?.value || state.geminiRaw);
  elements['openai-count'].textContent = `${openaiNames.length} name${openaiNames.length === 1 ? '' : 's'}`;
  elements['gemini-count'].textContent = `${geminiNames.length} name${geminiNames.length === 1 ? '' : 's'}`;
}

function renderLeadTable() {
  const body = elements['lead-table-body'];
  if (!body) return;
  body.replaceChildren();

  if (!state.leads.length) {
    const row = document.createElement('tr');
    const cell = createElement('td', 'table-empty', 'No comparison has been built yet.');
    cell.colSpan = 7;
    row.append(cell);
    body.append(row);
    renderSummary();
    return;
  }

  state.leads.forEach((lead) => {
    const row = document.createElement('tr');
    const business = createElement('td', 'business-cell');
    const businessName = createElement('strong', '', lead.name);
    const businessUrl = createElement('a', '', compactUrl(lead.url));
    businessUrl.href = lead.url;
    businessUrl.target = '_blank';
    businessUrl.rel = 'noreferrer noopener';
    business.append(businessName, businessUrl);

    const google = createElement('td', '', `Page ${lead.page} · #${lead.position}`);
    const openai = createElement('td');
    openai.append(makeBadge(lead.inOpenAi ? 'Present' : 'Missing', lead.inOpenAi ? 'good' : 'bad'));
    const gemini = createElement('td');
    gemini.append(makeBadge(lead.inGemini ? 'Present' : 'Missing', lead.inGemini ? 'good' : 'bad'));

    const contactCell = createElement('td');
    renderContactCell(contactCell, lead);

    const statusCell = createElement('td');
    const statusStack = createElement('div', 'contact-stack');
    if (!lead.missingAi.length) statusStack.append(makeBadge('Visible in both', 'good'));
    else statusStack.append(makeBadge(`Missing: ${lead.missingAi.join(' + ')}`, 'bad'));
    if (state.sent[lead.id]) statusStack.append(makeBadge('Marked sent', 'good'));
    if (state.replied[lead.id]) statusStack.append(makeBadge('Replied', 'good'));
    statusCell.append(statusStack);

    const actionCell = createElement('td');
    const actions = createElement('div', 'action-stack');
    const findButton = createElement('button', 'button small secondary', state.contacts[lead.id]?.loading ? 'Finding…' : 'Find contact');
    findButton.type = 'button';
    findButton.disabled = Boolean(state.contacts[lead.id]?.loading);
    findButton.addEventListener('click', () => findContact(lead.id));

    const draftButton = createElement('button', 'button small secondary', 'Draft message');
    draftButton.type = 'button';
    draftButton.disabled = !lead.missingAi.length;
    draftButton.addEventListener('click', () => generateDraft(lead.id));
    actions.append(findButton, draftButton);
    actionCell.append(actions);

    row.append(business, google, openai, gemini, contactCell, statusCell, actionCell);
    body.append(row);
  });

  renderSummary();
}

function renderContactCell(cell, lead) {
  const contact = state.contacts[lead.id];
  const stack = createElement('div', 'contact-stack');

  if (!contact) {
    stack.append(createElement('span', 'confidence', 'Not researched'));
  } else if (contact.loading) {
    stack.append(createElement('span', 'confidence', 'Checking public website pages…'));
  } else if (contact.error) {
    stack.append(createElement('span', 'confidence', contact.error));
  } else {
    const best = contact.emails?.[0];
    if (best) {
      stack.append(createElement('span', 'contact-email', best.email));
      stack.append(createElement('span', 'confidence', best.confidence));
    } else {
      stack.append(createElement('span', 'confidence', 'No public email found'));
    }
    const phone = contact.phones?.[0]?.phone;
    if (phone) stack.append(createElement('span', 'confidence', phone));
  }

  cell.append(stack);
}

function renderSummary() {
  const gaps = state.leads.filter((lead) => lead.missingAi.length).length;
  const contacts = Object.values(state.contacts).filter((contact) => contact?.emails?.length).length;
  elements['comparison-summary'].replaceChildren(
    summaryItem(state.leads.length, 'Google businesses'),
    summaryItem(gaps, 'visibility gaps'),
    summaryItem(contacts, 'contact candidates'),
  );
}

function summaryItem(number, label) {
  const item = document.createElement('span');
  const strong = createElement('strong', '', String(number));
  item.append(strong, document.createTextNode(` ${label}`));
  return item;
}

async function findContact(id) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead) return;

  state.contacts[id] = { loading: true };
  renderLeadTable();
  addLog('info', `Checking public contact pages for ${lead.name}.`);

  try {
    const result = await apiPost('/api/contact', { url: lead.url });
    state.contacts[id] = result;
    addLog('success', `${lead.name}: found ${result.emails?.length || 0} email candidate(s) and ${result.phones?.length || 0} phone candidate(s).`);
  } catch (error) {
    state.contacts[id] = { error: error.message || 'Contact lookup failed.', emails: [], phones: [] };
    addLog('error', `${lead.name}: ${error.message || 'Contact lookup failed.'}`);
  }

  renderLeadTable();
  renderDrafts();
}

async function findAllContacts() {
  const targets = state.leads.filter((lead) => lead.missingAi.length && !state.contacts[lead.id]);
  if (!targets.length) {
    addLog('info', 'There are no new visibility-gap contacts to research.');
    return;
  }

  elements['find-all-contacts'].disabled = true;
  addLog('info', `Starting contact lookup for ${targets.length} business(es).`);

  await runPool(targets, 3, async (lead) => findContact(lead.id));

  elements['find-all-contacts'].disabled = false;
  addLog('success', 'Bulk contact lookup finished. Review every candidate before use.');
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

function generateDraft(id) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead || !lead.missingAi.length) return;

  const contact = state.contacts[id];
  const recipient = contact?.emails?.[0]?.email || '';
  const variables = {
    COMPANY: lead.name,
    PROMPT: state.query || elements['search-query'].value.trim(),
    MISSING_AI: lead.missingAi.join(' and '),
    SENDER: elements['sender-name'].value.trim() || 'Your name',
    YOUR_COMPANY: elements['sender-company'].value.trim() || 'Your company',
  };

  const subject = applyTemplate(elements['subject-template'].value, variables).slice(0, 240);
  const body = applyTemplate(elements['message-template'].value, variables).slice(0, 8_000);

  state.drafts[id] = {
    id,
    company: lead.name,
    website: lead.url,
    to: recipient,
    subject,
    body,
    missingAi: [...lead.missingAi],
    createdAt: new Date().toISOString(),
  };

  addLog('info', `Draft prepared for ${lead.name}${recipient ? ` using ${recipient}` : ' without a recipient'}.`);
  renderDrafts();
}

function draftAll() {
  const targets = state.leads.filter((lead) => lead.missingAi.length);
  if (!targets.length) {
    addLog('info', 'There are no visibility-gap leads to draft.');
    return;
  }
  targets.forEach((lead) => generateDraft(lead.id));
  addLog('success', `Prepared ${targets.length} draft(s). Human review is required before sending.`);
}

function applyTemplate(template, variables) {
  return Object.entries(variables).reduce((output, [key, value]) => {
    return output.replaceAll(`{{${key}}}`, String(value || ''));
  }, String(template || ''));
}

function renderDrafts() {
  const drafts = Object.values(state.drafts);
  elements['draft-count'].textContent = `${drafts.length} draft${drafts.length === 1 ? '' : 's'}`;
  elements['draft-list'].replaceChildren();

  if (!drafts.length) {
    elements['draft-list'].className = 'draft-list empty-state';
    elements['draft-list'].textContent = 'No messages have been drafted.';
    return;
  }

  elements['draft-list'].className = 'draft-list';
  drafts.forEach((draft) => {
    const card = createElement('article', `draft-card${state.sent[draft.id] ? ' sent' : ''}`);
    const header = createElement('div', 'draft-header');
    const titleBlock = createElement('div');
    const title = createElement('h3', '', draft.company);
    const subtitle = createElement('p', '', `${draft.to || 'No recipient selected'} · Missing from ${draft.missingAi.join(' and ')}`);
    titleBlock.append(title, subtitle);

    const status = createElement('div', 'button-row');
    if (state.sent[draft.id]) status.append(makeBadge('Sent', 'good'));
    if (state.replied[draft.id]) status.append(makeBadge('Replied', 'good'));
    header.append(titleBlock, status);

    const message = createElement('div', 'draft-body', `Subject: ${draft.subject}\n\n${draft.body}`);
    const controls = createElement('div', 'button-row');

    const copy = createElement('button', 'button small secondary', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', () => copyDraft(draft));

    const gmail = createElement('button', 'button small secondary', 'Open Gmail');
    gmail.type = 'button';
    gmail.disabled = !draft.to;
    gmail.addEventListener('click', () => openGmail(draft));

    const mail = createElement('button', 'button small secondary', 'Open mail app');
    mail.type = 'button';
    mail.disabled = !draft.to;
    mail.addEventListener('click', () => openMailApp(draft));

    const markSent = createElement('button', 'button small secondary', state.sent[draft.id] ? 'Unmark sent' : 'Mark sent');
    markSent.type = 'button';
    markSent.addEventListener('click', () => {
      state.sent[draft.id] = !state.sent[draft.id];
      renderLeadTable();
      renderDrafts();
    });

    const markReplied = createElement('button', 'button small secondary', state.replied[draft.id] ? 'Unmark replied' : 'Mark replied');
    markReplied.type = 'button';
    markReplied.addEventListener('click', () => {
      state.replied[draft.id] = !state.replied[draft.id];
      renderLeadTable();
      renderDrafts();
    });

    const remove = createElement('button', 'button small danger', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      delete state.drafts[draft.id];
      renderDrafts();
    });

    controls.append(copy, gmail, mail, markSent, markReplied, remove);
    card.append(header, message, controls);
    elements['draft-list'].append(card);
  });
}

async function copyDraft(draft) {
  const text = `To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`;
  try {
    await navigator.clipboard.writeText(text);
    addLog('success', `Copied draft for ${draft.company}.`);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    addLog('success', `Copied draft for ${draft.company}.`);
  }
}

function openGmail(draft) {
  if (!draft.to) return;
  const url = new URL('https://mail.google.com/mail/');
  url.search = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: draft.to,
    su: draft.subject,
    body: draft.body,
  }).toString();
  window.open(url.href, '_blank', 'noopener,noreferrer');
  addLog('info', `Opened a Gmail compose window for ${draft.company}; this did not mark the message as sent.`);
}

function openMailApp(draft) {
  if (!draft.to) return;
  window.location.href = `mailto:${encodeURIComponent(draft.to)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
  addLog('info', `Opened the default mail application for ${draft.company}; this did not mark the message as sent.`);
}

function exportCsv() {
  if (!state.leads.length) {
    addLog('error', 'There are no leads to export.');
    return;
  }

  const headers = [
    'Prompt', 'Company', 'Website', 'Google Page', 'Google Position',
    'In ChatGPT', 'In Gemini', 'Missing AI', 'Contact Email', 'Email Confidence',
    'Phone', 'Drafted', 'Marked Sent', 'Marked Replied', 'Subject', 'Message',
  ];

  const rows = state.leads.map((lead) => {
    const contact = state.contacts[lead.id];
    const draft = state.drafts[lead.id];
    return [
      state.query,
      lead.name,
      lead.url,
      lead.page,
      lead.position,
      lead.inOpenAi ? 'Yes' : 'No',
      lead.inGemini ? 'Yes' : 'No',
      lead.missingAi.join(' and '),
      contact?.emails?.[0]?.email || '',
      contact?.emails?.[0]?.confidence || '',
      contact?.phones?.[0]?.phone || '',
      draft ? 'Yes' : 'No',
      state.sent[lead.id] ? 'Yes' : 'No',
      state.replied[lead.id] ? 'Yes' : 'No',
      draft?.subject || '',
      draft?.body || '',
    ];
  });

  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  downloadText(`LeadPulse_${fileSlug(state.query || 'export')}_${dateStamp()}.csv`, csv, 'text/csv;charset=utf-8');
  addLog('success', `Exported ${rows.length} lead row(s) to CSV.`);
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportSession() {
  const payload = {
    format: 'leadpulse-session-v2-sanitized',
    exportedAt: new Date().toISOString(),
    warning: 'This file may contain business contact data and outreach drafts. Store it securely.',
    query: state.query,
    pages: state.pages,
    googleResults: state.googleResults,
    openaiRaw: elements['openai-response'].value,
    geminiRaw: elements['gemini-response'].value,
    leads: state.leads,
    contacts: state.contacts,
    drafts: state.drafts,
    sent: state.sent,
    replied: state.replied,
    settings: {
      senderName: elements['sender-name'].value,
      senderCompany: elements['sender-company'].value,
      subjectTemplate: elements['subject-template'].value,
      messageTemplate: elements['message-template'].value,
    },
  };

  downloadText(`LeadPulse_Session_${fileSlug(state.query || 'workspace')}_${dateStamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  addLog('success', 'Exported the current workspace. The file contains no provider API keys.');
}

async function importSession(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 5_000_000) {
    addLog('error', 'The selected session is larger than the 5 MB import limit.');
    return;
  }

  try {
    const payload = JSON.parse(await file.text());
    if (payload?.format !== 'leadpulse-session-v2-sanitized') {
      throw new Error('This is not a supported sanitized LeadPulse session file.');
    }

    state.query = String(payload.query || '').slice(0, 240);
    state.pages = Math.min(10, Math.max(1, Number(payload.pages) || 3));
    state.googleResults = Array.isArray(payload.googleResults) ? payload.googleResults.map(sanitizeImportedResult).filter(Boolean) : [];
    state.openaiRaw = String(payload.openaiRaw || '').slice(0, 200_000);
    state.geminiRaw = String(payload.geminiRaw || '').slice(0, 200_000);
    state.contacts = sanitizeRecord(payload.contacts);
    state.drafts = sanitizeRecord(payload.drafts);
    state.sent = sanitizeBooleanRecord(payload.sent);
    state.replied = sanitizeBooleanRecord(payload.replied);

    elements['search-query'].value = state.query;
    elements['search-pages'].value = String(state.pages);
    elements['openai-response'].value = state.openaiRaw;
    elements['gemini-response'].value = state.geminiRaw;
    elements['sender-name'].value = String(payload.settings?.senderName || '').slice(0, 120);
    elements['sender-company'].value = String(payload.settings?.senderCompany || '').slice(0, 160);
    if (payload.settings?.subjectTemplate) elements['subject-template'].value = String(payload.settings.subjectTemplate).slice(0, 240);
    if (payload.settings?.messageTemplate) elements['message-template'].value = String(payload.settings.messageTemplate).slice(0, 20_000);

    buildComparison();
    addLog('success', `Imported ${state.googleResults.length} business result(s) from ${file.name}.`);
  } catch (error) {
    addLog('error', error.message || 'Could not import the session file.');
  }
}

function sanitizeImportedResult(item) {
  const url = safeUrl(item?.url);
  if (!url) return null;
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  return {
    id: makeId(hostname),
    name: String(item?.name || domainToName(hostname.split('.')[0])).slice(0, 200),
    rawTitle: String(item?.rawTitle || '').slice(0, 300),
    url,
    snippet: String(item?.snippet || '').slice(0, 800),
    page: Math.max(1, Number(item?.page) || 1),
    position: Math.max(1, Number(item?.position) || 1),
  };
}

function sanitizeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 2_000));
}

function sanitizeBooleanRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 2_000).map(([key, item]) => [key, Boolean(item)]));
}

function clearWorkspace() {
  const hasData = state.googleResults.length || state.leads.length || Object.keys(state.drafts).length;
  if (hasData && !window.confirm('Clear the in-memory workspace? Export it first if you need a copy.')) return;

  state.query = '';
  state.pages = 3;
  state.googleResults = [];
  state.openaiRaw = '';
  state.geminiRaw = '';
  state.leads = [];
  state.contacts = {};
  state.drafts = {};
  state.sent = {};
  state.replied = {};
  elements['search-query'].value = '';
  elements['search-pages'].value = '3';
  elements['openai-response'].value = '';
  elements['gemini-response'].value = '';
  setProgress('Workspace cleared.');
  addLog('info', 'Cleared the in-memory workspace.');
  renderAll();
}

function clearLogs() {
  state.logs = [];
  renderLog();
}

function addLog(level, message) {
  state.logs.push({
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    level,
    message: String(message || '').slice(0, 800),
  });
  if (state.logs.length > 500) state.logs.shift();
  renderLog();
}

function renderLog() {
  if (!elements['activity-log']) return;
  elements['activity-log'].replaceChildren();
  if (!state.logs.length) {
    elements['activity-log'].textContent = 'No activity yet.';
    return;
  }

  state.logs.forEach((entry) => {
    const line = createElement('div', `log-line ${entry.level}`, `[${entry.time}] ${entry.message}`);
    elements['activity-log'].append(line);
  });
  elements['activity-log'].scrollTop = elements['activity-log'].scrollHeight;
}

function setBusy(busy) {
  elements['run-search'].disabled = busy;
  elements['run-search'].textContent = busy ? 'Running…' : 'Run comparison';
}

function setProgress(message, type = '') {
  elements['search-progress'].textContent = message;
  elements['search-progress'].className = `progress-line${type ? ` ${type}` : ''}`;
}

function makeBadge(text, kind = 'neutral') {
  return createElement('span', `badge ${kind}`, text);
}

function createElement(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== '') element.textContent = text;
  return element;
}

function safeUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    return '';
  }
}

function compactUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`.slice(0, 80);
  } catch {
    return String(value || '').slice(0, 80);
  }
}

function makeId(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `lead-${(hash >>> 0).toString(36)}`;
}

function fileSlug(value) {
  return String(value || 'leadpulse')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'leadpulse';
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
