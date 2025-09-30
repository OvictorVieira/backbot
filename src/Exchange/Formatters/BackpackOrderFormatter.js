import OrderPayloadFormatter from './OrderPayloadFormatter.js';
import Logger from '../../Utils/Logger.js';

/**
 * Formatador específico para payloads de ordem da Backpack Exchange
 *
 * Transforma ordens do formato padrão da aplicação para o formato específico da Backpack.
 *
 * FORMATO PADRÃO DA APLICAÇÃO (input):
 * {
 *   symbol: "BTC_USDC_PERP",
 *   side: "BUY",
 *   price: 50000,
 *   quantity: 0.1,
 *   orderType: "LIMIT",
 *   timeInForce: "GTC",
 *   postOnly: true,
 *   reduceOnly: false,
 *   clientId: "abc123"
 * }
 *
 * FORMATO DA BACKPACK (output):
 * {
 *   symbol: "BTC_USDC_PERP",
 *   side: "Bid",                    // "Bid" ou "Ask" (case-sensitive!)
 *   orderType: "Limit",             // "Limit" ou "Market" (case-sensitive!)
 *   quantity: "0.100",              // String formatada
 *   price: "50000.00",              // String formatada (apenas para Limit)
 *   timeInForce: "GTC",             // "GTC", "IOC", "FOK"
 *   postOnly: true,                 // Apenas para Limit
 *   selfTradePrevention: "RejectTaker",
 *   clientId: "abc123"
 * }
 */
class BackpackOrderFormatter extends OrderPayloadFormatter {
  /**
   * Formata um payload de ordem do formato padrão para o formato da Backpack
   *
   * @param {Object} standardOrder - Ordem no formato padrão da aplicação
   * @param {Object} marketInfo - Informações do mercado (decimal_quantity, decimal_price)
   * @returns {Object} Ordem no formato específico da Backpack
   * @throws {Error} Se a ordem for inválida
   */
  formatOrderPayload(standardOrder, marketInfo) {
    // Valida ordem antes de formatar
    if (!this.validateStandardOrder(standardOrder)) {
      throw new Error(`Ordem inválida para ${standardOrder?.symbol || 'unknown'}`);
    }

    // Valida marketInfo
    if (!marketInfo?.decimal_quantity || marketInfo?.decimal_price === undefined) {
      throw new Error(
        `MarketInfo inválido para ${standardOrder.symbol}: decimal_quantity e decimal_price obrigatórios`
      );
    }

    Logger.debug(
      `[BackpackOrderFormatter] Formatando ordem: ${standardOrder.symbol} ${standardOrder.side} ${standardOrder.quantity} @ ${standardOrder.price || 'MARKET'}`
    );

    // Converte side padrão (BUY/SELL) para formato Backpack (Bid/Ask)
    const backpackSide = this.convertSideToBackpack(standardOrder.side);

    // Converte orderType padrão (LIMIT/MARKET) para formato Backpack (Limit/Market)
    const backpackOrderType = this.convertOrderTypeToBackpack(standardOrder.orderType);

    // Formata quantidade com decimais corretos
    const formattedQuantity = this.formatQuantity(
      standardOrder.quantity,
      marketInfo.decimal_quantity
    );

    // Monta payload base
    const backpackPayload = {
      symbol: standardOrder.symbol,
      side: backpackSide,
      orderType: backpackOrderType,
      quantity: formattedQuantity,
      timeInForce: standardOrder.timeInForce || this.getDefaultTimeInForce(backpackOrderType),
      selfTradePrevention: 'RejectTaker', // Padrão da Backpack
      clientId: standardOrder.clientId || null,
    };

    // Para ordens LIMIT, adiciona preço e postOnly
    if (backpackOrderType === 'Limit') {
      if (!standardOrder.price) {
        throw new Error(
          `Preço obrigatório para ordens LIMIT: ${standardOrder.symbol}`
        );
      }

      // Formata preço com decimais corretos
      const formattedPrice = this.formatPrice(standardOrder.price, marketInfo.decimal_price);
      backpackPayload.price = formattedPrice;

      // PostOnly padrão true para Limit, mas pode ser sobrescrito
      backpackPayload.postOnly =
        standardOrder.postOnly !== undefined ? standardOrder.postOnly : true;
    }

    // ReduceOnly (se fornecido)
    if (standardOrder.reduceOnly !== undefined) {
      backpackPayload.reduceOnly = standardOrder.reduceOnly;
    }

    // Adiciona opções extras se fornecidas (sem sobrescrever campos obrigatórios)
    if (standardOrder.options) {
      const { symbol, side, orderType, quantity, price, ...extraOptions } = standardOrder.options;
      Object.assign(backpackPayload, extraOptions);
    }

    Logger.debug(
      `[BackpackOrderFormatter] ✅ Payload formatado:`,
      JSON.stringify(backpackPayload, null, 2)
    );

    return backpackPayload;
  }

  /**
   * Converte side padrão (BUY/SELL) para formato Backpack (Bid/Ask)
   *
   * @param {string} side - "BUY" ou "SELL"
   * @returns {string} "Bid" ou "Ask"
   */
  convertSideToBackpack(side) {
    const normalizedSide = this.normalizeSide(side);

    if (normalizedSide === 'BUY') return 'Bid';
    if (normalizedSide === 'SELL') return 'Ask';

    Logger.warn(
      `⚠️ [BackpackOrderFormatter] Side desconhecido: ${side}, usando como está`
    );
    return side;
  }

  /**
   * Converte orderType padrão (LIMIT/MARKET) para formato Backpack (Limit/Market)
   *
   * @param {string} orderType - "LIMIT" ou "MARKET"
   * @returns {string} "Limit" ou "Market"
   */
  convertOrderTypeToBackpack(orderType) {
    const normalizedType = this.normalizeOrderType(orderType);

    if (normalizedType === 'LIMIT') return 'Limit';
    if (normalizedType === 'MARKET') return 'Market';

    Logger.warn(
      `⚠️ [BackpackOrderFormatter] OrderType desconhecido: ${orderType}, usando como está`
    );
    return orderType;
  }

  /**
   * Retorna timeInForce padrão baseado no tipo de ordem
   *
   * @param {string} backpackOrderType - "Limit" ou "Market"
   * @returns {string} "GTC" para Limit, "IOC" para Market
   */
  getDefaultTimeInForce(backpackOrderType) {
    return backpackOrderType === 'Market' ? 'IOC' : 'GTC';
  }

  /**
   * Converte uma ordem da Backpack (response) para formato padrão da aplicação
   * Útil para processar respostas da API
   *
   * @param {Object} backpackOrder - Ordem no formato da Backpack
   * @returns {Object} Ordem no formato padrão da aplicação
   */
  parseBackpackOrderResponse(backpackOrder) {
    return {
      orderId: backpackOrder.id || backpackOrder.orderId,
      clientId: backpackOrder.clientId,
      symbol: backpackOrder.symbol,
      side: backpackOrder.side === 'Bid' ? 'BUY' : 'SELL',
      orderType: backpackOrder.orderType === 'Limit' ? 'LIMIT' : 'MARKET',
      quantity: parseFloat(backpackOrder.quantity),
      price: backpackOrder.price ? parseFloat(backpackOrder.price) : null,
      status: backpackOrder.status,
      timeInForce: backpackOrder.timeInForce,
      postOnly: backpackOrder.postOnly,
      timestamp: backpackOrder.timestamp,
    };
  }

  // ============================================
  // 🔧 MÉTODOS PARA OUTRAS OPERAÇÕES
  // ============================================

  /**
   * Formata payload para cancelamento de ordem
   *
   * FORMATO PADRÃO (input):
   * {
   *   symbol: "BTC_USDC_PERP",
   *   orderId: "123456",
   *   clientId: "abc123" (opcional)
   * }
   *
   * FORMATO BACKPACK (output):
   * Backpack usa parâmetros diretos, não payload complexo
   * Retorna objeto com parâmetros prontos para a API
   */
  formatCancelOrderPayload(standardCancel) {
    if (!standardCancel.symbol || !standardCancel.orderId) {
      throw new Error('symbol e orderId são obrigatórios para cancelamento');
    }

    Logger.debug(
      `[BackpackOrderFormatter] Formatando cancelamento: ${standardCancel.symbol} ordem ${standardCancel.orderId}`
    );

    // Backpack: cancelOpenOrder(symbol, orderId, clientId, apiKey, apiSecret)
    return {
      symbol: standardCancel.symbol,
      orderId: standardCancel.orderId,
      clientId: standardCancel.clientId || null,
    };
  }

  /**
   * Formata payload para cancelamento de todas as ordens
   *
   * FORMATO PADRÃO (input):
   * {
   *   symbol: "BTC_USDC_PERP"  // null para cancelar todas as exchanges
   * }
   *
   * FORMATO BACKPACK (output):
   * {
   *   symbol: "BTC_USDC_PERP"
   * }
   */
  formatCancelAllOrdersPayload(standardCancelAll) {
    Logger.debug(
      `[BackpackOrderFormatter] Formatando cancelamento total: ${standardCancelAll.symbol || 'ALL'}`
    );

    // Backpack: cancelOpenOrders(symbol, null, apiKey, apiSecret)
    return {
      symbol: standardCancelAll.symbol || null,
    };
  }

  /**
   * Formata payload para modificação de ordem
   *
   * FORMATO PADRÃO (input):
   * {
   *   symbol: "BTC_USDC_PERP",
   *   orderId: "123456",
   *   modifications: {
   *     price: 51000,
   *     quantity: 0.2
   *   }
   * }
   *
   * FORMATO BACKPACK (output):
   * Nota: Backpack não suporta modificação direta
   * Retorna estrutura para cancel + create
   */
  formatModifyOrderPayload(standardModify, marketInfo) {
    if (!standardModify.symbol || !standardModify.orderId) {
      throw new Error('symbol e orderId são obrigatórios para modificação');
    }

    Logger.warn(
      `[BackpackOrderFormatter] Backpack não suporta modificação direta - retornando estrutura para cancel + create`
    );

    // Formata modificações se fornecidas
    const formattedModifications = {};

    if (standardModify.modifications.price !== undefined) {
      formattedModifications.price = this.formatPrice(
        standardModify.modifications.price,
        marketInfo.decimal_price
      );
    }

    if (standardModify.modifications.quantity !== undefined) {
      formattedModifications.quantity = this.formatQuantity(
        standardModify.modifications.quantity,
        marketInfo.decimal_quantity
      );
    }

    return {
      orderId: standardModify.orderId,
      symbol: standardModify.symbol,
      modifications: formattedModifications,
      note: 'Backpack requires cancel + create for order modification',
    };
  }

  /**
   * Formata payload para mudança de alavancagem
   *
   * FORMATO PADRÃO (input):
   * {
   *   symbol: "BTC_USDC_PERP",
   *   leverage: 10
   * }
   *
   * FORMATO BACKPACK (output):
   * Nota: Backpack pode não suportar mudança dinâmica de leverage
   */
  formatChangeLeveragePayload(standardLeverage) {
    if (!standardLeverage.symbol || !standardLeverage.leverage) {
      throw new Error('symbol e leverage são obrigatórios');
    }

    if (standardLeverage.leverage < 1 || standardLeverage.leverage > 100) {
      throw new Error('Leverage deve estar entre 1 e 100');
    }

    Logger.debug(
      `[BackpackOrderFormatter] Formatando mudança de leverage: ${standardLeverage.symbol} para ${standardLeverage.leverage}x`
    );

    return {
      symbol: standardLeverage.symbol,
      leverage: Math.floor(standardLeverage.leverage),
    };
  }

  // ============================================
  // 🔄 PARSERS DE RESPOSTA DA API
  // ============================================

  /**
   * Parse de resposta de posições
   * Converte formato Backpack para formato padrão
   */
  parsePositionsResponse(backpackPositions) {
    if (!Array.isArray(backpackPositions)) {
      return [];
    }

    return backpackPositions.map(pos => ({
      symbol: pos.symbol,
      side: pos.side || (pos.positionSide === 'LONG' ? 'BUY' : 'SELL'),
      quantity: parseFloat(pos.quantity || pos.positionAmt || 0),
      entryPrice: parseFloat(pos.entryPrice || pos.avgPrice || 0),
      markPrice: parseFloat(pos.markPrice || 0),
      liquidationPrice: parseFloat(pos.liquidationPrice || 0),
      unrealizedPnl: parseFloat(pos.unrealizedPnl || pos.unRealizedProfit || 0),
      leverage: parseFloat(pos.leverage || 1),
      marginType: pos.marginType || 'cross',
      isolated: pos.isolated || false,
    }));
  }

  /**
   * Parse de resposta de ordens abertas
   */
  parseOpenOrdersResponse(backpackOrders) {
    if (!Array.isArray(backpackOrders)) {
      return [];
    }

    return backpackOrders.map(order => this.parseBackpackOrderResponse(order));
  }

  /**
   * Parse de resposta de balanço
   */
  parseBalanceResponse(backpackBalance) {
    if (!backpackBalance) {
      return null;
    }

    return {
      totalBalance: parseFloat(backpackBalance.total || 0),
      availableBalance: parseFloat(backpackBalance.available || backpackBalance.free || 0),
      usedBalance: parseFloat(backpackBalance.used || backpackBalance.locked || 0),
      unrealizedPnl: parseFloat(backpackBalance.unrealizedPnl || 0),
      marginBalance: parseFloat(backpackBalance.marginBalance || 0),
    };
  }
}

export default BackpackOrderFormatter;
