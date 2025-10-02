import Logger from '../Utils/Logger.js';
import { ExchangeFactory } from './ExchangeFactory.js';

/**
 * Manager para facilitar a injeção de dependência e uso da Exchange Factory
 * Fornece uma interface simplificada para os controllers existentes
 */
export class ExchangeManager {
  constructor(exchangeName = 'backpack') {
    this.exchangeName = exchangeName;
    this.exchange = ExchangeFactory.createExchange(exchangeName);

    Logger.debug(`✅ [ExchangeManager] Instância criada para exchange: ${this.exchange.name}`);
  }

  /**
   * Retorna a instância da exchange
   */
  getExchange() {
    return this.exchange;
  }

  /**
   * Métodos proxy para facilitar migração - Account Management
   */
  async getAccount(apiKey, apiSecret) {
    return this.exchange.getAccount(apiKey, apiSecret);
  }

  async getPositions(apiKey, apiSecret) {
    return this.exchange.getPositions(apiKey, apiSecret);
  }

  async getCapital(apiKey, apiSecret) {
    return this.exchange.getCapital(apiKey, apiSecret);
  }

  async getAccountData(apiKey, apiSecret) {
    return this.exchange.getAccountData(apiKey, apiSecret);
  }

  /**
   * Métodos proxy para facilitar migração - Market Data
   */
  async getMarkets() {
    return this.exchange.getMarkets();
  }

  async getTicker(symbol) {
    return this.exchange.getTicker(symbol);
  }

  async getMarketPrice(symbol) {
    return this.exchange.getMarketPrice(symbol);
  }

  async getMarketInfo(symbol, apiKey, apiSecret) {
    return this.exchange.getMarketInfo(symbol, apiKey, apiSecret);
  }

  async getDepth(symbol) {
    return this.exchange.getDepth(symbol);
  }

  async getKlines(symbol, interval, limit = 100) {
    return this.exchange.getKlines(symbol, interval, limit);
  }

  async getTrades(symbol, limit = 100) {
    return this.exchange.getTrades(symbol, limit);
  }

  /**
   * Métodos proxy para facilitar migração - Order Management
   */
  async placeOrder(symbol, side, price, quantity, apiKey, apiSecret, options = {}) {
    return this.exchange.placeOrder(symbol, side, price, quantity, apiKey, apiSecret, options);
  }

  async cancelOrder(symbol, orderId, apiKey, apiSecret) {
    return this.exchange.cancelOrder(symbol, orderId, apiKey, apiSecret);
  }

  async cancelAllOpenOrders(symbol, apiKey, apiSecret) {
    return this.exchange.cancelAllOpenOrders(symbol, apiKey, apiSecret);
  }

  async getOpenOrders(symbol) {
    return this.exchange.getOpenOrders(symbol);
  }

  async getOpenOrdersForSymbol(symbol, apiKey, apiSecret) {
    return this.exchange.getOpenOrdersForSymbol(symbol, apiKey, apiSecret);
  }

  async getOrderHistory(symbol, apiKey, apiSecret, options = {}) {
    return this.exchange.getOrderHistory(symbol, apiKey, apiSecret, options);
  }

  async getOrderStatus(symbol, orderId, apiKey, apiSecret) {
    return this.exchange.getOrderStatus(symbol, orderId, apiKey, apiSecret);
  }

  async isOrderFilled(symbol, orderId, apiKey, apiSecret) {
    return this.exchange.isOrderFilled(symbol, orderId, apiKey, apiSecret);
  }

  /**
   * Métodos proxy para facilitar migração - Futures
   */
  async getFuturesPositions(apiKey, apiSecret) {
    return this.exchange.getFuturesPositions(apiKey, apiSecret);
  }

  async getFuturesPositionsForceRefresh(apiKey, apiSecret) {
    return this.exchange.getFuturesPositionsForceRefresh(apiKey, apiSecret);
  }

  async getFuturesBalance(apiKey, apiSecret) {
    return this.exchange.getFuturesBalance(apiKey, apiSecret);
  }

  /**
   * Métodos de compatibilidade para facilitar migração gradual
   * Estes métodos mantêm a interface similar aos imports diretos
   */

  /**
   * Compatibilidade com Order.executeOrder()
   */
  async executeOrder(orderBody, apiKey, apiSecret) {
    const { symbol, side, orderType, price, quantity, ...options } = orderBody;

    // Adapta formato do orderBody para interface da exchange
    const exchangeSide = side === 'Bid' ? 'BUY' : side === 'Ask' ? 'SELL' : side;

    // 🚨 CRITICAL: Não incluir campos undefined (causa Invalid signature)
    const exchangeOptions = {
      orderType,
      ...options,
    };

    // Adiciona campos opcionais apenas se definidos
    if (orderBody.timeInForce !== undefined) {
      exchangeOptions.timeInForce = orderBody.timeInForce;
    }
    if (orderBody.postOnly !== undefined) {
      exchangeOptions.postOnly = orderBody.postOnly;
    }
    if (orderBody.clientId !== undefined) {
      exchangeOptions.clientId = orderBody.clientId;
    }

    return this.exchange.placeOrder(
      symbol,
      exchangeSide,
      price,
      quantity,
      apiKey,
      apiSecret,
      exchangeOptions
    );
  }

  /**
   * Compatibilidade com Order.cancelOpenOrder()
   */
  async cancelOpenOrder(symbol, orderId, clientId, apiKey, apiSecret) {
    return this.exchange.cancelOrder(symbol, orderId, apiKey, apiSecret);
  }

  /**
   * Compatibilidade com Order.cancelOpenOrders()
   */
  async cancelOpenOrders(symbol, clientId, apiKey, apiSecret) {
    return this.exchange.cancelAllOpenOrders(symbol, apiKey, apiSecret);
  }

  /**
   * Factory method estático para criar instâncias
   */
  static create(exchangeName = 'backpack') {
    return new ExchangeManager(exchangeName);
  }

  /**
   * Factory method para criar baseado em configuração de bot
   */
  static createFromConfig(botConfig) {
    const exchangeName = botConfig.exchangeName || botConfig.exchange || 'backpack';
    return new ExchangeManager(exchangeName);
  }

  /**
   * Método de utilidade para logging
   */
  logOperation(operation, symbol, additional = {}) {
    Logger.debug(
      `🔄 [ExchangeManager] ${operation} - Exchange: ${this.exchangeName}, Symbol: ${symbol}`,
      additional
    );
  }
}

export default ExchangeManager;
