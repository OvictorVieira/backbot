/**
 * Classe Abstrata para todas as Exchanges.
 * Define a interface comum que a HFTStrategy espera.
 * Cada nova exchange deve estender esta classe e implementar seus métodos.
 */
export class BaseExchange {
  constructor(name) {
    this.name = name;
  }

  /**
   * Conecta ao WebSocket da exchange e gerencia os callbacks.
   * @param {object} callbacks - Objeto com funções de callback: { onOrderbookUpdate, onUserTradeUpdate }
   */
  async connectWebSocket(callbacks) {
    throw new Error('O método connectWebSocket deve ser implementado pela subclasse.');
  }

  /**
   * Assina os canais do usuário.
   * @param {string[]} symbols - Lista de símbolos para assinar.
   * @param {string} apiKey - Chave da API para autenticação.
   * @param {string} apiSecret - Secret da API para autenticação.
   */
  async subscribeUserTrades(symbols, apiKey, apiSecret) {
    throw new Error('O método subscribeUserTrades deve ser implementado pela subclasse.');
  }

  /**
   * Assina o canal do orderbook.
   * @param {string[]} symbols - Lista de símbolos para assinar.
   */
  async subscribeOrderbook(symbols) {
    throw new Error('O método subscribeOrderbook deve ser implementado pela subclasse.');
  }

  /**
   * Obtém o snapshot do book de ofertas via API REST.
   * @param {string} symbol - Símbolo do mercado.
   */
  async getDepth(symbol) {
    throw new Error('O método getDepth deve ser implementado pela subclasse.');
  }

  /**
   * Obtém o preço de mercado mais recente.
   * @param {string} symbol - Símbolo do mercado.
   */
  async getMarketPrice(symbol) {
    throw new Error('O método getMarketPrice deve ser implementado pela subclasse.');
  }

  /**
   * Coloca uma ordem na exchange.
   * @param {string} symbol - Símbolo do mercado.
   * @param {string} side - 'BUY' ou 'SELL'.
   * @param {number} price - Preço da ordem.
   * @param {string} quantity - Quantidade da ordem.
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   * @param {object} options - Opções adicionais (ex: clientId).
   */
  async placeOrder(symbol, side, price, quantity, apiKey, apiSecret, options = {}) {
    throw new Error('O método placeOrder deve ser implementado pela subclasse.');
  }

  /**
   * Cancela uma ordem específica.
   * @param {string} symbol - Símbolo do mercado.
   * @param {string} orderId - ID da ordem.
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   */
  async cancelOrder(symbol, orderId, apiKey, apiSecret) {
    throw new Error('O método cancelOrder deve ser implementado pela subclasse.');
  }

  /**
   * Cancela todas as ordens abertas para um símbolo.
   * @param {string} symbol - Símbolo do mercado.
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   */
  async cancelAllOpenOrders(symbol, apiKey, apiSecret) {
    throw new Error('O método cancelAllOpenOrders deve ser implementado pela subclasse.');
  }

  // Métodos de utilidade que podem ser genéricos
  async getAccountBalance() {
    throw new Error('O método getAccountBalance deve ser implementado pela subclasse.');
  }

  /**
   * Obtém dados normalizados da conta para cálculo de quantidade
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   * @returns {object} Dados normalizados: { capitalAvailable, balances }
   */
  async getAccountData(apiKey, apiSecret) {
    throw new Error('O método getAccountData deve ser implementado pela subclasse.');
  }

  /**
   * Obtém informações de formatação específicas do mercado/token
   * @param {string} symbol - Símbolo do mercado.
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   * @returns {object} Dados do mercado: { decimal_quantity, decimal_price, stepSize_quantity, tickSize }
   */
  async getMarketInfo(symbol, apiKey, apiSecret) {
    throw new Error('O método getMarketInfo deve ser implementado pela subclasse.');
  }

  async getOpenOrders(symbol) {
    throw new Error('O método getOpenOrders deve ser implementado pela subclasse.');
  }

  // ============================================
  // 🔧 MÉTODOS ADICIONAIS PARA MIGRAÇÃO COMPLETA
  // ============================================

  /**
   * Account Management Methods
   */

  /**
   * Obtém informações completas da conta
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   * @returns {object} Informações completas da conta
   */
  async getAccount(apiKey, apiSecret) {
    throw new Error('O método getAccount deve ser implementado pela subclasse.');
  }

  /**
   * Obtém posições atuais da conta
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   * @returns {Array} Lista de posições ativas
   */
  async getPositions(apiKey, apiSecret) {
    throw new Error('O método getPositions deve ser implementado pela subclasse.');
  }

  /**
   * Obtém informações de capital/colateral
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   * @returns {object} Informações de capital e colateral
   */
  async getCapital(apiKey, apiSecret) {
    throw new Error('O método getCapital deve ser implementado pela subclasse.');
  }

  /**
   * Market Data Methods
   */

  /**
   * Obtém todos os mercados disponíveis
   * @returns {Array} Lista de mercados disponíveis
   */
  async getMarkets() {
    throw new Error('O método getMarkets deve ser implementado pela subclasse.');
  }

  /**
   * Obtém ticker para um símbolo específico
   * @param {string} symbol - Símbolo do mercado.
   * @returns {object} Dados do ticker (preço, volume, etc.)
   */
  async getTicker(symbol) {
    throw new Error('O método getTicker deve ser implementado pela subclasse.');
  }

  /**
   * Obtém dados de candlestick (klines)
   * @param {string} symbol - Símbolo do mercado.
   * @param {string} interval - Intervalo dos candles (1m, 5m, 1h, etc.).
   * @param {number} limit - Número de candles a retornar.
   * @returns {Array} Array de dados de candlestick
   */
  async getKlines(symbol, interval, limit = 100) {
    throw new Error('O método getKlines deve ser implementado pela subclasse.');
  }

  /**
   * Obtém trades recentes
   * @param {string} symbol - Símbolo do mercado.
   * @param {number} limit - Número de trades a retornar.
   * @returns {Array} Lista de trades recentes
   */
  async getTrades(symbol, limit = 100) {
    throw new Error('O método getTrades deve ser implementado pela subclasse.');
  }

  /**
   * Order Management Methods
   */

  /**
   * Obtém histórico de ordens
   * @param {string} symbol - Símbolo do mercado.
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   * @param {object} options - Opções adicionais (limit, startTime, endTime).
   * @returns {Array} Histórico de ordens
   */
  async getOrderHistory(symbol, apiKey, apiSecret, options = {}) {
    throw new Error('O método getOrderHistory deve ser implementado pela subclasse.');
  }

  /**
   * Obtém status de uma ordem específica
   * @param {string} symbol - Símbolo do mercado.
   * @param {string} orderId - ID da ordem.
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   * @returns {object} Status da ordem
   */
  async getOrderStatus(symbol, orderId, apiKey, apiSecret) {
    throw new Error('O método getOrderStatus deve ser implementado pela subclasse.');
  }

  /**
   * Modifica uma ordem existente
   * @param {string} symbol - Símbolo do mercado.
   * @param {string} orderId - ID da ordem.
   * @param {object} modifications - Modificações a aplicar (price, quantity, etc.).
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   * @returns {object} Ordem modificada
   */
  async modifyOrder(symbol, orderId, modifications, apiKey, apiSecret) {
    throw new Error('O método modifyOrder deve ser implementado pela subclasse.');
  }

  /**
   * Futures Specific Methods
   */

  /**
   * Obtém posições de futuros
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   * @returns {Array} Lista de posições de futuros
   */
  async getFuturesPositions(apiKey, apiSecret) {
    throw new Error('O método getFuturesPositions deve ser implementado pela subclasse.');
  }

  /**
   * Obtém balanço de futuros
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   * @returns {object} Balanço de futuros
   */
  async getFuturesBalance(apiKey, apiSecret) {
    throw new Error('O método getFuturesBalance deve ser implementado pela subclasse.');
  }

  /**
   * Altera alavancagem de uma posição
   * @param {string} symbol - Símbolo do mercado.
   * @param {number} leverage - Nova alavancagem.
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   * @returns {object} Resultado da alteração
   */
  async changeLeverage(symbol, leverage, apiKey, apiSecret) {
    throw new Error('O método changeLeverage deve ser implementado pela subclasse.');
  }

  /**
   * Utility Methods
   */

  /**
   * Obtém ordens abertas para um símbolo específico
   * @param {string} symbol - Símbolo do mercado.
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   * @returns {Array} Lista de ordens abertas
   */
  async getOpenOrdersForSymbol(symbol, apiKey, apiSecret) {
    throw new Error('O método getOpenOrdersForSymbol deve ser implementado pela subclasse.');
  }

  /**
   * Verifica se uma ordem foi executada
   * @param {string} symbol - Símbolo do mercado.
   * @param {string} orderId - ID da ordem.
   * @param {string} apiKey - API Key para autenticação.
   * @param {string} apiSecret - API Secret para autenticação.
   * @returns {boolean} True se a ordem foi executada
   */
  async isOrderFilled(symbol, orderId, apiKey, apiSecret) {
    const orderStatus = await this.getOrderStatus(symbol, orderId, apiKey, apiSecret);
    return orderStatus && (orderStatus.status === 'FILLED' || orderStatus.status === 'PARTIALLY_FILLED');
  }
}

export default BaseExchange;
