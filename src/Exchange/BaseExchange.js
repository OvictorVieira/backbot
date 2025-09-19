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
   * @param {number} quantity - Quantidade da ordem.
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
}

export default BaseExchange;
