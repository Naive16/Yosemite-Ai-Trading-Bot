function finiteOrNull(value) { return Number.isFinite(value) ? Number(value.toFixed(8)) : null; }

export function calculateBacktestMetrics({ startingEquity, endingEquity, trades = [], skipped = 0, rejected = 0, totalCosts = 0, coverage = {} }) {
  const wins = trades.filter((trade) => trade.netPnl > 0); const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0); const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  let equity = startingEquity; let peak = equity; let maxDrawdown = 0;
  for (const trade of trades) { equity += trade.netPnl; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak === 0 ? 0 : (peak - equity) / peak); }
  const expectancy = trades.length ? trades.reduce((sum, trade) => sum + trade.netPnl, 0) / trades.length : null;
  return Object.freeze({ label: "historical simulation", startingEquity: finiteOrNull(startingEquity), endingEquity: finiteOrNull(endingEquity), netReturn: startingEquity > 0 ? finiteOrNull((endingEquity - startingEquity) / startingEquity) : null, maximumDrawdown: finiteOrNull(maxDrawdown), profitFactor: grossLoss > 0 ? finiteOrNull(grossProfit / grossLoss) : null, expectancyPerTrade: finiteOrNull(expectancy), tradeCount: trades.length, winCount: wins.length, lossCount: losses.length, averageWin: wins.length ? finiteOrNull(grossProfit / wins.length) : null, averageLoss: losses.length ? finiteOrNull(-grossLoss / losses.length) : null, largestGain: wins.length ? finiteOrNull(Math.max(...wins.map((trade) => trade.netPnl))) : null, largestLoss: losses.length ? finiteOrNull(Math.min(...losses.map((trade) => trade.netPnl))) : null, totalEstimatedCosts: finiteOrNull(totalCosts), riskLimitRejections: rejected, skippedOpportunities: skipped, coverage });
}
