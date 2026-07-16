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
      const severity = ["high", "medium", "low"].includes(risk.severity)
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

  const items = Object.values(library).filter((item) => {
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
    if (sort === "rating-asc") {
      return (a.policyRating ?? 10) - (b.policyRating ?? 10);
    }

    if (sort === "recent") {
      return (b.analyzedAt || 0) - (a.analyzedAt || 0);
    }

    if (sort === "name") {
      return String(a.sourceName || "").localeCompare(String(b.sourceName || ""));
    }

    return (b.policyRating ?? 10) - (a.policyRating ?? 10);
  });

  return items;
}

function renderSummary(items) {
  const total = items.length;
  const favorites = items.filter((item) => item.favorite).length;
  const average = total
    ? Math.round(
        (items.reduce((sum, item) => sum + Number(item.policyRating || 0), 0) /
          total) *
          10
      ) / 10
    : 0;
  const concerning = items.filter((item) => Number(item.policyRating) < 5).length;

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
    library[canonicalUrl(item.url)] = response.item;
    render();
  }
}

async function removeItem(item) {
  const confirmed = confirm(`Remove ${item.sourceName || "this policy"} from your library?`);
  if (!confirmed) return;

  const response = await chrome.runtime.sendMessage({
    type: "TERMSCOPE_REMOVE_LIBRARY",
    url: item.url
  });

  if (response?.ok) {
    delete library[canonicalUrl(item.url)];
    render();
  }
}

function createCard(item) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".policy-card");
  const rating = Number.isFinite(item.policyRating) ? item.policyRating : 10;
  const counts = countsForRisks(item.risks);

  fragment.querySelector(".policy-type").textContent = policyTypeLabel(item.type);
  fragment.querySelector(".company-name").textContent = item.sourceName || "Website";
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
