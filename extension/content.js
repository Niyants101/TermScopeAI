const POLICY_TEXT = {
  terms: /\b(?:terms(?:\s+(?:of\s+use|of\s+service|and\s+conditions|&\s+conditions))?|conditions\s+of\s+use|user\s+agreement)\b/i,
  privacy: /\bprivacy(?:\s+policy|\s+notice)?\b/i
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
let host;
let currentAnalysis = null;
let lastSelectedPolicies = [];

const shieldSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.8 19 5.9v5.2c0 4.8-2.8 8.4-7 10.1-4.2-1.7-7-5.3-7-10.1V5.9l7-3.1Z" stroke="currentColor" stroke-width="1.9"/><path d="m8.8 12 2 2 4.5-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const gearSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 13.1v-2.2l-2-.7a7.7 7.7 0 0 0-.7-1.6l.9-1.9-1.6-1.6-1.9.9a7.7 7.7 0 0 0-1.6-.7l-.7-2H9.6l-.7 2a7.7 7.7 0 0 0-1.6.7l-1.9-.9-1.6 1.6.9 1.9a7.7 7.7 0 0 0-.7 1.6l-2 .7v2.2l2 .7c.2.6.4 1.1.7 1.6l-.9 1.9 1.6 1.6 1.9-.9c.5.3 1 .5 1.6.7l.7 2h2.2l.7-2c.6-.2 1.1-.4 1.6-.7l1.9.9 1.6-1.6-.9-1.9c.3-.5.5-1 .7-1.6l2-.7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const closeSvg = `<svg viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const externalSvg = `<svg viewBox="0 0 24 24" fill="none"><path d="M14 5h5v5M19 5l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke="currentColor" stroke-width="2"/></svg>`;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function normalize(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function classifyPolicy(anchor) {
  const label = normalize(anchor.textContent || anchor.getAttribute("aria-label"));
  const href = anchor.href || "";
  if (POLICY_TEXT.terms.test(label) || /\/(?:terms|tos)(?:[\/?#]|$)/i.test(href)) return "terms";
  if (POLICY_TEXT.privacy.test(label) || /\/(?:privacy)(?:[\/?#]|$)/i.test(href)) return "privacy";
  return null;
}

function collectPolicies() {
  const found = [];
  document.querySelectorAll("a[href]").forEach(anchor => {
    const type = classifyPolicy(anchor);
    if (!type || !/^https?:/i.test(anchor.href)) return;
    found.push({ type, label: normalize(anchor.textContent) || (type === "terms" ? "Terms of Use" : "Privacy Policy"), url: anchor.href, anchor });
  });

  const unique = new Map();
  found.forEach(item => {
    const key = `${item.type}:${item.url}`;
    if (!unique.has(key)) unique.set(key, item);
  });
  policies = [...unique.values()];
  return policies;
}

function chooseTriggerAnchor(items) {
  if (!items.length) return null;
  const groups = new Map();
  items.forEach(item => {
    const parent = item.anchor.parentElement;
    if (!parent) return;
    const entry = groups.get(parent) || [];
    entry.push(item);
    groups.set(parent, entry);
  });
  const best = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  return best?.[1]?.[best[1].length - 1]?.anchor || items[items.length - 1].anchor;
}

function installSingleTrigger() {
  if (!settings.enabled) return;
  const items = collectPolicies();
  if (!items.length) return;

  document.querySelectorAll(".termscope-policy-trigger").forEach(button => button.remove());
  const anchor = chooseTriggerAnchor(items);
  if (!anchor) return;

  const button = document.createElement("button");
  button.className = "termscope-policy-trigger";
  button.type = "button";
  button.title = "Check the Terms and Privacy Policy";
  button.setAttribute("aria-label", "Check the Terms and Privacy Policy");
  button.innerHTML = shieldSvg;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openWidget();
  });
  anchor.insertAdjacentElement("afterend", button);
}

function createWidget() {
  if (host) return;
  host = document.createElement("div");
  host.id = "termscope-widget-host";
  host.className = "termscope-hidden";
  host.innerHTML = `
    <div class="termscope-shell">
      <div class="termscope-header" id="termscope-drag-handle">
        <div class="termscope-logo">${shieldSvg}</div>
        <div class="termscope-brand"><strong>TermScope</strong><span>${escapeHtml(location.hostname)}</span></div>
        <button class="termscope-icon-btn" id="termscope-settings-btn" title="Settings">${gearSvg}</button>
        <button class="termscope-icon-btn" id="termscope-close-btn" title="Close">${closeSvg}</button>
      </div>
      <div class="termscope-body" id="termscope-body"></div>
    </div>`;
  document.documentElement.appendChild(host);
  host.querySelector("#termscope-close-btn").addEventListener("click", closeWidget);
  host.querySelector("#termscope-settings-btn").addEventListener("click", renderSettings);
  enableDragging();
  applySavedPosition();
}

function applySavedPosition() {
  if (!host || !settings.widgetPosition) return;
  const { left, top } = settings.widgetPosition;
  if (!Number.isFinite(left) || !Number.isFinite(top)) return;
  host.style.left = `${Math.max(4, Math.min(left, innerWidth - host.offsetWidth - 4))}px`;
  host.style.top = `${Math.max(4, Math.min(top, innerHeight - 100))}px`;
  host.style.right = "auto";
  host.style.bottom = "auto";
}

function enableDragging() {
  const handle = host.querySelector("#termscope-drag-handle");
  let drag = null;
  handle.addEventListener("pointerdown", event => {
    if (event.target.closest("button")) return;
    const rect = host.getBoundingClientRect();
    drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", event => {
    if (!drag) return;
    const left = Math.max(4, Math.min(event.clientX - drag.x, innerWidth - host.offsetWidth - 4));
    const top = Math.max(4, Math.min(event.clientY - drag.y, innerHeight - host.offsetHeight - 4));
    Object.assign(host.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" });
  });
  handle.addEventListener("pointerup", async event => {
    if (!drag) return;
    drag = null;
    handle.releasePointerCapture(event.pointerId);
    const rect = host.getBoundingClientRect();
    settings.widgetPosition = { left: rect.left, top: rect.top };
    await chrome.storage.sync.set({ settings });
  });
}

function openWidget() {
  createWidget();
  host.classList.remove("termscope-hidden");
  renderPolicyPickerOrAnalyze();
}

function closeWidget() {
  host?.classList.add("termscope-hidden");
}

function setBody(html) {
  createWidget();
  host.querySelector("#termscope-body").innerHTML = html;
}

function renderPolicyPickerOrAnalyze() {
  const items = collectPolicies();
  const byType = new Map();
  items.forEach(item => { if (!byType.has(item.type)) byType.set(item.type, item); });
  const choices = [...byType.values()];

  if (!choices.length) {
    setBody(`<div class="termscope-error">I could not find a Terms of Use or Privacy Policy link on this page.</div>`);
    return;
  }

  if (choices.length === 1) {
    analyzePolicies(choices);
    return;
  }

  setBody(`
    <div class="termscope-summary-head"><div><h2>What should I check?</h2><p class="termscope-overview">Choose one policy or analyze both together.</p></div></div>
    <div class="termscope-policy-picker">
      <button class="termscope-policy-choice" data-choice="all"><span>Terms and Privacy Policy</span><strong>Check both</strong></button>
      ${choices.map((item, index) => `<button class="termscope-policy-choice" data-choice="${index}"><span>${escapeHtml(item.label)}</span><strong>${item.type === "terms" ? "Terms" : "Privacy"}</strong></button>`).join("")}
    </div>`);

  host.querySelectorAll(".termscope-policy-choice").forEach(button => {
    button.addEventListener("click", () => {
      const choice = button.dataset.choice;
      analyzePolicies(choice === "all" ? choices : [choices[Number(choice)]]);
    });
  });
}

function htmlToReadableDocument(html, url, contentType) {
  if (/text\/plain/i.test(contentType)) {
    return { title: new URL(url).hostname, text: normalize(html).slice(0, 180000), url };
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,svg,canvas,nav,header,footer,form,button,input,select,textarea,iframe").forEach(node => node.remove());
  const root = doc.querySelector("main, article, [role='main']") || doc.body;
  const title = normalize(doc.querySelector("h1")?.textContent) || normalize(doc.title) || new URL(url).hostname;
  return { title, text: normalize(root?.innerText || root?.textContent || "").slice(0, 180000), url };
}

async function analyzePolicies(selected) {
  lastSelectedPolicies = selected;
  setBody(`<div class="termscope-status"><div class="termscope-spinner"></div><strong>Reading the linked policies</strong><p>The login page will stay open while TermScope checks the documents in the background.</p></div>`);

  try {
    const documents = [];
    for (const policy of selected) {
      const fetched = await chrome.runtime.sendMessage({ type: "TERMSCOPE_FETCH_POLICY", url: policy.url });
      if (!fetched?.ok) throw new Error(fetched?.error || `Could not read ${policy.label}`);
      const document = htmlToReadableDocument(fetched.html, fetched.url, fetched.contentType);
      if (document.text.length < 100) throw new Error(`${policy.label} did not contain enough readable text.`);
      documents.push({ ...document, type: policy.type, label: policy.label });
    }

    setBody(`<div class="termscope-status"><div class="termscope-spinner"></div><strong>Finding the important problems</strong><p>AI is checking privacy, money, legal rights, ownership, account control, and AI training clauses.</p></div>`);

    const response = await chrome.runtime.sendMessage({
      type: "TERMSCOPE_ANALYZE",
      payload: {
        sourcePage: location.href,
        hostname: location.hostname,
        documents,
        preferences: {
          readingLevel: settings.readingLevel,
          priorities: settings.priorities
        }
      }
    });
    if (!response?.ok) throw new Error(response?.error || "AI analysis failed.");
    currentAnalysis = response.result;
    renderResults(response.result);
  } catch (error) {
    renderError(error.message);
  }
}

function renderResults(result) {
  const risks = Array.isArray(result.risks) ? result.risks : [];
  setBody(`
    <div class="termscope-summary-head">
      <div><h2>${escapeHtml(result.title || "Important problems")}</h2></div>
      <div class="termscope-score">${Number.isFinite(result.riskScore) ? `${result.riskScore}/100 risk` : `${risks.length} found`}</div>
    </div>
    <p class="termscope-overview">${escapeHtml(result.overview || "These are the clauses most worth knowing before you continue.")}</p>
    ${risks.length ? `<div class="termscope-risk-list">${risks.map((risk, index) => `
      <article class="termscope-risk">
        <div class="termscope-risk-top"><h3>${escapeHtml(risk.title || "Potential concern")}</h3><span class="termscope-severity ${escapeHtml(risk.severity || "medium")}">${escapeHtml(risk.severity || "medium")}</span></div>
        <p>${escapeHtml(risk.explanation || risk.explain || "")}</p>
        ${risk.action ? `<p class="termscope-action">What you can do: ${escapeHtml(risk.action)}</p>` : ""}
        ${risk.quote && risk.sourceUrl ? `<button class="termscope-view-clause" data-risk-index="${index}">${externalSvg} View actual clause</button>` : ""}
      </article>`).join("")}</div>` : `<div class="termscope-empty"><strong>No major problems found</strong><p class="termscope-muted">The AI did not identify a serious issue in the selected categories. It can still miss context.</p></div>`}
    <div class="termscope-disclaimer">AI can make mistakes. TermScope is informational and is not legal advice.</div>`);

  host.querySelectorAll(".termscope-view-clause").forEach(button => {
    button.addEventListener("click", async () => {
      const risk = risks[Number(button.dataset.riskIndex)];
      await chrome.runtime.sendMessage({ type: "TERMSCOPE_OPEN_CLAUSE", url: risk.sourceUrl, quote: risk.quote });
    });
  });
}

function renderError(message) {
  setBody(`
    <div class="termscope-error"><strong>TermScope could not finish the analysis.</strong><br><br>${escapeHtml(message)}</div>
    <button class="termscope-primary" id="termscope-open-settings">Open settings</button>
    <button class="termscope-primary" id="termscope-retry" style="background:#fff;color:#5146d7;border:1px solid #dcd8ed">Try again</button>`);
  host.querySelector("#termscope-open-settings").addEventListener("click", renderSettings);
  host.querySelector("#termscope-retry").addEventListener("click", () => analyzePolicies(lastSelectedPolicies.length ? lastSelectedPolicies : policies.slice(0, 1)));
}

function renderSettings() {
  const priorityLabels = {
    privacy: "Privacy and tracking", money: "Payments and renewals", rights: "Legal rights",
    content: "Content ownership", account: "Account deletion", ai: "AI training"
  };
  setBody(`
    <div class="termscope-settings">
      <h2>Settings</h2><p class="termscope-muted">Choose what TermScope focuses on.</p>
      <label class="termscope-setting"><span>Show policy shield<small>Only beside Terms or Privacy links</small></span><input id="ts-enabled" type="checkbox" ${settings.enabled ? "checked" : ""}></label>
      <label class="termscope-field">Reading style<select id="ts-reading"><option value="simple" ${settings.readingLevel === "simple" ? "selected" : ""}>Very simple</option><option value="balanced" ${settings.readingLevel === "balanced" ? "selected" : ""}>Balanced</option><option value="detailed" ${settings.readingLevel === "detailed" ? "selected" : ""}>Detailed</option></select></label>
      <strong style="font-size:12px">Focus areas</strong>
      <div class="termscope-priorities">${Object.entries(priorityLabels).map(([key,label]) => `<label class="termscope-priority"><input type="checkbox" value="${key}" ${settings.priorities.includes(key) ? "checked" : ""}>${label}</label>`).join("")}</div>
      <button class="termscope-primary" id="ts-save">Save settings</button>
      ${currentAnalysis ? `<button class="termscope-primary" id="ts-back" style="background:#fff;color:#5146d7;border:1px solid #dcd8ed">Back to results</button>` : ""}
    </div>`);

  host.querySelector("#ts-save").addEventListener("click", async () => {
    settings.enabled = host.querySelector("#ts-enabled").checked;
    settings.readingLevel = host.querySelector("#ts-reading").value;
    settings.priorities = [...host.querySelectorAll(".termscope-priority input:checked")].map(input => input.value);
    await chrome.storage.sync.set({ settings });
    installSingleTrigger();
    renderPolicyPickerOrAnalyze();
  });
  host.querySelector("#ts-back")?.addEventListener("click", () => renderResults(currentAnalysis));
}

async function highlightRequestedClause() {
  const match = location.hash.match(/termscope=([a-f0-9-]+)/i);
  if (!match) return;
  const key = `highlight:${match[1]}`;
  const stored = await chrome.storage.local.get(key);
  const request = stored[key];
  if (!request?.quote) return;

  const quote = normalize(request.quote);
  const candidates = [quote, quote.slice(0, 180), quote.slice(0, 100)].filter(value => value.length >= 35);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.parentElement || node.parentElement.closest("script,style,noscript,textarea,input,mark")) return NodeFilter.FILTER_REJECT;
      return normalize(node.nodeValue).length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const fullText = nodes.map(node => node.nodeValue).join("\n");
  const normalizedFull = normalize(fullText).toLowerCase();
  const target = candidates.find(value => normalizedFull.includes(value.toLowerCase()));

  let marked = false;
  if (target) {
    const shortTarget = target.slice(0, 90).toLowerCase();
    for (const node of nodes) {
      const text = node.nodeValue;
      const index = text.toLowerCase().indexOf(shortTarget);
      if (index === -1) continue;
      const mark = document.createElement("mark");
      mark.className = "termscope-highlight";
      const after = node.splitText(index);
      const tail = after.splitText(Math.min(shortTarget.length, after.nodeValue.length));
      mark.textContent = after.nodeValue;
      after.replaceWith(mark);
      mark.scrollIntoView({ behavior: "smooth", block: "center" });
      marked = true;
      break;
    }
  }

  if (!marked) {
    const bodyText = normalize(document.body.innerText).toLowerCase();
    const words = quote.split(" ").slice(0, 8).join(" ").toLowerCase();
    if (words && bodyText.includes(words)) {
      window.find(words);
    }
  }
  await chrome.storage.local.remove(key);
}

chrome.runtime.onMessage.addListener(message => {
  if (message.type === "TERMSCOPE_TOGGLE") {
    createWidget();
    host.classList.contains("termscope-hidden") ? openWidget() : closeWidget();
  }
});

chrome.storage.sync.get("settings").then(({ settings: stored }) => {
  settings = { ...DEFAULT_SETTINGS, ...(stored || {}) };
  installSingleTrigger();
  const observer = new MutationObserver(() => {
    clearTimeout(observer.timer);
    observer.timer = setTimeout(installSingleTrigger, 250);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  highlightRequestedClause();
});
