import Logger from './Logger.js';
import BackpackWebSocket from '../Backpack/Public/WebSocket.js';
import ExchangeManager from '../Exchange/ExchangeManager.js';
import CachedOrdersService from './CachedOrdersService.js';

/**
 * LimitOrderValidator - Sistema de validação e cancelamento automático de ordens LIMIT
 *
 * Monitora ordens LIMIT abertas via WebSocket e cancela automaticamente quando:
 * - O slippage ultrapassa o limite configurado
 * - A ordem fica muito longe do preço atual de mercado
 *
 * IMPORTANTE: Usado apenas para orderExecutionMode = 'LIMIT'
 */
class LimitOrderValidator {
  constructor() {
    this.isActive = false;
    this.webSocket = null;
    this.monitoredOrders = new Map(); // orderId -> { symbol, side, price, botConfig }
    this.priceCache = new Map(); // symbol -> currentPrice
    this.validationInterval = null;

    // Configurações de slippage
    this.defaultSlippageThreshold = 0.8; // 0.8% - Conservador mas não muito agressivo
    this.validationIntervalMs = 15000; // Verifica a cada 15 segundos
    this.maxOrderAge = 5 * 60 * 1000; // Remove ordens após 5 minutos sem validação

    // 🔒 Sistema de cooldown para evitar criação imediata de nova ordem após cancelamento
    this.recentCancellations = new Map(); // symbol -> { timestamp, orderId, botId }
    this.cancellationCooldown = 10000; // 10 segundos de cooldown após cancelamento

    Logger.info('🎯 [LIMIT_VALIDATOR] Inicializador criado');
  }

  /**
   * Inicia o sistema de validação
   */
  async start() {
    if (this.isActive) {
      Logger.warn('⚠️ [LIMIT_VALIDATOR] Sistema já está ativo');
      return;
    }

    try {
      Logger.info('🚀 [LIMIT_VALIDATOR] Iniciando sistema de validação...');

      // Inicializa WebSocket
      this.webSocket = new BackpackWebSocket();
      await this.webSocket.connect();

      // Inicia validação periódica
      this.startValidationLoop();

      this.isActive = true;
      Logger.info('✅ [LIMIT_VALIDATOR] Sistema iniciado com sucesso');
    } catch (error) {
      Logger.error('❌ [LIMIT_VALIDATOR] Erro ao iniciar sistema:', error.message);
      throw error;
    }
  }

  /**
   * Para o sistema de validação
   */
  async stop() {
    if (!this.isActive) {
      return;
    }

    Logger.info('🛑 [LIMIT_VALIDATOR] Parando sistema...');

    this.isActive = false;

    // Para validação periódica
    if (this.validationInterval) {
      clearInterval(this.validationInterval);
      this.validationInterval = null;
    }

    // Desconecta WebSocket
    if (this.webSocket) {
      this.webSocket.disconnect();
      this.webSocket = null;
    }

    // Limpa dados
    this.monitoredOrders.clear();
    this.priceCache.clear();

    Logger.info('✅ [LIMIT_VALIDATOR] Sistema parado com sucesso');
  }

  /**
   * Adiciona uma ordem LIMIT para monitoramento
   * @param {Object} orderData - Dados da ordem
   * @param {string} orderData.orderId - ID da ordem
   * @param {string} orderData.symbol - Símbolo do mercado
   * @param {string} orderData.side - Lado da ordem (Bid/Ask)
   * @param {number} orderData.price - Preço da ordem
   * @param {Object} orderData.botConfig - Configuração do bot (apiKey, apiSecret, etc.)
   * @param {number} orderData.slippageThreshold - Limite de slippage (opcional)
   */
  async addOrderToMonitor(orderData) {
    if (!this.isActive) {
      Logger.warn('⚠️ [LIMIT_VALIDATOR] Sistema não está ativo - ignorando ordem');
      return;
    }

    const { orderId, symbol, side, price, botConfig, slippageThreshold } = orderData;

    if (!orderId || !symbol || !side || !price || !botConfig) {
      Logger.error('❌ [LIMIT_VALIDATOR] Dados da ordem incompletos');
      return;
    }

    // Adiciona ordem ao monitoramento
    this.monitoredOrders.set(orderId, {
      symbol,
      side,
      price: parseFloat(price),
      botConfig,
      slippageThreshold: slippageThreshold || this.defaultSlippageThreshold,
      addedAt: Date.now(),
      lastValidation: Date.now(),
    });

    // Subscribe ao símbolo se ainda não estiver
    if (!this.priceCache.has(symbol)) {
      await this.subscribeToSymbol(symbol);
    }

    // 📊 Log detalhado: mostra total de ordens e de quais bots
    const botsByOrders = new Map();
    for (const [id, order] of this.monitoredOrders) {
      const botName = order.botConfig?.botName || order.botConfig?.id || 'UNKNOWN';
      botsByOrders.set(botName, (botsByOrders.get(botName) || 0) + 1);
    }
    const botsInfo = Array.from(botsByOrders.entries())
      .map(([name, count]) => `${name}(${count})`)
      .join(', ');

    Logger.info(
      `📝 [LIMIT_VALIDATOR] Ordem adicionada: ${orderId} | ${symbol} ${side} @ $${price} | Bot: ${botConfig?.botName || botConfig?.id || 'UNKNOWN'} | Total: ${this.monitoredOrders.size} ordens [${botsInfo}]`
    );
  }

  /**
   * Remove uma ordem do monitoramento
   * @param {string} orderId - ID da ordem
   */
  removeOrderFromMonitor(orderId) {
    if (this.monitoredOrders.has(orderId)) {
      const orderData = this.monitoredOrders.get(orderId);
      const botName = orderData.botConfig?.botName || orderData.botConfig?.id || 'UNKNOWN';
      this.monitoredOrders.delete(orderId);

      // 📊 Log detalhado: mostra quantas ordens restam e de quais bots
      const botsByOrders = new Map();
      for (const [id, order] of this.monitoredOrders) {
        const name = order.botConfig?.botName || order.botConfig?.id || 'UNKNOWN';
        botsByOrders.set(name, (botsByOrders.get(name) || 0) + 1);
      }
      const botsInfo =
        botsByOrders.size > 0
          ? Array.from(botsByOrders.entries())
              .map(([name, count]) => `${name}(${count})`)
              .join(', ')
          : 'nenhum';

      Logger.info(
        `🗑️ [LIMIT_VALIDATOR] Ordem removida: ${orderId} (${orderData.symbol}) | Bot: ${botName} | Restam: ${this.monitoredOrders.size} ordens [${botsInfo}]`
      );

      // Se não há mais ordens para este símbolo, unsubscribe
      const hasOtherOrdersForSymbol = Array.from(this.monitoredOrders.values()).some(
        order => order.symbol === orderData.symbol
      );

      if (!hasOtherOrdersForSymbol) {
        this.unsubscribeFromSymbol(orderData.symbol);
      }
    }
  }

  /**
   * Subscribe a atualizações de preço de um símbolo
   * @param {string} symbol - Símbolo do mercado
   */
  async subscribeToSymbol(symbol) {
    if (!this.webSocket || !this.webSocket.connected) {
      Logger.warn(
        `⚠️ [LIMIT_VALIDATOR] WebSocket não conectado - não é possível subscribir ${symbol}`
      );
      return;
    }

    try {
      await this.webSocket.subscribeSymbol(symbol, (sym, price, data) => {
        this.updatePrice(sym, price);
      });

      Logger.debug(`📡 [LIMIT_VALIDATOR] Subscribed a ${symbol}`);
    } catch (error) {
      Logger.error(`❌ [LIMIT_VALIDATOR] Erro ao subscribir ${symbol}:`, error.message);
    }
  }

  /**
   * Unsubscribe de atualizações de preço de um símbolo
   * @param {string} symbol - Símbolo do mercado
   */
  async unsubscribeFromSymbol(symbol) {
    if (!this.webSocket || !this.webSocket.connected) {
      return;
    }

    try {
      await this.webSocket.unsubscribeSymbol(symbol);
      this.priceCache.delete(symbol);

      Logger.debug(`📡 [LIMIT_VALIDATOR] Unsubscribed de ${symbol}`);
    } catch (error) {
      Logger.error(`❌ [LIMIT_VALIDATOR] Erro ao unsubscribir ${symbol}:`, error.message);
    }
  }

  /**
   * Atualiza preço no cache e valida ordens em tempo real
   * @param {string} symbol - Símbolo do mercado
   * @param {number} price - Preço atual
   */
  async updatePrice(symbol, price) {
    const previousPrice = this.priceCache.get(symbol);
    this.priceCache.set(symbol, price);

    // Só loga se o preço mudou significativamente (> 0.1%)
    if (!previousPrice || Math.abs((price - previousPrice) / previousPrice) > 0.001) {
      Logger.debug(`💰 [LIMIT_VALIDATOR] ${symbol}: $${parseFloat(price).toFixed(6)}`);
    }

    await this.validateOrdersForSymbol(symbol);
  }

  /**
   * Valida todas as ordens de um símbolo específico
   * @param {string} symbol - Símbolo do mercado
   */
  async validateOrdersForSymbol(symbol) {
    if (!this.isActive || this.monitoredOrders.size === 0) {
      return;
    }

    const now = Date.now();
    const ordersToRemove = [];

    // Filtra ordens apenas deste símbolo
    for (const [orderId, orderData] of this.monitoredOrders.entries()) {
      if (orderData.symbol !== symbol) {
        continue;
      }

      try {
        const shouldCancel = await this.validateOrderSlippage(orderId, orderData);

        if (shouldCancel) {
          await this.cancelOrderDueToSlippage(orderId, orderData);
          ordersToRemove.push(orderId);
        } else {
          orderData.lastValidation = now;
        }
      } catch (error) {
        Logger.error(`❌ [LIMIT_VALIDATOR] Erro ao validar ordem ${orderId}:`, error.message);
      }
    }

    ordersToRemove.forEach(orderId => {
      this.removeOrderFromMonitor(orderId);
    });
  }

  /**
   * Inicia loop de validação periódica
   */
  startValidationLoop() {
    this.validationInterval = setInterval(async () => {
      try {
        await this.validateAllOrders();
      } catch (error) {
        Logger.error('❌ [LIMIT_VALIDATOR] Erro no loop de validação:', error.message);
      }
    }, this.validationIntervalMs);

    Logger.debug(
      `⏰ [LIMIT_VALIDATOR] Loop de validação iniciado (${this.validationIntervalMs}ms)`
    );
  }

  /**
   * Valida todas as ordens monitoradas
   */
  async validateAllOrders() {
    if (this.monitoredOrders.size === 0) {
      return;
    }

    const now = Date.now();
    const ordersToRemove = [];

    Logger.debug(`🔍 [LIMIT_VALIDATOR] Validando ${this.monitoredOrders.size} ordens...`);

    for (const [orderId, orderData] of this.monitoredOrders.entries()) {
      try {
        if (now - orderData.addedAt > this.maxOrderAge) {
          Logger.debug(
            `⏰ [LIMIT_VALIDATOR] Ordem ${orderId} removida por idade (${Math.round((now - orderData.addedAt) / 60000)}min)`
          );
          ordersToRemove.push(orderId);
          continue;
        }

        const shouldCancel = await this.validateOrderSlippage(orderId, orderData);

        if (shouldCancel) {
          await this.cancelOrderDueToSlippage(orderId, orderData);
          ordersToRemove.push(orderId);
        } else {
          orderData.lastValidation = now;
        }
      } catch (error) {
        Logger.error(`❌ [LIMIT_VALIDATOR] Erro ao validar ordem ${orderId}:`, error.message);

        if (!orderData.errorCount) orderData.errorCount = 0;
        orderData.errorCount++;

        if (orderData.errorCount >= 3) {
          Logger.warn(`⚠️ [LIMIT_VALIDATOR] Removendo ordem ${orderId} após 3 erros consecutivos`);
          ordersToRemove.push(orderId);
        }
      }
    }

    ordersToRemove.forEach(orderId => {
      this.removeOrderFromMonitor(orderId);
    });
  }

  /**
   * Valida se uma ordem deve ser cancelada por slippage
   * @param {string} orderId - ID da ordem
   * @param {Object} orderData - Dados da ordem
   * @returns {boolean} True se deve cancelar
   */
  async validateOrderSlippage(orderId, orderData) {
    const { symbol, side, price, slippageThreshold } = orderData;

    const currentPrice = this.priceCache.get(symbol);
    if (!currentPrice) {
      Logger.debug(`⚠️ [LIMIT_VALIDATOR] ${orderId}: Preço atual não disponível para ${symbol}`);
      return false;
    }

    // Calcula slippage baseado no lado da ordem
    let slippage = 0;

    if (side === 'Bid') {
      slippage = ((currentPrice - price) / price) * 100;
    } else if (side === 'Ask') {
      slippage = ((price - currentPrice) / price) * 100;
    }

    const shouldCancel = slippage > slippageThreshold;

    if (shouldCancel) {
      Logger.warn(
        `🚨 [LIMIT_VALIDATOR] ${orderId}: SLIPPAGE ALTO! ${symbol} ${side} @ $${price} | Atual: $${currentPrice} | Slippage: ${slippage.toFixed(3)}% > ${slippageThreshold}%`
      );
    } else {
      Logger.debug(
        `✅ [LIMIT_VALIDATOR] ${orderId}: OK - ${symbol} ${side} @ $${price} | Atual: $${currentPrice} | Slippage: ${slippage.toFixed(3)}%`
      );
    }

    return shouldCancel;
  }

  /**
   * Cancela uma ordem devido a slippage alto
   * @param {string} orderId - ID da ordem
   * @param {Object} orderData - Dados da ordem
   */
  async cancelOrderDueToSlippage(orderId, orderData) {
    const { symbol, botConfig } = orderData;

    try {
      Logger.warn(
        `🚫 [LIMIT_VALIDATOR] Slippage alto detectado para ${symbol} - verificando ordens pendentes na corretora...`
      );

      // 🔍 BUSCA ORDENS PENDENTES DIRETAMENTE DA EXCHANGE
      const exchangeManager = ExchangeManager.createFromConfig(botConfig);
      const openOrders = await exchangeManager.getOpenOrdersForSymbol(
        symbol,
        botConfig.apiKey,
        botConfig.apiSecret
      );

      // Filtra apenas ordens LIMIT de entrada (não SL/TP)
      const limitOrders = openOrders.filter(order => {
        const isLimitOrder = order.orderType === 'Limit';
        const isPending = order.status === 'Pending' || order.status === 'New';
        const isNotReduceOnly = !order.reduceOnly;
        const isNotStopLoss = !order.stopLossTriggerPrice && !order.stopLossLimitPrice;
        const isNotTakeProfit = !order.takeProfitTriggerPrice && !order.takeProfitLimitPrice;

        return isLimitOrder && isPending && isNotReduceOnly && isNotStopLoss && isNotTakeProfit;
      });

      if (limitOrders.length === 0) {
        Logger.info(
          `✅ [LIMIT_VALIDATOR] Nenhuma ordem LIMIT pendente encontrada para ${symbol} - provavelmente foi EXECUTADA (filled)`
        );

        // 🔒 Invalida cache - ordem pode ter sido executada
        CachedOrdersService.invalidateCache(symbol, botConfig.apiKey);

        Logger.info(
          `📢 [LIMIT_VALIDATOR] ORDEM_EXECUTADA: ${symbol} | Sistema não criará nova ordem (já foi executada)`
        );

        // Remove do monitoramento sem criar cooldown
        return;
      }

      // 📋 Log das ordens encontradas
      Logger.info(
        `📋 [LIMIT_VALIDATOR] ${symbol}: ${limitOrders.length} ordem(ns) LIMIT pendente(s) encontrada(s)`
      );

      limitOrders.forEach(order => {
        Logger.debug(
          `   📝 ID: ${order.id} | ${order.side} @ $${order.price} | Qty: ${order.quantity}`
        );
      });

      // 🎯 Cancela TODAS as ordens LIMIT de entrada deste símbolo
      let cancelCount = 0;
      for (const order of limitOrders) {
        try {
          Logger.warn(
            `🚫 [LIMIT_VALIDATOR] Cancelando ordem ${order.id} (${symbol}) por slippage alto...`
          );

          const result = await exchangeManager.cancelOpenOrder(
            symbol,
            order.id,
            null,
            botConfig.apiKey,
            botConfig.apiSecret
          );

          if (result && result.success !== false) {
            Logger.info(`✅ [LIMIT_VALIDATOR] Ordem ${order.id} cancelada com sucesso`);
            cancelCount++;
          } else {
            Logger.warn(
              `⚠️ [LIMIT_VALIDATOR] Resposta inesperada ao cancelar ordem ${order.id}:`,
              JSON.stringify(result)
            );
          }
        } catch (error) {
          Logger.error(`❌ [LIMIT_VALIDATOR] Erro ao cancelar ordem ${order.id}:`, error.message);
        }
      }

      if (cancelCount > 0) {
        Logger.info(
          `✅ [LIMIT_VALIDATOR] ${symbol}: ${cancelCount} ordem(ns) cancelada(s) com sucesso`
        );

        // 🔒 Invalida cache de ordens para forçar atualização
        CachedOrdersService.invalidateCache(symbol, botConfig.apiKey);
        Logger.debug(`🔄 [LIMIT_VALIDATOR] Cache de ordens invalidado para ${symbol}`);

        // Notifica que ordens foram canceladas (ativa cooldown)
        this.notifyOrderCancelled(orderId, orderData, 'SLIPPAGE_HIGH');
      } else {
        Logger.warn(`⚠️ [LIMIT_VALIDATOR] ${symbol}: Nenhuma ordem foi cancelada com sucesso`);
      }
    } catch (error) {
      Logger.error(
        `❌ [LIMIT_VALIDATOR] Erro crítico ao processar cancelamento para ${symbol}:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Notifica sistema sobre cancelamento de ordem
   * @param {string} orderId - ID da ordem cancelada
   * @param {Object} orderData - Dados da ordem
   * @param {string} reason - Motivo do cancelamento
   */
  notifyOrderCancelled(orderId, orderData, reason) {
    const { symbol, botConfig } = orderData;

    // 🔒 Registra cancelamento para cooldown
    this.recentCancellations.set(symbol, {
      timestamp: Date.now(),
      orderId,
      botId: botConfig?.id || 'UNKNOWN',
      reason,
    });

    Logger.info(`📢 [LIMIT_VALIDATOR] ORDEM_CANCELADA: ${orderId} | ${symbol} | Motivo: ${reason}`);
    Logger.warn(
      `⏱️ [LIMIT_VALIDATOR] ${symbol}: Cooldown de ${this.cancellationCooldown / 1000}s ativado - Sistema não criará nova ordem imediatamente`
    );

    // Limpa cooldown automaticamente após o tempo definido
    setTimeout(() => {
      if (this.recentCancellations.get(symbol)?.orderId === orderId) {
        this.recentCancellations.delete(symbol);
        Logger.info(
          `✅ [LIMIT_VALIDATOR] ${symbol}: Cooldown expirado - Sistema pode criar nova ordem`
        );
      }
    }, this.cancellationCooldown);

    // TODO: Integrar com sistema de eventos se necessário
    // EventEmitter.emit('limitOrderCancelled', { orderId, orderData, reason });
  }

  /**
   * Verifica se um símbolo está em cooldown (cancelamento recente)
   * @param {string} symbol - Símbolo do mercado
   * @returns {boolean} True se está em cooldown
   */
  isSymbolInCooldown(symbol) {
    const cancellation = this.recentCancellations.get(symbol);
    if (!cancellation) return false;

    const elapsed = Date.now() - cancellation.timestamp;
    const isInCooldown = elapsed < this.cancellationCooldown;

    if (isInCooldown) {
      const remaining = Math.ceil((this.cancellationCooldown - elapsed) / 1000);
      Logger.debug(
        `⏱️ [LIMIT_VALIDATOR] ${symbol}: Em cooldown - ${remaining}s restantes (ordem ${cancellation.orderId} cancelada por ${cancellation.reason})`
      );
    }

    return isInCooldown;
  }

  /**
   * Obtém estatísticas do sistema
   */
  getStats() {
    const ordersBySymbol = {};
    for (const orderData of this.monitoredOrders.values()) {
      if (!ordersBySymbol[orderData.symbol]) {
        ordersBySymbol[orderData.symbol] = 0;
      }
      ordersBySymbol[orderData.symbol]++;
    }

    return {
      isActive: this.isActive,
      totalOrders: this.monitoredOrders.size,
      monitoredSymbols: this.priceCache.size,
      ordersBySymbol,
      defaultSlippageThreshold: this.defaultSlippageThreshold,
      validationIntervalMs: this.validationIntervalMs,
      webSocketConnected: this.webSocket?.connected || false,
    };
  }

  /**
   * Atualiza configurações
   * @param {Object} config - Novas configurações
   */
  updateConfig(config = {}) {
    if (config.slippageThreshold !== undefined) {
      this.defaultSlippageThreshold = parseFloat(config.slippageThreshold);
      Logger.info(
        `🔧 [LIMIT_VALIDATOR] Slippage threshold atualizado para ${this.defaultSlippageThreshold}%`
      );
    }

    if (config.validationIntervalMs !== undefined) {
      this.validationIntervalMs = parseInt(config.validationIntervalMs);

      // Reinicia loop de validação com novo intervalo
      if (this.validationInterval) {
        clearInterval(this.validationInterval);
        this.startValidationLoop();
      }

      Logger.info(
        `🔧 [LIMIT_VALIDATOR] Intervalo de validação atualizado para ${this.validationIntervalMs}ms`
      );
    }
  }

  /**
   * Log do status atual
   */
  logStatus() {
    const stats = this.getStats();

    Logger.info(
      `📊 [LIMIT_VALIDATOR] Status: ${stats.isActive ? 'ATIVO' : 'INATIVO'} | ` +
        `Ordens: ${stats.totalOrders} | Símbolos: ${stats.monitoredSymbols} | ` +
        `WebSocket: ${stats.webSocketConnected ? 'CONECTADO' : 'DESCONECTADO'} | ` +
        `Slippage: ${stats.defaultSlippageThreshold}%`
    );

    if (stats.totalOrders > 0) {
      Logger.debug(`📈 [LIMIT_VALIDATOR] Ordens por símbolo:`, stats.ordersBySymbol);
    }
  }
}

// Export singleton instance
export default new LimitOrderValidator();
