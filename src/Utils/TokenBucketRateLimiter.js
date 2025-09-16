import Logger from './Logger.js';

/**
 * TokenBucketRateLimiter - Sistema profissional de rate limiting baseado em Token Bucket
 *
 * Usado por exchanges e bots de trading de alta frequência para controle preciso de taxa.
 * Permite bursts controlados enquanto mantém a taxa média dentro dos limites.
 *
 * Características:
 * - Burst capacity: Permite rajadas quando tokens disponíveis
 * - Smooth recovery: Recuperação gradual de tokens
 * - Adaptive throttling: Ajuste dinâmico baseado na resposta da API
 * - Zero-latency checks: Verificações instantâneas de disponibilidade
 */
class TokenBucketRateLimiter {
  constructor(options = {}) {
    // Configuração do Token Bucket
    this.capacity = options.capacity || 10; // Máximo de tokens no bucket
    this.refillRate = options.refillRate || 2; // Tokens por segundo
    this.tokens = this.capacity; // Inicia com bucket cheio

    // Configuração de burst
    this.burstCapacity = options.burstCapacity || Math.ceil(this.capacity * 0.8);
    this.minReserve = options.minReserve || 1; // Reserva mínima para requests críticas

    // Timing
    this.lastRefillTime = Date.now();
    this.refillIntervalMs = 1000 / this.refillRate; // ms por token

    // Adaptive throttling
    this.baseRefillRate = this.refillRate;
    this.throttleMultiplier = 1.0;
    this.maxThrottleMultiplier = 0.1; // Mínimo 10% da taxa original

    // Statistics
    this.totalRequests = 0;
    this.rejectedRequests = 0;
    this.adaptiveAdjustments = 0;

    // Auto-refill interval
    this.startAutoRefill();

    Logger.info(
      `🪣 [TOKEN_BUCKET] Inicializado: ${this.capacity} tokens, ${this.refillRate} tokens/s, burst: ${this.burstCapacity}`
    );
  }

  /**
   * Tenta consumir tokens do bucket
   * @param {number} tokensNeeded - Número de tokens necessários
   * @param {string} priority - Prioridade da request (CRITICAL, HIGH, MEDIUM, LOW)
   * @returns {Promise<boolean>} - True se tokens foram consumidos com sucesso
   */
  async tryConsume(tokensNeeded = 1, priority = 'MEDIUM') {
    this.refillBucket();
    this.totalRequests++;

    // Check if we have enough tokens, considering reserve for critical requests
    const minAvailableTokens = priority === 'CRITICAL' ? 0 : this.minReserve;

    if (this.tokens >= tokensNeeded && this.tokens - tokensNeeded >= minAvailableTokens) {
      this.tokens -= tokensNeeded;
      Logger.debug(
        `🪣 [TOKEN_BUCKET] Consumido ${tokensNeeded} tokens (${priority}). Restante: ${this.tokens.toFixed(2)}/${this.capacity}`
      );
      return true;
    }

    this.rejectedRequests++;
    Logger.debug(
      `🚫 [TOKEN_BUCKET] Rejeitado ${tokensNeeded} tokens (${priority}). Disponível: ${this.tokens.toFixed(2)}/${this.capacity}`
    );
    return false;
  }

  /**
   * Aguarda até que tokens suficientes estejam disponíveis
   * @param {number} tokensNeeded - Número de tokens necessários
   * @param {string} priority - Prioridade da request
   * @param {number} maxWaitMs - Tempo máximo de espera (0 = sem limite)
   * @returns {Promise<boolean>} - True se tokens foram obtidos, false se timeout
   */
  async waitForTokens(tokensNeeded = 1, priority = 'MEDIUM', maxWaitMs = 0) {
    const startTime = Date.now();

    while (true) {
      if (await this.tryConsume(tokensNeeded, priority)) {
        return true;
      }

      // Verifica timeout
      if (maxWaitMs > 0 && Date.now() - startTime > maxWaitMs) {
        Logger.warn(
          `⏰ [TOKEN_BUCKET] Timeout aguardando ${tokensNeeded} tokens (${priority}) após ${maxWaitMs}ms`
        );
        return false;
      }

      // Calcula tempo de espera ótimo
      const waitTime = this.calculateOptimalWaitTime(tokensNeeded);
      await this.delay(waitTime);
    }
  }

  /**
   * Calcula tempo ótimo de espera baseado na taxa de refill
   * @param {number} tokensNeeded - Tokens necessários
   * @returns {number} - Tempo em ms
   */
  calculateOptimalWaitTime(tokensNeeded) {
    const tokensShortfall = tokensNeeded - this.tokens;
    if (tokensShortfall <= 0) return 50; // Check rápido

    const timeToRefill = (tokensShortfall / (this.refillRate * this.throttleMultiplier)) * 1000;
    const safetyBuffer = 100; // 100ms de buffer

    return Math.min(Math.max(timeToRefill + safetyBuffer, 50), 5000); // Entre 50ms e 5s
  }

  /**
   * Refill do bucket baseado no tempo decorrido
   */
  refillBucket() {
    const now = Date.now();
    const timePassed = now - this.lastRefillTime;

    if (timePassed >= this.refillIntervalMs) {
      const tokensToAdd = (timePassed / 1000) * this.refillRate * this.throttleMultiplier;
      const oldTokens = this.tokens;

      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefillTime = now;

      if (this.tokens !== oldTokens) {
        Logger.debug(
          `🔄 [TOKEN_BUCKET] Refill: ${oldTokens.toFixed(2)} → ${this.tokens.toFixed(2)} (+${tokensToAdd.toFixed(2)})`
        );
      }
    }
  }

  /**
   * Auto-refill periódico para manter precisão
   */
  startAutoRefill() {
    setInterval(
      () => {
        this.refillBucket();
      },
      Math.min(this.refillIntervalMs / 2, 1000)
    ); // Refill a cada meio intervalo ou 1s
  }

  /**
   * Ajuste adaptativo da taxa baseado na resposta da API
   * @param {boolean} wasRateLimited - Se a última request foi rate limited
   * @param {number} responseTime - Tempo de resposta em ms
   */
  adaptiveAdjustment(wasRateLimited, responseTime) {
    const oldMultiplier = this.throttleMultiplier;

    if (wasRateLimited) {
      // Reduz taxa drasticamente em caso de rate limit
      this.throttleMultiplier *= 0.5;
      this.throttleMultiplier = Math.max(this.throttleMultiplier, this.maxThrottleMultiplier);
      Logger.warn(
        `📉 [TOKEN_BUCKET] Rate limit detectado! Throttle: ${oldMultiplier.toFixed(3)} → ${this.throttleMultiplier.toFixed(3)}`
      );
    } else if (responseTime < 1000 && this.tokens > this.burstCapacity * 0.5) {
      // API saudável e tokens disponíveis - pode aumentar gradualmente
      this.throttleMultiplier = Math.min(1.0, this.throttleMultiplier * 1.05);

      if (Math.abs(oldMultiplier - this.throttleMultiplier) > 0.01) {
        Logger.debug(
          `📈 [TOKEN_BUCKET] API saudável. Throttle: ${oldMultiplier.toFixed(3)} → ${this.throttleMultiplier.toFixed(3)}`
        );
      }
    }

    if (oldMultiplier !== this.throttleMultiplier) {
      this.adaptiveAdjustments++;
    }
  }

  /**
   * Força refill completo do bucket (usado em recuperação)
   */
  forceRefill() {
    const oldTokens = this.tokens;
    this.tokens = this.capacity;
    this.lastRefillTime = Date.now();

    Logger.info(
      `🔄 [TOKEN_BUCKET] Force refill: ${oldTokens.toFixed(2)} → ${this.tokens.toFixed(2)}`
    );
  }

  /**
   * Reset completo do rate limiter
   */
  reset() {
    this.tokens = this.capacity;
    this.throttleMultiplier = 1.0;
    this.lastRefillTime = Date.now();
    this.totalRequests = 0;
    this.rejectedRequests = 0;
    this.adaptiveAdjustments = 0;

    Logger.info('🔄 [TOKEN_BUCKET] Reset completo executado');
  }

  /**
   * Obtém estatísticas detalhadas
   */
  getStats() {
    this.refillBucket(); // Atualiza tokens antes de reportar

    const rejectionRate =
      this.totalRequests > 0
        ? ((this.rejectedRequests / this.totalRequests) * 100).toFixed(1)
        : '0.0';

    return {
      // Token status
      tokens: parseFloat(this.tokens.toFixed(2)),
      capacity: this.capacity,
      utilizationPercent: parseFloat(
        (((this.capacity - this.tokens) / this.capacity) * 100).toFixed(1)
      ),

      // Rate limiting
      refillRate: parseFloat((this.refillRate * this.throttleMultiplier).toFixed(2)),
      baseRefillRate: this.refillRate,
      throttleMultiplier: parseFloat(this.throttleMultiplier.toFixed(3)),

      // Performance
      totalRequests: this.totalRequests,
      rejectedRequests: this.rejectedRequests,
      rejectionRate: `${rejectionRate}%`,
      adaptiveAdjustments: this.adaptiveAdjustments,

      // Config
      burstCapacity: this.burstCapacity,
      minReserve: this.minReserve,
    };
  }

  /**
   * Verifica se o rate limiter está saudável
   */
  isHealthy() {
    const stats = this.getStats();
    const rejectionRate = parseFloat(stats.rejectionRate);

    return {
      healthy: rejectionRate < 50 && this.throttleMultiplier > 0.2,
      rejectionRate,
      throttleLevel: this.throttleMultiplier,
      tokensAvailable: this.tokens,
      reason:
        rejectionRate >= 50
          ? 'High rejection rate'
          : this.throttleMultiplier <= 0.2
            ? 'Severe throttling'
            : 'OK',
    };
  }

  /**
   * Utilitário de delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log de status detalhado
   */
  logStatus() {
    const stats = this.getStats();
    const health = this.isHealthy();

    Logger.info(
      `🪣 [TOKEN_BUCKET] Status: ${stats.tokens}/${stats.capacity} tokens (${stats.utilizationPercent}% used) | ` +
        `Rate: ${stats.refillRate}/s | Rejection: ${stats.rejectionRate} | Health: ${health.healthy ? '✅' : '❌'}`
    );

    if (stats.adaptiveAdjustments > 0) {
      Logger.info(
        `🔧 [TOKEN_BUCKET] Adaptive: ${stats.adaptiveAdjustments} adjustments, throttle: ${stats.throttleMultiplier}`
      );
    }
  }
}

export default TokenBucketRateLimiter;
