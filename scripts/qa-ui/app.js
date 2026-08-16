const STORAGE_KEY = "muzeSuggestionLab.customProfiles.v1";
const DRAFT_KEY = "muzeSuggestionLab.lastDraft.v1";

const sectionIcons = { books: "📚", movies: "🎬", series: "📺", music: "🎵" };
const state = {
  presets: [],
  customProfiles: [],
  selectedId: "",
  selectedIsCustom: false,
  activeSection: "all",
  activeLang: "all",
  results: [],
  evaluations: {},
  controller: null,
  running: false,
  expectedCount: 0,
};

const elements = {};

function $(id) {
  return document.getElementById(id);
}

function lines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueId(prefix = "custom") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function slugify(value) {
  const latin = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return latin || uniqueId("profile");
}

function cloneProfile(profile) {
  return JSON.parse(JSON.stringify(profile));
}

function readCustomProfiles() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeCustomProfiles() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.customProfiles));
}

function showToast(message, type = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`.trim();
  toast.textContent = message;
  elements.toastRegion.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function profileDirection(lang) {
  return lang === "fa" ? "rtl" : "ltr";
}

function getAllProfiles() {
  return [
    ...state.presets.map((profile) => ({ ...profile, custom: false })),
    ...state.customProfiles.map((profile) => ({ ...profile, custom: true })),
  ];
}

function getSelectedProfile() {
  return getAllProfiles().find((profile) => profile.id === state.selectedId) || null;
}

function currentDraft() {
  const section = document.querySelector('input[name="section"]:checked')?.value || "books";
  const lang = document.querySelector('input[name="lang"]:checked')?.value || "fa";
  return {
    id: elements.profileId.value.trim() || slugify(elements.profileLabel.value),
    label: elements.profileLabel.value.trim() || "Untitled profile",
    section,
    lang,
    userText: elements.userText.value.trim(),
    favorites: lines(elements.favorites.value),
    rejected: lines(elements.rejected.value),
    liked: lines(elements.liked.value),
    watchlist: lines(elements.watchlist.value),
  };
}

function saveDraftLocally() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(currentDraft()));
  } catch {
    // Draft persistence is optional.
  }
}

function updateTextDirection(lang) {
  const direction = profileDirection(lang);
  for (const field of [elements.userText, elements.favorites, elements.rejected, elements.liked, elements.watchlist]) {
    field.dir = direction;
  }
}

function fillEditor(profile, { isCustom = false } = {}) {
  const copy = cloneProfile(profile);
  state.selectedId = copy.id;
  state.selectedIsCustom = isCustom;
  elements.profileLabel.value = copy.label || "";
  elements.profileId.value = copy.id || "";
  elements.userText.value = copy.userText || "";
  elements.favorites.value = (copy.favorites || []).join("\n");
  elements.rejected.value = (copy.rejected || []).join("\n");
  elements.liked.value = (copy.liked || []).join("\n");
  elements.watchlist.value = (copy.watchlist || []).join("\n");
  document.querySelector(`input[name="section"][value="${copy.section}"]`).checked = true;
  document.querySelector(`input[name="lang"][value="${copy.lang}"]`).checked = true;
  elements.editorTitle.textContent = copy.label || "Untitled profile";
  elements.editorSubtitle.textContent = isCustom
    ? "Custom profile saved in this browser."
    : "Built-in starter profile. Edit freely or save a custom copy.";
  elements.deleteProfileButton.classList.toggle("hidden", !isCustom);
  updateTextDirection(copy.lang);
  updateCounts();
  renderProfileList();
  saveDraftLocally();
}

function createBlankProfile() {
  return {
    id: uniqueId("custom"),
    label: "New test profile",
    section: "music",
    lang: "fa",
    userText: "",
    favorites: [],
    rejected: [],
    liked: [],
    watchlist: [],
  };
}

function matchesFilters(profile) {
  const query = elements.profileSearch.value.trim().toLowerCase();
  const haystack = `${profile.id} ${profile.label} ${profile.section} ${profile.lang}`.toLowerCase();
  return (!query || haystack.includes(query))
    && (state.activeSection === "all" || profile.section === state.activeSection)
    && (state.activeLang === "all" || profile.lang === state.activeLang);
}

function renderProfileGroup(container, label, profiles) {
  if (!profiles.length) return;
  const heading = document.createElement("div");
  heading.className = "profile-group-label";
  heading.textContent = label;
  container.appendChild(heading);

  for (const profile of profiles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `profile-card ${profile.id === state.selectedId ? "active" : ""}`.trim();
    button.innerHTML = `
      <span class="profile-icon">${sectionIcons[profile.section] || "✦"}</span>
      <span class="profile-copy">
        <span class="profile-name" dir="${profileDirection(profile.lang)}">${escapeHtml(profile.label)}</span>
        <span class="profile-meta">${profile.section} · ${(profile.favorites || []).length} favorites</span>
      </span>
      <span class="profile-lang">${profile.lang}</span>
    `;
    button.addEventListener("click", () => fillEditor(profile, { isCustom: Boolean(profile.custom) }));
    container.appendChild(button);
  }
}

function renderProfileList() {
  const builtIn = state.presets.filter(matchesFilters);
  const custom = state.customProfiles.filter(matchesFilters).map((profile) => ({ ...profile, custom: true }));
  elements.profileList.innerHTML = "";
  renderProfileGroup(elements.profileList, "Built-in", builtIn);
  renderProfileGroup(elements.profileList, "My profiles", custom);
  elements.profileCount.textContent = String(builtIn.length + custom.length);

  if (!builtIn.length && !custom.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.marginTop = "28px";
    empty.innerHTML = "<p>No profiles match these filters.</p>";
    elements.profileList.appendChild(empty);
  }
}

function updateCounts() {
  const count = lines(elements.favorites.value).length;
  elements.favoritesCount.textContent = `${count} item${count === 1 ? "" : "s"}`;
  const lang = document.querySelector('input[name="lang"]:checked')?.value || "en";
  updateTextDirection(lang);
  saveDraftLocally();
}

function saveCustomProfile() {
  const profile = currentDraft();
  if (!profile.favorites.length) {
    showToast("Add at least one favorite first.", "error");
    elements.favorites.focus();
    return;
  }

  const existingIndex = state.selectedIsCustom
    ? state.customProfiles.findIndex((item) => item.id === state.selectedId)
    : state.customProfiles.findIndex((item) => item.id === profile.id);
  const conflictsWithPreset = state.presets.some((item) => item.id === profile.id);
  const conflictsWithCustom = state.customProfiles.some((item, index) => (
    item.id === profile.id && index !== existingIndex
  ));
  if (conflictsWithPreset || conflictsWithCustom) profile.id = uniqueId(`${profile.id}-copy`);

  if (existingIndex >= 0) state.customProfiles[existingIndex] = profile;
  else state.customProfiles.push(profile);
  writeCustomProfiles();
  fillEditor(profile, { isCustom: true });
  showToast("Custom profile saved in this browser.");
}

function duplicateProfile() {
  const profile = currentDraft();
  profile.id = uniqueId(`${slugify(profile.label)}-copy`);
  profile.label = `${profile.label} copy`;
  fillEditor(profile, { isCustom: false });
  showToast("Profile duplicated. Save it when ready.");
}

function deleteCustomProfile() {
  if (!state.selectedIsCustom) return;
  const profile = getSelectedProfile();
  if (!profile || !window.confirm(`Delete “${profile.label}” from this browser?`)) return;
  state.customProfiles = state.customProfiles.filter((item) => item.id !== profile.id);
  writeCustomProfiles();
  const fallback = state.presets[0] || createBlankProfile();
  fillEditor(fallback, { isCustom: false });
  showToast("Custom profile deleted.");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setRunning(running) {
  state.running = running;
  elements.runButton.disabled = running;
  elements.cancelButton.classList.toggle("hidden", !running);
  elements.runProgress.classList.toggle("hidden", !running);
  for (const input of elements.profileForm.querySelectorAll("input, textarea")) input.disabled = running;
  elements.saveProfileButton.disabled = running;
  elements.duplicateButton.disabled = running;
}

function updateProgress() {
  const completed = state.results.length;
  const total = state.expectedCount || 1;
  const percentage = Math.min(100, (completed / total) * 100);
  elements.progressBar.style.width = `${percentage}%`;
  elements.progressTitle.textContent = completed
    ? `Completed ${completed} of ${total}`
    : "Running profile…";
  elements.progressSubtitle.textContent = completed
    ? "Waiting for the next suggestion"
    : "Waiting for the first result";
}

function updateMetrics() {
  const completed = state.results.length;
  const successful = state.results.filter((result) => result.ok).length;
  const average = completed
    ? state.results.reduce((sum, result) => sum + Number(result.elapsedMs || 0), 0) / completed
    : 0;
  elements.metricCompleted.textContent = String(completed);
  elements.metricSuccess.textContent = completed ? `${Math.round((successful / completed) * 100)}%` : "—";
  elements.metricTime.textContent = completed ? `${(average / 1000).toFixed(1)}s` : "—";
  const successfulResults = state.results.filter((result) => result.ok);
  const languagePasses = successfulResults.filter((result) => result.quality?.displayLanguagePass).length;
  elements.metricLanguage.textContent = successfulResults.length
    ? `${Math.round((languagePasses / successfulResults.length) * 100)}%`
    : "—";
  const creators = new Set(successfulResults.map((result) => (
    result.sourceArtist || result.sourceAuthor || result.sourceCreator || ""
  )).filter(Boolean).map((value) => value.toLowerCase()));
  elements.metricCreators.textContent = successfulResults.length
    ? `${creators.size}/${successfulResults.length}`
    : "—";
  elements.exportButton.disabled = !completed;
  elements.clearResultsButton.disabled = !completed;
  elements.emptyState.classList.toggle("hidden", completed > 0);
  updateProgress();
}

function resultEvaluationKey(result) {
  return `${result.preset}:${result.iteration}:${result.title || result.reason}`;
}

function renderResults() {
  elements.resultList.innerHTML = "";
  state.results.forEach((result, index) => {
    const card = document.createElement("article");
    card.className = `result-card ${result.ok ? "" : "failed"}`.trim();
    const source = [result.sourceTitle, result.sourceArtist || result.sourceAuthor || result.sourceCreator].filter(Boolean).join(" — ");
    const evaluation = state.evaluations[resultEvaluationKey(result)] || "";
    card.innerHTML = `
      <div class="result-card-header">
        <div class="result-status">
          <span class="result-index">${index + 1}</span>
          <strong>${result.ok ? "Suggestion ready" : "Suggestion failed"} · ${escapeHtml(result.variant || "full-account")}</strong>
        </div>
        <span class="result-time">${(Number(result.elapsedMs || 0) / 1000).toFixed(1)}s</span>
      </div>
      <div class="result-body">
        ${result.ok
          ? `<pre class="result-message" dir="${profileDirection(result.lang)}">${escapeHtml(result.displayMessage || result.title)}</pre>`
          : `<div class="failure-copy">${escapeHtml(result.reason || "missing_result")}${result.qualityIssue ? ` · ${escapeHtml(result.qualityIssue)}` : ""}</div>`}
        ${source && elements.verboseToggle.checked ? `<div class="source-box">Source: ${escapeHtml(source)}</div>` : ""}
      </div>
      <div class="result-footer">
        <div class="rating-group">
          <button class="mini-button ${evaluation === "good" ? "selected good" : ""}" data-rate="good" type="button">Good</button>
          <button class="mini-button ${evaluation === "bad" ? "selected bad" : ""}" data-rate="bad" type="button">Bad</button>
        </div>
        <button class="mini-button" data-copy type="button">Copy name</button>
      </div>
    `;
    card.querySelector("[data-copy]").addEventListener("click", async () => {
      await navigator.clipboard.writeText(result.copyText || result.title || "");
      showToast("Search name copied, matching the bot.");
    });
    for (const button of card.querySelectorAll("[data-rate]")) {
      button.addEventListener("click", () => {
        const key = resultEvaluationKey(result);
        const value = button.dataset.rate;
        state.evaluations[key] = state.evaluations[key] === value ? "" : value;
        renderResults();
      });
    }
    elements.resultList.appendChild(card);
  });
  updateMetrics();
}

function appendResult(result) {
  state.results.push(result);
  renderResults();
}

async function parseNdjson(response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with status ${response.status}.`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const rows = buffer.split("\n");
    buffer = rows.pop() || "";
    for (const row of rows) {
      if (!row.trim()) continue;
      const event = JSON.parse(row);
      if (event.type === "result") appendResult(event.result);
      else if (event.type === "error") throw new Error(event.error || "Run failed.");
    }
  }
}

async function runProfile() {
  if (state.running) return;
  const scenario = currentDraft();
  if (!scenario.favorites.length) {
    showToast("Add at least one favorite first.", "error");
    elements.favorites.focus();
    return;
  }
  const count = Math.min(20, Math.max(1, Number.parseInt(elements.runCount.value, 10) || 1));
  elements.runCount.value = String(count);
  state.results = [];
  state.evaluations = {};
  const variantCount = elements.variantsToggle.checked
    ? 1 + (scenario.favorites.length > 3 ? 1 : 0) + (scenario.favorites.length > 5 ? 1 : 0)
      + ((scenario.watchlist.length || scenario.rejected.length || scenario.liked.length) ? 1 : 0)
    : 1;
  state.expectedCount = count * variantCount;
  renderResults();
  setRunning(true);
  updateProgress();
  state.controller = new AbortController();

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario,
        count,
        mood: scenario.userText,
        rejected: scenario.rejected,
        liked: scenario.liked,
        verbose: elements.verboseToggle.checked,
        runVariants: elements.variantsToggle.checked,
      }),
      signal: state.controller.signal,
    });
    await parseNdjson(response);
  } catch (error) {
    if (error.name !== "AbortError") showToast(error.message || "The run failed.", "error");
  } finally {
    state.controller = null;
    setRunning(false);
    elements.progressBar.style.width = state.results.length ? "100%" : "0%";
    elements.progressTitle.textContent = state.results.length ? "Run complete" : "Run stopped";
    elements.progressSubtitle.textContent = `${state.results.length} result${state.results.length === 1 ? "" : "s"}`;
    window.setTimeout(() => {
      if (!state.running) elements.runProgress.classList.add("hidden");
    }, 1200);
  }
}

function cancelRun() {
  state.controller?.abort();
}

function clearResults() {
  state.results = [];
  state.evaluations = {};
  renderResults();
}

function exportResults() {
  const profile = currentDraft();
  const payload = {
    exportedAt: new Date().toISOString(),
    profile,
    results: state.results.map((result) => ({
      ...result,
      evaluation: state.evaluations[resultEvaluationKey(result)] || "",
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(profile.id || profile.label)}-results.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function bindElements() {
  const ids = [
    "connectionPill", "connectionText", "newProfileButton", "profileCount", "profileSearch", "profileList",
    "editorTitle", "editorSubtitle", "duplicateButton", "saveProfileButton", "deleteProfileButton", "profileForm",
    "profileLabel", "profileId", "userText", "favorites", "rejected", "liked", "watchlist", "favoritesCount",
    "decreaseCount", "increaseCount", "runCount", "verboseToggle", "variantsToggle", "cancelButton", "runButton", "exportButton",
    "clearResultsButton", "metricCompleted", "metricSuccess", "metricTime", "metricLanguage", "metricCreators", "runProgress", "progressTitle",
    "progressSubtitle", "progressBar", "emptyState", "resultList", "toastRegion",
  ];
  for (const id of ids) elements[id] = $(id);
}

function bindEvents() {
  elements.profileSearch.addEventListener("input", renderProfileList);
  document.querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", () => {
    state.activeSection = button.dataset.section;
    document.querySelectorAll("[data-section]").forEach((item) => item.classList.toggle("active", item === button));
    renderProfileList();
  }));
  document.querySelectorAll("[data-lang]").forEach((button) => button.addEventListener("click", () => {
    state.activeLang = button.dataset.lang;
    document.querySelectorAll("[data-lang]").forEach((item) => item.classList.toggle("active", item === button));
    renderProfileList();
  }));
  elements.newProfileButton.addEventListener("click", () => fillEditor(createBlankProfile(), { isCustom: false }));
  elements.duplicateButton.addEventListener("click", duplicateProfile);
  elements.saveProfileButton.addEventListener("click", saveCustomProfile);
  elements.deleteProfileButton.addEventListener("click", deleteCustomProfile);
  elements.favorites.addEventListener("input", updateCounts);
  for (const input of elements.profileForm.querySelectorAll("input, textarea")) {
    input.addEventListener("input", saveDraftLocally);
    input.addEventListener("change", updateCounts);
  }
  elements.decreaseCount.addEventListener("click", () => {
    elements.runCount.value = String(Math.max(1, Number(elements.runCount.value || 1) - 1));
  });
  elements.increaseCount.addEventListener("click", () => {
    elements.runCount.value = String(Math.min(20, Number(elements.runCount.value || 1) + 1));
  });
  elements.runButton.addEventListener("click", runProfile);
  elements.cancelButton.addEventListener("click", cancelRun);
  elements.clearResultsButton.addEventListener("click", clearResults);
  elements.exportButton.addEventListener("click", exportResults);
  elements.verboseToggle.addEventListener("change", renderResults);
}

async function initialize() {
  bindElements();
  bindEvents();
  state.customProfiles = readCustomProfiles();

  try {
    const [presetResponse, healthResponse] = await Promise.all([
      fetch("/api/presets"),
      fetch("/api/health"),
    ]);
    const presetBody = await presetResponse.json();
    const healthBody = await healthResponse.json();
    state.presets = presetBody.presets || [];
    elements.connectionPill.classList.add(healthBody.apiConfigured ? "ready" : "warning");
    const modelSummary = healthBody.models?.main
      ? ` · ${healthBody.models.main}${healthBody.models.fast && healthBody.models.fast !== healthBody.models.main ? ` → ${healthBody.models.fast}` : ""}`
      : "";
    elements.connectionText.textContent = healthBody.apiConfigured
      ? `Local · API ready${modelSummary}`
      : "Local · add API key";

    let initial = null;
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (draft?.favorites?.length) initial = draft;
    } catch {
      // Use the first preset when no valid draft exists.
    }
    initial ||= state.presets[0] || createBlankProfile();
    const isCustom = state.customProfiles.some((profile) => profile.id === initial.id);
    fillEditor(initial, { isCustom });
  } catch (error) {
    elements.connectionPill.classList.add("warning");
    elements.connectionText.textContent = "Server unavailable";
    showToast(error.message || "Could not load the QA dashboard.", "error");
  }
}

document.addEventListener("DOMContentLoaded", initialize);
