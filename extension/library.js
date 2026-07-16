const grid = document.querySelector("#policy-grid");
const emptyState = document.querySelector("#empty-state");
const summaryRow = document.querySelector("#summary-row");
const template = document.querySelector("#policy-card-template");
const searchInput = document.querySelector("#search");
const typeFilter = document.querySelector("#type-filter");
const favoriteFilter = document.querySelector("#favorite-filter");
const sortSelect = document.querySelector("#sort");

let library = {};

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

function libraryIdentityKey(item = {}) {
  const siteKey =
    item.siteKey || siteKeyFromHostname(hostnameFromItem(item)) || "website";
  const type = item.type === "privacy" ? "privacy" : "terms";
  return `${String(siteKey).toLowerCase()}:${type}`;
}

function brandFromHostname(hostname) {
  const siteKey = siteKeyFromHostname(hostname);
  const first = siteKey.split(".")[0] || "Website";
  return first.charAt(0).toUpperCase() + first.slice(1);
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
  let score = 0;

  if (isPrimaryPolicyLabel(label, type)) score += 120;
  if (label.length > 0 && label.length <= 36) score += 15;
  if (Array.isArray(item.risks) && item.risks.length) score += 10;
  if (isSupplementaryPolicyLabel(label)) score -= 180;
  if (/privacy/.test(label) && /terms/.test(label)) score -= 200;

  return score;
}

function choosePreferredItem(first, second) {
  if (!first) return second;
  if (!second) return first;

  const firstScore = libraryItemScore(first);
  const secondScore = libraryItemScore(second);

  if (firstScore !== secondScore) {
    return firstScore > secondScore ? first : second;
  }

  return Number(first.analyzedAt || 0) >= Number(second.analyzedAt || 0)
    ? first
    : second;
}

function deduplicatedLibraryItems(source) {
  const unique = new Map();

  for (const item of Object.values(source || {})) {
    if (!item?.url) continue;

    const hostname = hostnameFromItem(item);
    const normalized = {
      ...item,
      hostname,
      siteKey: item.siteKey || siteKeyFromHostname(hostname),
      sourceName: brandFromHostname(hostname)
    };
    const key = libraryIdentityKey(normalized);
    unique.set(key, choosePreferredItem(unique.get(key), normalized));
  }

  return [...unique.values()];
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

function normalizedRating(item) {
  if (Array.isArray(item?.risks)) return calculateRating(item.risks);
  const stored = Number(item?.policyRating);
  return Number.isFinite(stored) ? stored : null;
}

function ratingClass(rating) {
  if (rating >= 8) return "good";
  if (rating >= 5) return "mixed";
  return "poor";
}

function policyTypeLabel(type) {
  return type === "terms" ? "Terms of Use" : "Privacy Policy";
}

function formatDate(value) {
  if (!value) return "Unknown date";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function countsForRisks(risks = []) {
  return risks.reduce(
    (counts, risk) => {
      const severity = ["high", "medium", "low"].includes(risk?.severity)
        ? risk.severity
        : "medium";
      counts[severity] += 1;
      return counts;
    },
    { high: 0, medium: 0, low: 0 }
  );
}

function filteredItems() {
  const query = searchInput.value.trim().toLowerCase();
  const type = typeFilter.value;
  const favorites = favoriteFilter.value;
  const sort = sortSelect.value;

  const items = deduplicatedLibraryItems(library)
    .map((item) => ({
      ...item,
      policyRating: normalizedRating(item)
    }))
    .filter((item) => {
      const searchText = [item.sourceName, item.hostname, item.label, item.url]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (query && !searchText.includes(query)) return false;
      if (type !== "all" && item.type !== type) return false;
      if (favorites === "favorites" && !item.favorite) return false;
      return true;
    });

  items.sort((a, b) => {
    const aRating = Number.isFinite(a.policyRating) ? a.policyRating : 10;
    const bRating = Number.isFinite(b.policyRating) ? b.policyRating : 10;

    if (sort === "rating-asc") return aRating - bRating;
    if (sort === "recent") return (b.analyzedAt || 0) - (a.analyzedAt || 0);
    if (sort === "name") {
      return String(a.sourceName || "").localeCompare(String(b.sourceName || ""));
    }

    return bRating - aRating;
  });

  return items;
}

function renderSummary(items) {
  const total = items.length;
  const favorites = items.filter((item) => item.favorite).length;
  const validRatings = items
    .map((item) => Number(item.policyRating))
    .filter(Number.isFinite);
  const average = validRatings.length
    ? Math.round(
        (validRatings.reduce((sum, rating) => sum + rating, 0) /
          validRatings.length) *
          10
      ) / 10
    : 0;
  const concerning = validRatings.filter((rating) => rating < 5).length;

  summaryRow.innerHTML = `
    <article class="summary-card"><strong>${total}</strong><span>Policies shown</span></article>
    <article class="summary-card"><strong>${average}</strong><span>Average rating out of 10</span></article>
    <article class="summary-card"><strong>${favorites}</strong><span>Favorites</span></article>
    <article class="summary-card"><strong>${concerning}</strong><span>Concerning policies</span></article>
  `;
}

function renderRiskDetails(container, risks = []) {
  if (!risks.length) {
    container.innerHTML = `<p class="risk-item">No major concerns were saved for this policy.</p>`;
    return;
  }

  container.innerHTML = risks
    .map(
      (risk) => `
        <article class="risk-item">
          <strong>${escapeHtml(risk.title || "Potential concern")}</strong>
          <p>${escapeHtml(
            risk.shortSummary || risk.plainMeaning || risk.explanation || ""
          )}</p>
        </article>
      `
    )
    .join("");
}

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

async function toggleFavorite(item) {
  const response = await chrome.runtime.sendMessage({
    type: "TERMSCOPE_TOGGLE_FAVORITE",
    url: item.url
  });

  if (response?.ok) {
    library[libraryIdentityKey(response.item)] = response.item;
    render();
  }
}

async function removeItem(item) {
  const confirmed = confirm(
    `Remove ${item.sourceName || "this policy"} from your library?`
  );
  if (!confirmed) return;

  const response = await chrome.runtime.sendMessage({
    type: "TERMSCOPE_REMOVE_LIBRARY",
    url: item.url
  });

  if (response?.ok) {
    delete library[libraryIdentityKey(item)];
    render();
  }
}

function createCard(item) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".policy-card");
  const rating = Number.isFinite(item.policyRating) ? item.policyRating : 10;
  const counts = countsForRisks(item.risks);

  fragment.querySelector(".policy-type").textContent = policyTypeLabel(item.type);
  fragment.querySelector(".company-name").textContent =
    item.sourceName || brandFromHostname(hostnameFromItem(item));
  fragment.querySelector(".hostname").textContent = item.hostname || item.url;
  fragment.querySelector(".rating-value").textContent = rating;
  fragment.querySelector(".overview").textContent =
    item.overview || "No overview was saved for this policy.";
  fragment.querySelector(".reviewed-date").textContent =
    `Analyzed ${formatDate(item.analyzedAt)}`;

  const ratingCircle = fragment.querySelector(".rating-circle");
  ratingCircle.classList.add(ratingClass(rating));

  const riskSummary = fragment.querySelector(".risk-summary");
  riskSummary.innerHTML = `
    <span class="risk-count high">${counts.high} high</span>
    <span class="risk-count medium">${counts.medium} medium</span>
    <span class="risk-count low">${counts.low} low</span>
  `;

  renderRiskDetails(fragment.querySelector(".risk-list"), item.risks);

  const favoriteButton = fragment.querySelector(".favorite-button");
  favoriteButton.textContent = item.favorite ? "★ Favorited" : "☆ Favorite";
  favoriteButton.addEventListener("click", () => toggleFavorite(item));

  fragment.querySelector(".open-button").addEventListener("click", () => {
    chrome.tabs.create({ url: item.url });
  });

  fragment.querySelector(".remove-button").addEventListener("click", () => {
    removeItem(item);
  });

  card.dataset.url = item.url;
  return fragment;
}

function render() {
  const items = filteredItems();
  grid.innerHTML = "";

  renderSummary(items);

  for (const item of items) {
    grid.appendChild(createCard(item));
  }

  emptyState.hidden = items.length > 0;
}

async function loadLibrary() {
  const response = await chrome.runtime.sendMessage({
    type: "TERMSCOPE_GET_LIBRARY"
  });

  library = response?.ok ? response.library || {} : {};
  render();
}

[searchInput, typeFilter, favoriteFilter, sortSelect].forEach((control) => {
  control.addEventListener("input", render);
  control.addEventListener("change", render);
});

loadLibrary();
