import axios from 'axios';
import https from 'https';
import http from 'http';
import { auth } from '../Backpack/Authenticated/Authentication.js';
import Logger from './Logger.js';

/**
 * RequestManager - Sistema centralizado para gerenciar todas as requests da API Backpack
 * Inclui circuit breaker, rate limiting inteligente, recovery automático e connection pooling
 */
class RequestManager {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.requestCount = 0;
    this.lastRequestTime = 0;

    // HTTP/HTTPS Agents com Keep-Alive para connection pooling
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000, // 30 segundos entre keep-alive packets
      maxSockets: 50, // Máximo de sockets por host
      maxFreeSockets: 10, // Máximo de sockets livres no pool
      timeout: 45000, // 45 segundos timeout para sockets
      freeSocketTimeout: 30000, // 30 segundos para liberar socket idle
      socketActiveTTL: 300000, // 5 minutos TTL para sockets ativos
    });

    this.httpAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: 45000,
      freeSocketTimeout: 30000,
      socketActiveTTL: 300000,
    });

    // Configuração padrão do Axios com agents
    this.axiosDefaults = {
      httpsAgent: this.httpsAgent,
      httpAgent: this.httpAgent,
      timeout: 40000, // 40 segundos timeout para axios (menor que socket)
      headers: {
        Connection: 'keep-alive',
        'Keep-Alive': 'timeout=30, max=100',
      },
    };

    // Instância configurada do axios
    this.httpClient = axios.create(this.axiosDefaults);

    // Rate Limiting
    this.minDelay = 1500; // 1.5 segundos mínimo entre requests
    this.adaptiveDelay = 1500; // Delay adaptativo
    this.maxDelay = 300000; // Máximo 5 minutos

    // Circuit Breaker
    this.rateLimitCount = 0;
    this.consecutiveRateLimits = 0;
    this.maxConsecutiveRateLimits = 3;
    this.circuitBreakerActive = false;
    this.circuitBreakerUntil = 0;
    this.circuitBreakerDuration = 300000; // 5 minutos

    // Retry Logic
    this.maxRetries = 3;
    this.retryMultiplier = 2;

    // Statistics
    this.successCount = 0;
    this.errorCount = 0;
    this.startTime = Date.now();

    Logger.info(
      `🔧 [REQUEST_MANAGER] Sistema iniciado - Keep-Alive ativado, Min delay: ${this.minDelay}ms, Circuit breaker: ${this.circuitBreakerDuration / 1000}s`
    );
    Logger.info(
      `🌐 [CONNECTION_POOL] HTTPS Agent: maxSockets=${this.httpsAgent?.maxSockets}, maxFreeSockets=${this.httpsAgent?.maxFreeSockets}, keepAlive=${this.httpsAgent?.keepAlive}`
    );
  }

  /**
   * Enfileira uma request HTTP para processamento controlado
   * @param {Function} requestFunction - Função que retorna uma Promise da request
   * @param {string} description - Descrição da request para logs
   * @param {number} priority - Prioridade (0 = alta, 10 = baixa)
   * @param {number} maxRetries - Número máximo de tentativas
   * @returns {Promise} - Promise que resolve com o resultado da request
   */
  async enqueue(
    requestFunction,
    description = 'API Request',
    priority = 5,
    maxRetries = this.maxRetries
  ) {
    return new Promise((resolve, reject) => {
      // Verifica circuit breaker
      if (this.isCircuitBreakerActive()) {
        const remainingTime = Math.ceil((this.circuitBreakerUntil - Date.now()) / 1000);
        Logger.warn(
          `🚨 [REQUEST_MANAGER] Circuit breaker ativo! Rejeitando request: ${description} (${remainingTime}s restantes)`
        );
        reject(new Error(`Circuit breaker ativo. Tente novamente em ${remainingTime}s`));
        return;
      }

      const request = {
        requestFunction,
        description,
        priority,
        maxRetries,
        retryCount: 0,
        resolve,
        reject,
        timestamp: Date.now(),
        id: this.generateRequestId(),
      };

      // Insere na posição correta baseado na prioridade
      this.insertByPriority(request);

      Logger.debug(
        `📋 [REQUEST_MANAGER] Request enfileirada: ${description} (ID: ${request.id}, Prioridade: ${priority}, Fila: ${this.queue.length})`
      );

      // Inicia processamento se não estiver processando
      if (!this.isProcessing && !this.isCircuitBreakerActive()) {
        this.processQueue();
      } else if (this.isProcessing) {
        Logger.debug(
          `⏳ [REQUEST_MANAGER] Fila crescendo: ${this.queue.length} requests (processamento em andamento)`
        );
      }
    });
  }

  /**
   * Insere request na fila ordenada por prioridade
   */
  insertByPriority(request) {
    let insertIndex = this.queue.length;

    // Encontra posição correta baseada na prioridade (0 = mais alta)
    for (let i = 0; i < this.queue.length; i++) {
      if (request.priority < this.queue[i].priority) {
        insertIndex = i;
        break;
      }
    }

    this.queue.splice(insertIndex, 0, request);
  }

  /**
   * Processa a fila de requests com controle de rate limit
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0 || this.isCircuitBreakerActive()) {
      return;
    }

    this.isProcessing = true;
    Logger.debug(
      `🔄 [REQUEST_MANAGER] Iniciando processamento (${this.queue.length} requests na fila)`
    );

    // Timeout de segurança para evitar travamento indefinido
    const processTimeout = setTimeout(() => {
      Logger.error(
        '🚨 [REQUEST_MANAGER] TIMEOUT DE SEGURANÇA: Processamento da fila travado por mais de 2 minutos!'
      );
      Logger.error(
        `🚨 [REQUEST_MANAGER] Limpando fila com ${this.queue.length} requests pendentes`
      );

      // Rejeita todos os requests pendentes para evitar memory leak
      while (this.queue.length > 0) {
        const request = this.queue.shift();
        if (request && request.reject) {
          request.reject(new Error('Request timeout - fila travada'));
        }
      }

      this.isProcessing = false;
      this.lastRequestTime = 0; // Reset rate limiting

      Logger.info('🔄 [REQUEST_MANAGER] Fila limpa e processamento reiniciado');

      // Força reinício do processamento se houver novos itens
      setTimeout(() => {
        if (this.queue.length > 0) {
          this.processQueue();
        }
      }, 1000);
    }, 120000); // 2 minutos (mais agressivo)

    while (this.queue.length > 0 && !this.isCircuitBreakerActive()) {
      const request = this.queue.shift();

      try {
        // Aplica delay entre requests
        await this.waitForNextRequest();

        Logger.debug(
          `🚀 [REQUEST_MANAGER] Executando: ${request.description} (ID: ${request.id}, Tentativa: ${request.retryCount + 1}/${request.maxRetries + 1})`
        );

        // Executa a request com timeout de segurança
        const startTime = Date.now();
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout de 45s atingido')), 45000);
        });

        const result = await Promise.race([request.requestFunction(), timeoutPromise]);
        const duration = Date.now() - startTime;

        // Request bem-sucedida
        this.onRequestSuccess(request, duration);
        request.resolve(result);
      } catch (error) {
        await this.handleRequestError(request, error);
      }
    }

    // Limpa o timeout de segurança
    clearTimeout(processTimeout);
    this.isProcessing = false;
    Logger.debug(`✅ [REQUEST_MANAGER] Processamento concluído (Fila: ${this.queue.length})`);
  }

  /**
   * Aguarda o tempo necessário entre requests
   */
  async waitForNextRequest() {
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.adaptiveDelay) {
      const waitTime = this.adaptiveDelay - timeSinceLastRequest;
      Logger.debug(
        `⏳ [REQUEST_MANAGER] Aguardando ${waitTime}ms (Delay atual: ${this.adaptiveDelay}ms)`
      );
      await this.delay(waitTime);
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Manipula sucesso de request
   */
  onRequestSuccess(request, duration) {
    this.successCount++;
    this.requestCount++;
    this.consecutiveRateLimits = 0; // Reset contador

    // Reduz delay gradualmente após sucesso
    if (this.adaptiveDelay > this.minDelay) {
      const previousDelay = this.adaptiveDelay;
      this.adaptiveDelay = Math.max(this.minDelay, this.adaptiveDelay * 0.95);

      if (previousDelay !== this.adaptiveDelay) {
        Logger.debug(
          `📉 [REQUEST_MANAGER] Delay reduzido: ${previousDelay}ms → ${this.adaptiveDelay}ms`
        );
      }
    }

    Logger.debug(`✅ [REQUEST_MANAGER] Sucesso: ${request.description} (${duration}ms)`);
  }

  /**
   * Manipula erro de request com retry inteligente
   */
  async handleRequestError(request, error) {
    this.errorCount++;
    const isRateLimit = this.isRateLimitError(error);

    if (isRateLimit) {
      await this.handleRateLimit(request, error);
    } else if (request.retryCount < request.maxRetries && this.shouldRetry(error)) {
      // Retry para outros erros
      request.retryCount++;
      const retryDelay = this.calculateRetryDelay(request.retryCount);

      Logger.warn(
        `🔄 [REQUEST_MANAGER] Retry ${request.retryCount}/${request.maxRetries} para: ${request.description} em ${retryDelay}ms - Erro: ${error.message}`
      );

      await this.delay(retryDelay);
      this.queue.unshift(request);
    } else {
      Logger.error(`❌ [REQUEST_MANAGER] Erro final em: ${request.description} - ${error.message}`);
      request.reject(error);
    }
  }

  /**
   * Manipula rate limit com circuit breaker
   */
  async handleRateLimit(request, error) {
    this.rateLimitCount++;
    this.consecutiveRateLimits++;

    // Aumenta delay drasticamente
    const previousDelay = this.adaptiveDelay;
    this.adaptiveDelay = Math.min(this.adaptiveDelay * 2.5, this.maxDelay);

    Logger.warn(
      `⏰ [REQUEST_MANAGER] Rate limit #${this.rateLimitCount} detectado! Consecutivos: ${this.consecutiveRateLimits}`
    );
    Logger.warn(
      `📈 [REQUEST_MANAGER] Delay aumentado: ${previousDelay}ms → ${this.adaptiveDelay}ms`
    );

    // Ativa circuit breaker se muitos rate limits consecutivos
    if (this.consecutiveRateLimits >= this.maxConsecutiveRateLimits) {
      this.activateCircuitBreaker();
      request.reject(
        new Error(
          `Circuit breaker ativado após ${this.consecutiveRateLimits} rate limits consecutivos`
        )
      );
      return;
    }

    // Recoloca request na fila para retry
    Logger.warn(`🔄 [REQUEST_MANAGER] Recolocando na fila: ${request.description}`);
    this.queue.unshift(request);

    // Delay extra para rate limit
    await this.delay(Math.min(30000, this.adaptiveDelay)); // Até 30s extra
  }

  /**
   * Ativa circuit breaker
   */
  activateCircuitBreaker() {
    this.circuitBreakerActive = true;
    this.circuitBreakerUntil = Date.now() + this.circuitBreakerDuration;

    Logger.error(
      `🚨 [REQUEST_MANAGER] CIRCUIT BREAKER ATIVADO! Todas as requests bloqueadas por ${this.circuitBreakerDuration / 1000}s`
    );
    Logger.error(
      `🚨 [REQUEST_MANAGER] Motivo: ${this.consecutiveRateLimits} rate limits consecutivos. Bot entrará em modo de espera.`
    );

    // Limpa fila atual - todas as requests falharão
    while (this.queue.length > 0) {
      const request = this.queue.shift();
      request.reject(new Error('Circuit breaker ativo - todas as requests canceladas'));
    }

    // Agenda deativação do circuit breaker
    setTimeout(() => {
      this.deactivateCircuitBreaker();
    }, this.circuitBreakerDuration);
  }

  /**
   * Desativa circuit breaker
   */
  deactivateCircuitBreaker() {
    this.circuitBreakerActive = false;
    this.consecutiveRateLimits = 0;
    this.adaptiveDelay = Math.max(this.minDelay, this.adaptiveDelay * 0.5); // Reduz delay

    Logger.info(`✅ [REQUEST_MANAGER] Circuit breaker DESATIVADO! Operações podem ser retomadas.`);
    Logger.info(`📉 [REQUEST_MANAGER] Delay reiniciado para: ${this.adaptiveDelay}ms`);

    // Reinicia processamento se há itens na fila
    if (this.queue.length > 0 && !this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Verifica se circuit breaker está ativo
   */
  isCircuitBreakerActive() {
    if (this.circuitBreakerActive && Date.now() > this.circuitBreakerUntil) {
      this.deactivateCircuitBreaker();
    }
    return this.circuitBreakerActive;
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
  async request(config, description = 'HTTP Request', priority = 5) {
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

    return this.enqueue(requestFunction, description, priority);
  }

  /**
   * Wrapper para GET requests
   */
  async get(url, config = {}, description = `GET ${url}`, priority = 5) {
    return this.request({ method: 'GET', url, ...config }, description, priority);
  }

  /**
   * Wrapper para POST requests
   */
  async post(url, data = {}, config = {}, description = `POST ${url}`, priority = 5) {
    return this.request({ method: 'POST', url, data, ...config }, description, priority);
  }

  /**
   * Wrapper para PUT requests
   */
  async put(url, data = {}, config = {}, description = `PUT ${url}`, priority = 5) {
    return this.request({ method: 'PUT', url, data, ...config }, description, priority);
  }

  /**
   * Wrapper para DELETE requests
   */
  async delete(url, config = {}, description = `DELETE ${url}`, priority = 5) {
    return this.request({ method: 'DELETE', url, ...config }, description, priority);
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
   * ✅ FIX: Authenticated request with FRESH timestamp
   * Generates timestamp immediately before HTTP call to prevent expiration
   */
  async authenticatedRequest(method, url, config = {}, authParams, description, priority = 5) {
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
        ...config,
        headers: {
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

    return this.enqueue(requestFunction, description, priority);
  }

  /**
   * Authenticated GET wrapper
   */
  async authenticatedGet(url, config = {}, authParams, description, priority = 5) {
    return this.authenticatedRequest('GET', url, config, authParams, description, priority);
  }

  /**
   * Authenticated POST wrapper
   */
  async authenticatedPost(url, data, config = {}, authParams, description, priority = 5) {
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
  async authenticatedDelete(url, config = {}, authParams, description, priority = 5) {
    return this.authenticatedRequest('DELETE', url, config, authParams, description, priority);
  }

  /**
   * Obtém estatísticas detalhadas do sistema
   */
  getStatus() {
    const uptime = Date.now() - this.startTime;
    const successRate =
      this.requestCount > 0 ? ((this.successCount / this.requestCount) * 100).toFixed(1) : 0;

    return {
      // Fila
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,

      // Circuit Breaker
      circuitBreakerActive: this.circuitBreakerActive,
      circuitBreakerUntil: this.circuitBreakerUntil,
      consecutiveRateLimits: this.consecutiveRateLimits,

      // Rate Limiting
      adaptiveDelay: this.adaptiveDelay,
      minDelay: this.minDelay,
      maxDelay: this.maxDelay,

      // Estatísticas
      requestCount: this.requestCount,
      successCount: this.successCount,
      errorCount: this.errorCount,
      rateLimitCount: this.rateLimitCount,
      successRate: `${successRate}%`,
      uptime: `${Math.floor(uptime / 60000)}m ${Math.floor((uptime % 60000) / 1000)}s`,

      // Performance
      lastRequestTime: this.lastRequestTime,
      avgDelay: this.adaptiveDelay,

      // Connection Pool
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
   * Força reset do sistema (emergência)
   */
  emergencyReset() {
    Logger.warn(`🔄 [REQUEST_MANAGER] RESET EMERGENCIAL executado!`);

    // Cancela todas as requests pendentes
    while (this.queue.length > 0) {
      const request = this.queue.shift();
      request.reject(new Error('Sistema resetado'));
    }

    // Reset de estado
    this.isProcessing = false;
    this.circuitBreakerActive = false;
    this.consecutiveRateLimits = 0;
    this.adaptiveDelay = this.minDelay;
    this.rateLimitCount = 0;

    Logger.info(`✅ [REQUEST_MANAGER] Reset concluído - sistema reiniciado`);
  }

  /**
   * Log do status atual (para debugging)
   */
  logStatus() {
    const status = this.getStatus();
    Logger.info(
      `📊 [REQUEST_MANAGER] Status: Fila(${status.queueLength}) | Delay(${status.adaptiveDelay}ms) | Success(${status.successRate}) | RateLimit(${status.rateLimitCount}) | CircuitBreaker(${status.circuitBreakerActive}) | Uptime(${status.uptime})`
    );
    Logger.info(
      `🔌 [CONNECTION_POOL] KeepAlive(${status.keepAliveEnabled}) | ActiveSockets(${status.activeSockets}) | FreeSockets(${status.freeSockets}) | Max(${status.maxSockets})`
    );
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
   * Força reset completo do RequestManager (limpa deadlocks)
   */
  forceReset() {
    // Para o processamento atual
    this.isProcessing = false;

    // Rejeita e limpa toda a fila
    while (this.queue.length > 0) {
      const request = this.queue.shift();
      if (request && request.reject) {
        request.reject(new Error('RequestManager force reset'));
      }
    }

    // Reset de todos os contadores
    this.lastRequestTime = 0;
    this.consecutiveRateLimits = 0;
    this.isCircuitBreakerOpen = false;
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
