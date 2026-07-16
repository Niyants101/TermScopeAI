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

const MAX_PREVIEW_POLICIES = 8;
const PREVIEW_CONCURRENCY = 2;
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
let pickerSession = 0;
let clauseNavigator = null;
let activeClauseRequestId = "";
let clauseLoadPromise = null;
let userPositionedThisPage = false;
let viewportFitFrame = null;

const analysisCache = new Map();
const analysisJobs = new Map();

const shieldSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.8 19 5.9v5.2c0 4.8-2.8 8.4-7 10.1-4.2-1.7-7-5.3-7-10.1V5.9l7-3.1Z" stroke="currentColor" stroke-width="1.9"/><path d="m8.8 12 2 2 4.5-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const gearSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a7.4 7.4 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.58-1.69.98l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.08.66-.08.98s.03.66.08.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .6.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65A.49.49 0 0 0 10 22h4a.49.49 0 0 0 .49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1a.5.5 0 0 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"/></svg>`;

const closeSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

const externalSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke="currentColor" stroke-width="2"/></svg>`;

const librarySvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5A2.5 2.5 0 0 0 5 21.5v-17Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M5 18.5A2.5 2.5 0 0 1 7.5 16H19" stroke="currentColor" stroke-width="1.8"/></svg>`;

const backSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 18-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const jumpSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v13M7 12l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 21h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

const previousSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 18-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const nextSvg = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 18 6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

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

function policySiteKey(policy) {
  if (policy?.siteKey) return String(policy.siteKey).toLowerCase();

  try {
    return siteKeyFromHostname(
      policy?.hostname || new URL(policy?.url || "").hostname
    );
  } catch {
    return String(policy?.hostname || "").toLowerCase();
  }
}

function policyKey(policy) {
  return `${policySiteKey(policy) || "website"}:${policy?.type || "policy"}`;
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
  try {
    return brandFromHostname(new URL(anchor.href, location.href).hostname);
  } catch {
    return type === "terms" ? "Terms" : "Privacy";
  }
}

function normalizedPolicyLabel(value) {
  return normalize(value)
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

function isSupplementaryPolicyLabel(label) {
  return /\b(?:preview|new terms|generative|prohibited|acceptable use|additional|supplemental|service-specific|service specific|technology|technologies|cookies?|faq|overview|updates?|definitions?|government|children|safety|community|advertising|developer|api|content policy|product-specific|product specific)\b/i.test(
    label
  );
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

function explicitPolicyType(label) {
  const hasTerms = POLICY_TEXT.terms.test(label);
  const hasPrivacy = POLICY_TEXT.privacy.test(label);

  if (hasTerms && hasPrivacy) return null;
  if (hasTerms) return "terms";
  if (hasPrivacy) return "privacy";
  return null;
}

function policyCandidateScore(item) {
  const label = normalizedPolicyLabel(item?.label);
  let pathname = "";

  try {
    pathname = new URL(item?.url || "", location.href).pathname.toLowerCase();
  } catch {
    pathname = "";
  }

  let score = 0;

  if (isPrimaryPolicyLabel(label, item?.type)) score += 120;
  if (label.length > 0 && label.length <= 36) score += 15;
  if (isVisiblePolicyAnchor(item?.anchor)) score += 8;

  if (
    item?.type === "terms" &&
    /(?:^|\/)(?:terms|tos|terms-of-use|terms-of-service|user-agreement|conditions)(?:\/)?$/i.test(
      pathname
    )
  ) {
    score += 60;
  }

  if (
    item?.type === "privacy" &&
    /(?:^|\/)(?:privacy|privacy-policy|privacy-notice|privacy-statement|data-policy)(?:\/)?$/i.test(
      pathname
    )
  ) {
    score += 60;
  }

  if (isSupplementaryPolicyLabel(label)) score -= 180;
  if (POLICY_TEXT.terms.test(label) && POLICY_TEXT.privacy.test(label)) score -= 200;

  return score;
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

  if (!label || isSupplementaryPolicyLabel(label)) return null;

  const hasTerms = POLICY_TEXT.terms.test(label);
  const hasPrivacy = POLICY_TEXT.privacy.test(label);
  if (hasTerms && hasPrivacy) return null;

  const explicitType = explicitPolicyType(label);
  let target;
  let current;

  try {
    target = new URL(anchor.href, location.href);
    current = new URL(location.href);
  } catch {
    return null;
  }

  if (!/^https?:$/i.test(target.protocol)) return null;

  const sameDocument =
    target.origin === current.origin &&
    target.pathname.replace(/\/$/, "") === current.pathname.replace(/\/$/, "") &&
    target.search === current.search;

  if (sameDocument && !explicitType) return null;
  if (sameDocument && explicitType && canonicalPolicyUrl(target.href) === canonicalPolicyUrl(current.href)) {
    return null;
  }

  if (explicitType) return explicitType;

  if (
    label.length > 120 ||
    !/\b(?:policy|terms|agreement|conditions|privacy)\b/i.test(label)
  ) {
    return null;
  }

  if (
    /(?:^|\/)(?:terms|tos|terms-of-use|terms-of-service|user-agreement|conditions)(?:\/)?$/i.test(
      target.pathname
    )
  ) {
    return "terms";
  }

  if (
    /(?:^|\/)(?:privacy|privacy-policy|privacy-notice|privacy-statement|data-policy)(?:\/)?$/i.test(
      target.pathname
    )
  ) {
    return "privacy";
  }

  return null;
}

function policyFromAnchor(anchor) {
  const type = classifyPolicy(anchor);

  if (!type || !/^https?:/i.test(anchor.href)) return null;

  let hostname = "";

  try {
    hostname = new URL(anchor.href).hostname.replace(/^www\./, "");
  } catch {
    hostname = "";
  }

  return {
    type,
    label:
      normalize(anchor.textContent) ||
      (type === "terms" ? "Terms of Use" : "Privacy Policy"),
    sourceName: sourceNameForPolicy(anchor, type),
    hostname,
    siteKey: siteKeyFromHostname(hostname),
    url: canonicalPolicyUrl(anchor.href),
    anchor
  };
}

function collectPolicyAnchors() {
  const found = [];

  document.querySelectorAll("a[href]").forEach((anchor) => {
    if (anchor.closest("#termscope-widget-host")) return;
    const item = policyFromAnchor(anchor);
    if (item) found.push(item);
  });

  return found;
}

function collectPolicies() {
  const unique = new Map();

  for (const item of collectPolicyAnchors()) {
    const key = policyKey(item);
    const previous = unique.get(key);

    if (!previous || policyCandidateScore(item) > policyCandidateScore(previous)) {
      unique.set(key, item);
    }
  }

  policies = [...unique.values()].sort((a, b) => {
    if (a.anchor === b.anchor) return 0;
    const position = a.anchor.compareDocumentPosition(b.anchor);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  return policies;
}

function removeAllPolicyTriggers() {
  document
    .querySelectorAll(".termscope-policy-trigger")
    .forEach((button) => button.remove());
}

function isVisiblePolicyAnchor(anchor) {
  if (!anchor?.isConnected) return false;

  const style = getComputedStyle(anchor);
  const rect = anchor.getBoundingClientRect();

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(rect.width) > 0 &&
    Number(rect.height) > 0
  );
}

function compactPolicyContainerFor(item, allItems) {
  let node = item.anchor.parentElement;
  let fallback = null;

  for (
    let depth = 0;
    node && node !== document.body && node !== document.documentElement && depth < 7;
    depth += 1, node = node.parentElement
  ) {
    const members = allItems.filter((candidate) => node.contains(candidate.anchor));
    if (members.length < 2) continue;

    if (!fallback) fallback = { container: node, members };

    const rect = node.getBoundingClientRect();
    const text = normalize(node.innerText || node.textContent);
    const types = new Set(members.map((member) => member.type));
    const compact =
      members.length <= 4 &&
      text.length <= 1000 &&
      rect.height <= 320;

    if (compact && (types.size >= 2 || members.length === 2)) {
      return { container: node, members };
    }
  }

  return fallback?.members?.length === 2 ? fallback : null;
}

function clusterPolicyItems(items) {
  const visible = items.filter((item) => isVisiblePolicyAnchor(item.anchor));
  const remaining = new Set(visible);
  const clusters = [];

  for (const item of visible) {
    if (!remaining.has(item)) continue;

    const candidate = compactPolicyContainerFor(item, visible);
    let members = candidate
      ? candidate.members.filter((member) => remaining.has(member))
      : [item];

    const types = new Set(members.map((member) => member.type));
    if (members.length > 4 || (members.length > 2 && types.size < 2)) {
      members = [item];
    }

    members.forEach((member) => remaining.delete(member));
    clusters.push(members);
  }

  const paired = clusters.filter((cluster) => cluster.length >= 2);
  if (paired.length) return paired;
  return visible.length ? [visible] : [];
}

function selectTriggerAnchor(items) {
  return [...items]
    .sort((a, b) => {
      if (a.anchor === b.anchor) return 0;
      const position = a.anchor.compareDocumentPosition(b.anchor);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    })
    .at(-1)?.anchor;
}

function triggerClusterKey(items, index) {
  const value = items
    .map((item) => `${item.type}:${canonicalPolicyUrl(item.url)}`)
    .sort()
    .join("|");

  return `${value || "cluster"}::${index}`;
}

async function syncPolicyTriggers() {
  if (!settings.enabled) {
    removeAllPolicyTriggers();
    return;
  }

  const clusters = clusterPolicyItems(collectPolicies());
  const liveKeys = new Set();

  clusters.forEach((cluster, index) => {
    const anchor = selectTriggerAnchor(cluster);
    if (!anchor) return;

    const key = triggerClusterKey(cluster, index);
    liveKeys.add(key);

    let button = [...document.querySelectorAll(".termscope-policy-trigger")].find(
      (candidate) => candidate.dataset.termscopeCluster === key
    );

    if (!button) {
      button = document.createElement("button");
      button.className = "termscope-policy-trigger";
      button.type = "button";
      button.dataset.termscopeCluster = key;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openWidget();
      });
    }

    button.title = `Review ${cluster.length} ${
      cluster.length === 1 ? "policy" : "policies"
    } with TermScopeAI`;
    button.setAttribute("aria-label", button.title);
    button.innerHTML = shieldSvg;

    if (anchor.nextElementSibling !== button) {
      anchor.insertAdjacentElement("afterend", button);
    }
  });

  document.querySelectorAll(".termscope-policy-trigger").forEach((button) => {
    if (!liveKeys.has(button.dataset.termscopeCluster)) button.remove();
  });
}

function scheduleTriggerSync() {
  clearTimeout(triggerSyncTimer);
  triggerSyncTimer = setTimeout(() => {
    syncPolicyTriggers().catch(() => {});
  }, 300);
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
          <strong>TermScopeAI</strong>
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
  addEventListener("resize", scheduleFitWidgetToViewport);
  resetWidgetToBottomRight();
}

function setClauseMode(enabled) {
  createWidget();
  host.classList.toggle("termscope-clause-mode", Boolean(enabled));
  scheduleFitWidgetToViewport();
}

function showWidget() {
  createWidget();
  host.classList.remove("termscope-hidden");
  scheduleFitWidgetToViewport();
}

function closeWidget() {
  host?.classList.add("termscope-hidden");
}

function setBody(html) {
  showWidget();
  const body = host.querySelector("#termscope-body");
  body.innerHTML = html;
  body.scrollTop = 0;
  scheduleFitWidgetToViewport();
}

function resetWidgetToBottomRight() {
  if (!host) return;

  userPositionedThisPage = false;
  host.classList.remove("termscope-user-positioned");
  host.style.setProperty("left", "auto", "important");
  host.style.setProperty("top", "auto", "important");
  host.style.setProperty("right", `${innerWidth <= 520 ? 8 : 18}px`, "important");
  host.style.setProperty("bottom", `${innerWidth <= 520 ? 8 : 18}px`, "important");
  scheduleFitWidgetToViewport();
}

function fitWidgetToViewport() {
  viewportFitFrame = null;
  if (!host || host.classList.contains("termscope-hidden")) return;

  const margin = innerWidth <= 520 ? 8 : 18;
  const availableHeight = Math.max(180, innerHeight - margin * 2);
  host.style.setProperty("--termscope-available-height", `${availableHeight}px`);

  if (!userPositionedThisPage) {
    host.classList.remove("termscope-user-positioned");
    host.style.setProperty("left", "auto", "important");
    host.style.setProperty("top", "auto", "important");
    host.style.setProperty("right", `${margin}px`, "important");
    host.style.setProperty("bottom", `${margin}px`, "important");
    return;
  }

  const rect = host.getBoundingClientRect();
  const width = Math.min(rect.width || 390, Math.max(120, innerWidth - margin * 2));
  const height = Math.min(rect.height || 160, availableHeight);
  const left = Math.max(margin, Math.min(rect.left, innerWidth - width - margin));
  const top = Math.max(margin, Math.min(rect.top, innerHeight - height - margin));

  host.classList.add("termscope-user-positioned");
  host.style.setProperty("left", `${left}px`, "important");
  host.style.setProperty("top", `${top}px`, "important");
  host.style.setProperty("right", "auto", "important");
  host.style.setProperty("bottom", "auto", "important");
}

function scheduleFitWidgetToViewport() {
  if (viewportFitFrame !== null) cancelAnimationFrame(viewportFitFrame);
  viewportFitFrame = requestAnimationFrame(() => {
    viewportFitFrame = requestAnimationFrame(fitWidgetToViewport);
  });
}

function enableDragging() {
  const handle = host.querySelector("#termscope-drag-handle");
  let drag = null;

  handle.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;

    const rect = host.getBoundingClientRect();
    userPositionedThisPage = true;
    host.classList.add("termscope-user-positioned");
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

    host.classList.add("termscope-user-positioned");
    host.style.setProperty("left", `${left}px`, "important");
    host.style.setProperty("top", `${top}px`, "important");
    host.style.setProperty("right", "auto", "important");
    host.style.setProperty("bottom", "auto", "important");
  });

  handle.addEventListener("pointerup", (event) => {
    if (!drag) return;

    drag = null;
    handle.releasePointerCapture(event.pointerId);
    fitWidgetToViewport();
  });
}

function destroyClauseNavigator() {
  if (clauseNavigator?.scrollHandler) {
    removeEventListener("scroll", clauseNavigator.scrollHandler, true);
  }

  clauseNavigator = null;
  clearClauseHighlights();
}

function openWidget() {
  destroyClauseNavigator();
  resetWidgetToBottomRight();
  setClauseMode(false);
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

function fallbackActionForRisk(risk = {}) {
  const text = normalize(
    [
      risk.title,
      risk.shortSummary,
      risk.plainMeaning,
      risk.whyItMatters,
      risk.quote
    ].join(" ")
  ).toLowerCase();

  if (/biometric|facial recognition|voiceprint|fingerprint/.test(text)) {
    return "Avoid enabling biometric features unless they are necessary. Use another sign in method when available, and delete stored biometric data through the account or privacy settings if the service allows it.";
  }

  if (/precise location|geolocation|location data/.test(text)) {
    return "Turn off precise location access unless the feature truly needs it. Choose approximate location or a one time browser permission when those options are available.";
  }

  if (/targeted advert|personalized advert|tracking|cookie|analytics/.test(text)) {
    return "Review the privacy and cookie controls, turn off personalized advertising where available, and limit optional tracking permissions in your browser or device settings.";
  }

  if (/sell|sale of personal|share|third part|disclos/.test(text)) {
    return "Use the service's privacy controls to limit sharing where available, opt out of targeted advertising or data sales, and avoid providing optional personal information.";
  }

  if (/retain|retention|delete|deletion/.test(text)) {
    return "Check the account and privacy settings for deletion controls, download anything you need first, and contact support if the policy does not clearly explain when retained data is removed.";
  }

  if (/arbitration|class action|jury trial|dispute/.test(text)) {
    return "Read the dispute section before accepting, look for any opt out deadline, and save a copy of the terms if you decide to opt out.";
  }

  if (/automatic renewal|auto.?renew|subscription|refund|nonrefundable|charge/.test(text)) {
    return "Check the renewal date, cancellation steps, and refund rules before paying. Set a reminder before the next charge so you have time to cancel.";
  }

  if (/license|ownership|content|intellectual property|sublicens/.test(text)) {
    return "Only upload content you are comfortable licensing under these terms, remove sensitive files, and keep your own backup of anything important.";
  }

  if (/artificial intelligence|machine learning|train.*(?:model|ai)/.test(text)) {
    return "Avoid submitting sensitive or proprietary content, check for an AI training opt out, and remove earlier uploads when the service provides that control.";
  }

  if (/terminate|termination|suspend|suspension|account access/.test(text)) {
    return "Keep backups of important content, follow the account rules, and do not rely on this service as the only place where your files or records are stored.";
  }

  return "Review this clause before accepting, check whether the service provides an opt out or related setting, and avoid providing optional information until you are comfortable with the tradeoff.";
}

function normalizedActionForRisk(risk = {}) {
  const action = normalize(risk.action);
  const invalid =
    action.length < 18 ||
    /^(?:high|medium|low|none|n\/?a|not applicable|unknown)$/i.test(action) ||
    /^(?:severity|risk level)\s*:?\s*(?:high|medium|low)$/i.test(action);

  return invalid ? fallbackActionForRisk(risk) : action;
}

function normalizeRiskResult(risk = {}) {
  const severity = ["high", "medium", "low"].includes(risk.severity)
    ? risk.severity
    : "medium";

  return {
    ...risk,
    severity,
    action: normalizedActionForRisk({ ...risk, severity })
  };
}

function normalizeAnalysisResult(result = {}) {
  const risks = Array.isArray(result.risks)
    ? result.risks.map(normalizeRiskResult)
    : [];
  const storedRating = Number(result.policyRating);
  const policyRating = risks.length || result.scoringVersion === "7.0"
    ? calculateRating(risks)
    : Number.isFinite(storedRating)
      ? storedRating
      : calculateRating(risks);

  return {
    ...result,
    risks,
    policyRating,
    ratingLabel: ratingLabel(policyRating),
    scoringVersion: "7.0",
    analysisVersion: result.analysisVersion || "legacy"
  };
}

async function readSavedRatings() {
  const response = await chrome.runtime.sendMessage({
    type: "TERMSCOPE_GET_LIBRARY"
  });

  return response?.ok ? response.library || {} : {};
}

function savedItemFor(library, policy) {
  const direct = library[policyKey(policy)];
  if (direct) return direct;

  return Object.values(library).find(
    (item) =>
      policySiteKey(item) === policySiteKey(policy) &&
      item?.type === policy?.type
  );
}

function isCurrentSavedAnalysis(item) {
  return item?.scoringVersion === "7.0" && Array.isArray(item.risks);
}

function cacheLibraryItems(library, choices) {
  for (const policy of choices) {
    const item = savedItemFor(library, policy);
    if (!isCurrentSavedAnalysis(item)) continue;

    analysisCache.set(policyKey(policy), normalizeAnalysisResult(item));
  }
}

function ratingChipHtml(rating, state = "ready") {
  if (state === "checking") {
    return `<span class="termscope-mini-rating checking">Checking</span>`;
  }

  if (state === "unavailable") {
    return `<span class="termscope-mini-rating unavailable">Unavailable</span>`;
  }

  return `<span class="termscope-mini-rating ${ratingClass(rating)}">${rating}/10</span>`;
}

function sortPolicyList(list) {
  const buttons = [...list.querySelectorAll(".termscope-policy-choice")];

  buttons
    .sort((a, b) => {
      const aRating = Number(a.dataset.rating);
      const bRating = Number(b.dataset.rating);
      const aFinite = Number.isFinite(aRating);
      const bFinite = Number.isFinite(bRating);

      if (aFinite && bFinite) return aRating - bRating;
      if (aFinite) return -1;
      if (bFinite) return 1;
      return 0;
    })
    .forEach((button) => list.appendChild(button));
}

function updatePickerRating(policy, result, sessionId) {
  if (!host || currentView !== "picker" || sessionId !== pickerSession) return;

  const key = policyKey(policy);
  const button = [...host.querySelectorAll(".termscope-policy-choice")].find(
    (candidate) => candidate.dataset.policyKey === key
  );

  if (!button) return;

  const right = button.querySelector(".termscope-policy-choice-right");

  if (result) {
    const normalized = normalizeAnalysisResult(result);
    button.dataset.rating = String(normalized.policyRating);
    right.innerHTML = `${ratingChipHtml(normalized.policyRating)}<span class="termscope-chevron">›</span>`;
  } else {
    delete button.dataset.rating;
    right.innerHTML = `${ratingChipHtml(null, "unavailable")}<span class="termscope-chevron">›</span>`;
  }

  sortPolicyList(button.closest(".termscope-policy-list"));
}

function updatePickerProgress(completed, total, sessionId) {
  if (!host || currentView !== "picker" || sessionId !== pickerSession) return;

  const status = host.querySelector("#termscope-preview-status");
  if (!status) return;

  if (!total) {
    status.textContent = "Ratings are ready. The lowest scores appear first.";
    status.classList.add("ready");
    return;
  }

  if (completed >= total) {
    status.textContent = "Ratings are ready. The lowest scores appear first.";
    status.classList.add("ready");
  } else {
    status.textContent = `Checking ratings ${completed} of ${total}`;
  }
}

async function runWithConcurrency(items, limit, worker) {
  let cursor = 0;

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index], index);
      }
    }
  );

  await Promise.all(runners);
}

async function preloadPolicyRatings(choices, library, sessionId) {
  const missing = choices
    .filter(
      (policy) =>
        !isCurrentSavedAnalysis(savedItemFor(library, policy)) &&
        !analysisCache.has(policyKey(policy))
    )
    .slice(0, MAX_PREVIEW_POLICIES);

  let completed = 0;
  updatePickerProgress(completed, missing.length, sessionId);

  if (!missing.length) return;

  await runWithConcurrency(missing, PREVIEW_CONCURRENCY, async (policy) => {
    try {
      const result = await getPolicyAnalysis(policy);
      updatePickerRating(policy, result, sessionId);
    } catch {
      updatePickerRating(policy, null, sessionId);
    } finally {
      completed += 1;
      updatePickerProgress(completed, missing.length, sessionId);
    }
  });

  syncPolicyTriggers().catch(() => {});
}

async function renderPolicyPicker() {
  destroyClauseNavigator();
  setClauseMode(false);
  currentView = "picker";
  currentClauseRequest = null;
  pickerSession += 1;
  const sessionId = pickerSession;

  const choices = collectPolicies();
  const library = await readSavedRatings();
  cacheLibraryItems(library, choices);

  if (!choices.length) {
    setBody(`
      <div class="termscope-empty-state">
        <div class="termscope-empty-icon">${shieldSvg}</div>
        <h2>No policies found</h2>
        <p>TermScopeAI could not find a Terms of Use or Privacy Policy link on this page.</p>
      </div>
    `);
    return;
  }

  const grouped = groupPolicies(choices);

  const renderGroup = (title, items) => {
    if (!items.length) return "";

    const sorted = [...items].sort((a, b) => {
      const aRating = analysisCache.get(policyKey(a))?.policyRating;
      const bRating = analysisCache.get(policyKey(b))?.policyRating;
      const aFinite = Number.isFinite(aRating);
      const bFinite = Number.isFinite(bRating);
      if (aFinite && bFinite) return aRating - bRating;
      if (aFinite) return -1;
      if (bFinite) return 1;
      return 0;
    });

    return `
      <section class="termscope-policy-group">
        <div class="termscope-group-title">
          <h3>${escapeHtml(title)}</h3>
          <span>${items.length}</span>
        </div>

        <div class="termscope-policy-list">
          ${sorted
            .map((item) => {
              const cached = analysisCache.get(policyKey(item));
              const savedRating = cached?.policyRating;

              return `
                <button
                  class="termscope-policy-choice"
                  data-policy-key="${escapeHtml(policyKey(item))}"
                  data-policy-url="${escapeHtml(item.url)}"
                  data-policy-type="${escapeHtml(item.type)}"
                  ${Number.isFinite(savedRating) ? `data-rating="${savedRating}"` : ""}
                  type="button"
                >
                  <span class="termscope-policy-source">
                    <strong>${escapeHtml(item.sourceName)}</strong>
                    <small>${escapeHtml(item.hostname || item.label)}</small>
                  </span>

                  <span class="termscope-policy-choice-right">
                    ${
                      Number.isFinite(savedRating)
                        ? ratingChipHtml(savedRating)
                        : ratingChipHtml(null, "checking")
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
        <p>TermScopeAI checks the ratings first so you can open the most concerning policy.</p>
        <div class="termscope-preview-status" id="termscope-preview-status">Checking ratings</div>
      </div>
    </div>

    ${renderGroup("Terms of Use", grouped.terms)}
    ${renderGroup("Privacy Policies", grouped.privacy)}

    <button class="termscope-library-link" id="termscope-picker-library" type="button">
      ${librarySvg}
      Open Policy Library
    </button>
  `);

  host.querySelectorAll(".termscope-policy-list").forEach(sortPolicyList);

  host
    .querySelectorAll(".termscope-policy-choice")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const selected = choices.find(
          (item) => policyKey(item) === button.dataset.policyKey
        );

        if (selected) analyzePolicies([selected]);
      });
    });

  host
    .querySelector("#termscope-picker-library")
    .addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "TERMSCOPE_OPEN_LIBRARY" });
    });

  preloadPolicyRatings(choices, library, sessionId).catch(() => {});
}

function extractRelevantText(text, maxChars = 18000) {
  const cleaned = String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length <= maxChars) return cleaned;

  const keywords = [
    /sell|sale of personal|share.{0,30}(data|information)|third part/i,
    /track|advertis|analytics|cookie|device identifier|location|biometric/i,
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

  if (output.length < Math.min(5000, maxChars)) {
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

async function saveAnalysisToLibrary(policy, result) {
  const normalized = normalizeAnalysisResult(result);
  const response = await chrome.runtime.sendMessage({
    type: "TERMSCOPE_SAVE_LIBRARY",
    item: {
      url: policy.url,
      type: policy.type,
      label: policy.label,
      sourceName: policy.sourceName,
      hostname: policy.hostname,
      siteKey: policy.siteKey || policySiteKey(policy),
      policyRating: normalized.policyRating,
      ratingLabel: normalized.ratingLabel,
      overview: normalized.overview,
      risks: normalized.risks,
      scoringVersion: normalized.scoringVersion,
      analysisVersion: normalized.analysisVersion,
      analyzedAt: Date.now()
    }
  });

  return response?.ok ? response.item : normalized;
}

async function getPolicyAnalysis(policy) {
  const key = policyKey(policy);

  if (analysisCache.has(key)) return analysisCache.get(key);
  if (analysisJobs.has(key)) return analysisJobs.get(key);

  const job = (async () => {
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

    const normalized = normalizeAnalysisResult(response.result);
    const saved = await saveAnalysisToLibrary(policy, normalized);
    const finalResult = normalizeAnalysisResult(saved);
    analysisCache.set(key, finalResult);
    return finalResult;
  })();

  analysisJobs.set(key, job);

  try {
    return await job;
  } finally {
    analysisJobs.delete(key);
  }
}

async function analyzePolicies(selected) {
  const policy = selected[0];
  if (!policy) return;

  destroyClauseNavigator();
  setClauseMode(false);
  lastSelectedPolicies = [policy];
  currentPolicy = policy;
  currentAnalysis = null;
  currentView = "loading";

  const cached = analysisCache.get(policyKey(policy));

  if (cached) {
    renderResults(cached, policy);
    return;
  }

  setBody(`
    ${backButtonHtml()}
    <div class="termscope-status">
      <div class="termscope-spinner"></div>
      <strong>Finishing the ${escapeHtml(policyTypeLabel(policy.type))} review</strong>
      <p>TermScopeAI is checking the most important clauses and calculating the rating.</p>
    </div>
  `);

  host.querySelector("#termscope-back-btn").addEventListener("click", renderPolicyPicker);

  try {
    const result = await getPolicyAnalysis(policy);
    currentAnalysis = result;
    renderResults(result, policy);
  } catch (error) {
    renderError(error.message);
  }
}

function renderResults(result, policy = currentPolicy) {
  destroyClauseNavigator();
  setClauseMode(false);
  currentView = "results";
  currentAnalysis = normalizeAnalysisResult(result);
  currentPolicy = policy;

  const risks = currentAnalysis.risks;
  const rating = currentAnalysis.policyRating;
  const colorClass = ratingClass(rating);

  setBody(`
    ${backButtonHtml()}

    <div class="termscope-result-head">
      <div class="termscope-result-title">
        <span class="termscope-eyebrow">${escapeHtml(
          policyTypeLabel(policy?.type)
        )}</span>
        <h2>${escapeHtml(policy?.sourceName || currentAnalysis.title || "Policy review")}</h2>
        <p>${escapeHtml(currentAnalysis.overview || "")}</p>
      </div>

      <div class="termscope-rating-wrap">
        <div class="termscope-rating-circle ${colorClass}">
          <strong>${escapeHtml(rating)}</strong>
          <span>out of 10</span>
        </div>
        <small>${escapeHtml(currentAnalysis.ratingLabel)}</small>
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
                  <article class="termscope-risk ${escapeHtml(risk.severity || "medium")}">
                    <div class="termscope-risk-top">
                      <h3>${escapeHtml(risk.title || "Potential concern")}</h3>
                      <span class="termscope-severity ${escapeHtml(
                        risk.severity || "medium"
                      )}">${escapeHtml(risk.severity || "medium")}</span>
                    </div>

                    <p class="termscope-short-summary">${escapeHtml(
                      risk.shortSummary || risk.plainMeaning || ""
                    )}</p>

                    ${
                      risk.plainMeaning
                        ? `<div class="termscope-risk-explanation"><strong>What it means</strong><p>${escapeHtml(
                            risk.plainMeaning
                          )}</p></div>`
                        : ""
                    }

                    ${
                      risk.whyItMatters
                        ? `<div class="termscope-risk-explanation"><strong>Why it matters</strong><p>${escapeHtml(
                            risk.whyItMatters
                          )}</p></div>`
                        : ""
                    }

                    ${
                      risk.action
                        ? `<div class="termscope-risk-explanation termscope-action"><strong>What you can do</strong><p>${escapeHtml(
                            risk.action
                          )}</p></div>`
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
                            Read this clause with guided summaries
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
            <p>The AI did not identify a material concern in your selected categories. It can still miss context.</p>
          </div>
        `
    }

    <div class="termscope-saved-note">
      ${librarySvg}
      This review was saved to your Policy Library
    </div>

    <div class="termscope-disclaimer">
      AI can make mistakes. TermScopeAI is informational and is not legal advice.
    </div>
  `);

  host.querySelector("#termscope-back-btn").addEventListener("click", renderPolicyPicker);

  host.querySelectorAll(".termscope-view-clause").forEach((button) => {
    button.addEventListener("click", async () => {
      const activeIndex = Number(button.dataset.riskIndex);

      await chrome.runtime.sendMessage({
        type: "TERMSCOPE_OPEN_CLAUSE",
        clauses: risks,
        activeIndex,
        policyRating: rating,
        ratingLabel: currentAnalysis.ratingLabel,
        policySourceName: policy?.sourceName,
        policyType: policy?.type
      });
    });
  });
}

function renderError(message) {
  destroyClauseNavigator();
  setClauseMode(false);
  currentView = "error";

  setBody(`
    ${backButtonHtml()}

    <div class="termscope-error">
      <strong>TermScopeAI could not finish the analysis.</strong>
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

  if (settingsReturnView === "clause" && currentClauseRequest && clauseNavigator) {
    activateClauseIndex(clauseNavigator.activeIndex, { scroll: false });
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
      <p class="termscope-muted">Choose what TermScopeAI focuses on.</p>

      <label class="termscope-setting">
        <span>
          Show one policy shield
          <small>Display one shield for all Terms and Privacy links on a page</small>
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

    analysisCache.clear();
    await chrome.storage.sync.set({ settings });
    await syncPolicyTriggers();
    returnFromSettings();
  });
}

function normalizeForSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function significantWords(value) {
  const ignored = new Set([
    "the", "and", "that", "this", "with", "from", "your", "you", "for",
    "are", "may", "will", "our", "their", "have", "not", "but", "can",
    "any", "all", "such", "when", "where", "into", "than", "then"
  ]);

  return normalizeForSearch(value)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !ignored.has(word));
}

function visibleTextNode(node) {
  const element = node.parentElement;
  if (!element) return false;
  if (element.closest("script,style,noscript,textarea,input,mark.termscope-highlight,#termscope-widget-host")) {
    return false;
  }

  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function collectSearchRoots() {
  const roots = [document];
  const queue = [document.documentElement];

  while (queue.length) {
    const node = queue.shift();
    if (!node?.querySelectorAll) continue;

    for (const element of node.querySelectorAll("*")) {
      if (element.shadowRoot) {
        roots.push(element.shadowRoot);
        queue.push(element.shadowRoot);
      }
    }
  }

  return roots;
}

function queryAcrossRoots(selector) {
  const results = [];

  for (const root of collectSearchRoots()) {
    results.push(...root.querySelectorAll(selector));
  }

  return results;
}

function quoteCandidates(quote) {
  const normalized = normalizeForSearch(quote);
  const sentences = normalized
    .split(/(?<=[.!?;])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 45)
    .sort((a, b) => b.length - a.length);

  return [
    normalized,
    ...sentences,
    normalized.slice(0, 300),
    normalized.slice(0, 220),
    normalized.slice(0, 150),
    normalized.slice(0, 95)
  ].filter((value, index, array) => value.length >= 35 && array.indexOf(value) === index);
}

function findBestClauseElement(quote) {
  const candidates = quoteCandidates(quote);
  const quoteWords = new Set(significantWords(quote));
  const elements = queryAcrossRoots(
    "p, li, blockquote, dd, dt, td, th, section, article, [role='main'] div, main div, [data-testid]"
  );

  let best = null;

  for (const element of elements) {
    if (element.closest?.("#termscope-widget-host")) continue;

    const text = normalizeForSearch(element.innerText || element.textContent);
    if (text.length < 35 || text.length > 7000) continue;

    let score = 0;
    let candidate = "";

    for (const option of candidates) {
      if (text.includes(option)) {
        const exactScore = 1000 + option.length * 2 - Math.min(text.length, 5000) / 20;
        if (exactScore > score) {
          score = exactScore;
          candidate = option;
        }
      }
    }

    if (!score && quoteWords.size >= 5) {
      const textWords = new Set(significantWords(text));
      let overlap = 0;

      for (const word of quoteWords) {
        if (textWords.has(word)) overlap += 1;
      }

      const ratio = overlap / quoteWords.size;
      if (ratio >= 0.62) {
        score = ratio * 500 - Math.min(text.length, 5000) / 35;
        candidate = candidates[candidates.length - 1];
      }
    }

    if (score && (!best || score > best.score)) {
      best = { element, candidate, score, textLength: text.length };
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

  return { text: text.trim(), map };
}

function markTextInsideElement(element, candidate) {
  if (!candidate) return null;

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

  queryAcrossRoots("mark.termscope-highlight").forEach((mark) => {
    const parent = mark.parentNode;
    mark.replaceWith(...mark.childNodes);
    parent?.normalize?.();
  });

  queryAcrossRoots(".termscope-clause-block-highlight").forEach((element) => {
    element.classList.remove(
      "termscope-clause-block-highlight",
      "termscope-highlight-fading"
    );
    if (element.id === "termscope-highlight-target") element.removeAttribute("id");
  });
}

function highlightClauseMatch(match, scroll = false) {
  clearClauseHighlights();
  if (!match?.element?.isConnected) return null;

  const mark = markTextInsideElement(match.element, match.candidate);
  const target = mark || match.element;

  if (!mark) {
    match.element.classList.add("termscope-clause-block-highlight");
    match.element.id = "termscope-highlight-target";
  }

  if (scroll) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return target;
}

function clauseProgressText(index, total) {
  return total > 1 ? `Clause ${index + 1} of ${total}` : "Selected clause";
}

function renderClauseDetail(request, located, index = 0, total = 1) {
  currentView = "clause";
  currentClauseRequest = request;
  setClauseMode(true);

  const canPrevious = index > 0;
  const canNext = index < total - 1;

  setBody(`
    <div class="termscope-clause-progress">
      <span>${escapeHtml(clauseProgressText(index, total))}</span>
      ${
        total > 1
          ? `<small>Scroll the policy and the summary follows the closest reviewed clause.</small>`
          : ""
      }
    </div>

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
          <div class="termscope-detail-card termscope-action-card ${escapeHtml(
            request.severity || "medium"
          )}">
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
      ${located ? "Jump to this clause" : "Try to find this clause again"}
    </button>

    ${
      total > 1
        ? `
          <div class="termscope-clause-nav">
            <button id="termscope-prev-clause" type="button" ${canPrevious ? "" : "disabled"}>
              ${previousSvg} Previous
            </button>
            <button id="termscope-next-clause" type="button" ${canNext ? "" : "disabled"}>
              Next ${nextSvg}
            </button>
          </div>
        `
        : ""
    }

    ${
      located
        ? ""
        : `<p class="termscope-locator-status missing">The page may still be loading or may use a protected format that cannot be matched automatically.</p>`
    }
  `);

  host.querySelector("#termscope-jump-clause").addEventListener("click", () => {
    if (!clauseNavigator) return;
    activateClauseIndex(clauseNavigator.activeIndex, { scroll: true, forceFind: true });
  });

  host.querySelector("#termscope-prev-clause")?.addEventListener("click", () => {
    activateClauseIndex(index - 1, { scroll: true });
  });

  host.querySelector("#termscope-next-clause")?.addEventListener("click", () => {
    activateClauseIndex(index + 1, { scroll: true });
  });
}

function nearestClauseIndex() {
  if (!clauseNavigator) return -1;

  const viewportCenter = innerHeight / 2;
  let best = { index: -1, distance: Infinity };

  clauseNavigator.matches.forEach((match, index) => {
    const element = match?.element;
    if (!element?.isConnected) return;

    const rect = element.getBoundingClientRect();
    const center = rect.top + Math.min(rect.height, innerHeight) / 2;
    const distance = Math.abs(center - viewportCenter);

    if (distance < best.distance) best = { index, distance };
  });

  return best.index;
}

function setupClauseScrollTracking() {
  if (!clauseNavigator) return;

  let scheduled = false;

  clauseNavigator.scrollHandler = () => {
    if (scheduled || clauseNavigator?.ignoreScrollUntil > Date.now()) return;
    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      const nearest = nearestClauseIndex();

      if (nearest >= 0 && nearest !== clauseNavigator?.activeIndex) {
        activateClauseIndex(nearest, { scroll: false, fromScroll: true });
      }
    });
  };

  addEventListener("scroll", clauseNavigator.scrollHandler, true);
}

function activateClauseIndex(index, options = {}) {
  if (!clauseNavigator) return;

  const bounded = Math.max(0, Math.min(index, clauseNavigator.clauses.length - 1));
  const clause = clauseNavigator.clauses[bounded];

  if (!clause) return;

  clauseNavigator.activeIndex = bounded;

  if (options.forceFind || !clauseNavigator.matches[bounded]?.element?.isConnected) {
    clauseNavigator.matches[bounded] = findBestClauseElement(clause.quote);
  }

  const match = clauseNavigator.matches[bounded];
  const target = match ? highlightClauseMatch(match, Boolean(options.scroll)) : null;

  if (options.scroll) {
    clauseNavigator.ignoreScrollUntil = Date.now() + 1300;
  }

  renderClauseDetail(
    clause,
    Boolean(target || match),
    bounded,
    clauseNavigator.clauses.length
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findClauseMatches(clauses) {
  const matches = Array(clauses.length).fill(null);

  for (let attempt = 0; attempt < 18; attempt += 1) {
    let remaining = 0;

    clauses.forEach((clause, index) => {
      if (matches[index]?.element?.isConnected) return;
      matches[index] = findBestClauseElement(clause.quote);
      if (!matches[index]) remaining += 1;
    });

    if (!remaining) break;
    await delay(attempt < 5 ? 350 : 650);
  }

  return matches;
}

async function loadClauseRequest(requestId) {
  if (!requestId) return false;
  if (activeClauseRequestId === requestId && clauseNavigator) return true;
  if (activeClauseRequestId === requestId && clauseLoadPromise) {
    return clauseLoadPromise;
  }

  activeClauseRequestId = requestId;
  clauseLoadPromise = (async () => {
    const key = `highlight:${requestId}`;
    const stored = await chrome.storage.local.get(key);
    const request = stored[key];

    const clauses = Array.isArray(request?.clauses)
      ? request.clauses.filter((clause) => clause?.quote)
      : request?.quote
        ? [request]
        : [];

    if (!clauses.length) {
      activeClauseRequestId = "";
      return false;
    }

    resetWidgetToBottomRight();
    showWidget();
    setClauseMode(true);
    currentClauseRequest = clauses[0];
    renderClauseDetail(clauses[0], false, 0, clauses.length);

    const matches = await findClauseMatches(clauses);
    const activeIndex = Math.max(
      0,
      Math.min(Number(request.activeIndex) || 0, clauses.length - 1)
    );

    clauseNavigator = {
      clauses,
      matches,
      activeIndex,
      ignoreScrollUntil: 0,
      scrollHandler: null
    };

    activateClauseIndex(activeIndex, { scroll: true });
    setupClauseScrollTracking();
    scheduleFitWidgetToViewport();
    return true;
  })();

  try {
    return await clauseLoadPromise;
  } finally {
    if (activeClauseRequestId === requestId) clauseLoadPromise = null;
  }
}

async function highlightRequestedClause() {
  const match = location.hash.match(/(?:^|[&#])termscope=([a-f0-9-]+)/i);
  if (!match) return;
  await loadClauseRequest(match[1]);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "TERMSCOPE_TOGGLE") {
    createWidget();

    if (host.classList.contains("termscope-hidden")) {
      openWidget();
    } else {
      closeWidget();
    }
    return;
  }

  if (message.type === "TERMSCOPE_LOAD_CLAUSE") {
    loadClauseRequest(message.requestId)
      .then((loaded) => sendResponse({ ok: loaded }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.storage.sync.get("settings").then(({ settings: stored }) => {
  settings = {
    ...DEFAULT_SETTINGS,
    ...(stored || {})
  };

  syncPolicyTriggers().catch(() => {});

  const observer = new MutationObserver((mutations) => {
    const changedOutsideWidget = mutations.some((mutation) => {
      const target = mutation.target instanceof Element
        ? mutation.target
        : mutation.target?.parentElement;
      return !target?.closest?.("#termscope-widget-host");
    });

    if (changedOutsideWidget) scheduleTriggerSync();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  highlightRequestedClause().catch(() => {});
});
