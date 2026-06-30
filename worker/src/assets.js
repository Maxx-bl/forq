// Liste fermée des actifs suivis par le worker.
// Volontairement limitée pour ne pas exploser le quota CoinGecko (plan Demo : 30 appels/min).
// Pour ajouter un actif : ajouter une entrée ici, le front la récupérera automatiquement
// via /api/prices (aucune autre modification nécessaire côté front).

// Cryptos : id = identifiant CoinGecko utilisé dans les appels API.
export const CRYPTOS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "tether", symbol: "USDT", name: "Tether" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "usd-coin", symbol: "USDC", name: "USD Coin" },
  { id: "cardano", symbol: "ADA", name: "Cardano" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "tron", symbol: "TRX", name: "TRON" },
  { id: "avalanche-2", symbol: "AVAX", name: "Avalanche" },
  { id: "chainlink", symbol: "LINK", name: "Chainlink" },
  { id: "polkadot", symbol: "DOT", name: "Polkadot" },
  { id: "litecoin", symbol: "LTC", name: "Litecoin" },
];

// Devises : id = code ISO, utilisé comme clé d'actif (identique au symbol pour les devises).
export const FIATS = [
  { id: "USD", symbol: "USD", name: "Dollar américain" },
  { id: "EUR", symbol: "EUR", name: "Euro" },
  { id: "GBP", symbol: "GBP", name: "Livre sterling" },
  { id: "JPY", symbol: "JPY", name: "Yen japonais" },
  { id: "CHF", symbol: "CHF", name: "Franc suisse" },
  { id: "CAD", symbol: "CAD", name: "Dollar canadien" },
  { id: "AUD", symbol: "AUD", name: "Dollar australien" },
  { id: "CNY", symbol: "CNY", name: "Yuan chinois" },
  { id: "INR", symbol: "INR", name: "Roupie indienne" },
  { id: "BRL", symbol: "BRL", name: "Real brésilien" },
  { id: "MXN", symbol: "MXN", name: "Peso mexicain" },
  { id: "SEK", symbol: "SEK", name: "Couronne suédoise" },
  { id: "NOK", symbol: "NOK", name: "Couronne norvégienne" },
  { id: "NZD", symbol: "NZD", name: "Dollar néo-zélandais" },
];
