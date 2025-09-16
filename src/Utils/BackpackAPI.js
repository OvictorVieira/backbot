import requestManager from './RequestManager.js';
import Logger from './Logger.js';

/**
 * BackpackAPI - Wrapper específico para API da Backpack Exchange
 * Facilita migração das chamadas diretas para o sistema centralizado
 */
class BackpackAPI {
  constructor() {
    this.baseURL = process.env.API_URL || 'https://api.backpack.exchange';
    this.defaultTimeout = 30000; // 30 segundos
  }

  /**
   * GET request para API da Backpack
   * @param {string} endpoint - Endpoint da API (ex: '/api/v1/account')
   * @param {Object} options - Opções da request
   * @param {Object} options.headers - Headers HTTP
   * @param {Object} options.params - Query parameters
   * @param {number} options.timeout - Timeout em ms
   * @param {string} options.priority - Prioridade (CRITICAL, HIGH, MEDIUM, LOW)
   * @param {string} options.description - Descrição para logs
   * @returns {Promise} Response data
   */
  async get(endpoint, options = {}) {
    const {
      headers = {},
      params = {},
      timeout = this.defaultTimeout,
      priority = 'MEDIUM',
      description,
    } = options;

    const config = {
      method: 'GET',
      url: this.buildURL(endpoint),
      headers: this.buildHeaders(headers),
      params,
      timeout,
    };

    const desc = description || `GET ${endpoint}`;

    try {
      Logger.debug(`📤 [BACKPACK_API] Iniciando: ${desc}`);
      const response = await requestManager.request(config, desc, priority);
      Logger.debug(`📥 [BACKPACK_API] Sucesso: ${desc}`);
      return response.data;
    } catch (error) {
      Logger.error(`❌ [BACKPACK_API] Erro em ${desc}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * POST request para API da Backpack
   */
  async post(endpoint, data = {}, options = {}) {
    const { headers = {}, timeout = this.defaultTimeout, priority = 'HIGH', description } = options;

    const config = {
      method: 'POST',
      url: this.buildURL(endpoint),
      headers: this.buildHeaders(headers),
      data,
      timeout,
    };

    const desc = description || `POST ${endpoint}`;

    try {
      Logger.debug(`📤 [BACKPACK_API] Iniciando: ${desc}`);
      const response = await requestManager.request(config, desc, priority);
      Logger.debug(`📥 [BACKPACK_API] Sucesso: ${desc}`);
      return response.data;
    } catch (error) {
      Logger.error(`❌ [BACKPACK_API] Erro em ${desc}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * PUT request para API da Backpack
   */
  async put(endpoint, data = {}, options = {}) {
    const { headers = {}, timeout = this.defaultTimeout, priority = 'HIGH', description } = options;

    const config = {
      method: 'PUT',
      url: this.buildURL(endpoint),
      headers: this.buildHeaders(headers),
      data,
      timeout,
    };

    const desc = description || `PUT ${endpoint}`;

    try {
      Logger.debug(`📤 [BACKPACK_API] Iniciando: ${desc}`);
      const response = await requestManager.request(config, desc, priority);
      Logger.debug(`📥 [BACKPACK_API] Sucesso: ${desc}`);
      return response.data;
    } catch (error) {
      Logger.error(`❌ [BACKPACK_API] Erro em ${desc}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * DELETE request para API da Backpack
   */
  async delete(endpoint, options = {}) {
    const { headers = {}, timeout = this.defaultTimeout, priority = 'HIGH', description } = options;

    const config = {
      method: 'DELETE',
      url: this.buildURL(endpoint),
      headers: this.buildHeaders(headers),
      timeout,
    };

    const desc = description || `DELETE ${endpoint}`;

    try {
      Logger.debug(`📤 [BACKPACK_API] Iniciando: ${desc}`);
      const response = await requestManager.request(config, desc, priority);
      Logger.debug(`📥 [BACKPACK_API] Sucesso: ${desc}`);
      return response.data;
    } catch (error) {
      Logger.error(`❌ [BACKPACK_API] Erro em ${desc}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Constrói URL completa
   */
  buildURL(endpoint) {
    // Remove barra inicial se presente para evitar duplicação
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    return `${this.baseURL}/${cleanEndpoint}`;
  }

  /**
   * Constrói headers com defaults
   */
  buildHeaders(customHeaders = {}) {
    return {
      'Content-Type': 'application/json',
      'User-Agent': 'BackBot/1.6.3',
      ...customHeaders,
    };
  }

  /**
   * Métodos de conveniência para endpoints específicos da Backpack
   */

  // Account endpoints
  async getAccount(headers, description = 'Get Account') {
    return this.get('/api/v1/account', { headers, description, priority: 2 });
  }

  async getOpenPositions(headers, description = 'Get Open Positions') {
    return this.get('/api/v1/positions', { headers, description, priority: 1 });
  }

  async getCollateral(headers, description = 'Get Collateral') {
    return this.get('/api/v1/account/collateral', { headers, description, priority: 2 });
  }

  // Order endpoints
  async getOpenOrders(headers, params = {}, description = 'Get Open Orders') {
    return this.get('/api/v1/orders', { headers, params, description, priority: 1 });
  }

  async createOrder(orderData, headers, description = 'Create Order') {
    return this.post('/api/v1/orders', orderData, { headers, description, priority: 0 });
  }

  async cancelOrder(orderId, headers, description = 'Cancel Order') {
    return this.delete(`/api/v1/order/${orderId}`, { headers, description, priority: 1 });
  }

  async cancelAllOrders(symbol, headers, description = 'Cancel All Orders') {
    return this.delete(`/api/v1/orders`, {
      headers,
      description,
      priority: 0,
      params: symbol ? { symbol } : {},
    });
  }

  // Market endpoints
  async getMarkets(description = 'Get Markets') {
    return this.get('/api/v1/markets', { description, priority: 8 });
  }

  async getTicker(symbol, description = 'Get Ticker') {
    return this.get(`/api/v1/ticker?symbol=${symbol}`, { description, priority: 6 });
  }

  async getKlines(symbol, interval, startTime = null, endTime = null, description = 'Get Klines') {
    const params = { symbol, interval };
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;

    return this.get('/api/v1/klines', { params, description, priority: 7 });
  }

  // Capital endpoints
  async getDeposits(headers, description = 'Get Deposits') {
    return this.get('/api/v1/capital/deposits', { headers, description, priority: 9 });
  }

  async getWithdrawals(headers, description = 'Get Withdrawals') {
    return this.get('/api/v1/capital/withdrawals', { headers, description, priority: 9 });
  }

  // History endpoints
  async getOrderHistory(headers, params = {}, description = 'Get Order History') {
    return this.get('/api/v1/orders/history', { headers, params, description, priority: 8 });
  }

  async getFillHistory(headers, params = {}, description = 'Get Fill History') {
    return this.get('/api/v1/fills', { headers, params, description, priority: 8 });
  }

  /**
   * Status e debugging
   */
  getRequestManagerStatus() {
    return requestManager.getStatus();
  }

  logRequestManagerStatus() {
    requestManager.logStatus();
  }

  emergencyReset() {
    Logger.warn(`🚨 [BACKPACK_API] Executando reset emergencial do RequestManager`);
    requestManager.emergencyReset();
  }

  /**
   * Método para migration - mantém compatibilidade com axios direto
   * @deprecated Use os métodos específicos da classe
   */
  async axios(config, description) {
    Logger.warn(
      `⚠️ [BACKPACK_API] Uso de axios() está deprecated. Use métodos específicos da classe.`
    );
    return requestManager.request(config, description || 'Legacy Axios Call');
  }
}

// Instância singleton
const backpackAPI = new BackpackAPI();

export default backpackAPI;
