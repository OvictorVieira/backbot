import Logger from './Logger.js';

/**
 * RequestHealthMonitor - Sistema abrangente de monitoramento de saúde para trading bots
 *
 * Monitora múltiplas dimensões de saúde do sistema de requests:
 * - Performance: latência, throughput, success rate
 * - Resource usage: memória, CPU, network
 * - API health: rate limits, error patterns, connectivity
 * - System stability: trends, anomalies, predictions
 *
 * Usado por sistemas de trading profissionais para prevenção proativa de problemas
 * e otimização contínua de performance.
 */
class RequestHealthMonitor {
  constructor(options = {}) {
    // Time windows for different analyses
    this.shortWindow = options.shortWindow || 60000; // 1 minute
    this.mediumWindow = options.mediumWindow || 300000; // 5 minutes
    this.longWindow = options.longWindow || 3600000; // 1 hour

    // Health thresholds
    this.thresholds = {
      responseTime: {
        good: options.responseTimeGood || 1000, // < 1s
        warning: options.responseTimeWarning || 3000, // < 3s
        critical: options.responseTimeCritical || 10000, // >= 10s
      },
      successRate: {
        critical: options.successRateCritical || 50, // < 50%
        warning: options.successRateWarning || 80, // < 80%
        good: options.successRateGood || 95, // >= 95%
      },
      errorRate: {
        good: options.errorRateGood || 5, // < 5%
        warning: options.errorRateWarning || 15, // < 15%
        critical: options.errorRateCritical || 30, // >= 30%
      },
      queueSize: {
        good: options.queueSizeGood || 100,
        warning: options.queueSizeWarning || 500,
        critical: options.queueSizeCritical || 1000,
      },
    };

    // Metrics storage
    this.metrics = {
      requests: [], // Individual request metrics
      snapshots: [], // Periodic system snapshots
      alerts: [], // Generated alerts
      trends: new Map(), // Trend analysis data
    };

    // Request tracking
    this.activeRequests = new Map(); // requestId -> start time
    this.requestCounter = 0;

    // Alert system
    this.alertCooldowns = new Map();
    this.alertCooldownDuration = options.alertCooldownDuration || 300000; // 5 minutes

    // Trend detection
    this.trendDetectionEnabled = options.trendDetection !== false;
    this.trendSensitivity = options.trendSensitivity || 0.1; // 10% change threshold

    // Anomaly detection
    this.anomalyDetectionEnabled = options.anomalyDetection !== false;
    this.anomalyThreshold = options.anomalyThreshold || 2.5; // 2.5 std deviations

    // Auto-healing suggestions
    this.autoHealingEnabled = options.autoHealing !== false;
    this.healingSuggestions = [];

    // Performance baseline
    this.baseline = {
      avgResponseTime: 0,
      avgSuccessRate: 0,
      avgThroughput: 0,
      established: false,
    };

    // Start monitoring tasks
    this.startPeriodicSnapshots();
    this.startTrendAnalysis();
    this.startCleanupTask();

    Logger.info(
      `📊 [HEALTH_MONITOR] Inicializado: windows=${this.shortWindow / 1000}s/${this.mediumWindow / 1000}s/${this.longWindow / 1000}s, ` +
        `trends=${this.trendDetectionEnabled}, anomalies=${this.anomalyDetectionEnabled}`
    );
  }

  /**
   * Registra início de uma request
   * @param {string} requestId
   * @param {Object} metadata
   */
  startRequest(requestId, metadata = {}) {
    this.activeRequests.set(requestId, {
      startTime: Date.now(),
      metadata: { ...metadata },
    });

    this.requestCounter++;
  }

  /**
   * Registra fim de uma request com resultado
   * @param {string} requestId
   * @param {Object} result
   */
  endRequest(requestId, result = {}) {
    const requestInfo = this.activeRequests.get(requestId);

    if (!requestInfo) {
      Logger.warn(`📊 [HEALTH_MONITOR] Request not found: ${requestId}`);
      return;
    }

    const endTime = Date.now();
    const responseTime = endTime - requestInfo.startTime;

    // Create request metric
    const metric = {
      requestId,
      startTime: requestInfo.startTime,
      endTime,
      responseTime,
      success: result.success !== false,
      statusCode: result.statusCode,
      errorType: result.errorType,
      errorMessage: result.errorMessage,
      endpoint: result.endpoint || requestInfo.metadata.endpoint,
      method: result.method || requestInfo.metadata.method,
      priority: result.priority || requestInfo.metadata.priority,
      retries: result.retries || 0,
      dataSize: result.dataSize || 0,
      fromCache: result.fromCache || false,
    };

    // Store metric
    this.metrics.requests.push(metric);
    this.activeRequests.delete(requestId);

    // Trigger real-time analysis
    this.analyzeRequestMetric(metric);

    // Cleanup old metrics
    this.cleanupOldMetrics();

    Logger.debug(
      `📊 [HEALTH_MONITOR] Request completed: ${requestId} (${responseTime}ms, ${metric.success ? 'SUCCESS' : 'FAILED'})`
    );
  }

  /**
   * Analisa métrica de request individual em tempo real
   * @param {Object} metric
   */
  analyzeRequestMetric(metric) {
    // Check for immediate alerts
    if (!metric.success) {
      this.checkErrorPatterns(metric);
    }

    if (metric.responseTime > this.thresholds.responseTime.critical) {
      this.generateAlert('CRITICAL', 'SLOW_RESPONSE', {
        responseTime: metric.responseTime,
        requestId: metric.requestId,
        endpoint: metric.endpoint,
      });
    }

    // Update baseline if established
    if (this.baseline.established) {
      this.updateBaseline(metric);
    }
  }

  /**
   * Verifica padrões de erro
   * @param {Object} metric
   */
  checkErrorPatterns(metric) {
    // Get recent errors
    const recentErrors = this.getRecentMetrics(this.shortWindow).filter(
      m => !m.success && m.errorType === metric.errorType
    );

    // Check for error bursts
    if (recentErrors.length >= 3) {
      this.generateAlert('WARNING', 'ERROR_BURST', {
        errorType: metric.errorType,
        count: recentErrors.length,
        window: this.shortWindow / 1000,
      });
    }

    // Check for specific error patterns
    if (metric.errorType === 'RATE_LIMIT') {
      this.generateAlert('CRITICAL', 'RATE_LIMIT_HIT', {
        endpoint: metric.endpoint,
        responseTime: metric.responseTime,
      });
    }
  }

  /**
   * Gera snapshot periódico do sistema
   */
  takeSystemSnapshot() {
    const now = Date.now();

    // Get metrics for different time windows
    const shortMetrics = this.getRecentMetrics(this.shortWindow);
    const mediumMetrics = this.getRecentMetrics(this.mediumWindow);
    const longMetrics = this.getRecentMetrics(this.longWindow);

    // Calculate key metrics
    const snapshot = {
      timestamp: now,
      shortWindow: this.calculateWindowMetrics(shortMetrics),
      mediumWindow: this.calculateWindowMetrics(mediumMetrics),
      longWindow: this.calculateWindowMetrics(longMetrics),
      activeRequests: this.activeRequests.size,
      queueHealth: this.getQueueHealth(),
      systemLoad: this.getSystemLoad(),
      memoryUsage: this.getMemoryUsage(),
    };

    // Store snapshot
    this.metrics.snapshots.push(snapshot);

    // Analyze snapshot for trends and anomalies
    this.analyzeSnapshot(snapshot);

    Logger.debug(
      `📸 [HEALTH_MONITOR] Snapshot: ${shortMetrics.length} requests, ` +
        `${snapshot.shortWindow.successRate.toFixed(1)}% success, ` +
        `${snapshot.shortWindow.avgResponseTime.toFixed(0)}ms avg`
    );

    return snapshot;
  }

  /**
   * Calcula métricas para uma janela de tempo
   * @param {Array} metrics
   * @returns {Object}
   */
  calculateWindowMetrics(metrics) {
    if (metrics.length === 0) {
      return {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        successRate: 0,
        errorRate: 0,
        avgResponseTime: 0,
        medianResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        throughput: 0,
        errorBreakdown: {},
        endpointBreakdown: {},
      };
    }

    const successful = metrics.filter(m => m.success);
    const failed = metrics.filter(m => !m.success);
    const responseTimes = metrics.map(m => m.responseTime).sort((a, b) => a - b);

    // Calculate percentiles
    const p95Index = Math.floor(responseTimes.length * 0.95);
    const p99Index = Math.floor(responseTimes.length * 0.99);
    const medianIndex = Math.floor(responseTimes.length * 0.5);

    // Error breakdown
    const errorBreakdown = {};
    failed.forEach(m => {
      const errorType = m.errorType || 'UNKNOWN';
      errorBreakdown[errorType] = (errorBreakdown[errorType] || 0) + 1;
    });

    // Endpoint breakdown
    const endpointBreakdown = {};
    metrics.forEach(m => {
      const endpoint = m.endpoint || 'UNKNOWN';
      if (!endpointBreakdown[endpoint]) {
        endpointBreakdown[endpoint] = { total: 0, successful: 0, avgResponseTime: 0 };
      }
      endpointBreakdown[endpoint].total++;
      if (m.success) endpointBreakdown[endpoint].successful++;
      endpointBreakdown[endpoint].avgResponseTime += m.responseTime;
    });

    // Calculate averages for endpoints
    Object.keys(endpointBreakdown).forEach(endpoint => {
      endpointBreakdown[endpoint].avgResponseTime /= endpointBreakdown[endpoint].total;
      endpointBreakdown[endpoint].successRate =
        (endpointBreakdown[endpoint].successful / endpointBreakdown[endpoint].total) * 100;
    });

    // Calculate time span for throughput
    const timeSpan = Math.max(
      1,
      (Math.max(...metrics.map(m => m.endTime)) - Math.min(...metrics.map(m => m.startTime))) / 1000
    );

    return {
      totalRequests: metrics.length,
      successfulRequests: successful.length,
      failedRequests: failed.length,
      successRate: (successful.length / metrics.length) * 100,
      errorRate: (failed.length / metrics.length) * 100,
      avgResponseTime: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
      medianResponseTime: responseTimes[medianIndex] || 0,
      p95ResponseTime: responseTimes[p95Index] || 0,
      p99ResponseTime: responseTimes[p99Index] || 0,
      throughput: metrics.length / timeSpan, // requests per second
      errorBreakdown,
      endpointBreakdown,
    };
  }

  /**
   * Analisa snapshot para tendências e anomalias
   * @param {Object} snapshot
   */
  analyzeSnapshot(snapshot) {
    // Check current health status
    const healthStatus = this.calculateHealthStatus(snapshot);

    // Generate alerts based on health status
    if (healthStatus.overall === 'CRITICAL') {
      this.generateAlert('CRITICAL', 'SYSTEM_UNHEALTHY', {
        healthScore: healthStatus.score,
        issues: healthStatus.issues,
      });
    } else if (healthStatus.overall === 'WARNING') {
      this.generateAlert('WARNING', 'SYSTEM_DEGRADED', {
        healthScore: healthStatus.score,
        issues: healthStatus.issues,
      });
    }

    // Trend analysis
    if (this.trendDetectionEnabled) {
      this.detectTrends(snapshot);
    }

    // Anomaly detection
    if (this.anomalyDetectionEnabled) {
      this.detectAnomalies(snapshot);
    }

    // Auto-healing suggestions
    if (this.autoHealingEnabled) {
      this.generateHealingSuggestions(healthStatus);
    }
  }

  /**
   * Calcula status geral de saúde
   * @param {Object} snapshot
   * @returns {Object}
   */
  calculateHealthStatus(snapshot) {
    const metrics = snapshot.shortWindow;
    const issues = [];
    let score = 100;

    // Response time health
    if (metrics.avgResponseTime >= this.thresholds.responseTime.critical) {
      issues.push('Critical response time');
      score -= 30;
    } else if (metrics.avgResponseTime >= this.thresholds.responseTime.warning) {
      issues.push('Slow response time');
      score -= 15;
    }

    // Success rate health
    if (metrics.successRate < this.thresholds.successRate.critical) {
      issues.push('Critical success rate');
      score -= 40;
    } else if (metrics.successRate < this.thresholds.successRate.warning) {
      issues.push('Low success rate');
      score -= 20;
    }

    // Error rate health
    if (metrics.errorRate >= this.thresholds.errorRate.critical) {
      issues.push('High error rate');
      score -= 35;
    } else if (metrics.errorRate >= this.thresholds.errorRate.warning) {
      issues.push('Elevated error rate');
      score -= 15;
    }

    // Queue health
    const queueHealth = this.getQueueHealth();
    if (queueHealth.totalSize >= this.thresholds.queueSize.critical) {
      issues.push('Queue overflow');
      score -= 25;
    } else if (queueHealth.totalSize >= this.thresholds.queueSize.warning) {
      issues.push('High queue size');
      score -= 10;
    }

    // Determine overall status
    let overall;
    if (score >= 80) overall = 'GOOD';
    else if (score >= 60) overall = 'WARNING';
    else overall = 'CRITICAL';

    return {
      overall,
      score: Math.max(0, score),
      issues,
      timestamp: Date.now(),
    };
  }

  /**
   * Detecta tendências nos dados
   * @param {Object} snapshot
   */
  detectTrends(snapshot) {
    const snapshots = this.metrics.snapshots;

    if (snapshots.length < 5) return; // Need at least 5 data points

    // Analyze key metrics trends
    const trendMetrics = ['avgResponseTime', 'successRate', 'throughput', 'errorRate'];

    trendMetrics.forEach(metric => {
      const values = snapshots.slice(-5).map(s => s.shortWindow[metric]);
      const trend = this.calculateTrend(values);

      if (Math.abs(trend.slope) > this.trendSensitivity) {
        const direction = trend.slope > 0 ? 'INCREASING' : 'DECREASING';
        const severity = Math.abs(trend.slope) > this.trendSensitivity * 2 ? 'WARNING' : 'INFO';

        this.generateAlert(severity, 'TREND_DETECTED', {
          metric,
          direction,
          slope: trend.slope,
          confidence: trend.confidence,
        });
      }
    });
  }

  /**
   * Calcula tendência linear simples
   * @param {Array} values
   * @returns {Object}
   */
  calculateTrend(values) {
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const xMean = x.reduce((a, b) => a + b) / n;
    const yMean = values.reduce((a, b) => a + b) / n;

    const numerator = x.reduce((sum, xi, i) => sum + (xi - xMean) * (values[i] - yMean), 0);
    const denominator = x.reduce((sum, xi) => sum + Math.pow(xi - xMean, 2), 0);

    const slope = denominator !== 0 ? numerator / denominator : 0;

    // Calculate R-squared for confidence
    const yPred = x.map(xi => slope * (xi - xMean) + yMean);
    const ssRes = values.reduce((sum, yi, i) => sum + Math.pow(yi - yPred[i], 2), 0);
    const ssTot = values.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
    const confidence = ssTot !== 0 ? 1 - ssRes / ssTot : 0;

    return { slope, confidence };
  }

  /**
   * Detecta anomalias nos dados
   * @param {Object} snapshot
   */
  detectAnomalies(snapshot) {
    // Need historical data for anomaly detection
    if (this.metrics.snapshots.length < 10) return;

    const recent = this.metrics.snapshots.slice(-10);
    const current = snapshot.shortWindow;

    // Check each metric for anomalies
    const anomalyMetrics = ['avgResponseTime', 'successRate', 'errorRate', 'throughput'];

    anomalyMetrics.forEach(metric => {
      const historicalValues = recent.map(s => s.shortWindow[metric]);
      const mean = historicalValues.reduce((a, b) => a + b) / historicalValues.length;
      const stdDev = Math.sqrt(
        historicalValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
          historicalValues.length
      );

      const currentValue = current[metric];
      const zScore = stdDev !== 0 ? Math.abs(currentValue - mean) / stdDev : 0;

      if (zScore > this.anomalyThreshold) {
        this.generateAlert('WARNING', 'ANOMALY_DETECTED', {
          metric,
          currentValue,
          expectedValue: mean,
          zScore: zScore.toFixed(2),
          deviation: (((currentValue - mean) / mean) * 100).toFixed(1) + '%',
        });
      }
    });
  }

  /**
   * Gera sugestões de auto-healing
   * @param {Object} healthStatus
   */
  generateHealingSuggestions(healthStatus) {
    const suggestions = [];

    if (healthStatus.issues.includes('Critical response time')) {
      suggestions.push({
        type: 'INCREASE_TIMEOUT',
        description: 'Consider increasing request timeout values',
        priority: 'HIGH',
        automated: false,
      });
    }

    if (healthStatus.issues.includes('High error rate')) {
      suggestions.push({
        type: 'ENABLE_CIRCUIT_BREAKER',
        description: 'Activate circuit breaker to prevent cascading failures',
        priority: 'CRITICAL',
        automated: true,
      });
    }

    if (healthStatus.issues.includes('Queue overflow')) {
      suggestions.push({
        type: 'INCREASE_CONCURRENCY',
        description: 'Increase concurrent request processing',
        priority: 'HIGH',
        automated: true,
      });
    }

    // Store new suggestions
    suggestions.forEach(suggestion => {
      suggestion.timestamp = Date.now();
      this.healingSuggestions.push(suggestion);
    });

    // Limit suggestions history
    if (this.healingSuggestions.length > 100) {
      this.healingSuggestions = this.healingSuggestions.slice(-50);
    }
  }

  /**
   * Gera alerta com cooldown
   * @param {string} severity
   * @param {string} type
   * @param {Object} details
   */
  generateAlert(severity, type, details = {}) {
    const alertKey = `${severity}-${type}`;

    // Check cooldown
    const lastAlert = this.alertCooldowns.get(alertKey);
    if (lastAlert && Date.now() - lastAlert < this.alertCooldownDuration) {
      return; // Still in cooldown
    }

    const alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      severity,
      type,
      details,
      timestamp: Date.now(),
      acknowledged: false,
    };

    this.metrics.alerts.push(alert);
    this.alertCooldowns.set(alertKey, Date.now());

    // Log alert
    const logLevel = severity === 'CRITICAL' ? 'error' : severity === 'WARNING' ? 'warn' : 'info';
    Logger[logLevel](`🚨 [HEALTH_MONITOR] ${severity} Alert: ${type} | ${JSON.stringify(details)}`);

    return alert;
  }

  /**
   * Obtém métricas recentes dentro de uma janela de tempo
   * @param {number} windowMs
   * @returns {Array}
   */
  getRecentMetrics(windowMs) {
    const cutoff = Date.now() - windowMs;
    return this.metrics.requests.filter(m => m.endTime >= cutoff);
  }

  /**
   * Obtém saúde da fila (mock - deve ser implementado pelo sistema de fila)
   * @returns {Object}
   */
  getQueueHealth() {
    // This should be implemented to integrate with actual queue system
    return {
      totalSize: 0,
      prioritySizes: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
      avgWaitTime: 0,
    };
  }

  /**
   * Obtém carga do sistema (simplificado)
   * @returns {Object}
   */
  getSystemLoad() {
    return {
      cpu: process.cpuUsage ? process.cpuUsage() : { user: 0, system: 0 },
      activeRequests: this.activeRequests.size,
      requestRate: this.getRecentMetrics(60000).length / 60, // requests per second
    };
  }

  /**
   * Obtém uso de memória
   * @returns {Object}
   */
  getMemoryUsage() {
    const memUsage = process.memoryUsage();
    return {
      rss: Math.round(memUsage.rss / 1024 / 1024), // MB
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      external: Math.round(memUsage.external / 1024 / 1024), // MB
    };
  }

  /**
   * Atualiza baseline de performance
   * @param {Object} metric
   */
  updateBaseline(metric) {
    // Simple moving average update
    const alpha = 0.1; // Smoothing factor

    if (metric.success) {
      this.baseline.avgResponseTime =
        (1 - alpha) * this.baseline.avgResponseTime + alpha * metric.responseTime;
    }

    // Update success rate based on recent window
    const recentMetrics = this.getRecentMetrics(this.mediumWindow);
    if (recentMetrics.length > 0) {
      const recentSuccessRate =
        (recentMetrics.filter(m => m.success).length / recentMetrics.length) * 100;
      this.baseline.avgSuccessRate =
        (1 - alpha) * this.baseline.avgSuccessRate + alpha * recentSuccessRate;
    }
  }

  /**
   * Estabelece baseline inicial
   */
  establishBaseline() {
    const recentMetrics = this.getRecentMetrics(this.mediumWindow);

    if (recentMetrics.length >= 50) {
      // Need enough data
      const successful = recentMetrics.filter(m => m.success);

      this.baseline.avgResponseTime =
        successful.reduce((sum, m) => sum + m.responseTime, 0) / successful.length;
      this.baseline.avgSuccessRate = (successful.length / recentMetrics.length) * 100;
      this.baseline.avgThroughput = recentMetrics.length / (this.mediumWindow / 1000);
      this.baseline.established = true;

      Logger.info(
        `📊 [HEALTH_MONITOR] Baseline established: ${this.baseline.avgResponseTime.toFixed(0)}ms response, ` +
          `${this.baseline.avgSuccessRate.toFixed(1)}% success, ${this.baseline.avgThroughput.toFixed(2)} req/s`
      );
    }
  }

  /**
   * Inicia snapshots periódicos
   */
  startPeriodicSnapshots() {
    // Take snapshot every minute
    setInterval(() => {
      this.takeSystemSnapshot();

      // Try to establish baseline if not done yet
      if (!this.baseline.established) {
        this.establishBaseline();
      }
    }, 60000);
  }

  /**
   * Inicia análise de tendências
   */
  startTrendAnalysis() {
    // Analyze trends every 5 minutes
    setInterval(() => {
      if (this.metrics.snapshots.length >= 5) {
        // Trend analysis is done in analyzeSnapshot
        Logger.debug('📊 [HEALTH_MONITOR] Trend analysis completed');
      }
    }, 300000);
  }

  /**
   * Inicia task de limpeza
   */
  startCleanupTask() {
    // Cleanup every 10 minutes
    setInterval(() => {
      this.cleanupOldMetrics();
      this.cleanupOldAlerts();
    }, 600000);
  }

  /**
   * Limpa métricas antigas
   */
  cleanupOldMetrics() {
    const cutoff = Date.now() - this.longWindow;

    // Clean old request metrics
    const initialSize = this.metrics.requests.length;
    this.metrics.requests = this.metrics.requests.filter(m => m.endTime >= cutoff);

    // Clean old snapshots (keep more history for snapshots)
    const snapshotCutoff = Date.now() - this.longWindow * 4; // 4 hours
    this.metrics.snapshots = this.metrics.snapshots.filter(s => s.timestamp >= snapshotCutoff);

    const cleaned = initialSize - this.metrics.requests.length;
    if (cleaned > 0) {
      Logger.debug(
        `🧹 [HEALTH_MONITOR] Cleaned ${cleaned} old metrics (${this.metrics.requests.length} remaining)`
      );
    }
  }

  /**
   * Limpa alertas antigos
   */
  cleanupOldAlerts() {
    const cutoff = Date.now() - this.longWindow * 2; // 2 hours

    const initialSize = this.metrics.alerts.length;
    this.metrics.alerts = this.metrics.alerts.filter(a => a.timestamp >= cutoff);

    const cleaned = initialSize - this.metrics.alerts.length;
    if (cleaned > 0) {
      Logger.debug(
        `🧹 [HEALTH_MONITOR] Cleaned ${cleaned} old alerts (${this.metrics.alerts.length} remaining)`
      );
    }
  }

  /**
   * Obtém relatório completo de saúde
   */
  getHealthReport() {
    const latestSnapshot = this.metrics.snapshots[this.metrics.snapshots.length - 1];
    const healthStatus = latestSnapshot ? this.calculateHealthStatus(latestSnapshot) : null;

    return {
      timestamp: Date.now(),
      healthStatus,
      currentSnapshot: latestSnapshot,
      activeRequests: this.activeRequests.size,
      recentAlerts: this.metrics.alerts.slice(-10),
      healingSuggestions: this.healingSuggestions.slice(-5),
      systemLoad: this.getSystemLoad(),
      memoryUsage: this.getMemoryUsage(),
      baseline: this.baseline,
      statistics: {
        totalRequests: this.requestCounter,
        totalSnapshots: this.metrics.snapshots.length,
        totalAlerts: this.metrics.alerts.length,
        monitoringDuration: Date.now() - (this.metrics.snapshots[0]?.timestamp || Date.now()),
      },
    };
  }

  /**
   * Log de status detalhado
   */
  logStatus() {
    const report = this.getHealthReport();

    if (report.healthStatus) {
      Logger.info(
        `📊 [HEALTH_MONITOR] Health: ${report.healthStatus.overall} (${report.healthStatus.score}) | ` +
          `Active: ${report.activeRequests} | Alerts: ${report.recentAlerts.length} | ` +
          `Memory: ${report.memoryUsage.heapUsed}MB`
      );

      if (report.healthStatus.issues.length > 0) {
        Logger.warn(`⚠️ [HEALTH_MONITOR] Issues: ${report.healthStatus.issues.join(', ')}`);
      }
    }

    if (report.baseline.established) {
      Logger.info(
        `📊 [HEALTH_MONITOR] Baseline: ${report.baseline.avgResponseTime.toFixed(0)}ms, ` +
          `${report.baseline.avgSuccessRate.toFixed(1)}%, ${report.baseline.avgThroughput.toFixed(2)} req/s`
      );
    }
  }
}

export default RequestHealthMonitor;
