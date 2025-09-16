import Logger from './Logger.js';

/**
 * SmartCircuitBreaker - Sistema inteligente de circuit breaker para APIs de trading
 *
 * Usado por sistemas de trading de alta frequência para proteção contra falhas em cascata.
 * Monitora falhas, detecta padrões e executa recuperação inteligente.
 *
 * Estados:
 * - CLOSED: Funcionamento normal, todas requests passam
 * - OPEN: Circuit aberto, requests rejeitadas imediatamente
 * - HALF_OPEN: Teste de recuperação, algumas requests passam
 *
 * Características:
 * - Adaptive thresholds: Limites dinâmicos baseados no histórico
 * - Smart recovery: Recuperação gradual com backoff exponencial
 * - Pattern detection: Detecção de padrões de falha específicos
 * - Health scoring: Pontuação de saúde baseada em múltiplas métricas
 */
class SmartCircuitBreaker {
  constructor(options = {}) {
    // Estados do Circuit Breaker
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.lastStateChange = Date.now();

    // Configuração de failure detection
    this.failureThreshold = options.failureThreshold || 5; // Falhas consecutivas para abrir
    this.recoveryTime = options.recoveryTime || 30000; // 30s para tentar recuperação
    this.successThreshold = options.successThreshold || 3; // Sucessos para fechar novamente

    // Janela de tempo para análise
    this.timeWindow = options.timeWindow || 60000; // 1 minuto
    this.maxTimeWindow = options.maxTimeWindow || 300000; // 5 minutos máximo

    // Contadores e histórico
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.requestHistory = [];
    this.failureHistory = [];

    // Health scoring
    this.healthScore = 100; // 0-100, 100 = perfeito
    this.minHealthScore = options.minHealthScore || 20;

    // Adaptive behavior
    this.baseFailureThreshold = this.failureThreshold;
    this.adaptiveMultiplier = 1.0;
    this.maxAdaptiveMultiplier = 3.0;

    // Recovery strategy
    this.recoveryAttempts = 0;
    this.maxRecoveryAttempts = options.maxRecoveryAttempts || 10;
    this.recoveryBackoffMultiplier = options.recoveryBackoffMultiplier || 1.5;

    // Pattern detection
    this.errorPatterns = new Map();
    this.suspiciousPatterns = [
      'RATE_LIMIT',
      'TIMEOUT',
      'CONNECTION_RESET',
      'NETWORK_ERROR',
      'AUTHENTICATION_ERROR',
    ];

    // Statistics
    this.totalRequests = 0;
    this.totalFailures = 0;
    this.totalTimeouts = 0;
    this.stateTransitions = 0;

    Logger.info(
      `🔌 [CIRCUIT_BREAKER] Inicializado: threshold=${this.failureThreshold}, ` +
        `recovery=${this.recoveryTime}ms, window=${this.timeWindow}ms`
    );
  }

  /**
   * Executa uma request através do circuit breaker
   * @param {Function} requestFunction - Função que executa a request
   * @param {string} requestType - Tipo da request para categorização
   * @returns {Promise} - Resultado da request ou erro de circuit aberto
   */
  async execute(requestFunction, requestType = 'UNKNOWN') {
    this.totalRequests++;

    // Verifica se pode executar
    if (!this.canExecute()) {
      const error = new Error(`Circuit breaker is ${this.state}`);
      error.code = 'CIRCUIT_BREAKER_OPEN';
      error.state = this.state;
      throw error;
    }

    const startTime = Date.now();
    let result;
    let error;

    try {
      result = await requestFunction();
      this.onSuccess(requestType, Date.now() - startTime);
      return result;
    } catch (err) {
      error = err;
      this.onFailure(requestType, err, Date.now() - startTime);
      throw err;
    }
  }

  /**
   * Verifica se uma request pode ser executada
   * @returns {boolean}
   */
  canExecute() {
    const now = Date.now();

    switch (this.state) {
      case 'CLOSED':
        return true;

      case 'OPEN':
        // Verifica se é hora de tentar recuperação
        if (now - this.lastStateChange >= this.getRecoveryTime()) {
          this.transitionTo('HALF_OPEN');
          return true;
        }
        return false;

      case 'HALF_OPEN':
        // No estado HALF_OPEN, permite algumas requests para teste
        return true;

      default:
        return false;
    }
  }

  /**
   * Callback de sucesso
   * @param {string} requestType
   * @param {number} responseTime
   */
  onSuccess(requestType, responseTime) {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;

    this.addToHistory({
      type: 'SUCCESS',
      requestType,
      responseTime,
      timestamp: Date.now(),
    });

    // Melhora health score
    this.healthScore = Math.min(100, this.healthScore + 2);

    // Verifica se deve fechar o circuit
    if (this.state === 'HALF_OPEN' && this.consecutiveSuccesses >= this.successThreshold) {
      this.transitionTo('CLOSED');
      this.recoveryAttempts = 0; // Reset recovery attempts
    }

    Logger.debug(
      `✅ [CIRCUIT_BREAKER] Success: ${requestType} (${responseTime}ms) | ` +
        `State: ${this.state} | Health: ${this.healthScore.toFixed(1)}`
    );
  }

  /**
   * Callback de falha
   * @param {string} requestType
   * @param {Error} error
   * @param {number} responseTime
   */
  onFailure(requestType, error, responseTime) {
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;
    this.totalFailures++;

    const errorType = this.categorizeError(error);

    this.addToHistory({
      type: 'FAILURE',
      requestType,
      errorType,
      errorMessage: error.message,
      responseTime,
      timestamp: Date.now(),
    });

    // Trackea padrões de erro
    this.trackErrorPattern(errorType);

    // Reduz health score baseado no tipo de erro
    const healthPenalty = this.getHealthPenalty(errorType);
    this.healthScore = Math.max(0, this.healthScore - healthPenalty);

    // Verifica se deve abrir o circuit
    if (this.shouldOpenCircuit(errorType)) {
      this.transitionTo('OPEN');
    }

    Logger.warn(
      `❌ [CIRCUIT_BREAKER] Failure: ${requestType} (${errorType}) | ` +
        `Consecutive: ${this.consecutiveFailures} | Health: ${this.healthScore.toFixed(1)}`
    );
  }

  /**
   * Categoriza erros para análise inteligente
   * @param {Error} error
   * @returns {string}
   */
  categorizeError(error) {
    const message = error.message?.toUpperCase() || '';
    const code = error.code?.toUpperCase() || '';

    if (message.includes('RATE') || message.includes('LIMIT') || code === 'RATE_LIMIT') {
      return 'RATE_LIMIT';
    }
    if (message.includes('TIMEOUT') || code === 'ETIMEDOUT') {
      this.totalTimeouts++;
      return 'TIMEOUT';
    }
    if (message.includes('NETWORK') || message.includes('ECONNRESET')) {
      return 'NETWORK_ERROR';
    }
    if (message.includes('AUTH') || message.includes('UNAUTHORIZED') || code === 'UNAUTHORIZED') {
      return 'AUTHENTICATION_ERROR';
    }
    if (message.includes('SERVER') || code.startsWith('5')) {
      return 'SERVER_ERROR';
    }

    return 'UNKNOWN_ERROR';
  }

  /**
   * Determina se o circuit deve abrir baseado no erro e contexto
   * @param {string} errorType
   * @returns {boolean}
   */
  shouldOpenCircuit(errorType) {
    // Rate limit sempre abre o circuit imediatamente
    if (errorType === 'RATE_LIMIT') {
      return true;
    }

    // Para outros erros, usa threshold adaptativo
    const effectiveThreshold = Math.floor(this.failureThreshold * this.adaptiveMultiplier);

    // Considera health score na decisão
    const healthFactor = this.healthScore < this.minHealthScore ? 0.5 : 1.0;
    const adjustedThreshold = Math.max(1, Math.floor(effectiveThreshold * healthFactor));

    return this.consecutiveFailures >= adjustedThreshold;
  }

  /**
   * Calcula penalidade de health score por tipo de erro
   * @param {string} errorType
   * @returns {number}
   */
  getHealthPenalty(errorType) {
    const penalties = {
      RATE_LIMIT: 25,
      AUTHENTICATION_ERROR: 20,
      TIMEOUT: 15,
      NETWORK_ERROR: 10,
      SERVER_ERROR: 8,
      UNKNOWN_ERROR: 5,
    };

    return penalties[errorType] || 5;
  }

  /**
   * Transição de estado do circuit breaker
   * @param {string} newState
   */
  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    this.stateTransitions++;

    // Ajustes por estado
    switch (newState) {
      case 'OPEN':
        this.recoveryAttempts++;
        this.adjustAdaptiveBehavior();
        break;

      case 'HALF_OPEN':
        this.consecutiveSuccesses = 0;
        break;

      case 'CLOSED':
        this.consecutiveFailures = 0;
        this.adaptiveMultiplier = Math.max(1.0, this.adaptiveMultiplier * 0.9); // Reduz gradualmente
        break;
    }

    Logger.info(
      `🔄 [CIRCUIT_BREAKER] State transition: ${oldState} → ${newState} | ` +
        `Attempts: ${this.recoveryAttempts} | Health: ${this.healthScore.toFixed(1)}`
    );
  }

  /**
   * Ajusta comportamento adaptativo baseado no histórico
   */
  adjustAdaptiveBehavior() {
    // Increase failure threshold if we're having too many state transitions
    const recentTransitions = this.stateTransitions;
    if (recentTransitions > 5) {
      this.adaptiveMultiplier = Math.min(this.maxAdaptiveMultiplier, this.adaptiveMultiplier * 1.2);

      Logger.info(
        `🧠 [CIRCUIT_BREAKER] Adaptive adjustment: multiplier → ${this.adaptiveMultiplier.toFixed(2)}`
      );
    }
  }

  /**
   * Calcula tempo de recuperação com backoff exponencial
   * @returns {number}
   */
  getRecoveryTime() {
    const backoffFactor = Math.pow(this.recoveryBackoffMultiplier, this.recoveryAttempts - 1);
    const adaptiveRecoveryTime = this.recoveryTime * backoffFactor;

    // Cap no máximo 5 minutos
    return Math.min(adaptiveRecoveryTime, 300000);
  }

  /**
   * Adiciona evento ao histórico com limpeza automática
   * @param {Object} event
   */
  addToHistory(event) {
    this.requestHistory.push(event);

    // Mantém apenas últimos eventos dentro da janela de tempo
    const cutoffTime = Date.now() - this.maxTimeWindow;
    this.requestHistory = this.requestHistory.filter(e => e.timestamp > cutoffTime);
  }

  /**
   * Trackea padrões de erro para análise
   * @param {string} errorType
   */
  trackErrorPattern(errorType) {
    const count = this.errorPatterns.get(errorType) || 0;
    this.errorPatterns.set(errorType, count + 1);
  }

  /**
   * Força abertura do circuit (usado em emergências)
   */
  forceOpen(reason = 'Manual') {
    Logger.warn(`🚨 [CIRCUIT_BREAKER] Force open: ${reason}`);
    this.transitionTo('OPEN');
  }

  /**
   * Força fechamento do circuit (usado após manutenção)
   */
  forceClose(reason = 'Manual') {
    Logger.info(`🔧 [CIRCUIT_BREAKER] Force close: ${reason}`);
    this.reset();
    this.transitionTo('CLOSED');
  }

  /**
   * Reset completo do circuit breaker
   */
  reset() {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.healthScore = 100;
    this.recoveryAttempts = 0;
    this.adaptiveMultiplier = 1.0;
    this.requestHistory = [];
    this.errorPatterns.clear();

    Logger.info('🔄 [CIRCUIT_BREAKER] Reset completo executado');
  }

  /**
   * Obtém estatísticas detalhadas
   */
  getStats() {
    const now = Date.now();
    const recentRequests = this.requestHistory.filter(e => e.timestamp > now - this.timeWindow);

    const recentFailures = recentRequests.filter(e => e.type === 'FAILURE');
    const recentSuccesses = recentRequests.filter(e => e.type === 'SUCCESS');

    const failureRate =
      recentRequests.length > 0
        ? ((recentFailures.length / recentRequests.length) * 100).toFixed(1)
        : '0.0';

    const avgResponseTime =
      recentRequests.length > 0
        ? (
            recentRequests.reduce((sum, r) => sum + r.responseTime, 0) / recentRequests.length
          ).toFixed(0)
        : '0';

    return {
      // Estado atual
      state: this.state,
      healthScore: parseFloat(this.healthScore.toFixed(1)),
      timeSinceLastStateChange: now - this.lastStateChange,

      // Contadores
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      recoveryAttempts: this.recoveryAttempts,

      // Métricas da janela recente
      recentRequests: recentRequests.length,
      recentFailures: recentFailures.length,
      recentSuccesses: recentSuccesses.length,
      failureRate: `${failureRate}%`,
      avgResponseTime: `${avgResponseTime}ms`,

      // Métricas totais
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalTimeouts: this.totalTimeouts,
      stateTransitions: this.stateTransitions,

      // Configuração adaptativa
      effectiveFailureThreshold: Math.floor(this.failureThreshold * this.adaptiveMultiplier),
      adaptiveMultiplier: parseFloat(this.adaptiveMultiplier.toFixed(2)),
      nextRecoveryTime: this.state === 'OPEN' ? this.getRecoveryTime() : 0,

      // Padrões de erro
      errorPatterns: Object.fromEntries(this.errorPatterns),
    };
  }

  /**
   * Verifica se o circuit breaker está saudável
   */
  isHealthy() {
    const stats = this.getStats();
    const recentFailureRate = parseFloat(stats.failureRate);

    return {
      healthy:
        this.state === 'CLOSED' &&
        this.healthScore >= this.minHealthScore &&
        recentFailureRate < 50,
      state: this.state,
      healthScore: this.healthScore,
      failureRate: recentFailureRate,
      reason:
        this.state !== 'CLOSED'
          ? `Circuit ${this.state}`
          : this.healthScore < this.minHealthScore
            ? 'Low health score'
            : recentFailureRate >= 50
              ? 'High failure rate'
              : 'OK',
    };
  }

  /**
   * Log de status detalhado
   */
  logStatus() {
    const stats = this.getStats();
    const health = this.isHealthy();

    Logger.info(
      `🔌 [CIRCUIT_BREAKER] Status: ${stats.state} | Health: ${stats.healthScore} | ` +
        `Failures: ${stats.consecutiveFailures} | Rate: ${stats.failureRate} | ${health.healthy ? '✅' : '❌'}`
    );

    if (Object.keys(stats.errorPatterns).length > 0) {
      Logger.info(`🔍 [CIRCUIT_BREAKER] Error patterns: ${JSON.stringify(stats.errorPatterns)}`);
    }

    if (stats.recoveryAttempts > 0) {
      Logger.info(
        `🔧 [CIRCUIT_BREAKER] Recovery: attempt ${stats.recoveryAttempts}, next in ${(stats.nextRecoveryTime / 1000).toFixed(0)}s`
      );
    }
  }
}

export default SmartCircuitBreaker;
