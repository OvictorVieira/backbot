class Utils {
  minutesAgo(timestampMs) {
    const now = Date.now();
    const diffMs = now - timestampMs;
    return Math.floor(diffMs / 60000);
  }

  getIntervalInSeconds(interval) {
    if (typeof interval !== 'string') return 60;

    const match = interval.match(/^(\d+)([smhd])$/i);
    if (!match) return 60;

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    const unitToSeconds = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };

    return value * (unitToSeconds[unit] || 60);
  }
}

// Cache para logs de ajuste de alavancagem
const leverageAdjustLogged = new Set();

/**
 * Limpa o cache de logs de ajuste de alavancagem
 * @param {string} symbol - Símbolo do mercado (opcional, se não informado limpa todo o cache)
 */
function clearLeverageAdjustLog(symbol = null) {
  if (symbol) {
    leverageAdjustLogged.delete(symbol);
  } else {
    leverageAdjustLogged.clear();
  }
}

/**
 * Valida e ajusta a alavancagem baseada nas regras da Backpack
 * @param {string} symbol - Símbolo do mercado (ex: BTC_USDC_PERP)
 * @param {number} currentLeverage - Alavancagem atual da conta
 * @returns {number} - Alavancagem válida para o símbolo
 */
function validateLeverageForSymbol(symbol, currentLeverage) {
  // Tokens que podem ter até 50x (BTC, ETH, SOL)
  const highLeverageTokens = ['BTC_USDC_PERP', 'ETH_USDC_PERP', 'SOL_USDC_PERP'];

  // Tokens que têm limite de 5x (OG, 2Z, AVANT, PUMP)
  const lowLeverageTokens = ['OG_USDC_PERP', '2Z_USDC_PERP', 'AVANT_USDC_PERP', 'PUMP_USDC_PERP'];

  // Verifica categoria do token
  const isHighLeverageToken = highLeverageTokens.includes(symbol);
  const isLowLeverageToken = lowLeverageTokens.includes(symbol);

  if (isHighLeverageToken) {
    // Para BTC, ETH, SOL: pode usar até 50x
    const validLeverage = Math.min(currentLeverage, 50);
    if (validLeverage !== currentLeverage && !leverageAdjustLogged.has(symbol)) {
      console.log(
        `⚠️ [LEVERAGE_ADJUST] ${symbol}: Alavancagem ajustada de ${currentLeverage}x para ${validLeverage}x (máximo 50x para este token)`
      );
      leverageAdjustLogged.add(symbol);
    }
    return validLeverage;
  } else if (isLowLeverageToken) {
    // Para 0G, AVANT: máximo 5x
    const validLeverage = Math.min(currentLeverage, 5);
    if (validLeverage !== currentLeverage && !leverageAdjustLogged.has(symbol)) {
      console.log(
        `⚠️ [LEVERAGE_ADJUST] ${symbol}: Alavancagem ajustada de ${currentLeverage}x para ${validLeverage}x (máximo 5x para este token)`
      );
      leverageAdjustLogged.add(symbol);
    }
    return validLeverage;
  } else {
    // Para outros tokens: máximo 10x
    const validLeverage = Math.min(currentLeverage, 10);
    if (validLeverage !== currentLeverage && !leverageAdjustLogged.has(symbol)) {
      console.log(
        `⚠️ [LEVERAGE_ADJUST] ${symbol}: Alavancagem ajustada de ${currentLeverage}x para ${validLeverage}x (máximo 10x para este token)`
      );
      leverageAdjustLogged.add(symbol);
    }
    return validLeverage;
  }
}

export default new Utils();
export { validateLeverageForSymbol, clearLeverageAdjustLog };
