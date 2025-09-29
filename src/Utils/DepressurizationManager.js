import Logger from './Logger.js';
import RequestManager from './RequestManager.js';
import AccountController from '../Controllers/AccountController.js';

/**
 * Sistema de Despressurização do Bot
 *
 * Problema: Após horas de operação contínua, o bot degrada:
 * - Cache corrompido (capitalAvailable = NaN)
 * - Memory leaks causando iterator errors
 * - API rate limiting acumulado
 * - Ordem book cache stale
 * - Trailing stop states inconsistentes
 *
 * Solução: Reset preventivo a cada 1h com 10min de pausa
 */
class DepressurizationManager {
  constructor() {
    this.isDepressurizationActive = false;

    // 🔧 CONFIGURAÇÃO VIA ENV: Tempo em minutos para facilitar testes
    const intervalMinutes = parseInt(process.env.DEPRESSURIZATION_INTERVAL_MINUTES) || 60; // Default: 60min (1h)
    const durationMinutes = parseInt(process.env.DEPRESSURIZATION_DURATION_MINUTES) || 10; // Default: 10min

    this.depressurizationInterval = intervalMinutes * 60 * 1000; // Converte minutos para ms
    this.depressurizationDuration = durationMinutes * 60 * 1000; // Converte minutos para ms
    this.lastDepressurizationTime = Date.now();
    this.depressurizationTimer = null;

    // Validação de valores mínimos para segurança
    const minIntervalMinutes = 5; // Mínimo 5 minutos
    const minDurationMinutes = 1; // Mínimo 1 minuto

    if (intervalMinutes < minIntervalMinutes) {
      Logger.warn(
        `⚠️ [DEPRESSURIZATION] Intervalo muito baixo (${intervalMinutes}min) - usando mínimo ${minIntervalMinutes}min`
      );
      this.depressurizationInterval = minIntervalMinutes * 60 * 1000;
    }

    if (durationMinutes < minDurationMinutes) {
      Logger.warn(
        `⚠️ [DEPRESSURIZATION] Duração muito baixa (${durationMinutes}min) - usando mínimo ${minDurationMinutes}min`
      );
      this.depressurizationDuration = minDurationMinutes * 60 * 1000;
    }

    // Log dinâmico baseado no tempo configurado
    const finalIntervalMinutes = Math.max(intervalMinutes, minIntervalMinutes);
    const finalDurationMinutes = Math.max(durationMinutes, minDurationMinutes);

    // Start automatic depressurization cycle
    this.startDepressurizationCycle();

    Logger.info(`🔄 [DEPRESSURIZATION] Sistema inicializado:`);
    Logger.info(
      `   • Intervalo: ${finalIntervalMinutes}min (${this.formatTime(finalIntervalMinutes)})`
    );
    Logger.info(`   • Duração pausa: ${finalDurationMinutes}min`);
    Logger.info(
      `   • ENV: DEPRESSURIZATION_INTERVAL_MINUTES=${process.env.DEPRESSURIZATION_INTERVAL_MINUTES || 'default'}`
    );
  }

  /**
   * Formata tempo em minutos para exibição legível
   */
  formatTime(minutes) {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      if (remainingMinutes === 0) {
        return `${hours}h`;
      }
      return `${hours}h${remainingMinutes}min`;
    }
    return `${minutes}min`;
  }

  /**
   * Inicia o ciclo automático de despressurização
   */
  startDepressurizationCycle() {
    // Schedule first depressurization
    this.scheduleNextDepressurization();
  }

  /**
   * Agenda a próxima despressurização
   */
  scheduleNextDepressurization() {
    const timeUntilNext =
      this.depressurizationInterval - (Date.now() - this.lastDepressurizationTime);
    const actualDelay = Math.max(timeUntilNext, 60000); // Mínimo 1 minuto

    if (this.depressurizationTimer) {
      clearTimeout(this.depressurizationTimer);
    }

    this.depressurizationTimer = setTimeout(async () => {
      await this.performDepressurization();
      this.scheduleNextDepressurization();
    }, actualDelay);

    const minutesUntilNext = Math.round(actualDelay / (60 * 1000));
    Logger.info(
      `⏰ [DEPRESSURIZATION] Próxima despressurização agendada para ${this.formatTime(minutesUntilNext)}`
    );
  }

  /**
   * Executa a despressurização completa do sistema
   */
  async performDepressurization() {
    if (this.isDepressurizationActive) {
      Logger.warn('🔄 [DEPRESSURIZATION] Já em progresso - ignorando nova tentativa');
      return;
    }

    this.isDepressurizationActive = true;
    this.lastDepressurizationTime = Date.now();

    Logger.warn('🚨 [DEPRESSURIZATION] ===== INICIANDO DESPRESSURIZAÇÃO PREVENTIVA =====');
    Logger.warn('🔄 [DEPRESSURIZATION] Bot entrando em modo manutenção por 10 minutos...');
    Logger.warn('🔄 [DEPRESSURIZATION] Motivo: Prevenção de degradação após operação prolongada');

    try {
      // 1. Limpeza de Caches
      await this.clearAllCaches();

      // 2. Reset de Componentes Críticos
      await this.resetCriticalComponents();

      // 3. Força Garbage Collection
      await this.forceGarbageCollection();

      // 4. Pausa Preventiva
      await this.preventivePause();

      // 5. Verificação Pós-Reset
      await this.postResetValidation();

      Logger.info('✅ [DEPRESSURIZATION] ===== DESPRESSURIZAÇÃO CONCLUÍDA COM SUCESSO =====');
    } catch (error) {
      Logger.error('❌ [DEPRESSURIZATION] Erro durante despressurização:', error.message);
    } finally {
      this.isDepressurizationActive = false;
      // Limpar cache de logs de bloqueio quando manutenção terminar
      DepressurizationManager.clearBlockedLogs();
    }
  }

  /**
   * Limpa todos os caches do sistema
   */
  async clearAllCaches() {
    Logger.info('🧹 [DEPRESSURIZATION] Limpando todos os caches...');

    try {
      // Account Controller Cache
      if (AccountController.accountCacheByBot) {
        AccountController.accountCacheByBot.clear();
        Logger.info('✅ [DEPRESSURIZATION] AccountController cache limpo');
      }

      if (AccountController.lastCacheTimeByBot) {
        AccountController.lastCacheTimeByBot.clear();
        Logger.info('✅ [DEPRESSURIZATION] AccountController timestamps limpos');
      }

      if (AccountController.capitalLoggedByBot) {
        AccountController.capitalLoggedByBot.clear();
        Logger.info('✅ [DEPRESSURIZATION] AccountController capital logs limpos');
      }

      if (AccountController.pendingRequests) {
        AccountController.pendingRequests.clear();
        Logger.info('✅ [DEPRESSURIZATION] AccountController pending requests limpos');
      }

      // Decision Cache (se existir)
      const Decision = (await import('../Decision/Decision.js')).default;
      if (Decision && Decision.prototype.marketCache) {
        Decision.prototype.marketCache = new Map();
        Logger.info('✅ [DEPRESSURIZATION] Decision cache limpo');
      }
    } catch (error) {
      Logger.error('❌ [DEPRESSURIZATION] Erro ao limpar caches:', error.message);
    }
  }

  /**
   * Reset de componentes críticos
   */
  async resetCriticalComponents() {
    Logger.info('🔄 [DEPRESSURIZATION] Resetando componentes críticos...');

    try {
      // RequestManager Reset
      if (RequestManager && RequestManager.forceReset) {
        RequestManager.forceReset();
        Logger.info('✅ [DEPRESSURIZATION] RequestManager resetado');
      }

      // Reset Global Rate Limit
      if (AccountController.globalRateLimit) {
        AccountController.globalRateLimit.lastApiCall = 0;
        Logger.info('✅ [DEPRESSURIZATION] Global rate limit resetado');
      }

      // Reset Error Logs
      AccountController.lastErrorLog = 0;
      AccountController.lastDebounceLog = 0;
      Logger.info('✅ [DEPRESSURIZATION] Error logs resetados');
    } catch (error) {
      Logger.error('❌ [DEPRESSURIZATION] Erro ao resetar componentes:', error.message);
    }
  }

  /**
   * Força garbage collection para liberar memória
   */
  async forceGarbageCollection() {
    Logger.info('🗑️ [DEPRESSURIZATION] Executando garbage collection...');

    try {
      // Força GC se disponível
      if (global.gc) {
        global.gc();
        Logger.info('✅ [DEPRESSURIZATION] Garbage collection executado');
      } else {
        Logger.warn(
          '⚠️ [DEPRESSURIZATION] Garbage collection não disponível (rode com --expose-gc)'
        );
      }

      // Log memory usage
      const memUsage = process.memoryUsage();
      Logger.info(
        `📊 [DEPRESSURIZATION] Memória - RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`
      );
    } catch (error) {
      Logger.error('❌ [DEPRESSURIZATION] Erro durante garbage collection:', error.message);
    }
  }

  /**
   * Pausa preventiva de 10 minutos
   */
  async preventivePause() {
    const pauseMinutes = this.depressurizationDuration / (60 * 1000);
    Logger.warn(`⏳ [DEPRESSURIZATION] Pausando sistema por ${pauseMinutes} minutos...`);
    Logger.warn(
      '🔄 [DEPRESSURIZATION] Motivo: Permitir estabilização da API e reset interno de sistemas'
    );

    // Countdown timer para feedback visual
    const startTime = Date.now();
    const endTime = startTime + this.depressurizationDuration;

    while (Date.now() < endTime) {
      const remaining = Math.round((endTime - Date.now()) / (60 * 1000));
      if (remaining > 0 && remaining % 2 === 0) {
        // Log a cada 2 minutos
        Logger.info(`⏳ [DEPRESSURIZATION] Aguardando... ${remaining} minutos restantes`);
      }

      // Sleep 30 segundos
      await new Promise(resolve => setTimeout(resolve, 30000));
    }

    Logger.info('✅ [DEPRESSURIZATION] Pausa preventiva concluída - sistema reiniciando');
  }

  /**
   * Validação pós-reset
   */
  async postResetValidation() {
    Logger.info('🔍 [DEPRESSURIZATION] Executando validação pós-reset...');

    try {
      // Test API connectivity
      const Markets = (await import('../Backpack/Public/Markets.js')).default;
      const markets = new Markets();
      const testMarkets = await markets.getMarkets();

      if (testMarkets && testMarkets.length > 0) {
        Logger.info(
          `✅ [DEPRESSURIZATION] API conectividade OK - ${testMarkets.length} markets disponíveis`
        );
      } else {
        Logger.warn('⚠️ [DEPRESSURIZATION] API pode estar instável - markets retornou vazio');
      }

      // Validate cache is clean
      const accountCacheSize = AccountController.accountCacheByBot
        ? AccountController.accountCacheByBot.size
        : 0;
      Logger.info(
        `✅ [DEPRESSURIZATION] Cache validation - AccountCache size: ${accountCacheSize}`
      );

      Logger.info('✅ [DEPRESSURIZATION] Validação pós-reset concluída com sucesso');
    } catch (error) {
      Logger.error('❌ [DEPRESSURIZATION] Erro na validação pós-reset:', error.message);
    }
  }

  /**
   * Verifica se o sistema está em despressurização
   */
  isActive() {
    return this.isDepressurizationActive;
  }

  /**
   * Função estática global para verificação rápida em qualquer lugar do código
   * @returns {boolean} True se sistema está em manutenção
   */
  static isSystemInMaintenance() {
    return global.depressurizationManager && global.depressurizationManager.isActive();
  }

  /**
   * Função helper para logging de operações bloqueadas com debounce
   * @param {string} operation - Nome da operação que foi bloqueada
   * @param {string} component - Componente que tentou executar a operação
   */
  static logBlockedOperation(operation, component = 'UNKNOWN') {
    // Sistema de debounce - só loga uma vez por componente a cada 30 segundos
    const key = `${component}_${operation}`;
    const now = Date.now();
    const debounceTime = 30000; // 30 segundos

    if (!this.lastBlockedLogs) {
      this.lastBlockedLogs = new Map();
    }

    const lastLog = this.lastBlockedLogs.get(key);
    if (!lastLog || now - lastLog > debounceTime) {
      this.lastBlockedLogs.set(key, now);
      Logger.info(
        `🚫 [MAINTENANCE_BLOCK] ${operation} bloqueada em ${component} - Evitando rate limit durante manutenção`
      );
    }
  }

  /**
   * Limpa o cache de logs de operações bloqueadas
   */
  static clearBlockedLogs() {
    if (this.lastBlockedLogs) {
      this.lastBlockedLogs.clear();
      Logger.debug('🧹 [MAINTENANCE_CLEANUP] Cache de logs de bloqueio limpo');
    }
  }

  /**
   * Para o ciclo de despressurização
   */
  stop() {
    if (this.depressurizationTimer) {
      clearTimeout(this.depressurizationTimer);
      this.depressurizationTimer = null;
    }
    Logger.info('🛑 [DEPRESSURIZATION] Ciclo de despressurização interrompido');
  }

  /**
   * Força despressurização imediata (para debugging)
   */
  async forceDepressurization() {
    Logger.warn('🚨 [DEPRESSURIZATION] Despressurização forçada iniciada');
    await this.performDepressurization();
  }

  /**
   * Configura intervalo personalizado (em horas)
   */
  setInterval(hours) {
    this.depressurizationInterval = hours * 60 * 60 * 1000;
    Logger.info(`⚙️ [DEPRESSURIZATION] Intervalo atualizado para ${hours}h`);

    // Reagenda próxima despressurização
    this.scheduleNextDepressurization();
  }

  /**
   * Configura duração personalizada (em minutos)
   */
  setDuration(minutes) {
    this.depressurizationDuration = minutes * 60 * 1000;
    Logger.info(`⚙️ [DEPRESSURIZATION] Duração atualizada para ${minutes}min`);
  }
}

export default DepressurizationManager;
