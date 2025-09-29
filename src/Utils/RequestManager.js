import axios from 'axios';
import https from 'https';
import http from 'http';
import { auth } from '../Backpack/Authenticated/Authentication.js';
import Logger from './Logger.js';

/**
 * RequestManager - Sistema simplificado para requests em tempo real
 *
 * Características:
 * - Requests diretas sem filas
 * - Rate limiting básico
 * - Responses imediatas
 */
class RequestManager {
  constructor() {
    // Rate limiting básico
    this.lastRequestTime = 0;
    this.minRequestInterval = 333; // ~3 requests per second
    this.requestCount = 0;
    this.successCount = 0;
    this.errorCount = 0;
    this.startTime = Date.now();

    // HTTP/HTTPS Agents com Keep-Alive otimizado
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 10,
      maxFreeSockets: 3,
      timeout: 30000,
      freeSocketTimeout: 15000,
      socketActiveTTL: 180000,
    });

    this.httpAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 10,
      maxFreeSockets: 3,
      timeout: 30000,
      freeSocketTimeout: 15000,
      socketActiveTTL: 180000,
    });

    // Axios configuration
    this.axiosDefaults = {
      httpsAgent: this.httpsAgent,
      httpAgent: this.httpAgent,
      timeout: 25000,
      headers: {
        Connection: 'keep-alive',
        'Keep-Alive': 'timeout=30, max=100',
      },
    };

    this.httpClient = axios.create(this.axiosDefaults);

    Logger.info('🚀 [REQUEST_MANAGER] Initialized - Direct requests, no queues');
  }

  /**
   * Rate limiting básico com delay
   */
  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      const delay = this.minRequestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Request GET direta
   */
  async get(url, config = {}, description = 'GET Request') {
    await this.waitForRateLimit();

    try {
      this.requestCount++;
      const startTime = Date.now();

      const response = await this.httpClient.get(url, {
        ...this.axiosDefaults,
        ...config,
      });

      this.successCount++;
      const responseTime = Date.now() - startTime;
      Logger.debug(`✅ [DIRECT_GET] ${description} (${responseTime}ms)`);

      return response;
    } catch (error) {
      this.errorCount++;
      Logger.debug(`❌ [DIRECT_GET] ${description}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Request POST direta
   */
  async post(url, data = {}, config = {}, description = 'POST Request') {
    await this.waitForRateLimit();

    try {
      this.requestCount++;
      const startTime = Date.now();

      const response = await this.httpClient.post(url, data, {
        ...this.axiosDefaults,
        ...config,
      });

      this.successCount++;
      const responseTime = Date.now() - startTime;
      Logger.debug(`✅ [DIRECT_POST] ${description} (${responseTime}ms)`);

      return response;
    } catch (error) {
      this.errorCount++;
      Logger.debug(`❌ [DIRECT_POST] ${description}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Request DELETE direta
   */
  async delete(url, config = {}, description = 'DELETE Request') {
    await this.waitForRateLimit();

    try {
      this.requestCount++;
      const startTime = Date.now();

      const response = await this.httpClient.delete(url, {
        ...this.axiosDefaults,
        ...config,
      });

      this.successCount++;
      const responseTime = Date.now() - startTime;
      Logger.debug(`✅ [DIRECT_DELETE] ${description} (${responseTime}ms)`);

      return response;
    } catch (error) {
      this.errorCount++;
      Logger.debug(`❌ [DIRECT_DELETE] ${description}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Request autenticada DIRETA - SEM FILAS
   */
  async authenticatedRequest(method, url, config = {}, authParams, description) {
    await this.waitForRateLimit();

    try {
      this.requestCount++;
      const timestamp = Date.now();

      if (!auth || typeof auth !== 'function') {
        throw new Error('auth function is not available');
      }

      const headers = auth({
        ...authParams,
        timestamp,
      });

      const finalConfig = {
        ...this.axiosDefaults,
        ...config,
        headers: {
          ...this.axiosDefaults.headers,
          ...headers,
          ...(config.headers || {}),
        },
      };

      const startTime = Date.now();
      let response;

      // EXECUÇÃO DIRETA - SEM FILAS
      if (method === 'GET') {
        response = await this.httpClient.get(url, finalConfig);
      } else if (method === 'POST') {
        response = await this.httpClient.post(url, finalConfig.data || {}, finalConfig);
      } else if (method === 'DELETE') {
        response = await this.httpClient.delete(url, finalConfig);
      } else {
        throw new Error(`Unsupported HTTP method: ${method}`);
      }

      this.successCount++;
      const responseTime = Date.now() - startTime;
      Logger.debug(`✅ [DIRECT_AUTH] ${description} (${responseTime}ms)`);

      return response;
    } catch (error) {
      this.errorCount++;
      Logger.debug(
        `❌ [REQUEST_MANAGER] Error: ${description} (${Date.now() - Date.now()}ms) - ${error.response?.data?.message || error.message}`
      );
      throw error;
    }
  }

  /**
   * Authenticated GET wrapper - DIRETO
   */
  async authenticatedGet(url, config = {}, authParams, description) {
    return this.authenticatedRequest('GET', url, config, authParams, description);
  }

  /**
   * Authenticated POST wrapper - DIRETO
   */
  async authenticatedPost(url, data, config = {}, authParams, description) {
    return this.authenticatedRequest('POST', url, { ...config, data }, authParams, description);
  }

  /**
   * Authenticated DELETE wrapper - DIRETO
   */
  async authenticatedDelete(url, config = {}, authParams, description) {
    return this.authenticatedRequest('DELETE', url, config, authParams, description);
  }

  /**
   * Direct GET sem autenticação
   */
  async directGet(url, description = 'Direct GET') {
    return this.get(url, {}, description);
  }

  /**
   * Statistics simplificadas
   */
  getStatus() {
    const uptime = Date.now() - this.startTime;
    const successRate =
      this.requestCount > 0 ? ((this.successCount / this.requestCount) * 100).toFixed(1) : 0;

    return {
      queueLength: 0, // No queue
      isProcessing: false, // Direct requests
      requestCount: this.requestCount,
      successCount: this.successCount,
      errorCount: this.errorCount,
      successRate: `${successRate}%`,
      uptime: uptime,
      healthy: this.successCount >= this.errorCount,
    };
  }

  /**
   * Reset statistics
   */
  forceReset() {
    this.requestCount = 0;
    this.successCount = 0;
    this.errorCount = 0;
    this.lastRequestTime = 0;
    this.startTime = Date.now();
    Logger.debug('🔄 [REQUEST_MANAGER] Statistics reset');
  }

  /**
   * Log status
   */
  logStatus() {
    const status = this.getStatus();
    Logger.info(
      `📊 [REQUEST_MANAGER] Requests: ${status.requestCount}, Success: ${status.successRate}, Uptime: ${Math.round(status.uptime / 1000)}s`
    );
  }
}

// Export singleton instance for consistency across the app
export default new RequestManager();
