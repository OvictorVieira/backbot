import Logger from './Logger.js';

/**
 * Gerenciador de rate limiting dinâmico
 * Ajusta automaticamente os delays baseado na frequência de rate limits
 */
class RateLimiter {
  constructor() {
    // Estado do rate limiter
    this.currentDelay = 1000; // Delay inicial: 1 segundo
    this.minDelay = 60000; // Delay mínimo: 1 minuto
    this.maxDelay = 300000; // Delay máximo: 5 minutos
    this.consecutiveRateLimits = 0;
    this.lastRateLimitTime = null;
    this.successfulRequests = 0;

    // Configurações de ajuste
    this.increaseMultiplier = 2; // Multiplica delay por 2 quando hit rate limit
    this.decreaseMultiplier = 0.8; // Reduz delay em 20% após sucessos
    this.resetThreshold = 10; // Número de sucessos para começar a reduzir delay
  }

  /**
   * Aguarda o delay atual antes de fazer uma request
   * @param {string} operation - Nome da operação para logs
   */
  async wait(operation = 'API') {
    if (this.currentDelay > this.minDelay) {
      Logger.debug(`⏱️ [RATE_LIMITER] Aguardando ${this.currentDelay}ms antes de ${operation}`);
      await new Promise(resolve => setTimeout(resolve, this.currentDelay));
    }
  }

  /**
   * Chama quando recebe um rate limit error
   * Aumenta o delay dinamicamente
   */
  onRateLimit() {
    this.consecutiveRateLimits++;
    this.successfulRequests = 0; // Reset contador de sucessos
    this.lastRateLimitTime = Date.now();

    // Aumenta o delay exponencialmente, mas limitado pelo máximo
    const oldDelay = this.currentDelay;
    this.currentDelay = Math.min(
      this.currentDelay * this.increaseMultiplier,
      this.maxDelay
    );

    Logger.warn(`⚠️ [RATE_LIMITER] Rate limit #${this.consecutiveRateLimits} - Delay: ${oldDelay}ms → ${this.currentDelay}ms`);
  }

  /**
   * Chama quando uma request é bem-sucedida
   * Gradualmente reduz o delay se não houve rate limits recentes
   */
  onSuccess() {
    this.successfulRequests++;

    // Se não houve rate limits recentes e tivemos várias requests bem-sucedidas
    const timeSinceLastRateLimit = this.lastRateLimitTime ?
      Date.now() - this.lastRateLimitTime : Infinity;

    // Só reduz delay se:
    // 1. Passou tempo suficiente desde o último rate limit (30s)
    // 2. Tivemos requisições bem-sucedidas suficientes
    // 3. O delay atual está acima do mínimo
    if (timeSinceLastRateLimit > 30000 &&
        this.successfulRequests >= this.resetThreshold &&
        this.currentDelay > this.minDelay) {

      const oldDelay = this.currentDelay;
      this.currentDelay = Math.max(
        this.currentDelay * this.decreaseMultiplier,
        this.minDelay
      );

      Logger.debug(`✅ [RATE_LIMITER] Reduzindo delay após ${this.successfulRequests} sucessos: ${oldDelay}ms → ${this.currentDelay}ms`);

      // Reset para próximo ciclo
      this.successfulRequests = 0;
      this.consecutiveRateLimits = 0;
    }
  }

  /**
   * Chama quando há erro que não é rate limit
   * Não altera delays, apenas reseta contador de sucessos
   */
  onError() {
    // Reset contador de sucessos em caso de erro
    this.successfulRequests = 0;
  }

  /**
   * Obtém status atual do rate limiter
   */
  getStatus() {
    return {
      currentDelay: this.currentDelay,
      consecutiveRateLimits: this.consecutiveRateLimits,
      successfulRequests: this.successfulRequests,
      timeSinceLastRateLimit: this.lastRateLimitTime ?
        Date.now() - this.lastRateLimitTime : null
    };
  }

  /**
   * Reset manual do rate limiter
   */
  reset() {
    this.currentDelay = 1000;
    this.consecutiveRateLimits = 0;
    this.successfulRequests = 0;
    this.lastRateLimitTime = null;
    Logger.info('🔄 [RATE_LIMITER] Rate limiter resetado');
  }
}

// Instância singleton para uso global
const rateLimiter = new RateLimiter();

export default rateLimiter;