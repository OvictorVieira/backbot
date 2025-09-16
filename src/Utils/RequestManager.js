import axios from 'axios';
import https from 'https';
import http from 'http';
import { auth } from '../Backpack/Authenticated/Authentication.js';
import Logger from './Logger.js';
import TokenBucketRateLimiter from './TokenBucketRateLimiter.js';
import SmartCircuitBreaker from './SmartCircuitBreaker.js';
import PriorityRequestQueue from './PriorityRequestQueue.js';
import RequestHealthMonitor from './RequestHealthMonitor.js';

/**
 * RequestManager - Sistema profissional centralizado para gerenciar todas as requests da API Backpack
 *
 * Nova arquitetura baseada em padrões de trading de alta frequência:
 * - TokenBucketRateLimiter: Controle preciso de taxa com burst capacity
 * - SmartCircuitBreaker: Recuperação inteligente de falhas
 * - PriorityRequestQueue: Priorização de requests críticas
 * - RequestHealthMonitor: Monitoramento abrangente de saúde
 *
 * Elimina problemas de "death spiral" e garante operação contínua.
 */
class RequestManager {
  constructor() {
    // Professional components initialization
    this.rateLimiter = new TokenBucketRateLimiter({
      capacity: 10,
      refillRate: 3, // 3 requests per second (more generous for testing)
      burstCapacity: 8,
      minReserve: 1, // Reduced reserve for testing
    });

    this.circuitBreaker = new SmartCircuitBreaker({
      failureThreshold: 5,
      recoveryTime: 30000,
      successThreshold: 3,
      minHealthScore: 30,
    });

    this.requestQueue = new PriorityRequestQueue({
      maxQueueSize: 500,
      maxTotalSize: 2000,
      enableDeduplication: true,
      dedupTimeout: 10000,
    });

    this.healthMonitor = new RequestHealthMonitor({
      responseTimeWarning: 2000,
      responseTimeCritical: 5000,
      successRateCritical: 70,
      successRateWarning: 85,
      trendDetection: true,
      anomalyDetection: true,
    });

    // Legacy compatibility - maintain for existing code
    this.isProcessing = false;
    this.requestCount = 0;

    // HTTP/HTTPS Agents com Keep-Alive otimizado
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 20, // Reduzido para evitar overwhelming
      maxFreeSockets: 5,
      timeout: 30000,
      freeSocketTimeout: 15000,
      socketActiveTTL: 180000, // 3 minutos
    });

    this.httpAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 20,
      maxFreeSockets: 5,
      timeout: 30000,
      freeSocketTimeout: 15000,
      socketActiveTTL: 180000,
    });

    // Axios configuration otimizada
    this.axiosDefaults = {
      httpsAgent: this.httpsAgent,
      httpAgent: this.httpAgent,
      timeout: 25000, // Reduced timeout
      headers: {
        Connection: 'keep-alive',
        'Keep-Alive': 'timeout=30, max=100',
      },
    };

    this.httpClient = axios.create(this.axiosDefaults);

    // Statistics
    this.successCount = 0;
    this.errorCount = 0;
    this.startTime = Date.now();

    // Start unified request processor
    this.startRequestProcessor();

    Logger.info(
      `🚀 [REQUEST_MANAGER] New architecture initialized: TokenBucket(${this.rateLimiter.capacity} tokens), ` +
        `CircuitBreaker(${this.circuitBreaker.failureThreshold} threshold), Queue(${this.requestQueue.maxTotalSize} max)`
    );

    // Integration: Set up health monitor integration with queue
    this.setupHealthMonitorIntegration();
  }

  /**
   * Setup health monitor integration
   */
  setupHealthMonitorIntegration() {
    // Override health monitor's getQueueHealth method
    this.healthMonitor.getQueueHealth = () => {
      const stats = this.requestQueue.getStats();
      return {
        totalSize: stats.totalInQueue,
        prioritySizes: stats.queueSizes,
        avgWaitTime: stats.avgWaitTime,
      };
    };
  }

  /**
   * Start unified request processor
   */
  startRequestProcessor() {
    // Process queue every 500ms (less aggressive)
    setInterval(async () => {
      if (!this.isProcessing) {
        await this.processNextRequest();
      }
    }, 500);
  }

  /**
   * Process next request from priority queue
   */
  async processNextRequest() {
    if (this.isProcessing) return;

    const requestWrapper = this.requestQueue.dequeue();
    if (!requestWrapper) return;

    this.isProcessing = true;

    try {
      const result = await this.executeRequest(requestWrapper);
      requestWrapper.resolve(result);
    } catch (error) {
      requestWrapper.reject(error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Execute individual request with all safety measures
   */
  async executeRequest(requestWrapper) {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    // Start health monitoring
    this.healthMonitor.startRequest(requestId, {
      description: requestWrapper.request.description,
      priority: requestWrapper.priority,
      endpoint: requestWrapper.request.options.endpoint,
    });

    // Determine priority for rate limiter
    const rateLimiterPriority = this.mapPriorityToRateLimiter(requestWrapper.priority);

    try {
      // Try to consume tokens (with timeout for critical requests)
      const tokenTimeout = requestWrapper.priority === 'CRITICAL' ? 2000 : 5000; // Reduced timeouts
      const hasTokens = await this.rateLimiter.waitForTokens(1, rateLimiterPriority, tokenTimeout);

      if (!hasTokens) {
        throw new Error('Rate limiter timeout - tokens not available');
      }

      // Execute through circuit breaker
      const result = await this.circuitBreaker.execute(async () => {
        // Execute the request function - requestWrapper.request contains our request data
        return await requestWrapper.request.request();
      }, requestWrapper.request.options.type || 'API_REQUEST');

      // Success handling
      const responseTime = Date.now() - startTime;
      this.onRequestSuccess(responseTime, requestWrapper);

      // End health monitoring with success
      this.healthMonitor.endRequest(requestId, {
        success: true,
        responseTime,
        statusCode: result?.status,
        endpoint: requestWrapper.request.options.endpoint,
        method: requestWrapper.request.options.method,
        priority: requestWrapper.priority,
      });

      // Adaptive rate limiter adjustment
      this.rateLimiter.adaptiveAdjustment(false, responseTime);

      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorType = this.categorizeError(error);

      // Error handling
      this.onRequestError(error, requestWrapper, responseTime);

      // End health monitoring with error
      this.healthMonitor.endRequest(requestId, {
        success: false,
        responseTime,
        statusCode: error?.response?.status,
        errorType,
        errorMessage: error.message,
        endpoint: requestWrapper.request.options.endpoint,
        method: requestWrapper.request.options.method,
        priority: requestWrapper.priority,
      });

      // Adaptive adjustments
      const wasRateLimited = this.isRateLimitError(error);
      this.rateLimiter.adaptiveAdjustment(wasRateLimited, responseTime);

      throw error;
    }
  }

  /**
   * Enfileira uma request HTTP para processamento controlado
   * @param {Function} requestFunction - Função que retorna uma Promise da request
   * @param {string} description - Descrição da request para logs
   * @param {string|number} priority - Prioridade (CRITICAL, HIGH, MEDIUM, LOW ou 0-10 legacy)
   * @param {Object} options - Opções adicionais
   * @returns {Promise} - Promise que resolve com o resultado da request
   */
  async enqueue(requestFunction, description = 'API Request', priority = 'MEDIUM', options = {}) {
    // Convert legacy numeric priority to string
    const normalizedPriority = this.normalizePriority(priority);

    // Enhanced request wrapper
    const requestData = {
      request: requestFunction, // Don't execute yet, store the function
      description,
      options: {
        description,
        type: options.type || 'API_REQUEST',
        endpoint: options.endpoint,
        method: options.method,
        ...options,
      },
    };

    // Enqueue using professional priority queue
    return await this.requestQueue.enqueue(requestData, normalizedPriority, options);
  }

  /**
   * Normalize priority from legacy numeric or string format
   */
  normalizePriority(priority) {
    if (typeof priority === 'string') {
      return priority.toUpperCase();
    }

    // Convert legacy numeric priority (0-10) to string
    if (priority <= 1) return 'CRITICAL';
    if (priority <= 3) return 'HIGH';
    if (priority <= 7) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Map priority to rate limiter priority
   */
  mapPriorityToRateLimiter(priority) {
    const mapping = {
      CRITICAL: 'CRITICAL',
      HIGH: 'HIGH',
      MEDIUM: 'MEDIUM',
      LOW: 'LOW',
    };
    return mapping[priority] || 'MEDIUM';
  }

  /**
   * Categorize error for circuit breaker and monitoring
   */
  categorizeError(error) {
    const message = error.message?.toUpperCase() || '';
    const code = error.code?.toUpperCase() || '';
    const status = error?.response?.status;

    if (status === 429 || message.includes('RATE') || message.includes('LIMIT')) {
      return 'RATE_LIMIT';
    }
    if (message.includes('TIMEOUT') || code === 'ETIMEDOUT') {
      return 'TIMEOUT';
    }
    if (message.includes('NETWORK') || message.includes('ECONNRESET')) {
      return 'NETWORK_ERROR';
    }
    if (message.includes('AUTH') || status === 401 || status === 403) {
      return 'AUTHENTICATION_ERROR';
    }
    if (status && status >= 500) {
      return 'SERVER_ERROR';
    }

    return 'UNKNOWN_ERROR';
  }

  /**
   * Success handler with updated logic
   */
  onRequestSuccess(responseTime, requestWrapper) {
    this.successCount++;
    this.requestCount++;

    // Set market conditions based on response time
    if (responseTime > 3000) {
      this.requestQueue.setMarketConditions('VOLATILE');
    } else if (responseTime < 1000 && this.requestQueue.marketConditions !== 'NORMAL') {
      this.requestQueue.setMarketConditions('NORMAL');
    }

    Logger.debug(`✅ [REQUEST_MANAGER] Success: ${requestWrapper.description} (${responseTime}ms)`);
  }

  /**
   * Error handler with updated logic
   */
  onRequestError(error, requestWrapper, responseTime) {
    this.errorCount++;

    // Set critical market conditions for severe errors
    if (this.categorizeError(error) === 'RATE_LIMIT') {
      this.requestQueue.setMarketConditions('CRITICAL');
    }

    Logger.error(
      `❌ [REQUEST_MANAGER] Error: ${requestWrapper.description} (${responseTime}ms) - ${error.message}`
    );
  }

  /**
   * Legacy circuit breaker check - now delegates to SmartCircuitBreaker
   */
  isCircuitBreakerActive() {
    const healthStatus = this.circuitBreaker.isHealthy();
    return this.circuitBreaker.state === 'OPEN';
  }

  /**
   * Verifica se o erro é de rate limit
   */
  isRateLimitError(error) {
    const errorString = String(error?.response?.data || error?.message || error).toLowerCase();
    return (
      error?.response?.status === 429 ||
      errorString.includes('too_many_requests') ||
      errorString.includes('rate limit') ||
      errorString.includes('too many requests') ||
      errorString.includes('exceeded the rate limit')
    );
  }

  /**
   * Determina se deve tentar retry para um erro
   */
  shouldRetry(error) {
    const retryableCodes = [502, 503, 504, 408, 429];
    const retryableMessages = [
      'timeout',
      'etimedout',
      'network',
      'connection',
      'econnreset',
      'econnrefused',
      'socket hang up',
    ];

    if (error?.response?.status && retryableCodes.includes(error.response.status)) {
      return true;
    }

    const errorString = String(error?.message || error).toLowerCase();
    const shouldRetryResult = retryableMessages.some(msg => errorString.includes(msg));

    // Log específico para conexões com problema
    if (errorString.includes('econnrefused')) {
      Logger.warn(`🔌 [CONNECTION_RETRY] ECONNREFUSED detectado - tentando retry com keep-alive`);
    } else if (errorString.includes('etimedout')) {
      Logger.warn(`⏱️ [TIMEOUT_RETRY] ETIMEDOUT detectado - tentando retry com timeout estendido`);
    }

    return shouldRetryResult;
  }

  /**
   * Calcula delay para retry com backoff exponencial
   */
  calculateRetryDelay(retryCount) {
    const baseDelay = 2000; // 2 segundos base
    const jitter = Math.random() * 1000; // Jitter de até 1 segundo
    return Math.min(baseDelay * Math.pow(this.retryMultiplier, retryCount) + jitter, 30000);
  }

  /**
   * Wrapper para requests HTTP com configuração automática e keep-alive
   */
  async request(config, description = 'HTTP Request', priority = 'MEDIUM', options = {}) {
    const requestFunction = async () => {
      // Merge configurações do usuário com defaults (keep-alive agents)
      const finalConfig = {
        ...this.axiosDefaults,
        ...config,
        headers: {
          ...this.axiosDefaults.headers,
          ...config.headers,
        },
      };

      return await axios(finalConfig);
    };

    const enhancedOptions = {
      ...options,
      endpoint: config.url || options.endpoint,
      method: config.method || 'GET',
    };

    return this.enqueue(requestFunction, description, priority, enhancedOptions);
  }

  /**
   * Wrapper para GET requests
   */
  async get(url, config = {}, description = `GET ${url}`, priority = 'MEDIUM') {
    return this.request({ method: 'GET', url, ...config }, description, priority, {
      type: 'GET_REQUEST',
    });
  }

  /**
   * Wrapper para POST requests
   */
  async post(url, data = {}, config = {}, description = `POST ${url}`, priority = 'HIGH') {
    return this.request({ method: 'POST', url, data, ...config }, description, priority, {
      type: 'POST_REQUEST',
    });
  }

  /**
   * Wrapper para PUT requests
   */
  async put(url, data = {}, config = {}, description = `PUT ${url}`, priority = 'HIGH') {
    return this.request({ method: 'PUT', url, data, ...config }, description, priority, {
      type: 'PUT_REQUEST',
    });
  }

  /**
   * Wrapper para DELETE requests
   */
  async delete(url, config = {}, description = `DELETE ${url}`, priority = 'HIGH') {
    return this.request({ method: 'DELETE', url, ...config }, description, priority, {
      type: 'DELETE_REQUEST',
    });
  }

  /**
   * Requisição direta (sem fila) para casos específicos como dashboard
   * Use apenas quando precisar de resposta imediata
   */
  async directRequest(method, url, config = {}) {
    try {
      const finalConfig = {
        ...this.axiosDefaults,
        ...config,
        headers: {
          ...this.axiosDefaults.headers,
          ...config.headers,
        },
      };

      if (method === 'GET') {
        return await this.httpClient.get(url, finalConfig);
      } else if (method === 'POST') {
        return await this.httpClient.post(url, finalConfig.data || {}, finalConfig);
      } else if (method === 'DELETE') {
        return await this.httpClient.delete(url, finalConfig);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * GET direto (sem fila)
   */
  async directGet(url, config = {}) {
    return this.directRequest('GET', url, config);
  }

  /**
   * Utilitário de delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gera ID único para request
   */
  generateRequestId() {
    return Math.random().toString(36).substr(2, 9);
  }

  /**
   * ✅ ENHANCED: Authenticated request with professional components integration
   * Generates timestamp immediately before HTTP call to prevent expiration
   */
  async authenticatedRequest(method, url, config = {}, authParams, description, priority = 'HIGH') {
    const requestFunction = async () => {
      // 🚀 CRITICAL: Generate timestamp RIGHT before the HTTP call
      const timestamp = Date.now();

      // Debug: verificar se auth está disponível
      if (!auth || typeof auth !== 'function') {
        Logger.error(`❌ [AUTH_ERROR] auth is not available: ${typeof auth}`);
        throw new Error('auth function is not available');
      }

      const headers = auth({
        ...authParams,
        timestamp,
      });

      // Merge auth headers with any existing headers
      const finalConfig = {
        ...this.axiosDefaults,
        ...config,
        headers: {
          ...this.axiosDefaults.headers,
          ...headers,
          ...(config.headers || {}),
        },
      };

      if (method === 'GET') {
        return await this.httpClient.get(url, finalConfig);
      } else if (method === 'POST') {
        return await this.httpClient.post(url, finalConfig.data || {}, finalConfig);
      } else if (method === 'DELETE') {
        return await this.httpClient.delete(url, finalConfig);
      } else {
        throw new Error(`Unsupported HTTP method: ${method}`);
      }
    };

    const options = {
      type: 'AUTHENTICATED_REQUEST',
      endpoint: url,
      method,
      requiresAuth: true,
    };

    return this.enqueue(requestFunction, description, priority, options);
  }

  /**
   * Authenticated GET wrapper
   */
  async authenticatedGet(url, config = {}, authParams, description, priority = 'HIGH') {
    return this.authenticatedRequest('GET', url, config, authParams, description, priority);
  }

  /**
   * Authenticated POST wrapper
   */
  async authenticatedPost(url, data, config = {}, authParams, description, priority = 'CRITICAL') {
    return this.authenticatedRequest(
      'POST',
      url,
      { ...config, data },
      authParams,
      description,
      priority
    );
  }

  /**
   * Authenticated DELETE wrapper
   */
  async authenticatedDelete(url, config = {}, authParams, description, priority = 'CRITICAL') {
    return this.authenticatedRequest('DELETE', url, config, authParams, description, priority);
  }

  /**
   * Obtém estatísticas detalhadas do sistema com nova arquitetura
   */
  getStatus() {
    const uptime = Date.now() - this.startTime;
    const successRate =
      this.requestCount > 0 ? ((this.successCount / this.requestCount) * 100).toFixed(1) : 0;

    // Get stats from professional components
    const rateLimiterStats = this.rateLimiter.getStats();
    const circuitBreakerStats = this.circuitBreaker.getStats();
    const queueStats = this.requestQueue.getStats();
    const healthReport = this.healthMonitor.getHealthReport();

    return {
      // Legacy compatibility
      queueLength: queueStats.totalInQueue,
      isProcessing: this.isProcessing,
      circuitBreakerActive: circuitBreakerStats.state !== 'CLOSED',
      requestCount: this.requestCount,
      successCount: this.successCount,
      errorCount: this.errorCount,
      successRate: `${successRate}%`,
      uptime: `${Math.floor(uptime / 60000)}m ${Math.floor((uptime % 60000) / 1000)}s`,

      // Professional components stats
      rateLimiter: {
        tokens: rateLimiterStats.tokens,
        capacity: rateLimiterStats.capacity,
        refillRate: rateLimiterStats.refillRate,
        utilizationPercent: rateLimiterStats.utilizationPercent,
        healthy: this.rateLimiter.isHealthy().healthy,
      },

      circuitBreaker: {
        state: circuitBreakerStats.state,
        healthScore: circuitBreakerStats.healthScore,
        consecutiveFailures: circuitBreakerStats.consecutiveFailures,
        recentFailureRate: circuitBreakerStats.failureRate,
        healthy: this.circuitBreaker.isHealthy().healthy,
      },

      queue: {
        totalSize: queueStats.totalInQueue,
        prioritySizes: queueStats.queueSizes,
        avgWaitTime: queueStats.avgWaitTime,
        rejectionRate: queueStats.rejectionRate || '0.0%',
        healthy: this.requestQueue.isHealthy().healthy,
      },

      health: {
        overall: healthReport.healthStatus?.overall || 'UNKNOWN',
        score: healthReport.healthStatus?.score || 0,
        activeRequests: healthReport.activeRequests,
        memoryUsage: healthReport.memoryUsage,
      },

      // Connection Pool (legacy)
      keepAliveEnabled: this.httpsAgent.keepAlive,
      maxSockets: this.httpsAgent.maxSockets,
      maxFreeSockets: this.httpsAgent.maxFreeSockets,
      activeSockets: this.httpsAgent.sockets ? Object.keys(this.httpsAgent.sockets).length : 0,
      freeSockets: this.httpsAgent.freeSockets
        ? Object.keys(this.httpsAgent.freeSockets).length
        : 0,
    };
  }

  /**
   * Força reset do sistema (emergência) com nova arquitetura
   */
  emergencyReset() {
    Logger.warn(`🚨 [REQUEST_MANAGER] EMERGENCY RESET executado!`);

    // Reset professional components
    this.requestQueue.clear();
    this.circuitBreaker.reset();
    this.rateLimiter.reset();

    // Reset legacy state
    this.isProcessing = false;
    this.requestCount = 0;
    this.successCount = 0;
    this.errorCount = 0;

    Logger.info(`✅ [REQUEST_MANAGER] Emergency reset concluído - sistema profissional reiniciado`);
  }

  /**
   * Force reset completo (mesmo método que o forceReset original)
   */
  forceReset() {
    this.emergencyReset();
  }

  /**
   * Log do status atual com nova arquitetura
   */
  logStatus() {
    const status = this.getStatus();

    Logger.info(
      `📊 [REQUEST_MANAGER] Professional Status: Queue(${status.queueLength}) | ` +
        `Health(${status.health.overall}:${status.health.score}) | Success(${status.successRate}) | Uptime(${status.uptime})`
    );

    Logger.info(
      `🪣 [RATE_LIMITER] Tokens: ${status.rateLimiter.tokens}/${status.rateLimiter.capacity} | ` +
        `Rate: ${status.rateLimiter.refillRate}/s | Health: ${status.rateLimiter.healthy ? '✅' : '❌'}`
    );

    Logger.info(
      `🔌 [CIRCUIT_BREAKER] State: ${status.circuitBreaker.state} | ` +
        `Health: ${status.circuitBreaker.healthScore} | Failures: ${status.circuitBreaker.consecutiveFailures} | ` +
        `Status: ${status.circuitBreaker.healthy ? '✅' : '❌'}`
    );

    Logger.info(
      `📋 [PRIORITY_QUEUE] Total: ${status.queue.totalSize} | ` +
        `Wait: ${status.queue.avgWaitTime}ms | Rejection: ${status.queue.rejectionRate} | ` +
        `Status: ${status.queue.healthy ? '✅' : '❌'}`
    );

    // Log additional component details
    this.rateLimiter.logStatus();
    this.circuitBreaker.logStatus();
    this.requestQueue.logStatus();
    this.healthMonitor.logStatus();
  }

  /**
   * Obtém estatísticas detalhadas das conexões
   */
  getConnectionStats() {
    return {
      https: {
        keepAlive: this.httpsAgent.keepAlive,
        maxSockets: this.httpsAgent.maxSockets,
        maxFreeSockets: this.httpsAgent.maxFreeSockets,
        activeSockets: this.httpsAgent.sockets ? Object.keys(this.httpsAgent.sockets).length : 0,
        freeSockets: this.httpsAgent.freeSockets
          ? Object.keys(this.httpsAgent.freeSockets).length
          : 0,
        requests: this.httpsAgent.requests ? Object.keys(this.httpsAgent.requests).length : 0,
      },
      http: {
        keepAlive: this.httpAgent.keepAlive,
        maxSockets: this.httpAgent.maxSockets,
        maxFreeSockets: this.httpAgent.maxFreeSockets,
        activeSockets: this.httpAgent.sockets ? Object.keys(this.httpAgent.sockets).length : 0,
        freeSockets: this.httpAgent.freeSockets
          ? Object.keys(this.httpAgent.freeSockets).length
          : 0,
        requests: this.httpAgent.requests ? Object.keys(this.httpAgent.requests).length : 0,
      },
    };
  }

  /**
   * Get comprehensive health status for monitoring
   */
  getHealthStatus() {
    const healthReport = this.healthMonitor.getHealthReport();
    return {
      overall: healthReport.healthStatus?.overall || 'UNKNOWN',
      components: {
        rateLimiter: this.rateLimiter.isHealthy(),
        circuitBreaker: this.circuitBreaker.isHealthy(),
        queue: this.requestQueue.isHealthy(),
        system: healthReport.healthStatus,
      },
      metrics: {
        successRate:
          this.requestCount > 0 ? ((this.successCount / this.requestCount) * 100).toFixed(1) : 0,
        activeRequests: healthReport.activeRequests,
        memoryUsage: healthReport.memoryUsage,
        uptime: Date.now() - this.startTime,
      },
    };
  }
}

// Instância singleton global
const requestManager = new RequestManager();

// Log status a cada 5 minutos se houver atividade
setInterval(() => {
  if (requestManager.requestCount > 0) {
    requestManager.logStatus();
  }
}, 300000);

export default requestManager;
