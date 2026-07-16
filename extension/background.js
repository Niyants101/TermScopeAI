const DEFAULT_SETTINGS = {
  enabled: true,
  readingLevel: "simple",
  priorities: ["privacy", "money", "rights", "content", "account", "ai"],
  apiEndpoint: "https://termscope-api.nsithamraju.workers.dev/analyze",
  widgetPosition: null
};

const LIBRARY_KEY = "policyLibrary";
const MAX_LIBRARY_ITEMS = 200;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get("settings");
  await chrome.storage.sync.set({
    settings: {
      ...DEFAULT_SETTINGS,
      ...(stored.settings || {})
    }
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  chrome.tabs
    .sendMessage(tab.id, { type: "TERMSCOPE_TOGGLE" })
    .catch(() => {});
});

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
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
        Accept:
          "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8"
      }
    },
    15000
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
    throw new Error("The TermScope AI endpoint is missing.");
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
    40000
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

async function readLibrary() {
  const stored = await chrome.storage.local.get(LIBRARY_KEY);
  return stored[LIBRARY_KEY] || {};
}

async function saveLibraryItem(item) {
  if (!item?.url) {
    throw new Error("A policy URL is required.");
  }

  const library = await readLibrary();
  const key = canonicalUrl(item.url);
  const previous = library[key] || {};

  library[key] = {
    ...previous,
    ...item,
    url: item.url,
    favorite: previous.favorite || Boolean(item.favorite),
    analyzedAt: item.analyzedAt || Date.now()
  };

  const entries = Object.entries(library)
    .sort((a, b) => (b[1].analyzedAt || 0) - (a[1].analyzedAt || 0))
    .slice(0, MAX_LIBRARY_ITEMS);

  await chrome.storage.local.set({
    [LIBRARY_KEY]: Object.fromEntries(entries)
  });

  return library[key];
}

async function toggleFavorite(url) {
  const library = await readLibrary();
  const key = canonicalUrl(url);

  if (!library[key]) {
    throw new Error("That policy is not in the library.");
  }

  library[key].favorite = !library[key].favorite;
  await chrome.storage.local.set({ [LIBRARY_KEY]: library });
  return library[key];
}

async function removeLibraryItem(url) {
  const library = await readLibrary();
  delete library[canonicalUrl(url)];
  await chrome.storage.local.set({ [LIBRARY_KEY]: library });
}

function buildHighlightUrl(value, requestId) {
  const url = new URL(value);
  const existingHash = url.hash.replace(/^#/, "");
  url.hash = existingHash
    ? `${existingHash}&termscope=${requestId}`
    : `termscope=${requestId}`;
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

    chrome.storage.local
      .set({
        [storageKey]: {
          ...message.clause,
          quote: message.clause?.quote || message.quote,
          url: message.clause?.sourceUrl || message.url,
          createdAt: Date.now()
        }
      })
      .then(() =>
        openNextToSender(
          buildHighlightUrl(
            message.clause?.sourceUrl || message.url,
            requestId
          ),
          sender
        )
      )
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
