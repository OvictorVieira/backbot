/**
 * 🎯 UNIFIED ORDER MODEL
 * Modelo unificado de ordem que abstrai as especificidades de cada exchange.
 * Este modelo representa uma ordem no formato interno do bot, e cada exchange
 * implementa um tradutor para converter para o formato da API específica.
 */

export class UnifiedOrderModel {
  /**
   * @param {Object} params - Parâmetros da ordem
   * @param {string} params.symbol - Símbolo do mercado (ex: BTC_USDC_PERP)
   * @param {string} params.type - Tipo da ordem: 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'TAKE_PROFIT'
   * @param {string} params.side - Lado da ordem: 'LONG' | 'SHORT' | 'CLOSE_LONG' | 'CLOSE_SHORT'
   * @param {number} params.quantity - Quantidade da ordem
   * @param {number} [params.price] - Preço limite (obrigatório para LIMIT)
   * @param {number} [params.triggerPrice] - Preço de trigger (para STOP_LOSS e TAKE_PROFIT)
   * @param {number} [params.limitPrice] - Preço limite após trigger (opcional)
   * @param {boolean} [params.reduceOnly] - Se a ordem é reduceOnly (fecha posição)
   * @param {boolean} [params.postOnly] - Se a ordem é postOnly (maker only)
   * @param {string} [params.timeInForce] - Time in force: 'GTC' | 'IOC' | 'FOK'
   * @param {string} [params.clientId] - ID único da ordem gerado pelo cliente
   * @param {Object} [params.stopLoss] - Configuração de stop loss integrado
   * @param {Object} [params.takeProfit] - Configuração de take profit integrado
   * @param {Object} [params.metadata] - Metadados adicionais (estratégia, bot, etc)
   */
  constructor(params) {
    // Validação básica
    if (!params.symbol) throw new Error('UnifiedOrderModel: symbol is required');
    if (!params.type) throw new Error('UnifiedOrderModel: type is required');
    if (!params.side) throw new Error('UnifiedOrderModel: side is required');
    if (!params.quantity || params.quantity <= 0)
      throw new Error('UnifiedOrderModel: quantity must be > 0');

    // Propriedades essenciais
    this.symbol = params.symbol;
    this.type = params.type; // 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'TAKE_PROFIT'
    this.side = params.side; // 'LONG' | 'SHORT' | 'CLOSE_LONG' | 'CLOSE_SHORT'
    this.quantity = params.quantity;

    // Propriedades opcionais
    this.price = params.price || null;
    this.triggerPrice = params.triggerPrice || null;
    this.limitPrice = params.limitPrice || null;
    this.reduceOnly = params.reduceOnly || false;
    this.postOnly = params.postOnly || false;
    this.timeInForce = params.timeInForce || this._getDefaultTimeInForce();
    this.clientId = params.clientId || null;

    // Stop Loss integrado (opcional)
    this.stopLoss = params.stopLoss
      ? {
          triggerPrice: params.stopLoss.triggerPrice,
          limitPrice: params.stopLoss.limitPrice || params.stopLoss.triggerPrice,
          triggerBy: params.stopLoss.triggerBy || 'LAST_PRICE',
        }
      : null;

    // Take Profit integrado (opcional)
    this.takeProfit = params.takeProfit
      ? {
          triggerPrice: params.takeProfit.triggerPrice,
          limitPrice: params.takeProfit.limitPrice || params.takeProfit.triggerPrice,
          triggerBy: params.takeProfit.triggerBy || 'LAST_PRICE',
        }
      : null;

    // Metadados (para tracking e auditoria)
    this.metadata = params.metadata || {};
  }

  /**
   * Retorna o timeInForce padrão baseado no tipo de ordem
   */
  _getDefaultTimeInForce() {
    switch (this.type) {
      case 'MARKET':
        return 'IOC'; // Immediate or Cancel
      case 'LIMIT':
        return 'GTC'; // Good Till Cancel
      case 'STOP_LOSS':
      case 'TAKE_PROFIT':
        return 'GTC';
      default:
        return 'GTC';
    }
  }

  /**
   * Valida se a ordem está corretamente configurada
   * @returns {boolean}
   */
  isValid() {
    // LIMIT orders precisam de price
    if (this.type === 'LIMIT' && !this.price) {
      throw new Error('UnifiedOrderModel: LIMIT orders require price');
    }

    // STOP_LOSS e TAKE_PROFIT precisam de triggerPrice
    if ((this.type === 'STOP_LOSS' || this.type === 'TAKE_PROFIT') && !this.triggerPrice) {
      throw new Error(
        `UnifiedOrderModel: ${this.type} orders require triggerPrice`
      );
    }

    return true;
  }

  /**
   * Converte para objeto simples (para logging/debugging)
   */
  toJSON() {
    return {
      symbol: this.symbol,
      type: this.type,
      side: this.side,
      quantity: this.quantity,
      price: this.price,
      triggerPrice: this.triggerPrice,
      limitPrice: this.limitPrice,
      reduceOnly: this.reduceOnly,
      postOnly: this.postOnly,
      timeInForce: this.timeInForce,
      clientId: this.clientId,
      stopLoss: this.stopLoss,
      takeProfit: this.takeProfit,
      metadata: this.metadata,
    };
  }

  /**
   * Factory method: Cria ordem de abertura de posição LONG
   */
  static createOpenLong(symbol, quantity, price, options = {}) {
    return new UnifiedOrderModel({
      symbol,
      type: price ? 'LIMIT' : 'MARKET',
      side: 'LONG',
      quantity,
      price,
      postOnly: options.postOnly !== undefined ? options.postOnly : !!price,
      clientId: options.clientId,
      stopLoss: options.stopLoss,
      takeProfit: options.takeProfit,
      metadata: options.metadata,
    });
  }

  /**
   * Factory method: Cria ordem de abertura de posição SHORT
   */
  static createOpenShort(symbol, quantity, price, options = {}) {
    return new UnifiedOrderModel({
      symbol,
      type: price ? 'LIMIT' : 'MARKET',
      side: 'SHORT',
      quantity,
      price,
      postOnly: options.postOnly !== undefined ? options.postOnly : !!price,
      clientId: options.clientId,
      stopLoss: options.stopLoss,
      takeProfit: options.takeProfit,
      metadata: options.metadata,
    });
  }

  /**
   * Factory method: Cria ordem de fechamento de posição LONG
   */
  static createCloseLong(symbol, quantity, price, options = {}) {
    return new UnifiedOrderModel({
      symbol,
      type: price ? 'LIMIT' : 'MARKET',
      side: 'CLOSE_LONG',
      quantity,
      price,
      reduceOnly: true,
      postOnly: options.postOnly || false,
      clientId: options.clientId,
      metadata: options.metadata,
    });
  }

  /**
   * Factory method: Cria ordem de fechamento de posição SHORT
   */
  static createCloseShort(symbol, quantity, price, options = {}) {
    return new UnifiedOrderModel({
      symbol,
      type: price ? 'LIMIT' : 'MARKET',
      side: 'CLOSE_SHORT',
      quantity,
      price,
      reduceOnly: true,
      postOnly: options.postOnly || false,
      clientId: options.clientId,
      metadata: options.metadata,
    });
  }

  /**
   * Factory method: Cria ordem de Stop Loss
   */
  static createStopLoss(symbol, quantity, triggerPrice, limitPrice, options = {}) {
    return new UnifiedOrderModel({
      symbol,
      type: 'STOP_LOSS',
      side: options.isLong ? 'CLOSE_LONG' : 'CLOSE_SHORT',
      quantity,
      triggerPrice,
      limitPrice: limitPrice || triggerPrice,
      reduceOnly: true,
      postOnly: options.postOnly || false,
      clientId: options.clientId,
      metadata: options.metadata,
    });
  }

  /**
   * Factory method: Cria ordem de Take Profit
   */
  static createTakeProfit(symbol, quantity, triggerPrice, limitPrice, options = {}) {
    return new UnifiedOrderModel({
      symbol,
      type: 'TAKE_PROFIT',
      side: options.isLong ? 'CLOSE_LONG' : 'CLOSE_SHORT',
      quantity,
      triggerPrice,
      limitPrice: limitPrice || triggerPrice,
      reduceOnly: true,
      postOnly: options.postOnly || false,
      clientId: options.clientId,
      metadata: options.metadata,
    });
  }
}

export default UnifiedOrderModel;
