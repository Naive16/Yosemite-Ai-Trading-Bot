const viewMeta = {
  overview: ["Control room", "Overview"],
  markets: ["Markets / watchlist", "Markets"],
  chart: ["Chart / analysis", "Chart & analysis"],
  approvals: ["Decision queue", "Pending approvals"],
  positions: ["Exposure", "Open positions"],
  history: ["Record", "Trade history"],
  risk: ["Policy configuration", "Risk settings"],
  health: ["Operations", "System health"],
  audit: ["Traceability", "Audit history"],
  backtest: ["Historical lab", "Backtesting"],
  paper: ["Simulation", "Paper trading"]
};

const appShell = document.querySelector("#app-shell");
const pageTitle = document.querySelector("#page-title");
const pageKicker = document.querySelector("#page-kicker");
const mainContent = document.querySelector("#main-content");
const mobileMenuButton = document.querySelector("#mobile-menu-button");
const sidebar = document.querySelector("#sidebar");
const connectionStatus = document.querySelector("#connection-status");
const healthGrid = document.querySelector("#health-grid");
const lastHealthCheck = document.querySelector("#last-health-check");
const marketState = { symbol: "EUR/USD", timeframe: "M15", quotes: new Map(), requestId: 0, aiRequestId: 0 };

function setView(view) {
  if (!viewMeta[view]) return;
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  pageKicker.textContent = viewMeta[view][0];
  pageTitle.textContent = viewMeta[view][1];
  closeMobileNavigation();
  mainContent.focus({ preventScroll: true });
}

function closeMobileNavigation() {
  sidebar.classList.remove("is-mobile-open");
  mobileMenuButton.setAttribute("aria-expanded", "false");
  mobileMenuButton.setAttribute("aria-label", "Open navigation");
}

function toggleMobileNavigation() {
  const isOpen = sidebar.classList.toggle("is-mobile-open");
  mobileMenuButton.setAttribute("aria-expanded", String(isOpen));
  mobileMenuButton.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
}

function showAuthenticatedApp() {
  marketState.quotes.clear();
  document.querySelector("#proposal-list")?.replaceChildren();
  document.querySelector("#approval-count")?.replaceChildren(document.createTextNode("Checking proposals"));
  setMarketUnavailable("Loading protected market data.");
  appShell.hidden = false;
  setView("overview");
  loadRuntimeStatus();
  loadRiskStatus();
  loadProposals();
  loadSimulationStatus();
  loadMarketSnapshot();
}

function updateClock() {
  const now = new Date();
  const time = `UTC ${now.toISOString().slice(11, 19)}`;
  document.querySelector("#footer-clock").textContent = time;
  document.querySelector("#footer-clock-bottom").textContent = time;
}

function setConnectionStatus(kind, label) {
  const safeKind = ["green", "amber", "muted", "red"].includes(kind) ? kind : "muted";
  connectionStatus.innerHTML = `<span class="status-dot status-dot--${safeKind}"></span><span>${label}</span>`;
}

function setHealthCard(index, kind, label) {
  const card = healthGrid?.querySelectorAll(".health-card")[index];
  if (!card) return;
  const chip = card.querySelector(".status-chip");
  chip.className = `status-chip status-chip--${kind}`;
  chip.textContent = label;
}

function setOverviewHealth(index, kind, label) {
  const row = document.querySelector("#overview-health-list")?.querySelectorAll(".health-row")[index];
  if (!row) return;
  const dot = row.querySelector(".status-dot");
  dot.className = `status-dot status-dot--${kind}`;
  row.querySelector("strong").textContent = label;
}

function ensureOperationsSummary() {
  let summary = document.querySelector("#ops-summary");
  if (summary) return summary;
  const panel = document.querySelector("[data-view-panel=health] .health-detail-panel");
  if (!panel) return null;
  summary = document.createElement("div");
  summary.id = "ops-summary";
  summary.className = "detail-list";
  summary.setAttribute("aria-live", "polite");
  const title = document.createElement("p");
  title.className = "eyebrow";
  title.textContent = "Operational diagnostics";
  summary.append(title);
  for (const [key, label] of [["marketData", "Market data"], ["worker", "Worker heartbeat"], ["reconciliation", "Reconciliation"], ["risk", "Risk readiness"]]) {
    const row = document.createElement("div");
    row.dataset.opsKey = key;
    const name = document.createElement("span"); name.textContent = label;
    const value = document.createElement("strong"); value.textContent = "Unknown";
    row.append(name, value); summary.append(row);
  }
  panel.append(summary);
  return summary;
}

async function readJson(url, options = {}) {
  try {
    const response = await fetch(url, { ...options, headers: { Accept: "application/json", ...(options.headers || {}) }, credentials: "omit", cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } catch (error) {
    return { response: new Response(null, { status: 503 }), data: { status: "unavailable", message: "The requested service is unavailable. Try again shortly." } };
  }
}

async function loadRuntimeStatus() {
  setConnectionStatus("amber", "Checking services");
  try {
    const health = await readJson("/api/health", { headers: { Accept: "application/json" } });
    if (health.response.ok && health.data.status === "ok") {
      setHealthCard(0, "green", "Operational");
      setOverviewHealth(0, "green", "Operational");
      const marketDataStatus = health.data.services?.marketData || "not_configured";
      setHealthCard(2, marketDataStatus === "not_configured" ? "muted" : "amber", marketDataStatus === "not_configured" ? "Not configured" : "Configured");
      setOverviewHealth(2, marketDataStatus === "not_configured" ? "muted" : "amber", marketDataStatus === "not_configured" ? "Not configured" : "Configured");
      setHealthCard(3, "muted", "Not configured");
      setOverviewHealth(3, "muted", "Not configured");
      document.querySelector("#data-mode-status").textContent = marketDataStatus === "not_configured" ? "No market data" : "Market data configured";
    } else {
      setHealthCard(0, "red", "Unavailable");
      setOverviewHealth(0, "red", "Unavailable");
    }

    const protectedStatus = await readJson("/api/private/status", { headers: { Accept: "application/json" } });
    if (protectedStatus.response.ok) {
      setHealthCard(1, "green", "Connected");
      setOverviewHealth(1, "green", "Connected");
      setConnectionStatus("green", "Protected services online");
    } else if (protectedStatus.response.status === 503) {
      setHealthCard(1, "amber", "Unavailable");
      setOverviewHealth(1, "amber", "Unavailable");
      setConnectionStatus("amber", protectedStatus.data.message || "Protected services unavailable");
    } else {
      setHealthCard(1, "muted", "Unknown");
      setOverviewHealth(1, "muted", "Unknown");
      setConnectionStatus("amber", "Limited service state");
    }
    const checkedAt = health.data.checkedAt ? new Date(health.data.checkedAt) : new Date();
    lastHealthCheck.textContent = Number.isNaN(checkedAt.getTime()) ? "—" : checkedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
    const operations = await readJson("/api/private/operations", { headers: { Accept: "application/json" } });
    if (operations.response.status === 503) {
      const services = operations.data.services || {};
      const stateLabel = (name) => services[name]?.state ? services[name].state.replaceAll("_", " ") : "unknown";
      const summary = ensureOperationsSummary();
      for (const key of ["marketData", "worker", "reconciliation", "risk"]) summary?.querySelector(`[data-ops-key="${key}"] strong`)?.replaceChildren(document.createTextNode(stateLabel(key)));
    } else if (operations.response.ok) {
      const services = operations.data.services || {};
      const stateLabel = (name) => services[name]?.state ? services[name].state.replaceAll("_", " ") : "unknown";
      const summary = ensureOperationsSummary();
      for (const key of ["marketData", "worker", "reconciliation", "risk"]) summary?.querySelector(`[data-ops-key="${key}"] strong`)?.replaceChildren(document.createTextNode(stateLabel(key)));
    }
  } catch {
    setConnectionStatus("amber", "Service status unavailable");
    setHealthCard(0, "amber", "Unavailable");
    setOverviewHealth(0, "amber", "Unavailable");
    lastHealthCheck.textContent = "Unavailable";
  }
}

async function loadRiskStatus() {
  const state = document.querySelector("#risk-evaluation-state");
  try {
    const result = await readJson("/api/private/risk", { headers: { Accept: "application/json" } });
    if (!result.response.ok || result.data.evaluation?.decision === "BLOCKED") {
      if (state) { state.textContent = "BLOCKED"; state.className = "state-chip state-chip--amber"; }
      document.querySelector("#risk-engine-status")?.replaceChildren(document.createTextNode("Risk evaluation BLOCKED"));
      document.querySelector("#risk-engine-message")?.replaceChildren(document.createTextNode(result.data.message || "Trusted account and exposure state is unavailable."));
      return;
    }
    const decision = result.data.evaluation?.decision || "BLOCKED";
    if (state) { state.textContent = decision; state.className = `state-chip state-chip--${decision === "PASS" ? "green" : decision === "REJECT" ? "red" : "amber"}`; }
    document.querySelector("#risk-engine-status")?.replaceChildren(document.createTextNode(`Risk evaluation ${decision}`));
    document.querySelector("#risk-engine-message")?.replaceChildren(document.createTextNode("PASS is validation only; it is not approval or authorization."));
  } catch {
    if (state) { state.textContent = "BLOCKED"; state.className = "state-chip state-chip--amber"; }
  }
}

function proposalText(value) { return value == null || value === "" ? "—" : String(value); }

function renderProposals(proposals) {
  const list = document.querySelector("#proposal-list"); const empty = document.querySelector("#proposal-empty-state"); const count = document.querySelector("#approval-count");
  if (!list || !empty || !count) return;
  list.replaceChildren(); count.textContent = `${proposals.length} pending`;
  if (!proposals.length) { list.hidden = true; empty.hidden = false; return; }
  empty.hidden = true; list.hidden = false;
  proposals.forEach((proposal) => {
    const content = proposal.immutableContent || {}; const card = document.createElement("article"); card.className = "proposal-card";
    const heading = document.createElement("h3"); heading.textContent = `${proposalText(content.symbol)} · ${proposalText(content.direction)}`; card.append(heading);
    const details = document.createElement("p"); details.textContent = `Version ${proposal.proposalVersion} · ${proposal.status} · expires ${formatTimestamp(content.expiresAt)}`; card.append(details);
    const evidence = document.createElement("p"); evidence.textContent = `Risk: ${proposalText(content.risk?.decision)} · Reasons: ${(content.risk?.reasonCodes || []).join(", ") || "none"} · Digest: ${proposalText(proposal.contentDigest).slice(0, 16)}…`; card.append(evidence);
    const review = document.createElement("label"); const checkbox = document.createElement("input"); checkbox.type = "checkbox"; review.append(checkbox, document.createTextNode(" I reviewed this exact immutable proposal version.")); card.append(review);
    const actions = document.createElement("div"); actions.className = "intro-actions"; const approve = document.createElement("button"); approve.className = "button button--primary"; approve.type = "button"; approve.textContent = "Approve exact proposal"; approve.disabled = proposal.status !== "pending_approval" || content.risk?.decision !== "PASS"; const reject = document.createElement("button"); reject.className = "button button--quiet"; reject.type = "button"; reject.textContent = "Reject proposal"; reject.disabled = proposal.status !== "pending_approval"; checkbox.addEventListener("change", () => { approve.disabled = !checkbox.checked || proposal.status !== "pending_approval" || content.risk?.decision !== "PASS"; });
    approve.addEventListener("click", () => submitProposalDecision(proposal, "approve", approve, reject)); reject.addEventListener("click", () => submitProposalDecision(proposal, "reject", approve, reject)); actions.append(approve, reject); card.append(actions); list.append(card);
  });
}

async function submitProposalDecision(proposal, action, approve, reject) {
  approve.disabled = true; reject.disabled = true;
  const result = await readJson("/api/private/proposals", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ action, proposalId: proposal.proposalId, proposalVersion: proposal.proposalVersion, contentDigest: proposal.contentDigest, ...(action === "reject" ? { reason: "Rejected during explicit user review" } : {}) }) });
  if (!result.response.ok) { document.querySelector("#proposal-empty-title").textContent = result.data.message || "Proposal decision unavailable"; document.querySelector("#proposal-empty-state").hidden = false; }
  await loadProposals();
}

async function loadProposals() {
  const result = await readJson("/api/private/proposals", { headers: { Accept: "application/json" } });
  if (!result.response.ok) { document.querySelector("#approval-count")?.replaceChildren(document.createTextNode("Unavailable")); document.querySelector("#proposal-empty-message")?.replaceChildren(document.createTextNode(result.data.message || "Proposal workflow is unavailable.")); return; }
  renderProposals(Array.isArray(result.data.proposals) ? result.data.proposals : []);
}

async function loadSimulationStatus() {
  const [backtest, paper] = await Promise.allSettled([readJson("/api/private/backtest", { headers: { Accept: "application/json" } }), readJson("/api/private/paper-trading", { headers: { Accept: "application/json" } })]);
  const backtestData = backtest.status === "fulfilled" ? backtest.value.data : {}; const paperData = paper.status === "fulfilled" ? paper.value.data : {};
  document.querySelector("#backtest-status")?.replaceChildren(document.createTextNode(backtestData.message || "Historical simulation unavailable"));
  document.querySelector("#paper-status")?.replaceChildren(document.createTextNode(paperData.message || "Paper simulation unavailable"));
}

function formatDataMode(mode) {
  return ({ live: "Provider-reported live", delayed: "Delayed", cached: "Cached", unavailable: "Unavailable" })[mode] || "Provider status unknown";
}

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

function setMarketBadge(element, kind, label) {
  if (!element) return;
  element.innerHTML = `<span class="status-dot status-dot--${kind}"></span><span>${label}</span>`;
}

function marketStatusKind(mode) {
  return mode === "live" ? "green" : mode === "delayed" || mode === "cached" ? "amber" : "muted";
}

function formatPrice(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(value >= 20 ? 4 : 5) : "—";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
}

function renderMarketCards() {
  document.querySelectorAll(".instrument-card").forEach((card) => {
    const quote = marketState.quotes.get(card.dataset.symbol);
    card.querySelector("[data-market-price]").textContent = quote ? formatPrice(quote.quote.price) : "—";
    const state = card.querySelector("[data-market-state]");
    state.textContent = quote ? `${formatDataMode(quote.dataMode)} · ${quote.quote.freshness.status}` : "Data unavailable";
  });
}

function renderMarketTable() {
  const body = document.querySelector("#market-table-body");
  if (!body) return;
  const rows = [...marketState.quotes.entries()].filter(([, value]) => value?.quote);
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6"><div class="empty-state empty-state--compact"><span class="empty-state-icon" aria-hidden="true">⌁</span><h3>No market observations available</h3><p id="market-status-message">Live market data is unavailable until a server-side provider is configured.</p><button class="button button--quiet" data-view-target="chart" type="button">Open chart workspace</button></div></td></tr>`;
    body.querySelector("[data-view-target]")?.addEventListener("click", () => setView("chart"));
    return;
  }
  body.innerHTML = rows.map(([symbol, value]) => {
    const quote = value.quote;
    return `<tr><td><strong>${escapeHtml(symbol)}</strong></td><td>${formatPrice(quote.price)}</td><td>${quote.bid == null ? "—" : `${formatPrice(quote.bid)} / ${formatPrice(quote.ask)}`}</td><td>${quote.spread == null ? "—" : formatPrice(quote.spread)}</td><td><span class="state-chip state-chip--${quote.freshness.status === "fresh" ? "green" : "muted"}">${escapeHtml(quote.freshness.status)}</span></td><td>${escapeHtml(formatTimestamp(quote.timestamp))}</td></tr>`;
  }).join("");
}

function renderChartEmpty(title, message) {
  const overlay = document.querySelector("#chart-empty-overlay");
  const svg = document.querySelector("#chart-svg");
  if (overlay) overlay.hidden = false;
  if (document.querySelector("#chart-empty-title")) document.querySelector("#chart-empty-title").textContent = title;
  if (document.querySelector("#chart-empty-message")) document.querySelector("#chart-empty-message").textContent = message;
  svg?.querySelectorAll("[data-candle]").forEach((element) => element.remove());
  document.querySelector("#chart-canvas")?.setAttribute("aria-label", `${title}. ${message}`);
}

function renderCandles(candles) {
  const svg = document.querySelector("#chart-svg");
  const overlay = document.querySelector("#chart-empty-overlay");
  if (!svg) return;
  svg.querySelectorAll("[data-candle]").forEach((element) => element.remove());
  if (!candles?.length) {
    renderChartEmpty("No validated candles", "The provider returned no candles for this symbol and timeframe.");
    return;
  }
  const width = 900;
  const height = 360;
  const left = 28;
  const right = 12;
  const top = 18;
  const bottom = 22;
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const range = Math.max(Math.max(...highs) - Math.min(...lows), Number.EPSILON);
  const y = (price) => top + ((Math.max(...highs) - price) / range) * (height - top - bottom);
  const step = (width - left - right) / candles.length;
  const candleWidth = Math.max(2, Math.min(12, step * 0.58));
  candles.forEach((candle, index) => {
    const x = left + step * index + step / 2;
    const wick = document.createElementNS("http://www.w3.org/2000/svg", "line");
    wick.setAttribute("x1", x); wick.setAttribute("x2", x); wick.setAttribute("y1", y(candle.high)); wick.setAttribute("y2", y(candle.low));
    wick.setAttribute("stroke", candle.close >= candle.open ? "#65d5a5" : "#f38d8d"); wick.setAttribute("stroke-width", "1"); wick.dataset.candle = "true"; svg.appendChild(wick);
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    const topPrice = Math.max(candle.open, candle.close);
    const bottomPrice = Math.min(candle.open, candle.close);
    rect.setAttribute("x", x - candleWidth / 2); rect.setAttribute("y", y(topPrice)); rect.setAttribute("width", candleWidth); rect.setAttribute("height", Math.max(1, y(bottomPrice) - y(topPrice)));
    rect.setAttribute("fill", candle.close >= candle.open ? "#65d5a5" : "#f38d8d"); rect.setAttribute("fill-opacity", ".78"); rect.dataset.candle = "true"; svg.appendChild(rect);
  });
  if (overlay) overlay.hidden = true;
  document.querySelector("#chart-canvas")?.setAttribute("aria-label", `Validated candlestick chart for ${marketState.symbol} ${marketState.timeframe}`);
}

function updateChartMeta(quote, candleResponse) {
  const freshness = candleResponse?.freshness?.status || "unknown";
  document.querySelector("#chart-freshness").textContent = freshness;
  document.querySelector("#chart-spread").textContent = quote?.quote?.spread == null ? "—" : formatPrice(quote.quote.spread);
  document.querySelector("#chart-updated").textContent = formatTimestamp(quote?.quote?.timestamp || candleResponse?.candles?.at(-1)?.timestamp);
  document.querySelector("#chart-data-quality").textContent = candleResponse?.qualityWarnings?.length ? "Gaps reported" : candleResponse ? "Validated" : "Unavailable";
}

function setMarketUnavailable(message = "Live market data is unavailable") {
  setMarketBadge(document.querySelector("#market-source-status"), "muted", "Data unavailable");
  document.querySelector("#market-state").textContent = "Unavailable";
  document.querySelector("#market-status-message")?.replaceChildren(document.createTextNode(message));
  renderChartEmpty("Market data unavailable", message);
  document.querySelector("#chart-source-status") && setMarketBadge(document.querySelector("#chart-source-status"), "muted", "Data unavailable");
  document.querySelector("#chart-freshness").textContent = "Unavailable";
  document.querySelector("#chart-spread").textContent = "—";
  document.querySelector("#chart-updated").textContent = "—";
  document.querySelector("#chart-data-quality").textContent = "Unavailable";
  setCandidateUnavailable(message);
  renderMarketCards();
  renderMarketTable();
}

function setCandidateUnavailable(message = "Candidate analysis is unavailable") {
  document.querySelector("#candidate-heading").textContent = "Candidate analysis unavailable";
  document.querySelector("#candidate-state").textContent = "Unavailable";
  document.querySelector("#candidate-direction").textContent = "NO TRADE";
  document.querySelector("#candidate-signal-state").textContent = "Not confirmed";
  document.querySelector("#candidate-strategy").textContent = "—";
  document.querySelector("#candidate-reference").textContent = "—";
  document.querySelector("#candidate-stop").textContent = "—";
  document.querySelector("#candidate-target").textContent = "—";
  document.querySelector("#candidate-rr").textContent = "—";
  document.querySelector("#candidate-expiry").textContent = "—";
  document.querySelector("#candidate-note").textContent = `${message}. No signal, approval, or execution is implied.`;
}

function setAiUnavailable(message = "AI analysis is temporarily unavailable") {
  document.querySelector("#ai-analysis-heading").textContent = "AI analysis unavailable";
  document.querySelector("#ai-analysis-state").textContent = "Unavailable — no current result";
  document.querySelector("#ai-recommendation").textContent = "NO TRADE";
  document.querySelector("#ai-model").textContent = "—";
  document.querySelector("#ai-summary").textContent = message;
  document.querySelector("#ai-supporting").textContent = "—";
  document.querySelector("#ai-opposing").textContent = "—";
  document.querySelector("#ai-news").textContent = "Unavailable; no verified feed configured.";
  document.querySelector("#ai-warnings").textContent = "—";
  document.querySelector("#ai-expiry").textContent = "—";
}

function renderAiAnalysis(data) {
  const analysis = data?.analysis;
  if (data?.status !== "ok" || !analysis || analysis.metadata?.status !== "analysis_only") { setAiUnavailable("AI analysis is temporarily unavailable; no current result is available."); return; }
  document.querySelector("#ai-analysis-heading").textContent = `${analysis.recommendation} · AI interpretation`;
  document.querySelector("#ai-analysis-state").textContent = "Analysis only";
  document.querySelector("#ai-recommendation").textContent = analysis.recommendation;
  document.querySelector("#ai-model").textContent = `${analysis.model?.id || "—"} · ${formatTimestamp(analysis.analysisTimestamp)}`;
  document.querySelector("#ai-summary").textContent = analysis.summary;
  document.querySelector("#ai-supporting").textContent = (analysis.supportingEvidence || []).join("; ") || "—";
  document.querySelector("#ai-opposing").textContent = (analysis.opposingEvidence || []).join("; ") || "—";
  const news = data.evidence?.news;
  document.querySelector("#ai-news").textContent = news?.status === "available" ? `${news.items.length} verified item(s); ${news.items.map((item) => `${item.source} ${formatTimestamp(item.publishedAt)}`).join("; ") || "no relevant event supplied"}` : "Unavailable; no verified feed configured.";
  document.querySelector("#ai-warnings").textContent = [...(analysis.uncertainties || []), ...(analysis.dataQualityWarnings || [])].join("; ") || "None reported";
  document.querySelector("#ai-expiry").textContent = formatTimestamp(analysis.expiry);
  document.querySelector("#ai-analysis-note").textContent = "AI output is a read-only interpretation of supplied evidence. It cannot approve or execute trades or authorize risk. Model output is not a calibrated probability.";
}

function renderCandidate(data) {
  const candidate = data?.candidate;
  if (!candidate) { setCandidateUnavailable(); return; }
  const isNoTrade = candidate.direction === "NO TRADE";
  document.querySelector("#candidate-heading").textContent = isNoTrade ? "No trade decision" : `Informational candidate`;
  document.querySelector("#candidate-state").textContent = isNoTrade ? "NO TRADE" : `Informational ${candidate.direction}`;
  document.querySelector("#candidate-direction").textContent = candidate.direction;
  document.querySelector("#candidate-signal-state").textContent = candidate.signalStatus || "Not confirmed";
  document.querySelector("#candidate-strategy").textContent = `${candidate.strategy?.name || "—"} · ${candidate.strategy?.version || "—"}`;
  document.querySelector("#candidate-reference").textContent = candidate.referencePrice ? `${formatPrice(candidate.referencePrice.value)} · ${formatTimestamp(candidate.referencePrice.timestamp)}` : "—";
  document.querySelector("#candidate-stop").textContent = candidate.stopLoss ? formatPrice(candidate.stopLoss.value) : "—";
  document.querySelector("#candidate-target").textContent = candidate.takeProfit ? formatPrice(candidate.takeProfit.value) : "—";
  document.querySelector("#candidate-rr").textContent = candidate.rewardRisk == null ? "—" : `${candidate.rewardRisk} : 1`;
  document.querySelector("#candidate-expiry").textContent = formatTimestamp(candidate.expiry);
  document.querySelector("#chart-data-quality").textContent = `${candidate.dataQuality?.status || "unavailable"}${candidate.dataQuality?.warnings?.length ? " · warnings" : ""}`;
  const reasons = (candidate.reasons || []).map((reason) => reason.message).join("; ");
  const counterconditions = (candidate.counterconditions || []).join("; ");
  const sourceLabel = `${data.source || "Unknown source"} · ${formatDataMode(data.dataMode || "unavailable")}`;
  document.querySelector("#candidate-note").textContent = `${sourceLabel}. ${reasons || "No valid setup conditions were found."}${counterconditions ? ` Counterconditions: ${counterconditions}` : ""} Candidate status is informational only; it is not approved or executable.`;
}

async function loadCandidateAnalysis() {
  const result = await readJson(`/api/private/strategy?symbol=${encodeURIComponent(marketState.symbol)}&timeframe=${encodeURIComponent(marketState.timeframe)}`, { headers: { Accept: "application/json" } });
  if (!result.response.ok) { setCandidateUnavailable(result.data.message || "Candidate analysis is unavailable"); return; }
  renderCandidate(result.data);
}

async function loadAiAnalysis() {
  const requestId = ++marketState.aiRequestId;
  setAiUnavailable("AI analysis is loading; no current result is available.");
  const result = await readJson(`/api/private/analysis?symbol=${encodeURIComponent(marketState.symbol)}&timeframe=${encodeURIComponent(marketState.timeframe)}`, { headers: { Accept: "application/json" } });
  if (requestId !== marketState.aiRequestId) return;
  if (!result.response.ok) { setAiUnavailable(result.data.message || "AI analysis is temporarily unavailable; no current result is available."); return; }
  renderAiAnalysis(result.data);
}

async function loadMarketQuote(symbol) {
  const result = await readJson(`/api/private/market-data?kind=quote&symbol=${encodeURIComponent(symbol)}`, { headers: { Accept: "application/json" } });
  if (!result.response.ok) return null;
  marketState.quotes.set(symbol, result.data);
  renderMarketCards();
  renderMarketTable();
  const mode = result.data.dataMode;
  setMarketBadge(document.querySelector("#market-source-status"), marketStatusKind(mode), `${result.data.source} · ${formatDataMode(mode)}`);
  document.querySelector("#market-state").textContent = result.data.quote.freshness.status;
  return result.data;
}

async function loadMarketCandles() {
  const requestId = ++marketState.requestId;
  const { symbol, timeframe } = marketState;
  renderChartEmpty("Loading validated candles", `Requesting ${symbol} ${timeframe} data from the configured server-side provider.`);
  const result = await readJson(`/api/private/market-data?kind=candles&symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=90`, { headers: { Accept: "application/json" } });
  if (requestId !== marketState.requestId) return;
  if (!result.response.ok) {
    setMarketUnavailable(result.data.message || "Live market data is unavailable");
    return;
  }
  renderCandles(result.data.candles);
  const mode = result.data.dataMode;
  setMarketBadge(document.querySelector("#chart-source-status"), marketStatusKind(mode), `${result.data.source} · ${formatDataMode(mode)}`);
  updateChartMeta(marketState.quotes.get(symbol), result.data);
  document.querySelector("#chart-data-quality").textContent = result.data.qualityWarnings?.length ? "Gaps reported" : "Validated";
  applySupportedTimeframes(result.data.supportedTimeframes);
  loadCandidateAnalysis().catch(() => setCandidateUnavailable());
  loadAiAnalysis().catch(() => setAiUnavailable());
}

function applySupportedTimeframes(supported) {
  if (!Array.isArray(supported)) return;
  document.querySelectorAll("[data-timeframe]").forEach((button) => {
    const enabled = supported.includes(button.dataset.timeframe);
    button.disabled = !enabled;
    button.title = enabled ? "Load this timeframe" : "Not supported by the configured provider";
  });
}

async function loadMarketSnapshot() {
  marketState.quotes.clear();
  renderMarketCards();
  const symbols = [...document.querySelectorAll(".instrument-card")].map((card) => card.dataset.symbol);
  const results = await Promise.allSettled(symbols.map((symbol) => loadMarketQuote(symbol)));
  if (results.every((result) => result.status === "fulfilled" && !result.value)) setMarketUnavailable();
  await loadMarketCandles();
}

function selectMarketSymbol(symbol) {
  marketState.symbol = symbol;
  document.querySelectorAll(".instrument-card").forEach((card) => card.classList.toggle("is-selected", card.dataset.symbol === symbol));
  document.querySelectorAll("[data-chart-symbol]").forEach((button) => button.classList.toggle("is-selected", button.dataset.chartSymbol === symbol));
  document.querySelector("#chart-context").textContent = `${symbol} · ${marketState.timeframe}`;
  loadMarketQuote(symbol).then((quote) => { updateChartMeta(quote, null); }).catch(() => setMarketUnavailable());
  loadMarketCandles().catch(() => setMarketUnavailable());
}

document.querySelectorAll(".nav-item[data-view]").forEach((item) => item.addEventListener("click", () => setView(item.dataset.view)));
document.querySelectorAll("[data-view-target]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewTarget)));
mobileMenuButton.addEventListener("click", toggleMobileNavigation);
document.querySelector("#refresh-health").addEventListener("click", loadRuntimeStatus);
document.querySelector("#refresh-market")?.addEventListener("click", loadMarketSnapshot);
document.querySelector("#refresh-chart")?.addEventListener("click", loadMarketCandles);

document.querySelectorAll(".instrument-card").forEach((button) => {
  button.addEventListener("click", () => {
    selectMarketSymbol(button.dataset.symbol);
  });
});

document.querySelectorAll("[data-chart-symbol]").forEach((button) => {
  selectMarketSymbol(button.dataset.chartSymbol);
});

document.querySelectorAll("[data-timeframe]").forEach((button) => {
  document.querySelectorAll("[data-timeframe]").forEach((timeframe) => timeframe.classList.toggle("is-selected", timeframe === button));
  marketState.timeframe = button.dataset.timeframe;
  document.querySelector("#chart-context").textContent = `${marketState.symbol} · ${marketState.timeframe}`;
  loadMarketCandles().catch(() => setMarketUnavailable());
});

showAuthenticatedApp();

updateClock();
setInterval(updateClock, 1000);
