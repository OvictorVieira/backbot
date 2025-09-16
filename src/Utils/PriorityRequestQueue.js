import Logger from './Logger.js';

/**
 * PriorityRequestQueue - Sistema avançado de fila com priorização para trading bots
 *
 * Usado por sistemas de trading profissionais para gerenciar requests com diferentes prioridades.
 * Garante que operações críticas (como trades) sempre tenham precedência sobre operações secundárias.
 *
 * Prioridades:
 * - CRITICAL: Trades, cancelamentos, emergency stops
 * - HIGH: Account info, position updates, urgent market data
 * - MEDIUM: Market data updates, standard operations
 * - LOW: Historical data, logs, analytics
 *
 * Características:
 * - Multi-level priority queues com aging prevention
 * - Dynamic priority adjustment baseado em condições de mercado
 * - Request deduplication para evitar requests duplicadas
 * - Intelligent batching para otimizar throughput
 * - Memory-safe operations com automatic cleanup
 */
class PriorityRequestQueue {
  constructor(options = {}) {
    // Priority levels
    this.priorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    this.queues = new Map();

    // Initialize priority queues
    this.priorities.forEach(priority => {
      this.queues.set(priority, []);
    });

    // Configuration
    this.maxQueueSize = options.maxQueueSize || 1000; // Por prioridade
    this.maxTotalSize = options.maxTotalSize || 5000; // Total geral
    this.agingThreshold = options.agingThreshold || 30000; // 30s para aging
    this.cleanupInterval = options.cleanupInterval || 60000; // 1min cleanup

    // Deduplication
    this.requestDeduplication = options.enableDeduplication !== false;
    this.dedupMap = new Map(); // key -> request signature
    this.dedupTimeout = options.dedupTimeout || 5000; // 5s para dedup

    // Batching
    this.enableBatching = options.enableBatching || false;
    this.batchSize = options.batchSize || 5;
    this.batchTimeout = options.batchTimeout || 1000;
    this.pendingBatches = new Map();

    // Dynamic priority adjustment
    this.marketConditions = 'NORMAL'; // NORMAL, VOLATILE, CRITICAL
    this.priorityBoost = new Map();

    // Statistics
    this.stats = {
      totalEnqueued: 0,
      totalDequeued: 0,
      totalDropped: 0,
      totalDeduplicated: 0,
      totalAged: 0,
      avgWaitTime: 0,
      queueSizes: {},
    };

    // Request tracking
    this.requestHistory = [];
    this.maxHistorySize = options.maxHistorySize || 10000;

    // Start background tasks
    this.startCleanupTask();
    this.startAgingTask();

    Logger.info(
      `📋 [PRIORITY_QUEUE] Inicializado: max=${this.maxQueueSize}/queue, ` +
        `dedup=${this.requestDeduplication}, batching=${this.enableBatching}`
    );
  }

  /**
   * Adiciona request à fila com prioridade
   * @param {Object} request - Request object
   * @param {string} priority - CRITICAL, HIGH, MEDIUM, LOW
   * @param {Object} options - Opções adicionais
   * @returns {Promise} - Promise que resolve quando request é processada
   */
  async enqueue(request, priority = 'MEDIUM', options = {}) {
    // Validate priority
    if (!this.priorities.includes(priority)) {
      throw new Error(`Invalid priority: ${priority}`);
    }

    // Check total queue size
    const totalSize = this.getTotalQueueSize();
    if (totalSize >= this.maxTotalSize) {
      this.stats.totalDropped++;
      Logger.warn(
        `🚫 [PRIORITY_QUEUE] Queue full (${totalSize}/${this.maxTotalSize}), dropping request`
      );
      throw new Error('Queue is full');
    }

    // Create request wrapper
    const requestWrapper = {
      id: this.generateRequestId(),
      request,
      priority: this.adjustPriority(priority, options),
      enqueuedAt: Date.now(),
      options,
      signature: this.generateRequestSignature(request),
      retries: 0,
      resolve: null,
      reject: null,
    };

    // Check for deduplication
    if (this.requestDeduplication && this.isDuplicate(requestWrapper)) {
      this.stats.totalDeduplicated++;
      Logger.debug(`🔄 [PRIORITY_QUEUE] Duplicate request detected: ${requestWrapper.signature}`);

      // Return existing promise
      return this.dedupMap.get(requestWrapper.signature).promise;
    }

    // Create promise for this request
    const promise = new Promise((resolve, reject) => {
      requestWrapper.resolve = resolve;
      requestWrapper.reject = reject;
    });

    // Add to appropriate queue
    const queue = this.queues.get(requestWrapper.priority);

    // Check individual queue size
    if (queue.length >= this.maxQueueSize) {
      // Try to drop oldest LOW priority request
      if (!this.dropOldestLowPriorityRequest()) {
        this.stats.totalDropped++;
        throw new Error(`${requestWrapper.priority} queue is full`);
      }
    }

    queue.push(requestWrapper);
    this.stats.totalEnqueued++;

    // Add to dedup map if enabled
    if (this.requestDeduplication) {
      this.dedupMap.set(requestWrapper.signature, {
        request: requestWrapper,
        promise,
        timestamp: Date.now(),
      });
    }

    // Add to history
    this.addToHistory('ENQUEUE', requestWrapper);

    Logger.debug(
      `📥 [PRIORITY_QUEUE] Enqueued: ${requestWrapper.id} (${requestWrapper.priority}) | ` +
        `Queue sizes: ${this.getQueueSizesString()}`
    );

    return promise;
  }

  /**
   * Remove próxima request da fila respeitando prioridades
   * @returns {Object|null} - Request wrapper ou null se fila vazia
   */
  dequeue() {
    // Try each priority level
    for (const priority of this.priorities) {
      const queue = this.queues.get(priority);

      if (queue.length > 0) {
        const requestWrapper = queue.shift();
        this.stats.totalDequeued++;

        // Remove from dedup map
        if (this.requestDeduplication) {
          this.dedupMap.delete(requestWrapper.signature);
        }

        // Calculate wait time
        const waitTime = Date.now() - requestWrapper.enqueuedAt;
        this.updateAverageWaitTime(waitTime);

        // Add to history
        this.addToHistory('DEQUEUE', requestWrapper);

        Logger.debug(
          `📤 [PRIORITY_QUEUE] Dequeued: ${requestWrapper.id} (${requestWrapper.priority}) | ` +
            `Wait: ${waitTime}ms | Remaining: ${this.getTotalQueueSize()}`
        );

        return requestWrapper;
      }
    }

    return null; // All queues empty
  }

  /**
   * Obtém próximas N requests sem remover da fila (peek)
   * @param {number} count - Número de requests
   * @returns {Array} - Array de request wrappers
   */
  peek(count = 1) {
    const result = [];

    for (const priority of this.priorities) {
      const queue = this.queues.get(priority);
      const available = Math.min(count - result.length, queue.length);

      if (available > 0) {
        result.push(...queue.slice(0, available));
      }

      if (result.length >= count) break;
    }

    return result;
  }

  /**
   * Remove requests específicas da fila (por ID ou condição)
   * @param {string|Function} criteria - ID da request ou função de filtro
   * @returns {Array} - Requests removidas
   */
  remove(criteria) {
    const removed = [];
    const isCriteriaFunction = typeof criteria === 'function';

    for (const [priority, queue] of this.queues) {
      const initialLength = queue.length;

      // Filter out matching requests
      const remaining = queue.filter(requestWrapper => {
        const shouldRemove = isCriteriaFunction
          ? criteria(requestWrapper)
          : requestWrapper.id === criteria;

        if (shouldRemove) {
          removed.push(requestWrapper);

          // Reject the promise
          if (requestWrapper.reject) {
            requestWrapper.reject(new Error('Request removed from queue'));
          }

          // Remove from dedup map
          if (this.requestDeduplication) {
            this.dedupMap.delete(requestWrapper.signature);
          }

          return false;
        }
        return true;
      });

      // Update queue
      this.queues.set(priority, remaining);

      Logger.debug(
        `🗑️ [PRIORITY_QUEUE] Removed ${initialLength - remaining.length} requests from ${priority} queue`
      );
    }

    return removed;
  }

  /**
   * Ajusta prioridade dinamicamente baseado em condições
   * @param {string} basePriority
   * @param {Object} options
   * @returns {string}
   */
  adjustPriority(basePriority, options = {}) {
    let adjustedPriority = basePriority;

    // Market condition adjustments
    if (this.marketConditions === 'CRITICAL') {
      // Em condições críticas, eleva prioridade de trades
      if (options.type === 'TRADE' || options.type === 'CANCEL_ORDER') {
        adjustedPriority = 'CRITICAL';
      } else if (basePriority === 'MEDIUM') {
        adjustedPriority = 'HIGH';
      }
    } else if (this.marketConditions === 'VOLATILE') {
      // Em mercado volátil, prioriza market data
      if (options.type === 'MARKET_DATA' && basePriority === 'LOW') {
        adjustedPriority = 'MEDIUM';
      }
    }

    // Manual priority boosts
    const boostKey = `${options.type}-${basePriority}`;
    if (this.priorityBoost.has(boostKey)) {
      const boost = this.priorityBoost.get(boostKey);
      const currentIndex = this.priorities.indexOf(adjustedPriority);
      const boostedIndex = Math.max(0, currentIndex - boost);
      adjustedPriority = this.priorities[boostedIndex];
    }

    return adjustedPriority;
  }

  /**
   * Define condições de mercado para ajuste dinâmico
   * @param {string} conditions - NORMAL, VOLATILE, CRITICAL
   */
  setMarketConditions(conditions) {
    const oldConditions = this.marketConditions;
    this.marketConditions = conditions;

    if (oldConditions !== conditions) {
      Logger.info(`📊 [PRIORITY_QUEUE] Market conditions: ${oldConditions} → ${conditions}`);

      // Re-prioritize existing requests if needed
      if (conditions === 'CRITICAL') {
        this.rebalancePriorities();
      }
    }
  }

  /**
   * Rebalanceia prioridades das requests existentes
   */
  rebalancePriorities() {
    let rebalanced = 0;

    for (const [priority, queue] of this.queues) {
      const toMove = [];

      // Find requests that should be moved to higher priority
      for (let i = queue.length - 1; i >= 0; i--) {
        const requestWrapper = queue[i];
        const newPriority = this.adjustPriority(priority, requestWrapper.options);

        if (newPriority !== priority) {
          toMove.push({ requestWrapper, newPriority, index: i });
        }
      }

      // Move requests to new priority queues
      toMove.forEach(({ requestWrapper, newPriority, index }) => {
        queue.splice(index, 1);
        this.queues.get(newPriority).push(requestWrapper);
        requestWrapper.priority = newPriority;
        rebalanced++;
      });
    }

    if (rebalanced > 0) {
      Logger.info(`⚖️ [PRIORITY_QUEUE] Rebalanced ${rebalanced} requests due to market conditions`);
    }
  }

  /**
   * Verifica se request é duplicada
   * @param {Object} requestWrapper
   * @returns {boolean}
   */
  isDuplicate(requestWrapper) {
    const existing = this.dedupMap.get(requestWrapper.signature);

    if (!existing) return false;

    // Check if existing request is still valid (not too old)
    const age = Date.now() - existing.timestamp;
    if (age > this.dedupTimeout) {
      this.dedupMap.delete(requestWrapper.signature);
      return false;
    }

    return true;
  }

  /**
   * Gera assinatura única para request (para deduplicação)
   * @param {Object} request
   * @returns {string}
   */
  generateRequestSignature(request) {
    // Create signature based on method, endpoint, and key parameters
    const method = request.method || 'GET';
    const endpoint = request.endpoint || request.url || '';
    const params = request.params || request.data || {};

    // Sort params for consistent signature
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}:${params[key]}`)
      .join('|');

    return `${method}:${endpoint}:${sortedParams}`;
  }

  /**
   * Gera ID único para request
   * @returns {string}
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Remove request mais antiga de baixa prioridade para fazer espaço
   * @returns {boolean} - True se removeu alguma request
   */
  dropOldestLowPriorityRequest() {
    const lowQueue = this.queues.get('LOW');

    if (lowQueue.length > 0) {
      const dropped = lowQueue.shift();

      if (dropped.reject) {
        dropped.reject(new Error('Request dropped due to queue pressure'));
      }

      if (this.requestDeduplication) {
        this.dedupMap.delete(dropped.signature);
      }

      this.stats.totalDropped++;

      Logger.debug(`🗑️ [PRIORITY_QUEUE] Dropped oldest LOW priority request: ${dropped.id}`);

      return true;
    }

    return false;
  }

  /**
   * Task de aging - previne starvation de requests de baixa prioridade
   */
  startAgingTask() {
    setInterval(() => {
      this.performAging();
    }, this.agingThreshold / 2);
  }

  /**
   * Executa aging nas requests antigas
   */
  performAging() {
    const now = Date.now();
    let aged = 0;

    // Check MEDIUM and LOW priority queues for aging
    ['MEDIUM', 'LOW'].forEach(priority => {
      const queue = this.queues.get(priority);
      const targetPriority = priority === 'LOW' ? 'MEDIUM' : 'HIGH';
      const targetQueue = this.queues.get(targetPriority);

      for (let i = queue.length - 1; i >= 0; i--) {
        const requestWrapper = queue[i];
        const age = now - requestWrapper.enqueuedAt;

        // Age requests older than threshold
        if (age > this.agingThreshold) {
          queue.splice(i, 1);
          targetQueue.push(requestWrapper);
          requestWrapper.priority = targetPriority;
          aged++;
        }
      }
    });

    if (aged > 0) {
      this.stats.totalAged += aged;
      Logger.debug(`⏰ [PRIORITY_QUEUE] Aged ${aged} requests to prevent starvation`);
    }
  }

  /**
   * Task de cleanup periódico
   */
  startCleanupTask() {
    setInterval(() => {
      this.performCleanup();
    }, this.cleanupInterval);
  }

  /**
   * Executa cleanup de requests antigas e dedup map
   */
  performCleanup() {
    const now = Date.now();
    let cleaned = 0;

    // Clean dedup map
    if (this.requestDeduplication) {
      const initialSize = this.dedupMap.size;

      for (const [signature, entry] of this.dedupMap) {
        if (now - entry.timestamp > this.dedupTimeout) {
          this.dedupMap.delete(signature);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        Logger.debug(
          `🧹 [PRIORITY_QUEUE] Cleaned ${cleaned} expired dedup entries (${initialSize} → ${this.dedupMap.size})`
        );
      }
    }

    // Trim request history
    if (this.requestHistory.length > this.maxHistorySize) {
      const removed = this.requestHistory.length - this.maxHistorySize;
      this.requestHistory = this.requestHistory.slice(-this.maxHistorySize);

      Logger.debug(`🧹 [PRIORITY_QUEUE] Trimmed ${removed} old history entries`);
    }
  }

  /**
   * Adiciona evento ao histórico
   * @param {string} event
   * @param {Object} requestWrapper
   */
  addToHistory(event, requestWrapper) {
    this.requestHistory.push({
      event,
      requestId: requestWrapper.id,
      priority: requestWrapper.priority,
      timestamp: Date.now(),
      signature: requestWrapper.signature.substring(0, 50), // Truncate for storage
    });
  }

  /**
   * Atualiza tempo médio de espera
   * @param {number} waitTime
   */
  updateAverageWaitTime(waitTime) {
    if (this.stats.totalDequeued === 1) {
      this.stats.avgWaitTime = waitTime;
    } else {
      // Moving average
      this.stats.avgWaitTime = this.stats.avgWaitTime * 0.9 + waitTime * 0.1;
    }
  }

  /**
   * Obtém tamanho total de todas as filas
   * @returns {number}
   */
  getTotalQueueSize() {
    return Array.from(this.queues.values()).reduce((total, queue) => total + queue.length, 0);
  }

  /**
   * Obtém string com tamanhos das filas
   * @returns {string}
   */
  getQueueSizesString() {
    return Array.from(this.queues.entries())
      .map(([priority, queue]) => `${priority}:${queue.length}`)
      .join(' ');
  }

  /**
   * Limpa todas as filas
   */
  clear() {
    let totalCleared = 0;

    for (const [priority, queue] of this.queues) {
      // Reject all pending requests
      queue.forEach(requestWrapper => {
        if (requestWrapper.reject) {
          requestWrapper.reject(new Error('Queue cleared'));
        }
      });

      totalCleared += queue.length;
      queue.length = 0; // Clear array
    }

    // Clear dedup map
    this.dedupMap.clear();

    Logger.info(`🧹 [PRIORITY_QUEUE] Cleared all queues: ${totalCleared} requests`);
  }

  /**
   * Obtém estatísticas detalhadas
   */
  getStats() {
    // Update queue sizes
    this.stats.queueSizes = {};
    for (const [priority, queue] of this.queues) {
      this.stats.queueSizes[priority] = queue.length;
    }

    return {
      ...this.stats,
      totalInQueue: this.getTotalQueueSize(),
      dedupMapSize: this.dedupMap.size,
      historySize: this.requestHistory.length,
      marketConditions: this.marketConditions,
      avgWaitTime: parseFloat(this.stats.avgWaitTime.toFixed(0)),
    };
  }

  /**
   * Verifica se a fila está saudável
   */
  isHealthy() {
    const stats = this.getStats();
    const totalSize = stats.totalInQueue;
    const utilizationRate = (totalSize / this.maxTotalSize) * 100;

    return {
      healthy:
        totalSize < this.maxTotalSize * 0.8 && // Menos de 80% da capacidade
        this.stats.avgWaitTime < 10000, // Menos de 10s de espera média
      totalSize,
      maxSize: this.maxTotalSize,
      utilizationRate: parseFloat(utilizationRate.toFixed(1)),
      avgWaitTime: this.stats.avgWaitTime,
      reason:
        totalSize >= this.maxTotalSize * 0.8
          ? 'High queue utilization'
          : this.stats.avgWaitTime >= 10000
            ? 'High average wait time'
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
      `📋 [PRIORITY_QUEUE] Status: ${stats.totalInQueue}/${this.maxTotalSize} queued | ` +
        `Sizes: ${this.getQueueSizesString()} | Wait: ${stats.avgWaitTime.toFixed(0)}ms | ${health.healthy ? '✅' : '❌'}`
    );

    Logger.info(
      `📊 [PRIORITY_QUEUE] Stats: enqueued=${stats.totalEnqueued}, dequeued=${stats.totalDequeued}, ` +
        `dropped=${stats.totalDropped}, dedup=${stats.totalDeduplicated}, aged=${stats.totalAged}`
    );
  }
}

export default PriorityRequestQueue;
