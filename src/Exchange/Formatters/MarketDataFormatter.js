import Logger from '../../Utils/Logger.js';

/**
 * Classe base para formatadores de dados de mercado
 *
 * Define o contrato padrão que todos os formatadores de exchange devem seguir.
 * Cada exchange tem sua própria estrutura de dados, mas todos devem retornar
 * o mesmo formato padronizado para a aplicação.
 *
 * FORMATO PADRÃO ESPERADO:
 * {
 *   symbol: string,              // Ex: "BTC_USDC_PERP"
 *   decimal_quantity: number,    // Casas decimais para quantidade
 *   decimal_price: number,       // Casas decimais para preço (máx 6)
 *   stepSize_quantity: number,   // Step size da quantidade
 *   tickSize: number,            // Tick size do preço
 *   minQuantity: number          // Quantidade mínima permitida
 * }
 */
class MarketDataFormatter {
  /**
   * Formata um array de markets da exchange para o formato padrão da aplicação
   *
   * @param {Array} rawMarkets - Array de markets no formato nativo da exchange
   * @returns {Array} Array de markets no formato padrão da aplicação
   * @throws {Error} Se o método não for implementado pela classe filha
   */
  formatMarkets(rawMarkets) {
    throw new Error('formatMarkets() deve ser implementado pela classe filha');
  }

  /**
   * Formata um único market da exchange para o formato padrão
   *
   * @param {Object} rawMarket - Market no formato nativo da exchange
   * @returns {Object} Market no formato padrão da aplicação
   * @throws {Error} Se o método não for implementado pela classe filha
   */
  formatMarket(rawMarket) {
    throw new Error('formatMarket() deve ser implementado pela classe filha');
  }

  /**
   * Calcula o número de casas decimais baseado em um valor string
   * Útil para calcular decimal_quantity e decimal_price
   *
   * @param {string|number} value - Valor para calcular decimais (ex: "0.001")
   * @returns {number} Número de casas decimais
   *
   * @example
   * calculateDecimals("0.001")  // retorna 3
   * calculateDecimals("1")      // retorna 0
   * calculateDecimals(0.01)     // retorna 2
   */
  calculateDecimals(value) {
    const valueStr = String(value);
    if (!valueStr.includes('.')) {
      return 0;
    }
    return valueStr.split('.')[1].length;
  }

  /**
   * Valida se um market formatado está correto
   *
   * @param {Object} market - Market formatado
   * @returns {boolean} true se válido, false caso contrário
   */
  validateFormattedMarket(market) {
    const requiredFields = [
      'symbol',
      'decimal_quantity',
      'decimal_price',
      'stepSize_quantity',
      'tickSize',
      'minQuantity',
    ];

    for (const field of requiredFields) {
      if (market[field] === undefined || market[field] === null) {
        Logger.error(
          `❌ [FORMATTER] Campo obrigatório ausente: ${field} para ${market?.symbol || 'unknown'}`
        );
        return false;
      }
    }

    return true;
  }
}

export default MarketDataFormatter;
