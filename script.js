"use strict";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */
const REFRESH_INTERVAL_MS = 60 * 1000; // le worker rafraîchit son cache toutes les 15 min,
// on relit le cache (lecture KV, peu coûteuse) toutes les 60s côté front
const DEFAULT_ASSET_A = "bitcoin";
const LAST_ASSETS_KEY = "forq-last-assets";
const RANGES = ["24h", "7d", "30d", "all"];
const DEFAULT_RANGE = "7d";

/* ------------------------------------------------------------------ */
/* État applicatif                                                     */
/* ------------------------------------------------------------------ */
const state = {
  data: null, // dernière réponse du worker { updatedAt, assets }
  slotA: null, // id de l'actif affiché dans la carte 1
  slotB: null, // id de l'actif affiché dans la carte 2 (null = carte désactivée)
  mode: "compare", // "compare" | "convert"
  range: DEFAULT_RANGE, // "24h" | "7d" | "30d" | "all"
  charts: {}, // instances Chart.js actives, indexées par clé ("A", "B", "convert")
};

const lastPrices = {}; // dernier prix affiché par carte, pour l'animation de changement

/* ------------------------------------------------------------------ */
/* URL <-> état (partage de lien)                                      */
/* ------------------------------------------------------------------ */
function readStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const lastAssets = loadLastAssets();
  state.slotA = params.get("a") || lastAssets.a || DEFAULT_ASSET_A;
  state.slotB = params.get("b") || lastAssets.b || null;
  state.range = RANGES.includes(params.get("range")) ? params.get("range") : DEFAULT_RANGE;
  state.mode = params.get("mode") === "convert" && state.slotB ? "convert" : "compare";
}

function writeStateToUrl() {
  const params = new URLSearchParams();
  params.set("a", state.slotA);
  if (state.slotB) params.set("b", state.slotB);
  params.set("range", state.range);
  if (state.mode === "convert" && state.slotB) params.set("mode", "convert");
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

/* ------------------------------------------------------------------ */
/* Derniers actifs consultés (localStorage, pré-remplit l'ouverture)    */
/* ------------------------------------------------------------------ */
function loadLastAssets() {
  try {
    return JSON.parse(localStorage.getItem(LAST_ASSETS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveLastAssets() {
  localStorage.setItem(LAST_ASSETS_KEY, JSON.stringify({ a: state.slotA, b: state.slotB }));
}

/* ------------------------------------------------------------------ */
/* Thème (clair par défaut, choix persisté en localStorage)            */
/* ------------------------------------------------------------------ */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelector("#theme-toggle span").textContent = theme === "dark" ? "☀" : "☾";
}

function initTheme() {
  const saved = localStorage.getItem("forq-theme");
  applyTheme(saved === "dark" ? "dark" : "light");
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem("forq-theme", next);
  applyTheme(next);
}

/* ------------------------------------------------------------------ */
/* Récupération des données (lecture seule du cache du worker)         */
/* ------------------------------------------------------------------ */
async function fetchPrices() {
  const statusEl = document.getElementById("status");

  try {
    const res = await fetch(`${WORKER_URL}/api/prices`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.assets || Object.keys(data.assets).length === 0) {
      showStatus("En attente des premières données…");
      return;
    }

    state.data = data;
    statusEl.classList.add("hidden");
    updateFooter(data.updatedAt);
    render();
  } catch (err) {
    if (!state.data) {
      showStatus("Service momentanément indisponible…");
    }
    // si des données précédentes sont déjà affichées, on les laisse en place silencieusement
  }
}

function showStatus(message) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = message;
  statusEl.classList.remove("hidden");
  document.getElementById("cards").classList.add("hidden");
  document.getElementById("convert-view").classList.add("hidden");
}

function updateFooter(updatedAt) {
  const el = document.getElementById("updated-at");
  if (!updatedAt) {
    el.textContent = "";
    return;
  }
  const date = new Date(updatedAt);
  el.textContent = `mis à jour à ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

/* ------------------------------------------------------------------ */
/* Catalogue d'actifs (dérivé des données reçues, pas dupliqué ici)    */
/* ------------------------------------------------------------------ */
function getAssetList() {
  if (!state.data) return [];
  return Object.entries(state.data.assets).map(([id, asset]) => ({ id, ...asset }));
}

function getAsset(id) {
  return state.data && state.data.assets[id] ? { id, ...state.data.assets[id] } : null;
}

function isFiat(id) {
  const asset = getAsset(id);
  return Boolean(asset && asset.type === "fiat");
}

// Les devises (Frankfurter) n'ont pas de granularité 24h significative : on masque
// uniquement "Aujourd'hui" dès qu'un des actifs affichés est une devise (cf. worker/README.md).
function availableRanges() {
  const ids = [state.slotA, state.slotB].filter(Boolean);
  return ids.some(isFiat) ? RANGES.filter((r) => r !== "24h") : RANGES;
}

/* ------------------------------------------------------------------ */
/* Rendu général                                                        */
/* ------------------------------------------------------------------ */
function render() {
  renderModeSwitch();
  renderRangeSwitch();
  destroyAllCharts();

  const showConvert = state.mode === "convert" && state.slotB;
  document.getElementById("cards").classList.toggle("hidden", showConvert);
  document.getElementById("convert-view").classList.toggle("hidden", !showConvert);

  if (showConvert) {
    renderConvert();
  } else {
    renderCards();
  }

  writeStateToUrl();
  saveLastAssets();
}

function renderModeSwitch() {
  document.querySelector('.segmented-btn[data-mode="convert"]').disabled = !state.slotB;
  document.querySelectorAll(".segmented-btn[data-mode]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.mode === state.mode);
  });
}

function renderRangeSwitch() {
  const ranges = availableRanges();
  if (!ranges.includes(state.range)) {
    state.range = ranges[0]; // repli sur la plage disponible la plus proche (ex : 7j si 24h indisponible)
  }
  document.querySelectorAll(".segmented-btn[data-range]").forEach((btn) => {
    const range = btn.dataset.range;
    btn.classList.toggle("is-active", range === state.range);
    btn.disabled = !ranges.includes(range);
  });
}

/* ------------------------------------------------------------------ */
/* Rendu : sélecteur d'actif (champ texte avec filtrage en direct)     */
/* ------------------------------------------------------------------ */
function assetLabel(asset) {
  return `${asset.symbol} — ${asset.name}`;
}

// Normalise pour une recherche insensible à la casse et aux accents.
function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function buildAssetPicker(selectedId, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "asset-picker";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "asset-input";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "Rechercher un actif…";

  const arrow = document.createElement("span");
  arrow.className = "asset-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "⌄";

  const list = document.createElement("ul");
  list.className = "asset-options hidden";

  const allAssets = getAssetList();
  const selectedAsset = allAssets.find((a) => a.id === selectedId);
  input.value = selectedAsset ? assetLabel(selectedAsset) : "";

  let activeIndex = -1;
  let currentMatches = [];

  function renderOptions(query) {
    const normalizedQuery = normalize(query);
    // champ vide -> liste globale, sinon filtrage par symbole/nom
    currentMatches = allAssets.filter(
      (a) => normalizedQuery === "" || normalize(assetLabel(a)).includes(normalizedQuery)
    );
    activeIndex = -1;
    list.innerHTML = "";

    if (currentMatches.length === 0) {
      const empty = document.createElement("li");
      empty.className = "asset-option asset-option--empty";
      empty.textContent = "Aucun résultat";
      list.appendChild(empty);
      return;
    }

    let lastType = null;
    currentMatches.forEach((asset) => {
      if (asset.type !== lastType) {
        const group = document.createElement("li");
        group.className = "asset-option-group";
        group.textContent = asset.type === "crypto" ? "Cryptos" : "Devises";
        list.appendChild(group);
        lastType = asset.type;
      }
      const item = document.createElement("li");
      item.className = "asset-option";
      item.textContent = assetLabel(asset);
      // mousedown + preventDefault : sélectionne avant que le champ ne perde le focus
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectAsset(asset);
      });
      list.appendChild(item);
    });
  }

  function selectAsset(asset) {
    input.value = assetLabel(asset);
    list.classList.add("hidden");
    wrap.classList.remove("is-open");
    onChange(asset.id);
  }

  function openList() {
    input.value = "";
    renderOptions("");
    list.classList.remove("hidden");
    wrap.classList.add("is-open");
  }

  function moveActive(delta) {
    const optionEls = [...list.querySelectorAll(".asset-option:not(.asset-option--empty)")];
    if (optionEls.length === 0) return;
    activeIndex = (activeIndex + delta + optionEls.length) % optionEls.length;
    optionEls.forEach((el, i) => el.classList.toggle("is-active", i === activeIndex));
    optionEls[activeIndex].scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("focus", openList);
  input.addEventListener("input", () => {
    renderOptions(input.value);
    list.classList.remove("hidden");
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      list.classList.add("hidden");
      wrap.classList.remove("is-open");
      const current = allAssets.find((a) => a.id === selectedId);
      input.value = current ? assetLabel(current) : "";
    }, 100);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.blur();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = currentMatches[activeIndex] || currentMatches[0];
      if (target) selectAsset(target);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    }
  });

  wrap.appendChild(input);
  wrap.appendChild(arrow);
  wrap.appendChild(list);
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Rendu : cartes (mode comparaison)                                   */
/* ------------------------------------------------------------------ */
function renderCards() {
  const container = document.getElementById("cards");
  container.innerHTML = "";

  container.appendChild(
    buildCard("A", state.slotA, (id) => {
      state.slotA = id;
      render();
    }, null)
  );

  if (state.slotB) {
    container.appendChild(
      buildCard("B", state.slotB, (id) => {
        state.slotB = id;
        render();
      }, () => {
        state.slotB = null;
        state.mode = "compare";
        render();
      })
    );
  } else {
    container.appendChild(buildAddCardButton());
  }
}

function buildAddCardButton() {
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "add-card";
  addBtn.textContent = "+ comparer un second actif";
  addBtn.addEventListener("click", () => {
    const fallback = getAssetList().find((a) => a.id !== state.slotA);
    state.slotB = fallback ? fallback.id : null;
    render();
  });
  return addBtn;
}

function buildCard(key, assetId, onAssetChange, onRemove) {
  const asset = getAsset(assetId);

  const card = document.createElement("div");
  card.className = "card";

  const head = document.createElement("div");
  head.className = "card-head";
  head.appendChild(buildAssetPicker(assetId, onAssetChange));

  if (onRemove) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "card-remove";
    removeBtn.setAttribute("aria-label", "Retirer cet actif");
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", onRemove);
    head.appendChild(removeBtn);
  }
  card.appendChild(head);

  const priceRow = document.createElement("div");
  priceRow.className = "price-row";

  const priceEl = document.createElement("span");
  priceEl.className = "price";
  priceEl.textContent = asset ? formatPrice(asset.price) : "—";
  priceRow.appendChild(priceEl);

  if (asset && asset.price != null) {
    const changeEl = document.createElement("span");
    changeEl.className = `change ${asset.change24h >= 0 ? "is-up" : "is-down"}`;
    changeEl.textContent = `${asset.change24h >= 0 ? "+" : ""}${asset.change24h.toFixed(2)}%`;
    priceRow.appendChild(changeEl);
  }
  card.appendChild(priceRow);

  const chartWrap = document.createElement("div");
  chartWrap.className = "chart-wrap";
  const canvas = document.createElement("canvas");
  chartWrap.appendChild(canvas);
  card.appendChild(chartWrap);

  if (asset) {
    const points = asset.history[state.range] || [];
    requestAnimationFrame(() => renderChart(key, canvas, points, asset.change24h >= 0));
  }

  animatePriceChange(priceEl, asset ? asset.price : null, key);

  return card;
}

/* ------------------------------------------------------------------ */
/* Animation discrète sur changement de prix                           */
/* ------------------------------------------------------------------ */
function animatePriceChange(priceEl, price, key) {
  if (price == null) return;
  const previous = lastPrices[key];
  if (previous != null && previous !== price) {
    priceEl.classList.add(price > previous ? "flash-up" : "flash-down");
    setTimeout(() => priceEl.classList.remove("flash-up", "flash-down"), 700);
  }
  lastPrices[key] = price;
}

/* ------------------------------------------------------------------ */
/* Rendu : mode conversion directe                                     */
/* ------------------------------------------------------------------ */
function renderConvert() {
  const a = getAsset(state.slotA);
  const b = getAsset(state.slotB);
  const line1 = document.getElementById("convert-line-1");
  const line2 = document.getElementById("convert-line-2");

  if (!a || !b || a.price == null || b.price == null) {
    line1.textContent = "—";
    line2.textContent = "";
    return;
  }

  line1.textContent = `1 ${a.symbol} = ${formatNumber(a.price / b.price)} ${b.symbol}`;
  line2.textContent = `1 ${b.symbol} = ${formatNumber(b.price / a.price)} ${a.symbol}`;

  const ratioSeries = buildRatioSeries(a.history[state.range] || [], b.history[state.range] || []);
  const trendingUp = ratioSeries.length > 1 ? ratioSeries.at(-1)[1] >= ratioSeries[0][1] : true;

  const canvas = document.getElementById("convert-chart");
  requestAnimationFrame(() => renderChart("convert", canvas, ratioSeries, trendingUp));
}

// Aligne deux séries [timestamp, price] en associant à chaque point de la première série
// le point de la seconde dont le timestamp est le plus proche (les deux sources n'ont pas
// la même granularité : horaire pour les cryptos, quotidienne pour les devises).
function buildRatioSeries(seriesA, seriesB) {
  if (seriesA.length === 0 || seriesB.length === 0) return [];
  return seriesA.map(([timestamp, priceA]) => {
    const closest = seriesB.reduce((best, point) =>
      Math.abs(point[0] - timestamp) < Math.abs(best[0] - timestamp) ? point : best
    );
    return [timestamp, priceA / closest[1]];
  });
}

/* ------------------------------------------------------------------ */
/* Graphique (Chart.js, rendu minimaliste : grille fine, axes temps/valeur) */
/* ------------------------------------------------------------------ */
function renderChart(key, canvas, points, isUp) {
  destroyChart(key);
  if (!points || points.length === 0) return;

  const color = isUp ? getCssVar("--up") : getCssVar("--down");
  const gridColor = getCssVar("--border");
  const tickColor = getCssVar("--text-muted");
  const surfaceColor = getCssVar("--surface");
  const textColor = getCssVar("--text");
  const range = state.range;

  state.charts[key] = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          data: points.map(([timestamp, value]) => ({ x: timestamp, y: value })),
          borderColor: color,
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 3,
          pointHitRadius: 12,
          pointHoverBackgroundColor: color,
          pointHoverBorderColor: surfaceColor,
          pointHoverBorderWidth: 1.5,
          tension: 0.35,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: "nearest", axis: "x", intersect: false },
      scales: {
        x: {
          type: "linear",
          bounds: "data", // sans ça, Chart.js arrondit les bornes aux "ticks" les plus
          // proches et la courbe se retrouve resserrée au milieu du graphique
          min: points[0][0],
          max: points.at(-1)[0],
          offset: false,
          grid: { color: gridColor, drawTicks: false },
          border: { display: false },
          ticks: {
            color: tickColor,
            font: { size: 10 },
            maxRotation: 0,
            maxTicksLimit: 4,
            callback: (value) => formatAxisTime(value, range),
          },
        },
        y: {
          type: "linear",
          position: "left",
          bounds: "data",
          grid: { color: gridColor, drawTicks: false },
          border: { display: false },
          ticks: {
            color: tickColor,
            font: { size: 10 },
            maxTicksLimit: 4,
            callback: (value) => formatAxisValue(value),
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          intersect: false,
          displayColors: false,
          backgroundColor: surfaceColor,
          borderColor: gridColor,
          borderWidth: 1,
          titleColor: tickColor,
          bodyColor: textColor,
          padding: 8,
          cornerRadius: 8,
          titleFont: { size: 10, weight: "400" },
          bodyFont: { size: 13, weight: "600" },
          callbacks: {
            title: (items) => formatAxisTime(items[0].parsed.x, range),
            label: (item) => formatNumber(item.parsed.y),
          },
        },
      },
    },
  });
}

function formatAxisTime(timestamp, range) {
  const date = new Date(timestamp);
  if (range === "24h") {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "all") {
    // plage potentiellement pluriannuelle (devises) : on affiche le mois et l'année
    return date.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
  }
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

// Pas de notation compacte ("1,6 k") : sur une plage resserrée, plusieurs graduations
// arrondissaient à la même valeur affichée. On garde des nombres pleins, avec une précision
// dépendant de l'ordre de grandeur.
function formatAxisValue(value) {
  const decimals = value >= 1000 ? 0 : value >= 1 ? 2 : 6;
  return value.toLocaleString("fr-FR", { maximumFractionDigits: decimals });
}

function destroyChart(key) {
  if (state.charts[key]) {
    state.charts[key].destroy();
    delete state.charts[key];
  }
}

function destroyAllCharts() {
  Object.keys(state.charts).forEach(destroyChart);
}

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ------------------------------------------------------------------ */
/* Formatage des nombres                                                */
/* ------------------------------------------------------------------ */
function formatPrice(price) {
  return price == null ? "—" : formatNumber(price);
}

function formatNumber(value) {
  const decimals = value >= 100 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString("fr-FR", { maximumFractionDigits: decimals, minimumFractionDigits: 2 });
}

/* ------------------------------------------------------------------ */
/* Écouteurs globaux                                                    */
/* ------------------------------------------------------------------ */
function initControls() {
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);

  document.querySelectorAll(".segmented-btn[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      state.mode = btn.dataset.mode;
      render();
    });
  });

  document.querySelectorAll(".segmented-btn[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      state.range = btn.dataset.range;
      render();
    });
  });
}

/* ------------------------------------------------------------------ */
/* Démarrage                                                             */
/* ------------------------------------------------------------------ */
function init() {
  initTheme();
  readStateFromUrl();
  initControls();
  fetchPrices();
  setInterval(fetchPrices, REFRESH_INTERVAL_MS);
}

document.addEventListener("DOMContentLoaded", init);
