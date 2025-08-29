import Logger from './Logger.js';

/**
 * Global Request Queue - Serializa todas as requests para a API da Backpack
 * Evita rate limiting coordenando todas as chamadas da aplicação
 */
class GlobalRequestQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.requestCount = 0;
    this.lastRequestTime = 0;
    this.minDelay = 2000; // 2 segundos mínimo entre requests
    this.adaptiveDelay = 2000; // Delay adaptativo que aumenta com rate limits
    this.maxDelay = 60000; // Máximo 1 minuto
    this.rateLimitCount = 0;
  }

  /**
   * Adiciona uma request à fila global
   * @param {Function} requestFunction - Função que faz a request
   * @param {string} description - Descrição da request para logs
   * @returns {Promise} - Promise que resolve com o resultado da request
   */
  async enqueue(requestFunction, description = 'API Request') {
    return new Promise((resolve, reject) => {
      this.queue.push({
        requestFunction,
        description,
        resolve,
        reject,
        timestamp: Date.now(),
      });

      Logger.debug(
        `📋 [GLOBAL_QUEUE] Request enfileirada: ${description} (fila: ${this.queue.length})`
      );

      // Inicia processamento se não estiver processando
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Processa a fila de requests uma por vez
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    Logger.debug(
      `🔄 [GLOBAL_QUEUE] Iniciando processamento da fila (${this.queue.length} requests)`
    );

    while (this.queue.length > 0) {
      const request = this.queue.shift();

      try {
        // Aguarda delay mínimo entre requests
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;
        if (timeSinceLastRequest < this.adaptiveDelay) {
          const waitTime = this.adaptiveDelay - timeSinceLastRequest;
          Logger.debug(
            `⏳ [GLOBAL_QUEUE] Aguardando ${waitTime}ms antes de: ${request.description}`
          );
          await this.delay(waitTime);
        }

        Logger.debug(`🚀 [GLOBAL_QUEUE] Executando: ${request.description}`);
        this.lastRequestTime = Date.now();
        this.requestCount++;

        // Executa a request
        const result = await request.requestFunction();

        // Request bem-sucedida
        this.onSuccess();
        request.resolve(result);

        Logger.debug(`✅ [GLOBAL_QUEUE] Sucesso: ${request.description}`);
      } catch (error) {
        // Verifica se é rate limit
        if (this.isRateLimitError(error)) {
          this.onRateLimit(request);
        } else {
          Logger.warn(`❌ [GLOBAL_QUEUE] Erro em: ${request.description} - ${error.message}`);
          request.reject(error);
        }
      }
    }

    this.isProcessing = false;
    Logger.debug(`✅ [GLOBAL_QUEUE] Processamento da fila concluído`);
  }

  /**
   * Verifica se o erro é de rate limit
   */
  isRateLimitError(error) {
    return (
      error?.response?.status === 429 ||
      String(error).includes('TOO_MANY_REQUESTS') ||
      String(error).includes('rate limit') ||
      String(error).includes('too many requests')
    );
  }

  /**
   * Manipula rate limit - recoloca request na fila e aumenta delay
   */
  onRateLimit(request) {
    this.rateLimitCount++;

    // Aumenta delay drasticamente
    this.adaptiveDelay = Math.min(this.adaptiveDelay * 2, this.maxDelay);

    Logger.warn(
      `⏰ [GLOBAL_QUEUE] Rate limit #${this.rateLimitCount} detectado! Delay aumentado para ${this.adaptiveDelay}ms`
    );
    Logger.warn(`🔄 [GLOBAL_QUEUE] Recolocando request na fila: ${request.description}`);

    // Recoloca no início da fila para tentar novamente
    this.queue.unshift(request);
  }

  /**
   * Manipula sucesso - reduz delay gradualmente
   */
  onSuccess() {
    // Reduz delay gradualmente se não houve rate limits recentes
    if (this.adaptiveDelay > this.minDelay) {
      this.adaptiveDelay = Math.max(this.minDelay, this.adaptiveDelay * 0.9);
      Logger.debug(`📉 [GLOBAL_QUEUE] Delay reduzido para ${this.adaptiveDelay}ms`);
    }
  }

  /**
   * Utilitário de delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Obtém status da fila
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      requestCount: this.requestCount,
      adaptiveDelay: this.adaptiveDelay,
      rateLimitCount: this.rateLimitCount,
      lastRequestTime: this.lastRequestTime,
    };
  }

  /**
   * Reset do queue (usado para testes ou emergências)
   */
  reset() {
    this.queue = [];
    this.isProcessing = false;
    this.adaptiveDelay = this.minDelay;
    this.rateLimitCount = 0;
    Logger.info(`🔄 [GLOBAL_QUEUE] Queue resetado`);
  }
}

// Instância singleton global
const globalRequestQueue = new GlobalRequestQueue();

export default globalRequestQueue;
