import Markets from '../Backpack/Public/Markets.js';
import Logger from './Logger.js';

const markets = new Markets();

/**
 * Analisa o book de ordens para encontrar preços ótimos para ordens limit
 */
class OrderBookAnalyzer {
  /**
   * Obtem o book de ordens para um símbolo
   * @param {string} symbol - Símbolo do par de trading
   * @returns {Object|null} - Dados do book de ordens
   */
  static async getOrderBook(symbol) {
    try {
      const depth = await markets.getDepth(symbol);
      if (!depth || !depth.bids || !depth.asks) {
        Logger.warn(`[ORDER_BOOK] ${symbol}: Book de ordens inválido ou vazio`);
        return null;
      }

      Logger.debug(
        `[ORDER_BOOK] ${symbol}: Book obtido - ${depth.bids.length} bids, ${depth.asks.length} asks`
      );
      return depth;
    } catch (error) {
      Logger.error(`[ORDER_BOOK] ${symbol}: Erro ao obter book de ordens:`, error.message);
      return null;
    }
  }

  /**
   * Encontra o melhor preço para uma ordem limit de compra (dentro do spread)
   * @param {string} symbol - Símbolo do par
   * @param {number} distancePercent - Distância percentual do best bid (ex: 0.01 para 0.01%)
   * @returns {number|null} - Preço otimizado ou null se falhar
   */
  static async getOptimalBuyPrice(symbol, distancePercent = 0.01) {
    const book = await this.getOrderBook(symbol);
    if (!book) return null;

    const bestBid = parseFloat(book.bids[0]?.[0]); // Melhor preço de compra
    const bestAsk = parseFloat(book.asks[0]?.[0]); // Melhor preço de venda

    if (!bestBid || !bestAsk) {
      Logger.warn(`[ORDER_BOOK] ${symbol}: Best bid/ask não disponível`);
      return null;
    }

    // Calcula preço dentro do spread, um pouco acima do best bid
    const optimalPrice = bestBid * (1 + distancePercent / 100);

    // Garante que não ultrapasse o best ask (senão seria taker)
    const finalPrice = Math.min(optimalPrice, bestAsk * 0.9999);

    Logger.debug(
      `[ORDER_BOOK] ${symbol}: BUY - Best Bid: ${bestBid}, Best Ask: ${bestAsk}, Optimal: ${finalPrice.toFixed(6)}`
    );

    return finalPrice;
  }

  /**
   * Encontra o melhor preço para uma ordem limit de venda (dentro do spread)
   * @param {string} symbol - Símbolo do par
   * @param {number} distancePercent - Distância percentual do best ask (ex: 0.01 para 0.01%)
   * @returns {number|null} - Preço otimizado ou null se falhar
   */
  static async getOptimalSellPrice(symbol, distancePercent = 0.01) {
    const book = await this.getOrderBook(symbol);
    if (!book) return null;

    const bestBid = parseFloat(book.bids[0]?.[0]);
    const bestAsk = parseFloat(book.asks[0]?.[0]);

    if (!bestBid || !bestAsk) {
      Logger.warn(`[ORDER_BOOK] ${symbol}: Best bid/ask não disponível`);
      return null;
    }

    // Calcula preço dentro do spread, um pouco abaixo do best ask
    const optimalPrice = bestAsk * (1 - distancePercent / 100);

    // Garante que não fique abaixo do best bid (senão seria taker)
    const finalPrice = Math.max(optimalPrice, bestBid * 1.0001);

    Logger.debug(
      `[ORDER_BOOK] ${symbol}: SELL - Best Bid: ${bestBid}, Best Ask: ${bestAsk}, Optimal: ${finalPrice.toFixed(6)}`
    );

    return finalPrice;
  }

  /**
   * Obtém o spread atual do mercado
   * @param {string} symbol - Símbolo do par
   * @returns {Object|null} - Informações do spread
   */
  static async getMarketSpread(symbol) {
    const book = await this.getOrderBook(symbol);
    if (!book) return null;

    const bestBid = parseFloat(book.bids[0]?.[0]);
    const bestAsk = parseFloat(book.asks[0]?.[0]);

    if (!bestBid || !bestAsk) return null;

    const spreadAbs = bestAsk - bestBid;
    const spreadPercent = (spreadAbs / bestBid) * 100;
    const midPrice = (bestBid + bestAsk) / 2;

    return {
      bestBid,
      bestAsk,
      midPrice,
      spreadAbs,
      spreadPercent,
      symbol,
    };
  }

  /**
   * Valida se um preço pode ser usado em ordem limit sem executar imediatamente
   * @param {string} symbol - Símbolo do par
   * @param {string} side - 'BUY' ou 'SELL'
   * @param {number} price - Preço a ser validado
   * @returns {boolean} - true se o preço é seguro para limit order
   */
  static async validateLimitPrice(symbol, side, price) {
    const book = await this.getOrderBook(symbol);
    if (!book) return false;

    const bestBid = parseFloat(book.bids[0]?.[0]);
    const bestAsk = parseFloat(book.asks[0]?.[0]);

    if (!bestBid || !bestAsk) return false;

    if (side.toUpperCase() === 'BUY') {
      // Para compra: preço deve ser <= best ask para não executar imediatamente
      const isValid = price <= bestAsk * 0.9999;
      Logger.debug(
        `[ORDER_BOOK] ${symbol}: BUY price ${price} vs best ask ${bestAsk} - ${isValid ? 'VALID' : 'INVALID'}`
      );
      return isValid;
    } else {
      // Para venda: preço deve ser >= best bid para não executar imediatamente
      const isValid = price >= bestBid * 1.0001;
      Logger.debug(
        `[ORDER_BOOK] ${symbol}: SELL price ${price} vs best bid ${bestBid} - ${isValid ? 'VALID' : 'INVALID'}`
      );
      return isValid;
    }
  }

  /**
   * Encontra o melhor preço para Take Profit baseado no book de ordens
   * @param {string} symbol - Símbolo do par
   * @param {string} side - 'LONG' ou 'SHORT'
   * @param {number} targetPrice - Preço alvo original
   * @param {number} minDistancePercent - Distância mínima do spread (padrão 0.05%)
   * @returns {number|null} - Preço ajustado para Take Profit
   */
  static async getOptimalTakeProfitPrice(symbol, side, targetPrice, minDistancePercent = 0.05) {
    const book = await this.getOrderBook(symbol);
    if (!book) return targetPrice; // Fallback para preço original

    const bestBid = parseFloat(book.bids[0]?.[0]);
    const bestAsk = parseFloat(book.asks[0]?.[0]);

    if (!bestBid || !bestAsk) return targetPrice;

    let optimalPrice = targetPrice;

    if (side === 'LONG') {
      // Para LONG: TP é venda, precisa estar acima do best bid mas abaixo do best ask
      const minPrice = bestBid * (1 + minDistancePercent / 100);
      const maxPrice = bestAsk * 0.999; // Pequena margem para evitar taker

      optimalPrice = Math.max(minPrice, Math.min(targetPrice, maxPrice));

      Logger.debug(
        `[ORDER_BOOK] ${symbol}: LONG TP - Target: ${targetPrice}, Optimal: ${optimalPrice.toFixed(6)} (range: ${minPrice.toFixed(6)} - ${maxPrice.toFixed(6)})`
      );
    } else {
      // Para SHORT: TP é compra, precisa estar abaixo do best ask mas acima do best bid
      const maxPrice = bestAsk * (1 - minDistancePercent / 100);
      const minPrice = bestBid * 1.001; // Pequena margem para evitar taker

      optimalPrice = Math.min(maxPrice, Math.max(targetPrice, minPrice));

      Logger.debug(
        `[ORDER_BOOK] ${symbol}: SHORT TP - Target: ${targetPrice}, Optimal: ${optimalPrice.toFixed(6)} (range: ${minPrice.toFixed(6)} - ${maxPrice.toFixed(6)})`
      );
    }

    return optimalPrice;
  }
}

export default OrderBookAnalyzer;
