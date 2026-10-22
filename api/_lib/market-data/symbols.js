export const SYMBOL_REGISTRY = Object.freeze({
  "EUR/USD": Object.freeze({ symbol: "EUR/USD", name: "Euro / US dollar", providerSymbol: "EUR/USD" }),
  "GBP/USD": Object.freeze({ symbol: "GBP/USD", name: "British pound / US dollar", providerSymbol: "GBP/USD" }),
  "USD/ZAR": Object.freeze({ symbol: "USD/ZAR", name: "US dollar / South African rand", providerSymbol: "USD/ZAR" }),
  "EUR/ZAR": Object.freeze({ symbol: "EUR/ZAR", name: "Euro / South African rand", providerSymbol: "EUR/ZAR" })
});

export const TIMEFRAME_REGISTRY = Object.freeze({
  M5: Object.freeze({ key: "M5", providerInterval: "5min", seconds: 300, label: "5 minutes" }),
  M15: Object.freeze({ key: "M15", providerInterval: "15min", seconds: 900, label: "15 minutes" }),
  H1: Object.freeze({ key: "H1", providerInterval: "1h", seconds: 3_600, label: "1 hour" })
});

export const DEFAULT_SYMBOL = "EUR/USD";
export const DEFAULT_TIMEFRAME = "M15";

export function getSymbolDefinition(symbol) {
  return SYMBOL_REGISTRY[symbol] || null;
}

export function getTimeframeDefinition(timeframe) {
  return TIMEFRAME_REGISTRY[timeframe] || null;
}

export function listSupportedTimeframes() {
  return Object.keys(TIMEFRAME_REGISTRY);
}
