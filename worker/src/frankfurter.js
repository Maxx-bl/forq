// Appels à l'API Frankfurter (taux de référence BCE, gratuite, sans clé).
// Documentation : https://www.frankfurter.app/docs/
//
// Frankfurter ne publie qu'un taux par jour ouvré : il n'y a donc pas de vraie granularité
// "24h" pour les devises (voir worker/README.md). On normalise tout en USD : pour une devise
// X, price = 1 / rate(USD->X), de sorte que USD vaut toujours 1.0 et que le calcul de taux
// croisé entre deux actifs (crypto ou devise) reste un simple price[A] / price[B].

const BASE_URL = "https://api.frankfurter.app";

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function rateToUsdPrice(currency, rate) {
  if (currency === "USD") return 1;
  if (!rate) return null;
  return 1 / rate;
}

// Récupère le prix courant (USD) de chaque devise suivie, ainsi qu'une variation calculée
// par rapport au dernier jour ouvré disponible avant aujourd'hui (proxy du "24h").
export async function fetchCurrentRates(fiats) {
  const symbols = fiats.filter((f) => f.id !== "USD").map((f) => f.id);
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7); // fenêtre large pour couvrir week-ends/jours fériés

  const url = `${BASE_URL}/${toIsoDate(start)}..${toIsoDate(end)}?base=USD&symbols=${symbols.join(",")}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Frankfurter (time series) a échoué : ${res.status}`);
  }

  const data = await res.json();
  const dates = Object.keys(data.rates).sort(); // ordre chronologique croissant
  if (dates.length === 0) return {};

  const latestDate = dates[dates.length - 1];
  const previousDate = dates.length > 1 ? dates[dates.length - 2] : latestDate;

  const latestRates = data.rates[latestDate];
  const previousRates = data.rates[previousDate];

  const result = {
    USD: { price: 1, change24h: 0 },
  };

  for (const symbol of symbols) {
    const currentPrice = rateToUsdPrice(symbol, latestRates[symbol]);
    const previousPrice = rateToUsdPrice(symbol, previousRates[symbol]);
    if (currentPrice == null) continue;

    const change24h =
      previousPrice && previousPrice !== 0
        ? ((currentPrice - previousPrice) / previousPrice) * 100
        : 0;

    result[symbol] = { price: currentPrice, change24h };
  }

  return result;
}

// Récupère l'historique quotidien (USD) de chaque devise suivie sur `days` jours.
// Utilisé pour la série "7j" (les devises n'ont pas de série "24h" significative,
// cf. README — le front masque le toggle 24h pour les actifs de type "fiat").
export async function fetchHistory(fiats, days = 30) {
  const symbols = fiats.filter((f) => f.id !== "USD").map((f) => f.id);
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);

  const url = `${BASE_URL}/${toIsoDate(start)}..${toIsoDate(end)}?base=USD&symbols=${symbols.join(",")}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Frankfurter (historique) a échoué : ${res.status}`);
  }

  const data = await res.json();
  const dates = Object.keys(data.rates).sort();

  // points[symbol] = [[timestamp_ms, price], ...]
  const points = { USD: dates.map((d) => [Date.parse(d), 1]) };
  for (const symbol of symbols) {
    points[symbol] = dates
      .map((d) => {
        const price = rateToUsdPrice(symbol, data.rates[d][symbol]);
        return price == null ? null : [Date.parse(d), price];
      })
      .filter(Boolean);
  }

  return points;
}
