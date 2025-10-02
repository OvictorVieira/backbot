import Logger from '../../Utils/Logger.js';

/**
 * Classe base para formatadores de payloads de ordem
 *
 * Define o contrato padrão que todos os formatadores de ordem devem seguir.
 * Transforma o formato genérico da aplicação para o formato específico de cada exchange.
 *
 * FORMATO PADRÃO DA APLICAÇÃO (input):
 * {
 *   symbol: string,              // Ex: "BTC_USDC_PERP"
 *   side: string,                // "BUY" ou "SELL"
 *   price: number,               // Preço da ordem (null para market)
 *   quantity: number,            // Quantidade
 *   orderType: string,           // "LIMIT" ou "MARKET"
 *   timeInForce: string,         // "GTC", "IOC", "FOK"
 *   postOnly: boolean,           // true/false (apenas para limit)
 *   reduceOnly: boolean,         // true/false
 *   clientId: string,            // ID do cliente (opcional)
 *   options: object              // Opções adicionais específicas
 * }
 *
 * FORMATO ESPECÍFICO DA EXCHANGE (output):
 * Varia por exchange - cada formatador implementa seu próprio formato
 */
class OrderPayloadFormatter {
  /**
   * Formata um payload de ordem do formato padrão para o formato da exchange
   *
   * @param {Object} standardOrder - Ordem no formato padrão da aplicação
   * @param {Object} marketInfo - Informações do mercado (decimals, etc)
   * @returns {Object} Ordem no formato específico da exchange
   * @throws {Error} Se o método não for implementado pela classe filha
   */
  formatOrderPayload(standardOrder, marketInfo) {
    throw new Error('formatOrderPayload() deve ser implementado pela classe filha');
  }

  /**
   * Valida se uma ordem no formato padrão está correta
   *
   * @param {Object} standardOrder - Ordem no formato padrão
   * @returns {boolean} true se válida, false caso contrário
   */
  validateStandardOrder(standardOrder) {
    const requiredFields = ['symbol', 'side', 'quantity', 'orderType'];

    for (const field of requiredFields) {
      if (standardOrder[field] === undefined || standardOrder[field] === null) {
        Logger.error(
          `❌ [OrderFormatter] Campo obrigatório ausente: ${field} para ${standardOrder?.symbol || 'unknown'}`
        );
        return false;
      }
    }

    // Valida side
    if (!['BUY', 'SELL'].includes(standardOrder.side)) {
      Logger.error(`❌ [OrderFormatter] Side inválido: ${standardOrder.side}. Use "BUY" ou "SELL"`);
      return false;
    }

    // Valida orderType
    if (!['LIMIT', 'MARKET'].includes(standardOrder.orderType)) {
      Logger.error(
        `❌ [OrderFormatter] OrderType inválido: ${standardOrder.orderType}. Use "LIMIT" ou "MARKET"`
      );
      return false;
    }

    // Para LIMIT, preço é obrigatório
    if (standardOrder.orderType === 'LIMIT' && !standardOrder.price) {
      Logger.error(
        `❌ [OrderFormatter] Preço obrigatório para ordens LIMIT: ${standardOrder.symbol}`
      );
      return false;
    }

    return true;
  }

  /**
   * Formata preço com o número correto de casas decimais
   *
   * @param {number} price - Preço a ser formatado
   * @param {number} decimals - Número de casas decimais
   * @returns {string} Preço formatado como string
   */
  formatPrice(price, decimals) {
    if (price === null || price === undefined) {
      throw new Error('Preço não pode ser nulo ou indefinido.');
    }

    const priceAsString = String(price);

    const sanitizedPrice = priceAsString.replace(/[^0-9.]/g, '');

    const parsedPrice = parseFloat(sanitizedPrice);

    if (isNaN(parsedPrice)) {
      throw new Error(`Valor de preço inválido fornecido: "${price}"`);
    }

    return parsedPrice.toFixed(decimals);
  }

  /**
   * Formata quantidade com o número correto de casas decimais
   *
   * @param {number} quantity - Quantidade a ser formatada
   * @param {number} decimals - Número de casas decimais
   * @returns {string} Quantidade formatada como string
   */
  formatQuantity(quantity, decimals) {
    if (quantity === null || quantity === undefined) {
      throw new Error('Quantidade não pode ser nulo ou indefinido.');
    }

    const quantityAsString = String(quantity);

    const sanitizedQuantity = quantityAsString.replace(/[^0-9.]/g, '');

    const parsedQuantity = parseFloat(sanitizedQuantity);

    if (isNaN(parsedQuantity)) {
      throw new Error(`Valor de quantidade inválido fornecido: "${parsedQuantity}"`);
    }

    return parsedQuantity.toFixed(decimals);
  }

  /**
   * Normaliza side para o formato padrão da aplicação
   *
   * @param {string} side - Side em qualquer formato
   * @returns {string} "BUY" ou "SELL"
   */
  normalizeSide(side) {
    const upperSide = String(side).toUpperCase();
    if (['BUY', 'BID', 'LONG'].includes(upperSide)) return 'BUY';
    if (['SELL', 'ASK', 'SHORT'].includes(upperSide)) return 'SELL';
    return upperSide;
  }

  /**
   * Normaliza orderType para o formato padrão da aplicação
   *
   * @param {string} orderType - OrderType em qualquer formato
   * @returns {string} "LIMIT" ou "MARKET"
   */
  normalizeOrderType(orderType) {
    const upperType = String(orderType).toUpperCase();
    if (['LIMIT', 'LMT'].includes(upperType)) return 'LIMIT';
    if (['MARKET', 'MKT'].includes(upperType)) return 'MARKET';
    return upperType;
  }
}

export default OrderPayloadFormatter;
