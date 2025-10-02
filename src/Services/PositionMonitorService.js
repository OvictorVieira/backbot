import Logger from '../Utils/Logger.js';
import { validateLeverageForSymbol } from '../Utils/Utils.js';

/**
 * Service responsável por monitorar posições abertas e validar thresholds de SL/TP
 * em tempo real via WebSocket
 */
class PositionMonitorService {
  // 🔧 Lazy loading para evitar dependência circular
  static _OrderController = null;

  static async getOrderController() {
    if (!PositionMonitorService._OrderController) {
      const module = await import('../Controllers/OrderController.js');
      PositionMonitorService._OrderController = module.default;
    }
    return PositionMonitorService._OrderController;
  }
  constructor() {
    this.isMonitoring = false;
    this.lastCheck = new Map(); // symbol -> timestamp
    this.checkThrottle = 1000; // Throttle de 1s por símbolo
    this.positionsCache = new Map(); // symbol -> {position, botConfig, lastUpdate}
    // 🔧 Cache não expira por tempo - só é removido quando posição é fechada

    // 🔄 Sistema de sincronização periódica de posições
    this.syncInterval = null;
    this.syncIntervalMs = 30000; // Sincroniza a cada 30 segundos
    this.registeredBots = new Map(); // botId -> {config, lastSync}
  }

  /**
   * Atualiza cache de posições quando o bot sincroniza
   * Chamado externamente pelo BotInstance quando atualiza posições
   */
  updatePositionCache(symbol, position, botConfig) {
    this.positionsCache.set(symbol, {
      position,
      botConfig,
      lastUpdate: Date.now(),
    });

    Logger.debug(
      `🔄 [CACHE_UPDATE] ${symbol}: Posição adicionada ao cache - ` +
        `Entry: ${position.avgEntryPrice || position.entryPrice}, ` +
        `Qty: ${position.netQuantity}, ` +
        `Leverage: ${botConfig.leverage}x`
    );
  }

  /**
   * Remove posição do cache quando fechada
   */
  removePositionFromCache(symbol) {
    const hadPosition = this.positionsCache.has(symbol);
    this.positionsCache.delete(symbol);

    if (hadPosition) {
      Logger.info(`🗑️ [POSITION_MONITOR] ${symbol}: Removido do cache - não será mais monitorado`);
    }
  }

  /**
   * Verifica se existe posição aberta para o símbolo e se deve fechar por SL/TP
   * Chamado pelo WebSocket a cada atualização de preço
   *
   * @param {string} symbol - Símbolo do mercado
   * @param {number} currentPrice - Preço atual do WebSocket
   */
  async checkPositionThresholds(symbol, currentPrice) {
    try {
      // Throttling - evita validações muito frequentes
      const now = Date.now();
      const lastCheckTime = this.lastCheck.get(symbol) || 0;
      if (now - lastCheckTime < this.checkThrottle) {
        return;
      }
      this.lastCheck.set(symbol, now);

      // Busca posição no cache
      const cached = this.positionsCache.get(symbol);
      if (!cached) {
        Logger.debug(
          `⏭️ [POSITION_MONITOR] ${symbol}: Nenhuma posição no cache - pulando verificação. ` +
            `Cache total: ${this.positionsCache.size} posições`
        );
        return;
      }

      const { position, botConfig } = cached;

      if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) {
        Logger.error(`❌ [POSITION_MONITOR] ${symbol}: Current price inválido: ${currentPrice}`);
        return;
      }

      // Calcula PnL% baseado no preço atual
      const entryPrice = parseFloat(position.entryPrice || position.avgEntryPrice || 0);
      const rawLeverage = parseFloat(botConfig.leverage);
      const isLong = parseFloat(position.netQuantity) > 0;

      if (!entryPrice || entryPrice <= 0) {
        Logger.error(`❌ [POSITION_MONITOR] ${symbol}: Entry price inválido: ${entryPrice}`);
        return;
      }

      if (!rawLeverage || isNaN(rawLeverage) || rawLeverage <= 0) {
        Logger.error(`❌ [POSITION_MONITOR] ${symbol}: Leverage inválido: ${rawLeverage}`);
        return;
      }

      // 🔧 CORREÇÃO CRÍTICA: Valida alavancagem baseada nas regras da Backpack
      // BTC, ETH, SOL: max 50x | Maioria: max 10x | 0G, AVANT: max 5x
      const leverage = validateLeverageForSymbol(symbol, rawLeverage);

      if (leverage !== rawLeverage) {
        Logger.debug(
          `⚙️ [LEVERAGE_ADJUST] ${symbol}: Alavancagem ajustada de ${rawLeverage}x para ${leverage}x`
        );
      }

      // Calcula PnL% considerando alavancagem
      const priceDiff = currentPrice - entryPrice;
      const pnlPct = isLong
        ? (priceDiff / entryPrice) * 100 * leverage
        : (-priceDiff / entryPrice) * 100 * leverage;

      const maxNegativePnlStopPct = parseFloat(botConfig.maxNegativePnlStopPct);
      const minProfitPercentage = parseFloat(botConfig.minProfitPercentage);

      // Valida que os valores de SL/TP são válidos
      if (
        !maxNegativePnlStopPct ||
        isNaN(maxNegativePnlStopPct) ||
        !minProfitPercentage ||
        isNaN(minProfitPercentage)
      ) {
        Logger.error(
          `❌ [POSITION_MONITOR] ${symbol}: Valores de SL/TP inválidos. ` +
            `SL: ${maxNegativePnlStopPct}, TP: ${minProfitPercentage}`
        );
        return;
      }

      // 🔒 Valida todos os valores antes de usar .toFixed()
      const leverageStr = leverage != null && !isNaN(leverage) ? `${leverage}x` : 'N/A';
      const pnlPctStr =
        pnlPct != null && !isNaN(pnlPct) && Number.isFinite(pnlPct)
          ? `${pnlPct.toFixed(2)}%`
          : 'N/A';
      const slStr =
        !isNaN(maxNegativePnlStopPct) && Number.isFinite(maxNegativePnlStopPct)
          ? `${maxNegativePnlStopPct.toFixed(2)}%`
          : 'N/A';
      const tpStr =
        !isNaN(minProfitPercentage) && Number.isFinite(minProfitPercentage)
          ? `${minProfitPercentage.toFixed(2)}%`
          : 'N/A';

      // 🔒 VALIDAÇÃO ADICIONAL: Garante que pnlPct é válido antes de verificar thresholds
      if (isNaN(pnlPct) || !Number.isFinite(pnlPct)) {
        Logger.error(`❌ [POSITION_MONITOR] ${symbol}: PnL% inválido calculado: ${pnlPct}`);
        return;
      }

      if (pnlPct <= maxNegativePnlStopPct) {
        Logger.warn(
          `🚨 [SL_TRIGGER] ${symbol}: Stop Loss acionado! PnL ${pnlPctStr} <= SL ${slStr}`
        );
        await this.closePosition(symbol, position, botConfig, 'STOP_LOSS', pnlPct);
        return;
      }

      if (pnlPct >= minProfitPercentage) {
        Logger.debug(
          `🎯 [TP_TRIGGER] ${symbol}: Take Profit acionado! PnL ${pnlPctStr} >= TP ${tpStr}`
        );
        await this.closePosition(symbol, position, botConfig, 'TAKE_PROFIT', pnlPct);
        return;
      }
    } catch (error) {
      Logger.error(`❌ [WS_THRESHOLD] Erro ao verificar thresholds para ${symbol}:`, error.message);
      Logger.error(`❌ [WS_THRESHOLD] Stack trace:`, error.stack);
    }
  }

  /**
   * Fecha posição a mercado quando threshold é atingido
   *
   * @param {string} symbol - Símbolo do mercado
   * @param {object} position - Dados da posição
   * @param {object} botConfig - Configuração do bot
   * @param {string} reason - Razão do fechamento (STOP_LOSS ou TAKE_PROFIT)
   * @param {number} pnlPct - PnL% no momento do fechamento
   */
  async closePosition(symbol, position, botConfig, reason, pnlPct) {
    try {
      // 🔒 Valida pnlPct antes de usar .toFixed()
      const pnlPctFormatted = pnlPct != null && !isNaN(pnlPct) ? pnlPct.toFixed(2) : 'N/A';

      // 🔒 VALIDAÇÃO CRÍTICA: Verifica se credenciais estão presentes
      if (!botConfig.apiKey || !botConfig.apiSecret) {
        throw new Error(
          `API_KEY e API_SECRET são obrigatórios para fechar posição. ` +
            `Recebido: apiKey=${botConfig.apiKey ? 'presente' : 'ausente'}, ` +
            `apiSecret=${botConfig.apiSecret ? 'presente' : 'ausente'}`
        );
      }

      // 🔧 Lazy loading para evitar dependência circular
      const OrderController = await PositionMonitorService.getOrderController();

      const closeResult = await OrderController.forceClose(position, botConfig);

      // Verifica se houve sucesso (result.id existe e não há erro)
      const hasSuccess =
        closeResult && (closeResult.id || closeResult.orderId) && !closeResult.error;

      if (hasSuccess) {
        Logger.info(
          `✅ [WS_AUTO_CLOSE] ${symbol}: Posição fechada com sucesso - Razão: ${reason}, PnL: ${pnlPctFormatted}%`
        );
        // Remove do cache após fechar com sucesso
        this.removePositionFromCache(symbol);
      } else {
        const errorMsg = (closeResult?.error || closeResult?.reason || '').toString().toLowerCase();
        Logger.warn(
          `⚠️ [WS_AUTO_CLOSE] ${symbol}: Falha ao fechar posição - ${closeResult?.error || closeResult?.reason || 'desconhecido'}`
        );

        // 🔒 Se erro indica que posição não existe, remove do cache para parar loop
        if (
          errorMsg.includes('reduce only order not reduced') ||
          errorMsg.includes('position not found') ||
          errorMsg.includes('no position') ||
          errorMsg.includes('posição não encontrada')
        ) {
          Logger.warn(
            `🗑️ [WS_AUTO_CLOSE] ${symbol}: Posição não existe mais - removendo do cache para parar loop`
          );
          this.removePositionFromCache(symbol);
        }
      }

      return closeResult;
    } catch (error) {
      Logger.error(`❌ [WS_AUTO_CLOSE] Erro ao fechar posição ${symbol}:`, error.message);

      // 🔒 Se erro indica que posição não existe, remove do cache
      const errorMsg = error.message.toLowerCase();
      if (
        errorMsg.includes('reduce only order not reduced') ||
        errorMsg.includes('position not found') ||
        errorMsg.includes('no position')
      ) {
        Logger.warn(
          `🗑️ [WS_AUTO_CLOSE] ${symbol}: Erro indica posição inexistente - removendo do cache`
        );
        this.removePositionFromCache(symbol);
      }

      return { success: false, reason: error.message };
    }
  }

  /**
   * Inicia o monitoramento de posições
   */
  start() {
    this.isMonitoring = true;
    Logger.info('✅ [POSITION_MONITOR] Serviço de monitoramento de posições iniciado');
  }

  /**
   * Para o monitoramento de posições
   */
  stop() {
    this.isMonitoring = false;
    this.lastCheck.clear();
    Logger.info('⏹️ [POSITION_MONITOR] Serviço de monitoramento de posições parado');
  }
}

export default new PositionMonitorService();
