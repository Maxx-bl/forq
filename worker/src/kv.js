// Lecture/écriture de l'état global dans Cloudflare KV, et utilitaires de compression
// de l'historique. Une seule clé KV est utilisée pour tout l'état (voir README racine du
// dossier worker) afin de rester très en dessous de la limite gratuite de 1000 écritures/jour.

export const KV_KEY = "prices:latest";

export async function readState(kv) {
  const raw = await kv.get(KV_KEY);
  if (!raw) return { updatedAt: null, assets: {} };
  try {
    return JSON.parse(raw);
  } catch {
    return { updatedAt: null, assets: {} };
  }
}

export async function writeState(kv, state) {
  state.updatedAt = new Date().toISOString();
  await kv.put(KV_KEY, JSON.stringify(state));
}

function ensureAsset(state, id, type, symbol, name) {
  if (!state.assets[id]) {
    state.assets[id] = {
      type,
      symbol,
      name,
      price: null,
      change24h: 0,
      history: { "24h": [], "7d": [], "30d": [], all: [] },
    };
  }
  return state.assets[id];
}

// Réduit un tableau de points [timestamp, price] à `maxPoints` points maximum,
// répartis régulièrement, en conservant toujours le tout dernier point.
export function downsample(points, maxPoints) {
  if (points.length <= maxPoints) return points;

  const step = points.length / maxPoints;
  const result = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.floor(i * step)]);
  }

  const last = points[points.length - 1];
  if (result[result.length - 1] !== last) {
    result.push(last);
  }
  return result;
}

// Applique les prix courants (job 5 min) : met à jour price/change24h sans toucher à l'historique.
export function applyCurrentPrices(state, entries) {
  for (const entry of entries) {
    const asset = ensureAsset(state, entry.id, entry.type, entry.symbol, entry.name);
    asset.price = entry.price;
    asset.change24h = entry.change24h;
  }
}

// Applique l'historique d'une crypto (job historique) : dérive les 4 séries affichées
// ("24h", "7d", "30d", "all") à partir de DEUX appels CoinGecko :
//  - shortPoints : /market_chart?days=7  (granularité horaire) -> séries "24h" et "7d"
//  - longPoints  : /market_chart?days=365 (granularité quotidienne) -> séries "30d" et "all"
export function applyCryptoHistory(state, crypto, shortPoints, longPoints) {
  const asset = ensureAsset(state, crypto.id, "crypto", crypto.symbol, crypto.name);

  asset.history["7d"] = downsample(shortPoints, 56);

  const since24h = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = shortPoints.filter(([timestamp]) => timestamp >= since24h);
  asset.history["24h"] = downsample(last24h.length ? last24h : shortPoints.slice(-2), 48);

  const since30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const last30d = longPoints.filter(([timestamp]) => timestamp >= since30d);
  asset.history["30d"] = downsample(last30d.length ? last30d : longPoints.slice(-2), 60);

  asset.history.all = downsample(longPoints, 90);
}

// Applique l'historique d'une devise (job historique), à partir d'un unique appel Frankfurter
// longue durée (voir frankfurter.js) découpé en 3 fenêtres. Frankfurter ne publie qu'un taux
// par jour ouvré : il n'y a pas de série "24h" significative (le front masque ce bouton pour
// les actifs de type "fiat", cf. worker/README.md).
export function applyFiatHistory(state, fiat, rawPoints) {
  const asset = ensureAsset(state, fiat.id, "fiat", fiat.symbol, fiat.name);
  asset.history["24h"] = [];

  const since7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
  asset.history["7d"] = rawPoints.filter(([timestamp]) => timestamp >= since7d);

  const since30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  asset.history["30d"] = rawPoints.filter(([timestamp]) => timestamp >= since30d);

  asset.history.all = downsample(rawPoints, 120);
}
