import MarketDataFormatter from './MarketDataFormatter.js';
import Logger from '../../Utils/Logger.js';

/**
 * Formatador específico para dados de mercado da Backpack Exchange
 *
 * Transforma os dados vindos da API da Backpack para o formato padrão
 * esperado pela aplicação.
 *
 * ESTRUTURA DA BACKPACK (rawMarket):
 * {
 *   symbol: "BTC_USDC_PERP",
 *   filters: {
 *     quantity: {
 *       stepSize: "0.001",
 *       minQuantity: "0.001"
 *     },
 *     price: {
 *       tickSize: "0.01"
 *     }
 *   }
 * }
 *
 * ESTRUTURA PADRÃO DA APLICAÇÃO (output):
 * {
 *   symbol: "BTC_USDC_PERP",
 *   decimal_quantity: 3,
 *   decimal_price: 2,
 *   stepSize_quantity: 0.001,
 *   tickSize: 0.01,
 *   minQuantity: 0.001
 * }
 */
class BackpackMarketFormatter extends MarketDataFormatter {
  /**
   * Formata um array de markets da Backpack para o formato padrão
   *
   * @param {Array} rawMarkets - Array de markets no formato da Backpack
   * @returns {Array} Array de markets no formato padrão da aplicação
   */
  formatMarkets(rawMarkets) {
    if (!Array.isArray(rawMarkets)) {
      Logger.error('❌ [BackpackFormatter] rawMarkets deve ser um array');
      return [];
    }

    Logger.debug(`[BackpackFormatter] Formatando ${rawMarkets.length} markets...`);

    const formattedMarkets = rawMarkets
      .map(rawMarket => {
        try {
          return this.formatMarket(rawMarket);
        } catch (error) {
          Logger.error(
            `❌ [BackpackFormatter] Erro ao formatar market ${rawMarket?.symbol}: ${error.message}`
          );
          return null;
        }
      })
      .filter(market => market !== null && this.validateFormattedMarket(market));

    Logger.debug(
      `[BackpackFormatter] ✅ ${formattedMarkets.length} markets formatados com sucesso`
    );

    return formattedMarkets;
  }

  /**
   * Formata um único market da Backpack para o formato padrão
   *
   * @param {Object} rawMarket - Market no formato da Backpack
   * @returns {Object} Market no formato padrão da aplicação
   * @throws {Error} Se os dados do market estiverem inválidos
   */
  formatMarket(rawMarket) {
    // Validação dos dados de entrada
    if (!rawMarket?.filters?.quantity?.stepSize || !rawMarket?.filters?.price?.tickSize) {
      throw new Error(
        `Dados de filtros ausentes para ${rawMarket?.symbol || 'unknown market'}`
      );
    }

    const { symbol, filters } = rawMarket;
    const { quantity, price } = filters;

    // Calcula decimal_quantity baseado no stepSize
    const decimal_quantity = this.calculateDecimals(quantity.stepSize);

    // Calcula decimal_price baseado no tickSize
    // IMPORTANTE: NÃO limitar decimais - usar exatamente o que a exchange define
    const decimal_price = this.calculateDecimals(price.tickSize);

    // Monta o objeto no formato padrão
    const formattedMarket = {
      symbol: symbol,
      decimal_quantity: decimal_quantity,
      decimal_price: decimal_price,
      stepSize_quantity: Number(quantity.stepSize),
      tickSize: Number(price.tickSize),
      minQuantity: quantity.minQuantity
        ? Number(quantity.minQuantity)
        : Number(quantity.stepSize),
    };

    return formattedMarket;
  }
}

export default BackpackMarketFormatter;
