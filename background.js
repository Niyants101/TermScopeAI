const DEFAULT_SETTINGS = {
  enabled: true,
  readingLevel: "simple",
  priorities: ["privacy", "money", "rights", "content", "account", "ai"],
  apiEndpoint: "http://localhost:8787/analyze",
  accessToken: "",
  widgetPosition: null
};

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get("settings");
  await chrome.storage.sync.set({
    settings: { ...DEFAULT_SETTINGS, ...(stored.settings || {}) }
  });
});

chrome.action.onClicked.addListener(async tab => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "TERMSCOPE_TOGGLE" }).catch(() => {});
});

async function fetchPolicy(url) {
  const response = await fetch(url, {
    redirect: "follow",
    credentials: "omit",
    headers: {
      "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8"
    }
  });

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
    throw new Error("Add an AI backend endpoint in TermScope settings.");
  }

  const headers = { "Content-Type": "application/json" };
  if (settings.accessToken) headers.Authorization = `Bearer ${settings.accessToken}`;

  const response = await fetch(settings.apiEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `AI backend returned ${response.status}`);
  }
  return body;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TERMSCOPE_FETCH_POLICY") {
    fetchPolicy(message.url)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "TERMSCOPE_ANALYZE") {
    chrome.storage.sync.get("settings")
      .then(({ settings }) => callAiBackend(message.payload, { ...DEFAULT_SETTINGS, ...(settings || {}) }))
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "TERMSCOPE_OPEN_CLAUSE") {
    const requestId = crypto.randomUUID();
    chrome.storage.local.set({
      [`highlight:${requestId}`]: {
        quote: message.quote,
        url: message.url,
        createdAt: Date.now()
      }
    }).then(() => {
      const separator = message.url.includes("#") ? "&" : "#";
      chrome.tabs.create({ url: `${message.url}${separator}termscope=${requestId}` });
      sendResponse({ ok: true });
    }).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
