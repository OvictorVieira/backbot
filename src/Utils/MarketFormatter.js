import Logger from './Logger.js';

/**
 * Formatador genérico para mercados/exchanges
 * Funciona com qualquer exchange que implemente getMarketInfo()
 */
export class MarketFormatter {
  /**
   * Formata quantidade respeitando step size e quantidade mínima
   * @param {number} quantity - Quantidade bruta calculada
   * @param {object} marketInfo - Dados do mercado da exchange
   * @returns {string} Quantidade formatada para a exchange
   */
  static formatQuantity(quantity, marketInfo) {
    try {
      const { decimal_quantity, stepSize_quantity, minQuantity } = marketInfo;

      if (quantity <= 0) {
        Logger.debug(`[MarketFormatter] Quantidade <= 0, usando mínima: ${minQuantity}`);
        return parseFloat(minQuantity).toFixed(decimal_quantity).toString();
      }

      // Calcula quantos steps cabem na quantidade
      const steps = Math.floor(quantity / stepSize_quantity);

      // Se não cabe nem 1 step, usa a quantidade mínima
      if (steps === 0) {
        Logger.debug(`[MarketFormatter] Quantidade muito pequena, usando mínima: ${minQuantity}`);
        return parseFloat(minQuantity).toFixed(decimal_quantity).toString();
      }

      // Calcula quantidade final respeitando steps
      const finalQuantity = steps * stepSize_quantity;

      // Garante que não é menor que o mínimo
      const adjustedQuantity = Math.max(finalQuantity, minQuantity);

      const formatted = parseFloat(adjustedQuantity).toFixed(decimal_quantity).toString();

      Logger.debug(
        `[MarketFormatter] Quantidade: ${quantity} → Steps: ${steps} → Final: ${formatted}`
      );
      return formatted;
    } catch (error) {
      Logger.error(`[MarketFormatter] Erro ao formatar quantidade: ${error.message}`);
      // Fallback seguro
      return parseFloat(marketInfo.minQuantity || 0.00001)
        .toFixed(marketInfo.decimal_quantity || 8)
        .toString();
    }
  }

  /**
   * Formata preço respeitando casas decimais da exchange
   * @param {number} price - Preço bruto
   * @param {object} marketInfo - Dados do mercado da exchange
   * @returns {string} Preço formatado para a exchange
   */
  static formatPrice(price, marketInfo) {
    try {
      const { decimal_price, tickSize } = marketInfo;

      if (price <= 0) {
        throw new Error('Preço deve ser maior que 0');
      }

      // Ajusta para tick size se necessário
      let adjustedPrice = price;
      if (tickSize && tickSize > 0) {
        const ticks = Math.round(price / tickSize);
        adjustedPrice = ticks * tickSize;
      }

      const formatted = parseFloat(adjustedPrice).toFixed(decimal_price).toString();

      Logger.debug(
        `[MarketFormatter] Preço: ${price} → Ajustado: ${adjustedPrice} → Final: ${formatted}`
      );
      return formatted;
    } catch (error) {
      Logger.error(`[MarketFormatter] Erro ao formatar preço: ${error.message}`);
      // Fallback seguro
      return parseFloat(price)
        .toFixed(marketInfo.decimal_price || 2)
        .toString();
    }
  }

  /**
   * Valida se uma quantidade é válida para o mercado
   * @param {number} quantity - Quantidade a validar
   * @param {object} marketInfo - Dados do mercado da exchange
   * @returns {boolean} Se a quantidade é válida
   */
  static isValidQuantity(quantity, marketInfo) {
    try {
      const { stepSize_quantity, minQuantity } = marketInfo;

      if (quantity < minQuantity) {
        return false;
      }

      // Verifica se é múltiplo do step size
      const remainder = quantity % stepSize_quantity;
      return Math.abs(remainder) < 0.0000001; // Tolerância para float precision
    } catch (error) {
      Logger.error(`[MarketFormatter] Erro ao validar quantidade: ${error.message}`);
      return false;
    }
  }

  /**
   * Calcula a próxima quantidade válida maior que a informada
   * @param {number} quantity - Quantidade base
   * @param {object} marketInfo - Dados do mercado da exchange
   * @returns {number} Próxima quantidade válida
   */
  static getNextValidQuantity(quantity, marketInfo) {
    try {
      const { stepSize_quantity, minQuantity } = marketInfo;

      if (quantity < minQuantity) {
        return minQuantity;
      }

      const steps = Math.ceil(quantity / stepSize_quantity);
      return steps * stepSize_quantity;
    } catch (error) {
      Logger.error(
        `[MarketFormatter] Erro ao calcular próxima quantidade válida: ${error.message}`
      );
      return marketInfo.minQuantity || 0.00001;
    }
  }
}

export default MarketFormatter;
