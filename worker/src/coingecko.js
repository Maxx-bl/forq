// Appels à l'API CoinGecko (plan Demo, gratuit).
// Documentation : https://docs.coingecko.com/reference/introduction

const BASE_URL = "https://api.coingecko.com/api/v3";

function headers(apiKey) {
  return {
    accept: "application/json",
    "x-cg-demo-api-key": apiKey,
  };
}

// Récupère en UN SEUL appel le prix courant + variation 24h de toutes les cryptos suivies.
// `cryptos` : tableau d'objets { id, symbol, name } (voir assets.js).
export async function fetchCurrentPrices(cryptos, apiKey) {
  const ids = cryptos.map((c) => c.id).join(",");
  const url = `${BASE_URL}/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`;

  const res = await fetch(url, { headers: headers(apiKey) });
  if (!res.ok) {
    throw new Error(`CoinGecko /coins/markets a échoué : ${res.status}`);
  }

  const data = await res.json();
  const byId = new Map(data.map((entry) => [entry.id, entry]));

  const result = {};
  for (const crypto of cryptos) {
    const entry = byId.get(crypto.id);
    if (!entry) continue;
    result[crypto.id] = {
      price: entry.current_price,
      change24h: entry.price_change_percentage_24h ?? 0,
    };
  }
  return result;
}

// Récupère l'historique des prix d'une crypto sur `days` jours. CoinGecko choisit
// automatiquement la granularité selon la plage demandée (≈horaire jusqu'à 90 jours,
// quotidienne au-delà). Le plan Demo limite l'historique disponible à 365 jours.
export async function fetchHistory(cryptoId, days, apiKey) {
  const url = `${BASE_URL}/coins/${cryptoId}/market_chart?vs_currency=usd&days=${days}`;

  const res = await fetch(url, { headers: headers(apiKey) });
  if (!res.ok) {
    throw new Error(`CoinGecko /market_chart a échoué pour ${cryptoId} (days=${days}) : ${res.status}`);
  }

  const data = await res.json();
  // data.prices : tableau de [timestamp_ms, price]
  return data.prices ?? [];
}
