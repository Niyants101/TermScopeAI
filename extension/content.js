const POLICY_TEXT = {
  terms:
    /\b(?:terms(?:\s+(?:of\s+use|of\s+service|and\s+conditions|&\s+conditions))?|conditions\s+of\s+use|user\s+agreement|service\s+agreement)\b/i,
  privacy:
    /\b(?:privacy(?:\s+policy|\s+notice|\s+statement)?|data\s+policy)\b/i
};

const DEFAULT_SETTINGS = {
  enabled: true,
  readingLevel: "simple",
  priorities: ["privacy", "money", "rights", "content", "account", "ai"],
  apiEndpoint: "https://termscope-api.nsithamraju.workers.dev/analyze",
  widgetPosition: null
};

let settings = { ...DEFAULT_SETTINGS };
let policies = [];
let host = null;
let currentAnalysis = null;
let currentPolicy = null;
let lastSelectedPolicies = [];
let currentView = "picker";
let settingsReturnView = "picker";
let currentClauseRequest = null;
let triggerSyncTimer = null;

const shieldSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.8 19 5.9v5.2c0 4.8-2.8 8.4-7 10.1-4.2-1.7-7-5.3-7-10.1V5.9l7-3.1Z" stroke="currentColor" stroke-width="1.9"/><path d="m8.8 12 2 2 4.5-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const gearSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 13.1v-2.2l-2-.7a7.7 7.7 0 0 0-.7-1.6l.9-1.9-1.6-1.6-1.9.9a7.7 7.7 0 0 0-1.6-.7l-.7-2H9.6l-.7 2a7.7 7.7 0 0 0-1.6.7l-1.9-.9-1.6 1.6.9 1.9a7.7 7.7 0 0 0-.7 1.6l-2 .7v2.2l2 .7c.2.6.4 1.1.7 1.6l-.9 1.9 1.6 1.6 1.9-.9c.5.3 1 .5 1.6.7l.7 2h2.2l.7-2c.6-.2 1.1-.4 1.6-.7l1.9.9 1.6-1.6-.9-1.9c.3-.5.5-1 .7-1.6l2-.7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

const closeSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

const externalSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke="currentColor" stroke-width="2"/></svg>`;

const librarySvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5A2.5 2.5 0 0 0 5 21.5v-17Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M5 18.5A2.5 2.5 0 0 1 7.5 16H19" stroke="currentColor" stroke-width="1.8"/></svg>`;

const backSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 18-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const jumpSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v13M7 12l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 21h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char]
  );
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function canonicalPolicyUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return String(value || "");
  }
}

function brandFromHostname(hostname) {
  const parts = String(hostname || "")
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);

  if (!parts.length) return "Website";

  const brand = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function sourceNameForPolicy(anchor, type) {
  const label = normalize(
    anchor.textContent ||
      anchor.getAttribute("aria-label") ||
      anchor.getAttribute("title")
  );

  const cleaned = label
    .replace(POLICY_TEXT.terms, "")
    .replace(POLICY_TEXT.privacy, "")
    .replace(/[\s'’:\-|]+$/g, "")
    .replace(/^[\s'’:\-|]+/g, "")
    .replace(/['’]s$/i, "")
    .trim();

  if (cleaned && cleaned.length <= 40 && !/^(our|the|read)$/i.test(cleaned)) {
    return cleaned.replace(/\.com$/i, "");
  }

  try {
    return brandFromHostname(new URL(anchor.href).hostname);
  } catch {
    return type === "terms" ? "Terms" : "Privacy";
  }
}

function classifyPolicy(anchor) {
  const label = normalize(
    [
      anchor.textContent,
      anchor.getAttribute("aria-label"),
      anchor.getAttribute("title")
    ]
      .filter(Boolean)
      .join(" ")
  );

  const href = anchor.href || "";

  if (
    POLICY_TEXT.terms.test(label) ||
    /\/(?:terms|tos|terms-of-use|terms-of-service|user-agreement)(?:[\/?#_-]|$)/i.test(
      href
    )
  ) {
    return "terms";
  }

  if (
    POLICY_TEXT.privacy.test(label) ||
    /\/(?:privacy|privacy-policy|privacy-notice|data-policy)(?:[\/?#_-]|$)/i.test(
      href
    )
  ) {
    return "privacy";
  }

  return null;
}

function policyFromAnchor(anchor) {
  const type = classifyPolicy(anchor);

  if (!type || !/^https?:/i.test(anchor.href)) {
    return null;
  }

  let hostname = "";

  try {
    hostname = new URL(anchor.href).hostname.replace(/^www\./, "");
  } catch {
    hostname = "";
  }

  return {
    id: anchor.dataset.termscopePolicyId || "",
    type,
    label:
      normalize(anchor.textContent) ||
      (type === "terms" ? "Terms of Use" : "Privacy Policy"),
    sourceName: sourceNameForPolicy(anchor, type),
    hostname,
    url: anchor.href,
    anchor
  };
}

function collectPolicyAnchors() {
  const found = [];

  document.querySelectorAll("a[href]").forEach((anchor) => {
    const item = policyFromAnchor(anchor);
    if (item) found.push(item);
  });

  return found;
}

function collectPolicies() {
  const unique = new Map();

  for (const item of collectPolicyAnchors()) {
    const key = `${item.type}:${canonicalPolicyUrl(item.url)}`;
    if (!unique.has(key)) unique.set(key, item);
  }

  policies = [...unique.values()];
  return policies;
}

function removeAllPolicyTriggers() {
  document
    .querySelectorAll(".termscope-policy-trigger")
    .forEach((button) => button.remove());
}

function syncPolicyTriggers() {
  if (!settings.enabled) {
    removeAllPolicyTriggers();
    return;
  }

  const items = collectPolicyAnchors();
  const liveIds = new Set();

  for (const item of items) {
    const anchor = item.anchor;

    if (!anchor.dataset.termscopePolicyId) {
      anchor.dataset.termscopePolicyId = crypto.randomUUID();
    }

    const id = anchor.dataset.termscopePolicyId;
    liveIds.add(id);

    let button = document.querySelector(
      `.termscope-policy-trigger[data-termscope-for="${id}"]`
    );

    if (!button) {
      button = document.createElement("button");
      button.className = "termscope-policy-trigger";
      button.dataset.termscopeFor = id;
      button.type = "button";
      button.title = `Check ${item.sourceName} ${
        item.type === "terms" ? "Terms" : "Privacy Policy"
      }`;
      button.setAttribute("aria-label", button.title);
      button.innerHTML = shieldSvg;

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const freshPolicy = policyFromAnchor(anchor);
        if (!freshPolicy) return;

        showWidget();
        analyzePolicies([freshPolicy]);
      });

      anchor.insertAdjacentElement("afterend", button);
    }
  }

  document
    .querySelectorAll(".termscope-policy-trigger[data-termscope-for]")
    .forEach((button) => {
      if (!liveIds.has(button.dataset.termscopeFor)) {
        button.remove();
      }
    });
}

function scheduleTriggerSync() {
  clearTimeout(triggerSyncTimer);
  triggerSyncTimer = setTimeout(syncPolicyTriggers, 250);
}

function createWidget() {
  if (host) return;

  host = document.createElement("div");
  host.id = "termscope-widget-host";
  host.className = "termscope-hidden";
  host.innerHTML = `
    <div class="termscope-shell">
      <div class="termscope-header" id="termscope-drag-handle">
        <button
          class="termscope-logo"
          id="termscope-home-btn"
          type="button"
          title="All policies"
          aria-label="All policies"
        >
          ${shieldSvg}
        </button>

        <div class="termscope-brand">
          <strong>TermScope</strong>
          <span>${escapeHtml(location.hostname)}</span>
        </div>

        <button
          class="termscope-icon-btn"
          id="termscope-library-btn"
          title="Policy Library"
          aria-label="Policy Library"
          type="button"
        >
          ${librarySvg}
        </button>

        <button
          class="termscope-icon-btn"
          id="termscope-settings-btn"
          title="Settings"
          aria-label="Settings"
          type="button"
        >
          ${gearSvg}
        </button>

        <button
          class="termscope-icon-btn"
          id="termscope-close-btn"
          title="Close"
          aria-label="Close"
          type="button"
        >
          ${closeSvg}
        </button>
      </div>

      <div class="termscope-body" id="termscope-body"></div>
    </div>
  `;

  document.documentElement.appendChild(host);

  host
    .querySelector("#termscope-close-btn")
    .addEventListener("click", closeWidget);

  host
    .querySelector("#termscope-home-btn")
    .addEventListener("click", () => renderPolicyPicker());

  host
    .querySelector("#termscope-library-btn")
    .addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "TERMSCOPE_OPEN_LIBRARY" });
    });

  host
    .querySelector("#termscope-settings-btn")
    .addEventListener("click", () => {
      settingsReturnView = currentView;
      renderSettings();
    });

  enableDragging();
  requestAnimationFrame(applySavedPosition);
}

function showWidget() {
  createWidget();
  host.classList.remove("termscope-hidden");
}

function closeWidget() {
  host?.classList.add("termscope-hidden");
}

function setBody(html) {
  showWidget();
  host.querySelector("#termscope-body").innerHTML = html;
}

function applySavedPosition() {
  if (!host || !settings.widgetPosition) return;

  const { left, top } = settings.widgetPosition;
  if (!Number.isFinite(left) || !Number.isFinite(top)) return;

  const width = host.offsetWidth || 390;
  const height = host.offsetHeight || 160;

  host.style.left = `${Math.max(4, Math.min(left, innerWidth - width - 4))}px`;
  host.style.top = `${Math.max(4, Math.min(top, innerHeight - height - 4))}px`;
  host.style.right = "auto";
  host.style.bottom = "auto";
}

function enableDragging() {
  const handle = host.querySelector("#termscope-drag-handle");
  let drag = null;

  handle.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;

    const rect = host.getBoundingClientRect();
    drag = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener("pointermove", (event) => {
    if (!drag) return;

    const left = Math.max(
      4,
      Math.min(event.clientX - drag.x, innerWidth - host.offsetWidth - 4)
    );

    const top = Math.max(
      4,
      Math.min(event.clientY - drag.y, innerHeight - host.offsetHeight - 4)
    );

    Object.assign(host.style, {
      left: `${left}px`,
      top: `${top}px`,
      right: "auto",
      bottom: "auto"
    });
  });

  handle.addEventListener("pointerup", async (event) => {
    if (!drag) return;

    drag = null;
    handle.releasePointerCapture(event.pointerId);

    const rect = host.getBoundingClientRect();
    settings.widgetPosition = {
      left: rect.left,
      top: rect.top
    };

    await chrome.storage.sync.set({ settings });
  });
}

function openWidget() {
  showWidget();
  renderPolicyPicker();
}

function backButtonHtml(label = "All policies") {
  return `
    <button class="termscope-back" id="termscope-back-btn" type="button">
      ${backSvg}
      ${escapeHtml(label)}
    </button>
  `;
}

function policyTypeLabel(type) {
  return type === "terms" ? "Terms of Use" : "Privacy Policy";
}

function groupPolicies(items) {
  return {
    terms: items.filter((item) => item.type === "terms"),
    privacy: items.filter((item) => item.type === "privacy")
  };
}

function ratingClass(rating) {
  if (rating >= 8) return "good";
  if (rating >= 5) return "mixed";
  return "poor";
}

async function readSavedRatings() {
  const response = await chrome.runtime.sendMessage({
    type: "TERMSCOPE_GET_LIBRARY"
  });

  return response?.ok ? response.library || {} : {};
}

function savedRatingFor(library, url) {
  const key = canonicalPolicyUrl(url);
  return library[key]?.policyRating;
}

async function renderPolicyPicker() {
  currentView = "picker";
  currentClauseRequest = null;

  const choices = collectPolicies();
  const library = await readSavedRatings();

  if (!choices.length) {
    setBody(`
      <div class="termscope-empty-state">
        <div class="termscope-empty-icon">${shieldSvg}</div>
        <h2>No policies found</h2>
        <p>
          TermScope could not find a Terms of Use or Privacy Policy link on this page.
        </p>
      </div>
    `);
    return;
  }

  const grouped = groupPolicies(choices);

  const renderGroup = (title, items) => {
    if (!items.length) return "";

    return `
      <section class="termscope-policy-group">
        <div class="termscope-group-title">
          <h3>${escapeHtml(title)}</h3>
          <span>${items.length}</span>
        </div>

        <div class="termscope-policy-list">
          ${items
            .map((item) => {
              const savedRating = savedRatingFor(library, item.url);

              return `
                <button
                  class="termscope-policy-choice"
                  data-policy-url="${escapeHtml(item.url)}"
                  data-policy-type="${escapeHtml(item.type)}"
                  type="button"
                >
                  <span class="termscope-policy-source">
                    <strong>${escapeHtml(item.sourceName)}</strong>
                    <small>${escapeHtml(item.hostname || item.label)}</small>
                  </span>

                  <span class="termscope-policy-choice-right">
                    ${
                      Number.isFinite(savedRating)
                        ? `<span class="termscope-mini-rating ${ratingClass(
                            savedRating
                          )}">${savedRating}/10</span>`
                        : `<span class="termscope-analyze-label">Analyze</span>`
                    }
                    <span class="termscope-chevron">›</span>
                  </span>
                </button>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  };

  setBody(`
    <div class="termscope-picker-head">
      <div>
        <span class="termscope-eyebrow">Policies detected</span>
        <h2>${choices.length} ${choices.length === 1 ? "policy" : "policies"} found</h2>
        <p>Choose one policy to analyze. Each policy receives its own rating and explanation.</p>
      </div>
    </div>

    ${renderGroup("Terms of Use", grouped.terms)}
    ${renderGroup("Privacy Policies", grouped.privacy)}

    <button class="termscope-library-link" id="termscope-picker-library" type="button">
      ${librarySvg}
      Open Policy Library
    </button>
  `);

  host
    .querySelectorAll(".termscope-policy-choice")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const selected = choices.find(
          (item) =>
            canonicalPolicyUrl(item.url) ===
              canonicalPolicyUrl(button.dataset.policyUrl) &&
            item.type === button.dataset.policyType
        );

        if (selected) analyzePolicies([selected]);
      });
    });

  host
    .querySelector("#termscope-picker-library")
    .addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "TERMSCOPE_OPEN_LIBRARY" });
    });
}

function extractRelevantText(text, maxChars = 16000) {
  const cleaned = String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length <= maxChars) return cleaned;

  const keywords = [
    /sell|sale of personal|share.{0,30}(data|information)|third part/i,
    /track|advertis|analytics|cookie|device identifier|location/i,
    /arbitration|class action|jury trial|governing law|dispute/i,
    /automatic.{0,15}renew|subscription|refund|nonrefundable|charge/i,
    /license.{0,30}(content|upload)|ownership|intellectual property/i,
    /artificial intelligence|machine learning|train.{0,20}(model|ai)/i,
    /delete.{0,20}(account|data)|retain|retention|termination|suspend/i,
    /change.{0,20}(terms|policy)|modify.{0,20}(terms|policy)|without notice/i
  ];

  let pieces = cleaned
    .split(/\n+/)
    .map(normalize)
    .filter((part) => part.length >= 35);

  if (pieces.length < 8) {
    pieces = cleaned
      .split(/(?<=[.!?])\s+(?=[A-Z0-9])/) 
      .map(normalize)
      .filter((part) => part.length >= 35);
  }

  const scored = pieces.map((part, index) => {
    const matches = keywords.reduce(
      (total, pattern) => total + (pattern.test(part) ? 1 : 0),
      0
    );

    return {
      part,
      index,
      score: matches * 10 + Math.min(part.length / 500, 2)
    };
  });

  const selected = new Map();

  pieces.slice(0, 4).forEach((part, index) => selected.set(index, part));

  scored
    .filter((item) => item.score >= 10)
    .sort((a, b) => b.score - a.score)
    .forEach((item) => {
      const currentLength = [...selected.values()].join("\n\n").length;
      if (currentLength >= maxChars) return;

      selected.set(item.index, item.part);
      if (item.index > 0) selected.set(item.index - 1, pieces[item.index - 1]);
      if (item.index + 1 < pieces.length) {
        selected.set(item.index + 1, pieces[item.index + 1]);
      }
    });

  let output = [...selected.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1])
    .join("\n\n");

  if (output.length < Math.min(4500, maxChars)) {
    output = cleaned.slice(0, maxChars);
  }

  return output.slice(0, maxChars);
}

function htmlToReadableDocument(html, url, contentType) {
  if (/text\/plain/i.test(contentType)) {
    return {
      title: new URL(url).hostname,
      text: extractRelevantText(html),
      url
    };
  }

  const doc = new DOMParser().parseFromString(html, "text/html");

  doc
    .querySelectorAll(
      "script,style,noscript,svg,canvas,nav,header,footer,form,button,input,select,textarea,iframe"
    )
    .forEach((node) => node.remove());

  const root = doc.querySelector("main, article, [role='main']") || doc.body;
  const title =
    normalize(doc.querySelector("h1")?.textContent) ||
    normalize(doc.title) ||
    new URL(url).hostname;
  const readableText = root?.textContent || "";

  return {
    title,
    text: extractRelevantText(readableText),
    url
  };
}

async function analyzePolicies(selected) {
  const policy = selected[0];
  if (!policy) return;

  lastSelectedPolicies = [policy];
  currentPolicy = policy;
  currentAnalysis = null;
  currentView = "loading";

  setBody(`
    ${backButtonHtml()}
    <div class="termscope-status">
      <div class="termscope-spinner"></div>
      <strong>Reading ${escapeHtml(policy.sourceName)} ${escapeHtml(
        policyTypeLabel(policy.type)
      )}</strong>
      <p>TermScope is reading this policy without leaving the current page.</p>
    </div>
  `);

  host.querySelector("#termscope-back-btn").addEventListener("click", renderPolicyPicker);

  try {
    const fetched = await chrome.runtime.sendMessage({
      type: "TERMSCOPE_FETCH_POLICY",
      url: policy.url
    });

    if (!fetched?.ok) {
      throw new Error(fetched?.error || `Could not read ${policy.label}`);
    }

    const documentData = htmlToReadableDocument(
      fetched.html,
      fetched.url,
      fetched.contentType
    );

    if (documentData.text.length < 100) {
      throw new Error(`${policy.label} did not contain enough readable text.`);
    }

    setBody(`
      ${backButtonHtml()}
      <div class="termscope-status">
        <div class="termscope-spinner"></div>
        <strong>Explaining the important clauses</strong>
        <p>The fast AI model is checking the parts most likely to affect you.</p>
      </div>
    `);

    host.querySelector("#termscope-back-btn").addEventListener("click", renderPolicyPicker);

    const response = await chrome.runtime.sendMessage({
      type: "TERMSCOPE_ANALYZE",
      payload: {
        sourcePage: location.href,
        hostname: location.hostname,
        documents: [
          {
            ...documentData,
            type: policy.type,
            label: policy.label,
            sourceName: policy.sourceName
          }
        ],
        preferences: {
          readingLevel: settings.readingLevel,
          priorities: settings.priorities
        }
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "AI analysis failed.");
    }

    currentAnalysis = response.result;
    await saveAnalysisToLibrary(policy, response.result);
    renderResults(response.result, policy);
  } catch (error) {
    renderError(error.message);
  }
}

async function saveAnalysisToLibrary(policy, result) {
  await chrome.runtime.sendMessage({
    type: "TERMSCOPE_SAVE_LIBRARY",
    item: {
      url: policy.url,
      type: policy.type,
      label: policy.label,
      sourceName: policy.sourceName,
      hostname: policy.hostname,
      policyRating: result.policyRating,
      ratingLabel: result.ratingLabel,
      overview: result.overview,
      risks: result.risks,
      analyzedAt: Date.now()
    }
  });
}

function renderResults(result, policy = currentPolicy) {
  currentView = "results";
  currentAnalysis = result;
  currentPolicy = policy;

  const risks = Array.isArray(result.risks) ? result.risks : [];
  const rating = Number.isFinite(result.policyRating) ? result.policyRating : 10;
  const colorClass = ratingClass(rating);

  setBody(`
    ${backButtonHtml()}

    <div class="termscope-result-head">
      <div class="termscope-result-title">
        <span class="termscope-eyebrow">${escapeHtml(
          policyTypeLabel(policy?.type)
        )}</span>
        <h2>${escapeHtml(policy?.sourceName || result.title || "Policy review")}</h2>
        <p>${escapeHtml(result.overview || "")}</p>
      </div>

      <div class="termscope-rating-wrap">
        <div class="termscope-rating-circle ${colorClass}">
          <strong>${escapeHtml(rating)}</strong>
          <span>out of 10</span>
        </div>
        <small>${escapeHtml(result.ratingLabel || "Policy rating")}</small>
      </div>
    </div>

    <div class="termscope-rating-key">
      <span><i class="good"></i>8 to 10 strong</span>
      <span><i class="mixed"></i>5 to 7.9 mixed</span>
      <span><i class="poor"></i>Below 5 concerning</span>
    </div>

    ${
      risks.length
        ? `
          <div class="termscope-risk-list">
            ${risks
              .map(
                (risk, index) => `
                  <article class="termscope-risk">
                    <div class="termscope-risk-top">
                      <h3>${escapeHtml(risk.title || "Potential concern")}</h3>
                      <span class="termscope-severity ${escapeHtml(
                        risk.severity || "medium"
                      )}">${escapeHtml(risk.severity || "medium")}</span>
                    </div>

                    <p class="termscope-short-summary">
                      ${escapeHtml(
                        risk.shortSummary || risk.plainMeaning || risk.explanation || ""
                      )}
                    </p>

                    ${
                      risk.plainMeaning
                        ? `<p><strong>What it means:</strong> ${escapeHtml(
                            risk.plainMeaning
                          )}</p>`
                        : ""
                    }

                    ${
                      risk.action
                        ? `<p class="termscope-action"><strong>What you can do:</strong> ${escapeHtml(
                            risk.action
                          )}</p>`
                        : ""
                    }

                    ${
                      risk.quote && risk.sourceUrl
                        ? `
                          <button
                            class="termscope-view-clause"
                            data-risk-index="${index}"
                            type="button"
                          >
                            ${externalSvg}
                            Read and highlight this clause
                          </button>
                        `
                        : ""
                    }
                  </article>
                `
              )
              .join("")}
          </div>
        `
        : `
          <div class="termscope-empty-state termscope-safe-state">
            <div class="termscope-empty-icon">${shieldSvg}</div>
            <h2>No major problems found</h2>
            <p>The AI did not identify a serious issue in your selected categories. It can still miss context.</p>
          </div>
        `
    }

    <div class="termscope-saved-note">
      ${librarySvg}
      This review was saved to your Policy Library
    </div>

    <div class="termscope-disclaimer">
      AI can make mistakes. TermScope is informational and is not legal advice.
    </div>
  `);

  host.querySelector("#termscope-back-btn").addEventListener("click", renderPolicyPicker);

  host
    .querySelectorAll(".termscope-view-clause")
    .forEach((button) => {
      button.addEventListener("click", async () => {
        const risk = risks[Number(button.dataset.riskIndex)];

        await chrome.runtime.sendMessage({
          type: "TERMSCOPE_OPEN_CLAUSE",
          clause: {
            ...risk,
            policyRating: rating,
            ratingLabel: result.ratingLabel,
            policySourceName: policy?.sourceName,
            policyType: policy?.type,
            sourceUrl: risk.sourceUrl
          }
        });
      });
    });
}

function renderError(message) {
  currentView = "error";

  setBody(`
    ${backButtonHtml()}

    <div class="termscope-error">
      <strong>TermScope could not finish the analysis.</strong>
      <p>${escapeHtml(message)}</p>
    </div>

    <button class="termscope-primary" id="termscope-retry" type="button">
      Try again
    </button>
  `);

  host.querySelector("#termscope-back-btn").addEventListener("click", renderPolicyPicker);
  host.querySelector("#termscope-retry").addEventListener("click", () => {
    analyzePolicies(lastSelectedPolicies.length ? lastSelectedPolicies : policies.slice(0, 1));
  });
}

function returnFromSettings() {
  if (settingsReturnView === "results" && currentAnalysis && currentPolicy) {
    renderResults(currentAnalysis, currentPolicy);
    return;
  }

  if (settingsReturnView === "clause" && currentClauseRequest) {
    renderClauseDetail(currentClauseRequest, Boolean(document.querySelector(".termscope-highlight, .termscope-clause-block-highlight")));
    return;
  }

  renderPolicyPicker();
}

function renderSettings() {
  currentView = "settings";

  const priorityLabels = {
    privacy: "Privacy and tracking",
    money: "Payments and renewals",
    rights: "Legal rights",
    content: "Content ownership",
    account: "Account deletion",
    ai: "AI training"
  };

  setBody(`
    ${backButtonHtml("Back")}

    <div class="termscope-settings">
      <h2>Settings</h2>
      <p class="termscope-muted">Choose what TermScope focuses on.</p>

      <label class="termscope-setting">
        <span>
          Show policy shields
          <small>Display a shield beside every Terms or Privacy link</small>
        </span>
        <input id="ts-enabled" type="checkbox" ${settings.enabled ? "checked" : ""}>
      </label>

      <label class="termscope-field">
        Reading style
        <select id="ts-reading">
          <option value="simple" ${
            settings.readingLevel === "simple" ? "selected" : ""
          }>Very simple</option>
          <option value="balanced" ${
            settings.readingLevel === "balanced" ? "selected" : ""
          }>Balanced</option>
          <option value="detailed" ${
            settings.readingLevel === "detailed" ? "selected" : ""
          }>Detailed</option>
        </select>
      </label>

      <strong class="termscope-section-label">Focus areas</strong>

      <div class="termscope-priorities">
        ${Object.entries(priorityLabels)
          .map(
            ([key, label]) => `
              <label class="termscope-priority">
                <input type="checkbox" value="${key}" ${
                  settings.priorities.includes(key) ? "checked" : ""
                }>
                ${label}
              </label>
            `
          )
          .join("")}
      </div>

      <button class="termscope-primary" id="ts-save" type="button">
        Save settings
      </button>
    </div>
  `);

  host.querySelector("#termscope-back-btn").addEventListener("click", returnFromSettings);

  host.querySelector("#ts-save").addEventListener("click", async () => {
    settings.enabled = host.querySelector("#ts-enabled").checked;
    settings.readingLevel = host.querySelector("#ts-reading").value;
    settings.priorities = [
      ...host.querySelectorAll(".termscope-priority input:checked")
    ].map((input) => input.value);

    await chrome.storage.sync.set({ settings });
    syncPolicyTriggers();
    returnFromSettings();
  });
}

function normalizeForSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function visibleTextNode(node) {
  const element = node.parentElement;
  if (!element) return false;
  if (element.closest("script,style,noscript,textarea,input,mark.termscope-highlight")) {
    return false;
  }

  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function findBestClauseElement(quote) {
  const candidates = [
    normalizeForSearch(quote),
    normalizeForSearch(quote).slice(0, 240),
    normalizeForSearch(quote).slice(0, 150),
    normalizeForSearch(quote).slice(0, 90)
  ].filter((value) => value.length >= 35);

  const elements = [
    ...document.querySelectorAll(
      "p, li, blockquote, dd, td, section, article, [role='main'] div, main div"
    )
  ];

  let best = null;

  for (const element of elements) {
    if (element.closest("#termscope-widget-host")) continue;

    const text = normalizeForSearch(element.innerText || element.textContent);
    if (text.length < 35 || text.length > 5000) continue;

    for (const candidate of candidates) {
      if (!text.includes(candidate)) continue;

      if (!best || text.length < best.textLength) {
        best = { element, candidate, textLength: text.length };
      }
    }
  }

  return best;
}

function buildTextMap(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return visibleTextNode(node) && normalize(node.nodeValue)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });

  let text = "";
  const map = [];
  let previousWasSpace = false;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const value = node.nodeValue || "";

    for (let offset = 0; offset < value.length; offset += 1) {
      const char = value[offset];
      const isSpace = /\s/.test(char);

      if (isSpace) {
        if (!previousWasSpace && text.length) {
          text += " ";
          map.push({ node, offset });
        }
        previousWasSpace = true;
      } else {
        text += char.toLowerCase();
        map.push({ node, offset });
        previousWasSpace = false;
      }
    }

    if (!previousWasSpace && text.length) {
      text += " ";
      map.push({ node, offset: value.length });
      previousWasSpace = true;
    }
  }

  return {
    text: text.trim(),
    map
  };
}

function markTextInsideElement(element, candidate) {
  const { text, map } = buildTextMap(element);
  const target = normalizeForSearch(candidate);
  const index = text.indexOf(target);

  if (index < 0 || !map[index] || !map[index + target.length - 1]) {
    return null;
  }

  const start = map[index];
  const end = map[index + target.length - 1];
  const range = document.createRange();

  try {
    range.setStart(start.node, Math.min(start.offset, start.node.nodeValue.length));
    range.setEnd(end.node, Math.min(end.offset + 1, end.node.nodeValue.length));

    const mark = document.createElement("mark");
    mark.className = "termscope-highlight";
    mark.id = "termscope-highlight-target";
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
    return mark;
  } catch {
    return null;
  }
}

function clearClauseHighlights() {
  document.querySelectorAll("mark.termscope-highlight").forEach((mark) => {
    mark.replaceWith(...mark.childNodes);
  });

  document.querySelectorAll(".termscope-clause-block-highlight").forEach((element) => {
    element.classList.remove("termscope-clause-block-highlight");
  });
}

function locateAndHighlightClause(quote) {
  clearClauseHighlights();

  const best = findBestClauseElement(quote);
  if (!best) return null;

  const mark = markTextInsideElement(best.element, best.candidate);
  const target = mark || best.element;

  if (!mark) {
    best.element.classList.add("termscope-clause-block-highlight");
    best.element.id = "termscope-highlight-target";
  }

  target.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  return target;
}

function renderClauseDetail(request, located) {
  currentView = "clause";
  currentClauseRequest = request;

  setBody(`
    <div class="termscope-clause-head">
      <span class="termscope-severity ${escapeHtml(
        request.severity || "medium"
      )}">${escapeHtml(request.severity || "medium")}</span>
      <h2>${escapeHtml(request.title || "Clause explanation")}</h2>
      <p>${escapeHtml(request.shortSummary || "")}</p>
    </div>

    <div class="termscope-detail-card">
      <h3>What this means</h3>
      <p>${escapeHtml(request.plainMeaning || request.explanation || "")}</p>
    </div>

    ${
      request.whyItMatters
        ? `
          <div class="termscope-detail-card">
            <h3>Why it matters</h3>
            <p>${escapeHtml(request.whyItMatters)}</p>
          </div>
        `
        : ""
    }

    ${
      request.action
        ? `
          <div class="termscope-detail-card termscope-action-card">
            <h3>What you can do</h3>
            <p>${escapeHtml(request.action)}</p>
          </div>
        `
        : ""
    }

    <details class="termscope-quote-details">
      <summary>Show the original clause</summary>
      <blockquote>${escapeHtml(request.quote || "")}</blockquote>
    </details>

    <button class="termscope-primary" id="termscope-jump-clause" type="button">
      ${jumpSvg}
      ${located ? "Jump to highlighted clause" : "Try to find the clause again"}
    </button>

    <p class="termscope-locator-status ${located ? "found" : "missing"}">
      ${
        located
          ? "The matching clause is highlighted on this page."
          : "The page may still be loading or may display the policy in a format that cannot be highlighted automatically."
      }
    </p>
  `);

  host.querySelector("#termscope-jump-clause").addEventListener("click", () => {
    const existing = document.querySelector(
      "#termscope-highlight-target, .termscope-clause-block-highlight"
    );

    if (existing) {
      existing.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const target = locateAndHighlightClause(request.quote);
    renderClauseDetail(request, Boolean(target));
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function highlightRequestedClause() {
  const match = location.hash.match(/(?:^|[&#])termscope=([a-f0-9-]+)/i);
  if (!match) return;

  const key = `highlight:${match[1]}`;
  const stored = await chrome.storage.local.get(key);
  const request = stored[key];

  if (!request?.quote) return;

  currentClauseRequest = request;
  showWidget();
  renderClauseDetail(request, false);

  let target = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    target = locateAndHighlightClause(request.quote);
    if (target) break;
    await delay(600);
  }

  renderClauseDetail(request, Boolean(target));
  await chrome.storage.local.remove(key);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TERMSCOPE_TOGGLE") {
    createWidget();

    if (host.classList.contains("termscope-hidden")) {
      openWidget();
    } else {
      closeWidget();
    }
  }
});

chrome.storage.sync.get("settings").then(({ settings: stored }) => {
  settings = {
    ...DEFAULT_SETTINGS,
    ...(stored || {})
  };

  syncPolicyTriggers();

  const observer = new MutationObserver(scheduleTriggerSync);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  highlightRequestedClause();
});
