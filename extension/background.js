const DEFAULT_SETTINGS = {
  enabled: true,
  readingLevel: "simple",
  priorities: ["privacy", "money", "rights", "content", "account", "ai"],
  apiEndpoint: "https://termscope-api.nsithamraju.workers.dev/analyze",
  widgetPosition: null
};

const LIBRARY_KEY = "policyLibrary";
const MAX_LIBRARY_ITEMS = 200;
const SCORING_VERSION = "7.0";

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get("settings");
  await chrome.storage.sync.set({
    settings: {
      ...DEFAULT_SETTINGS,
      ...(stored.settings || {})
    }
  });

  await readLibrary();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  chrome.tabs
    .sendMessage(tab.id, { type: "TERMSCOPE_TOGGLE" })
    .catch(() => {});
});

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("The website took too long to respond.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPolicy(url) {
  const response = await fetchWithTimeout(
    url,
    {
      redirect: "follow",
      credentials: "omit",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8"
      }
    },
    12000
  );

  if (!response.ok) {
    throw new Error(`Policy page returned ${response.status}`);
  }

  return {
    url: response.url,
    contentType: response.headers.get("content-type") || "",
    html: await response.text()
  };
}

async function callAiBackend(payload, settings) {
  if (!settings.apiEndpoint) {
    throw new Error("The TermScopeAI endpoint is missing.");
  }

  const response = await fetchWithTimeout(
    settings.apiEndpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    35000
  );

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || `AI backend returned ${response.status}`);
  }

  return body;
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return String(value || "");
  }
}

const COMMON_SECOND_LEVEL_DOMAINS = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "gov",
  "net",
  "org"
]);

function siteKeyFromHostname(hostname) {
  const parts = String(hostname || "")
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);

  if (parts.length <= 2) return parts.join(".");

  const last = parts.at(-1);
  const secondLast = parts.at(-2);

  if (
    last.length === 2 &&
    COMMON_SECOND_LEVEL_DOMAINS.has(secondLast) &&
    parts.length >= 3
  ) {
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
}

function hostnameFromItem(item = {}) {
  if (item.hostname) return String(item.hostname).replace(/^www\./, "");

  try {
    return new URL(item.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function brandFromHostname(hostname) {
  const siteKey = siteKeyFromHostname(hostname);
  const first = siteKey.split(".")[0] || "Website";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function libraryIdentityKey(item = {}) {
  const siteKey =
    item.siteKey || siteKeyFromHostname(hostnameFromItem(item)) || "website";
  const type = item.type === "privacy" ? "privacy" : "terms";
  return `${String(siteKey).toLowerCase()}:${type}`;
}

function normalizedPolicyLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function isPrimaryPolicyLabel(label, type) {
  const value = normalizedPolicyLabel(label)
    .replace(/^(?:read|view|see|open)\s+(?:our|the)?\s*/i, "")
    .replace(/^(?:our|the)\s+/i, "")
    .trim();

  if (type === "terms") {
    return /^(?:(?:[a-z0-9.'’ -]+)\s+)?(?:terms|terms of use|terms of service|terms and conditions|terms & conditions|conditions of use|user agreement|service agreement)$/i.test(
      value
    );
  }

  return /^(?:(?:[a-z0-9.'’ -]+)\s+)?(?:privacy|privacy policy|privacy notice|privacy statement|data policy)$/i.test(
    value
  );
}

function isSupplementaryPolicyLabel(label) {
  return /\b(?:preview|new terms|generative|prohibited|acceptable use|additional|supplemental|service-specific|service specific|technology|technologies|cookies?|faq|overview|updates?|definitions?|government|children|safety|community|advertising|developer|api|content policy|product-specific|product specific)\b/i.test(
    label
  );
}

function libraryItemScore(item = {}) {
  const label = normalizedPolicyLabel(item.label);
  const type = item.type === "privacy" ? "privacy" : "terms";
  let pathname = "";

  try {
    pathname = new URL(item.url).pathname.toLowerCase();
  } catch {
    pathname = "";
  }

  let score = 0;

  if (isPrimaryPolicyLabel(label, type)) score += 120;
  if (label.length > 0 && label.length <= 36) score += 15;
  if (Array.isArray(item.risks) && item.risks.length) score += 10;

  if (
    type === "terms" &&
    /(?:^|\/)(?:terms|tos|terms-of-use|terms-of-service|user-agreement|conditions)(?:\/)?$/i.test(
      pathname
    )
  ) {
    score += 60;
  }

  if (
    type === "privacy" &&
    /(?:^|\/)(?:privacy|privacy-policy|privacy-notice|privacy-statement|data-policy)(?:\/)?$/i.test(
      pathname
    )
  ) {
    score += 60;
  }

  if (isSupplementaryPolicyLabel(label)) score -= 180;
  if (/privacy/.test(label) && /terms/.test(label)) score -= 200;
  if (/^(?:&|preview of the new)$/i.test(label)) score -= 100;

  return score;
}

function choosePreferredLibraryItem(first, second) {
  if (!first) return second;
  if (!second) return first;

  const firstScore = libraryItemScore(first);
  const secondScore = libraryItemScore(second);
  let selected;

  if (firstScore !== secondScore) {
    selected = firstScore > secondScore ? first : second;
  } else {
    selected =
      Number(first.analyzedAt || 0) >= Number(second.analyzedAt || 0)
        ? first
        : second;
  }

  return {
    ...selected,
    favorite: Boolean(first.favorite || second.favorite)
  };
}

function findLibraryKeyByUrl(library, url) {
  const target = canonicalUrl(url);

  return Object.entries(library).find(
    ([, item]) => canonicalUrl(item?.url) === target
  )?.[0];
}

function calculateRating(risks = []) {
  const counts = risks.reduce(
    (total, risk) => {
      const severity = ["high", "medium", "low"].includes(risk?.severity)
        ? risk.severity
        : "medium";
      total[severity] += 1;
      return total;
    },
    { high: 0, medium: 0, low: 0 }
  );

  let penalty = counts.high * 1.9 + counts.medium * 0.8 + counts.low * 0.25;
  if (counts.high > 1) penalty += (counts.high - 1) * 0.6;
  if (counts.high >= 4) penalty += 0.4;
  if (counts.medium >= 4) penalty += 0.35;

  let rating = Math.max(0, Math.min(10, 10 - penalty));
  if (counts.high === 1) rating = Math.min(rating, 7.5);
  if (counts.high === 2) rating = Math.min(rating, 6);
  if (counts.high === 3) rating = Math.min(rating, 4.5);
  if (counts.high >= 4) rating = Math.min(rating, 3.5);

  return Math.round(rating * 10) / 10;
}

function ratingLabel(rating) {
  if (rating >= 8) return "Strong";
  if (rating >= 5) return "Mixed";
  return "Concerning";
}

function normalizeLibraryItem(item = {}) {
  const risks = Array.isArray(item.risks) ? item.risks : [];
  const storedRating = Number(item.policyRating);
  const policyRating = risks.length || item.scoringVersion === SCORING_VERSION
    ? calculateRating(risks)
    : Number.isFinite(storedRating)
      ? storedRating
      : calculateRating(risks);
  const hostname = hostnameFromItem(item);
  const siteKey = item.siteKey || siteKeyFromHostname(hostname);
  const type = item.type === "privacy" ? "privacy" : "terms";

  return {
    ...item,
    url: canonicalUrl(item.url),
    type,
    hostname,
    siteKey,
    sourceName: brandFromHostname(hostname),
    label:
      String(item.label || "").trim() ||
      (type === "terms" ? "Terms of Use" : "Privacy Policy"),
    policyRating,
    ratingLabel: ratingLabel(policyRating),
    scoringVersion: SCORING_VERSION,
    analysisVersion: item.analysisVersion || "legacy"
  };
}

async function readLibrary() {
  const stored = await chrome.storage.local.get(LIBRARY_KEY);
  const original = stored[LIBRARY_KEY] || {};
  const deduplicated = {};

  for (const item of Object.values(original)) {
    if (!item?.url) continue;

    const next = normalizeLibraryItem(item);
    const key = libraryIdentityKey(next);
    deduplicated[key] = choosePreferredLibraryItem(deduplicated[key], next);
  }

  const entries = Object.entries(deduplicated)
    .sort((a, b) => (b[1].analyzedAt || 0) - (a[1].analyzedAt || 0))
    .slice(0, MAX_LIBRARY_ITEMS);
  const normalized = Object.fromEntries(entries);

  if (JSON.stringify(original) !== JSON.stringify(normalized)) {
    await chrome.storage.local.set({ [LIBRARY_KEY]: normalized });
  }

  return normalized;
}

async function saveLibraryItem(item) {
  if (!item?.url) {
    throw new Error("A policy URL is required.");
  }

  const library = await readLibrary();

  const candidate = normalizeLibraryItem({
    ...item,
    analyzedAt: item.analyzedAt || Date.now()
  });

  const key = libraryIdentityKey(candidate);
  const previous = library[key];

  library[key] = {
    ...candidate,
    favorite: Boolean(previous?.favorite || candidate.favorite)
  };

  const entries = Object.entries(library)
    .sort((a, b) => (b[1].analyzedAt || 0) - (a[1].analyzedAt || 0))
    .slice(0, MAX_LIBRARY_ITEMS);

  const updatedLibrary = Object.fromEntries(entries);

  await chrome.storage.local.set({
    [LIBRARY_KEY]: updatedLibrary
  });

  return updatedLibrary[key];
}

async function toggleFavorite(url) {
  const library = await readLibrary();
  const key = findLibraryKeyByUrl(library, url);

  if (!key || !library[key]) {
    throw new Error("That policy is not in the library.");
  }

  library[key].favorite = !library[key].favorite;
  await chrome.storage.local.set({ [LIBRARY_KEY]: library });
  return library[key];
}

async function removeLibraryItem(url) {
  const library = await readLibrary();
  const key = findLibraryKeyByUrl(library, url);

  if (key) {
    delete library[key];
    await chrome.storage.local.set({ [LIBRARY_KEY]: library });
  }
}

function buildHighlightUrl(value, requestId) {
  const url = new URL(value);
  const existingHash = url.hash.replace(/^#/, "");
  const requestHash = `termscope=${requestId}`;
  url.hash = existingHash ? `${existingHash}&${requestHash}` : requestHash;
  return url.href;
}

async function openNextToSender(url, sender, extra = {}) {
  const opener = sender?.tab;
  const properties = {
    url,
    active: true,
    ...extra
  };

  if (opener?.id !== undefined) {
    properties.windowId = opener.windowId;
    properties.index = opener.index + 1;
    properties.openerTabId = opener.id;
  }

  return chrome.tabs.create(properties);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function deliverClauseRequest(tabId, requestId) {
  let lastCompleteUrl = "";
  let stableCompleteChecks = 0;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    let tab;

    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new Error("The policy tab was closed before TermScopeAI could open the clause.");
    }

    if (tab.status === "complete" && tab.url) {
      if (tab.url === lastCompleteUrl) {
        stableCompleteChecks += 1;
      } else {
        lastCompleteUrl = tab.url;
        stableCompleteChecks = 1;
      }

      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          type: "TERMSCOPE_LOAD_CLAUSE",
          requestId
        });

        if (response?.ok && stableCompleteChecks >= 2) {
          await delay(700);
          const finalTab = await chrome.tabs.get(tabId);

          if (finalTab.status === "complete" && finalTab.url === lastCompleteUrl) {
            await chrome.tabs
              .sendMessage(tabId, {
                type: "TERMSCOPE_LOAD_CLAUSE",
                requestId
              })
              .catch(() => {});
            return true;
          }
        }
      } catch {
        // The content script may not be ready yet, so keep trying.
      }
    } else {
      stableCompleteChecks = 0;
    }

    await delay(attempt < 8 ? 250 : 500);
  }

  throw new Error("The policy opened, but the guided clause panel could not start.");
}

async function cleanupOldClauseRequests() {
  const stored = await chrome.storage.local.get(null);
  const cutoff = Date.now() - 10 * 60 * 1000;
  const expired = Object.entries(stored)
    .filter(
      ([key, value]) =>
        key.startsWith("highlight:") &&
        Number(value?.createdAt || 0) > 0 &&
        Number(value.createdAt) < cutoff
    )
    .map(([key]) => key);

  if (expired.length) await chrome.storage.local.remove(expired);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TERMSCOPE_FETCH_POLICY") {
    fetchPolicy(message.url)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "TERMSCOPE_ANALYZE") {
    chrome.storage.sync
      .get("settings")
      .then(({ settings }) =>
        callAiBackend(message.payload, {
          ...DEFAULT_SETTINGS,
          ...(settings || {})
        })
      )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "TERMSCOPE_OPEN_CLAUSE") {
    const requestId = crypto.randomUUID();
    const storageKey = `highlight:${requestId}`;
    const clauses = Array.isArray(message.clauses)
      ? message.clauses.filter((clause) => clause?.quote)
      : message.clause?.quote
        ? [message.clause]
        : [];
    const activeIndex = Math.max(
      0,
      Math.min(Number(message.activeIndex) || 0, Math.max(0, clauses.length - 1))
    );
    const activeClause = clauses[activeIndex] || message.clause || {};
    const sourceUrl = activeClause.sourceUrl || message.url;

    Promise.resolve()
      .then(cleanupOldClauseRequests)
      .then(() => {
        if (!clauses.length) {
          throw new Error("No reviewed clause was available to open.");
        }
        if (!sourceUrl) {
          throw new Error("The policy URL for this clause is missing.");
        }

        return chrome.storage.local.set({
          [storageKey]: {
            clauses,
            activeIndex,
            policyRating: message.policyRating,
            ratingLabel: message.ratingLabel,
            policySourceName: message.policySourceName,
            policyType: message.policyType,
            url: sourceUrl,
            createdAt: Date.now()
          }
        });
      })
      .then(() => openNextToSender(buildHighlightUrl(sourceUrl, requestId), sender))
      .then(async (tab) => {
        if (tab.id === undefined) {
          throw new Error("TermScopeAI could not identify the new policy tab.");
        }
        await deliverClauseRequest(tab.id, requestId);
        return tab;
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "TERMSCOPE_OPEN_LIBRARY") {
    openNextToSender(chrome.runtime.getURL("library.html"), sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "TERMSCOPE_SAVE_LIBRARY") {
    saveLibraryItem(message.item)
      .then((item) => sendResponse({ ok: true, item }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "TERMSCOPE_GET_LIBRARY") {
    readLibrary()
      .then((library) => sendResponse({ ok: true, library }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "TERMSCOPE_TOGGLE_FAVORITE") {
    toggleFavorite(message.url)
      .then((item) => sendResponse({ ok: true, item }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "TERMSCOPE_REMOVE_LIBRARY") {
    removeLibraryItem(message.url)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
