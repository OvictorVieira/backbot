import ExchangeManager from '../Exchange/ExchangeManager.js';
import BotOrdersManager from '../Config/BotOrdersManager.js';
import Logger from '../Utils/Logger.js';
import PositionTrackingService from './PositionTrackingService.js';

/**
 * Serviço para sincronizar posições e detectar fechamentos automáticos
 */
class PositionSyncService {
  constructor(dbService) {
    this.dbService = dbService;
    this.syncIntervals = new Map(); // botId -> intervalId
    this.lastSyncTimes = new Map(); // botId -> lastSyncTime
  }

  /**
   * Para monitoramento de sincronização para um bot
   * @param {number} botId - ID do bot
   */
  stopSyncForBot(botId) {
    const intervalId = this.syncIntervals.get(botId);
    if (intervalId) {
      clearInterval(intervalId);
      this.syncIntervals.delete(botId);
      this.lastSyncTimes.delete(botId);
      Logger.debug(`🛑 [POSITION_SYNC] Sincronização parada para bot ${botId}`);
    }
  }

  /**
   * Sincroniza posições de um bot específico
   * @param {number} botId - ID do bot
   * @param {object} config - Configuração do bot
   */
  async syncBotPositions(botId, config) {
    try {
      const startTime = Date.now();
      Logger.debug(`🔄 [POSITION_SYNC] Iniciando sincronização para bot ${botId}`);

      // NOVO SISTEMA: Usa PositionTrackingService para rastreamento baseado em fills
      Logger.debug(`🔄 [POSITION_SYNC] Usando novo sistema de rastreamento de posições`);

      // 1. Rastreia posições usando o novo sistema
      const positionTracker = new PositionTrackingService(this.dbService);
      // 5. Atualiza estatísticas
      await this.updateBotStatistics(botId, config);

      const duration = Date.now() - startTime;
      Logger.debug(`✅ [POSITION_SYNC] Sincronização concluída para bot ${botId} (${duration}ms)`);

      this.lastSyncTimes.set(botId, new Date());
    } catch (error) {
      Logger.error(`❌ [POSITION_SYNC] Erro na sincronização do bot ${botId}:`, error.message);
    }
  }

  /**
   * Busca fills recentes da corretora
   * @param {number} botId - ID do bot
   * @param {object} config - Configuração do bot
   */
  async getRecentFills(botId, config) {
    try {
      // Busca fills das últimas 24 horas
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      const exchangeManager = ExchangeManager.createFromConfig(config);
      const fills = await exchangeManager.getTrades(symbol, 1000); // Usando getTrades como alternativa ao getFillHistory

      if (!fills || !Array.isArray(fills)) {
        return [];
      }

      // Filtra fills do bot específico
      const botFills = this.filterBotFills(fills, config.botClientOrderId);

      Logger.debug(
        `📊 [POSITION_SYNC] Encontrados ${botFills.length} fills recentes para bot ${botId}`
      );

      return botFills;
    } catch (error) {
      Logger.error(`❌ [POSITION_SYNC] Erro ao buscar fills para bot ${botId}:`, error.message);
      return [];
    }
  }

  /**
   * [DESABILITADO] Busca posições abertas da corretora
   *
   * MOTIVO: Este método busca TODAS as posições da conta, incluindo posições manuais.
   * Isso pode causar interferência entre o bot e trading manual.
   *
   * NOVA ABORDAGEM: Usar apenas posições da tabela 'positions' (criadas pelos fills do próprio bot)
   *
   * @param {object} config - Configuração do bot
   */
  async getOpenPositions(config) {
    Logger.warn(
      '⚠️ [POSITION_SYNC] getOpenPositions foi desabilitado - usando apenas posições do bot'
    );
    return [];

    // Código original comentado:
    /*
    try {
      const exchangeManager = ExchangeManager.createFromConfig(config);
      const positions = await exchangeManager.getFuturesPositions(config.apiKey, config.apiSecret);
      return positions || [];

    } catch (error) {
      Logger.error(`❌ [POSITION_SYNC] Erro ao buscar posições abertas:`, error.message);
      return [];
    }
    */
  }

  /**
   * Busca ordens abertas do nosso banco
   * @param {number} botId - ID do bot
   */
  async getOurOpenOrders(botId) {
    try {
      const orders = await BotOrdersManager.getBotOrders(botId);

      // Filtra apenas ordens que não foram fechadas
      const openOrders = orders.filter(order => {
        // CORREÇÃO: Contar apenas ordens FILLED que ainda não foram fechadas
        return order.status === 'FILLED' && (!order.closeTime || order.closeTime === '');
      });

      return openOrders;
    } catch (error) {
      Logger.error(
        `❌ [POSITION_SYNC] Erro ao buscar ordens abertas do bot ${botId}:`,
        error.message
      );
      return [];
    }
  }

  /**
   * NOVO MÉTODO: Detecta posições fechadas usando o novo sistema de rastreamento
   * @param {number} botId - ID do bot
   * @param {object} config - Configuração do bot
   * @param {object} trackingResult - Resultado do rastreamento de posições
   */
  async detectClosedPositionsNew(botId, config, trackingResult) {
    const closedPositions = [];

    try {
      const { reconstructedPositions } = trackingResult;

      // Filtra posições que foram fechadas
      const closedPositionsData = reconstructedPositions.filter(pos => pos.isClosed);

      if (closedPositionsData.length > 0) {
        Logger.info(
          `🔍 [POSITION_SYNC] Bot ${botId}: ${closedPositionsData.length} posições fechadas detectadas`
        );
      } else {
        Logger.debug(`🔍 [POSITION_SYNC] Bot ${botId}: Nenhuma posição fechada detectada`);
      }

      // 🚨 VALIDAÇÃO CRÍTICA: Verifica se closedPositionsData é iterável
      if (
        !Array.isArray(closedPositionsData) ||
        !closedPositionsData[Symbol.iterator] ||
        typeof closedPositionsData[Symbol.iterator] !== 'function'
      ) {
        Logger.error(
          `❌ [POSITION_SYNC] Bot ${botId}: closedPositionsData não é iterável - type: ${typeof closedPositionsData}, isArray: ${Array.isArray(closedPositionsData)}`
        );
        return { closedPositions: [], recentFills: [] };
      }

      // Para cada posição fechada, atualiza o banco
      for (const position of closedPositionsData) {
        try {
          // 🚨 VALIDAÇÃO CRÍTICA: Verifica se position é um objeto válido
          if (!position || typeof position !== 'object' || position === null) {
            Logger.error(
              `❌ [POSITION_SYNC] Bot ${botId}: position é null ou inválido - type: ${typeof position}, value:`,
              position
            );
            continue;
          }

          await this.handleClosedPositionNew(botId, position);

          closedPositions.push({
            symbol: position.symbol,
            side: position.side,
            originalOrder: position.originalOrder,
            closureType: position.closeType,
            closePrice: position.closePrice,
            closeQuantity: position.closeQuantity,
            closeTime: position.closeTime,
            pnl: position.pnl,
            pnlPct: position.pnlPct,
          });
        } catch (error) {
          Logger.error(
            `❌ [POSITION_SYNC] Erro ao processar posição fechada ${position.symbol}:`,
            error.message
          );
        }
      }

      if (closedPositions.length > 0) {
        Logger.info(
          `✅ [POSITION_SYNC] Bot ${botId}: ${closedPositions.length} posições processadas`
        );
      }
    } catch (error) {
      Logger.error(
        `❌ [POSITION_SYNC] Erro ao detectar posições fechadas (novo sistema) para bot ${botId}:`,
        error.message
      );
    }

    return closedPositions;
  }

  /**
   * MÉTODO LEGADO: Detecta posições que foram fechadas automaticamente (mantido para compatibilidade)
   * @param {number} botId - ID do bot
   * @param {object} config - Configuração do bot
   * @param {Array} ourOpenOrders - Nossas ordens abertas
   * @param {Array} recentFills - Fills recentes da corretora
   */
  async detectClosedPositions(botId, config, ourOpenOrders, recentFills) {
    const closedPositions = [];

    try {
      // Agrupa fills por símbolo
      const fillsBySymbol = this.groupFillsBySymbol(recentFills);

      // 🚨 VALIDAÇÃO CRÍTICA: Verifica se ourOpenOrders é iterável
      if (
        !Array.isArray(ourOpenOrders) ||
        !ourOpenOrders[Symbol.iterator] ||
        typeof ourOpenOrders[Symbol.iterator] !== 'function'
      ) {
        Logger.error(
          `❌ [POSITION_SYNC] Bot ${botId}: ourOpenOrders não é iterável - type: ${typeof ourOpenOrders}, isArray: ${Array.isArray(ourOpenOrders)}`
        );
        return { closedPositions: [], recentFills: [] };
      }

      // Para cada ordem aberta do nosso lado
      for (const order of ourOpenOrders) {
        // 🚨 VALIDAÇÃO CRÍTICA: Verifica se order é um objeto válido
        if (!order || typeof order !== 'object' || order === null) {
          Logger.error(
            `❌ [POSITION_SYNC] Bot ${botId}: order é null ou inválido - type: ${typeof order}, value:`,
            order
          );
          continue;
        }

        const symbol = order.symbol;
        const symbolFills = fillsBySymbol[symbol] || [];

        if (symbolFills.length === 0) continue;

        // Calcula se a posição foi fechada
        const positionStatus = this.calculatePositionStatus(order, symbolFills);

        if (positionStatus.isClosed) {
          // Posição foi fechada automaticamente
          await this.handleClosedPosition(botId, order, positionStatus);
          closedPositions.push({
            originalOrder: order,
            closureType: positionStatus.closureType,
            closePrice: positionStatus.closePrice,
            closeQuantity: positionStatus.closeQuantity,
            closeTime: positionStatus.closeTime,
          });
        }
      }

      if (closedPositions.length > 0) {
        Logger.info(
          `🔍 [POSITION_SYNC] Bot ${botId}: ${closedPositions.length} posições fechadas automaticamente`
        );
      }
    } catch (error) {
      Logger.error(
        `❌ [POSITION_SYNC] Erro ao detectar posições fechadas para bot ${botId}:`,
        error.message
      );
    }

    return closedPositions;
  }

  /**
   * Calcula o status de uma posição baseado nos fills
   * @param {object} order - Ordem do nosso banco
   * @param {Array} symbolFills - Fills do símbolo
   */
  calculatePositionStatus(order, symbolFills) {
    const side = order.side; // BUY ou SELL
    const orderQuantity = parseFloat(order.quantity);
    const orderPrice = parseFloat(order.price);

    let totalFilledQuantity = 0;
    let totalFilledValue = 0;
    let closePrice = null;
    let closeTime = null;

    // Ordena fills por timestamp
    const sortedFills = symbolFills.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // 🚨 VALIDAÇÃO CRÍTICA: Verifica se sortedFills é iterável
    if (
      !Array.isArray(sortedFills) ||
      !sortedFills[Symbol.iterator] ||
      typeof sortedFills[Symbol.iterator] !== 'function'
    ) {
      Logger.error(
        `❌ [POSITION_SYNC] sortedFills não é iterável - type: ${typeof sortedFills}, isArray: ${Array.isArray(sortedFills)}`
      );
      return { isClosed: false, closureType: null };
    }

    for (const fill of sortedFills) {
      const fillSide = fill.side === 'Bid' ? 'BUY' : fill.side === 'Ask' ? 'SELL' : fill.side;
      const fillQuantity = parseFloat(fill.quantity);
      const fillPrice = parseFloat(fill.price);

      // Se é direção oposta à nossa posição
      if (fillSide !== side) {
        totalFilledQuantity += fillQuantity;
        totalFilledValue += fillQuantity * fillPrice;
        closePrice = fillPrice;
        closeTime = new Date(fill.timestamp);

        // Se preencheu toda a quantidade, posição foi fechada
        if (totalFilledQuantity >= orderQuantity) {
          return {
            isClosed: true,
            closureType: 'AUTO',
            closePrice: closePrice,
            closeQuantity: orderQuantity,
            closeTime: closeTime,
            remainingQuantity: 0,
          };
        }
      } else {
        // Mesma direção - pode ser entrada adicional
        // Não afeta o fechamento
      }
    }

    // Posição ainda aberta
    return {
      isClosed: false,
      remainingQuantity: orderQuantity - totalFilledQuantity,
    };
  }

  /**
   * NOVO MÉTODO: Manipula posições fechadas usando o novo sistema
   * @param {number} botId - ID do bot
   * @param {object} position - Posição reconstruída
   */
  async handleClosedPositionNew(botId, position) {
    try {
      const {
        symbol,
        side,
        originalOrder,
        closePrice,
        closeTime,
        closeQuantity,
        closeType,
        pnl,
        pnlPct,
      } = position;

      Logger.info(
        `🔍 [POSITION_SYNC] NOVO SISTEMA: Posição fechada: ${symbol} ${side} ${closeQuantity}`
      );

      // Atualiza a ordem no banco com status fechado
      await BotOrdersManager.updateOrder(originalOrder.externalOrderId, {
        status: 'CLOSED',
        closePrice: closePrice,
        closeTime: closeTime,
        closeQuantity: closeQuantity,
        closeType: closeType,
        pnl: pnl,
        pnlPct: pnlPct,
      });

      Logger.info(
        `💰 [POSITION_SYNC] NOVO SISTEMA: PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) para ${symbol}`
      );
    } catch (error) {
      Logger.error(
        `❌ [POSITION_SYNC] Erro ao manipular posição fechada (novo sistema):`,
        error.message
      );
    }
  }

  /**
   * MÉTODO LEGADO: Manipula uma posição que foi fechada automaticamente (mantido para compatibilidade)
   * @param {number} botId - ID do bot
   * @param {object} order - Ordem original
   * @param {object} positionStatus - Status da posição
   */
  async handleClosedPosition(botId, order, positionStatus) {
    try {
      Logger.info(
        `🔍 [POSITION_SYNC] Posição fechada automaticamente: ${order.symbol} ${order.side} ${order.quantity}`
      );

      // Atualiza a ordem no banco com status fechado
      await BotOrdersManager.updateOrder(order.externalOrderId, {
        status: 'CLOSED',
        closePrice: positionStatus.closePrice,
        closeTime: positionStatus.closeTime,
        closeQuantity: positionStatus.closeQuantity,
        closeType: positionStatus.closureType,
      });

      // Calcula PnL
      const pnl = this.calculatePnL(order, positionStatus);

      Logger.info(`💰 [POSITION_SYNC] PnL calculado: $${pnl.toFixed(2)} para ${order.symbol}`);
    } catch (error) {
      Logger.error(`❌ [POSITION_SYNC] Erro ao manipular posição fechada:`, error.message);
    }
  }

  /**
   * Calcula PnL de uma posição fechada
   * @param {object} order - Ordem original
   * @param {object} positionStatus - Status da posição
   */
  calculatePnL(order, positionStatus) {
    const entryPrice = parseFloat(order.price);
    const exitPrice = positionStatus.closePrice;
    const quantity = parseFloat(order.quantity);
    const side = order.side;

    let pnl;
    if (side === 'BUY') {
      // Long position: (exit - entry) * quantity
      pnl = (exitPrice - entryPrice) * quantity;
    } else {
      // Short position: (entry - exit) * quantity
      pnl = (entryPrice - exitPrice) * quantity;
    }

    return pnl;
  }

  /**
   * Atualiza estatísticas do bot usando o novo sistema
   * @param {number} botId - ID do bot
   * @param {object} config - Configuração do bot
   */
  async updateBotStatistics(botId, config) {
    try {
      // Usa o novo sistema para obter estatísticas atualizadas
      const positionTracker = new PositionTrackingService(this.dbService);
      const trackingResult = await positionTracker.trackBotPositions(botId, config);
      const { performanceMetrics } = trackingResult;

      Logger.debug(
        `📊 [POSITION_SYNC] Bot ${botId}: Estatísticas - ${performanceMetrics.closedPositions}/${performanceMetrics.totalPositions} posições, WR: ${performanceMetrics.winRate.toFixed(1)}%, PnL: $${performanceMetrics.totalPnl.toFixed(2)}`
      );

      // TODO: Salvar estatísticas no banco de dados
    } catch (error) {
      Logger.error(
        `❌ [POSITION_SYNC] Erro ao atualizar estatísticas do bot ${botId}:`,
        error.message
      );
    }
  }

  /**
   * Filtra fills que pertencem ao bot
   * @param {Array} fills - Fills da corretora
   * @param {string} botClientOrderId - ID do client do bot
   */
  filterBotFills(fills, botClientOrderId) {
    if (!botClientOrderId) return [];

    // 🚨 VALIDAÇÃO CRÍTICA: Verifica se fills é iterável
    if (
      !Array.isArray(fills) ||
      !fills[Symbol.iterator] ||
      typeof fills[Symbol.iterator] !== 'function'
    ) {
      Logger.error(
        `❌ [POSITION_SYNC] fills não é iterável em filterBotFills - type: ${typeof fills}, isArray: ${Array.isArray(fills)}`
      );
      return [];
    }

    const botFills = [];
    const botClientOrderIdStr = botClientOrderId.toString();

    for (const fill of fills) {
      const clientId = fill.clientId || fill.clientOrderId || fill.client_order_id;

      if (clientId && clientId.toString().startsWith(botClientOrderIdStr)) {
        botFills.push(fill);
      }
    }

    return botFills;
  }

  /**
   * Agrupa fills por símbolo
   * @param {Array} fills - Fills da corretora
   */
  groupFillsBySymbol(fills) {
    const grouped = {};

    // 🚨 VALIDAÇÃO CRÍTICA: Verifica se fills é iterável
    if (
      !Array.isArray(fills) ||
      !fills[Symbol.iterator] ||
      typeof fills[Symbol.iterator] !== 'function'
    ) {
      Logger.error(
        `❌ [POSITION_SYNC] fills não é iterável em groupFillsBySymbol - type: ${typeof fills}, isArray: ${Array.isArray(fills)}`
      );
      return {};
    }

    for (const fill of fills) {
      // 🚨 VALIDAÇÃO CRÍTICA: Verifica se fill é um objeto válido
      if (!fill || typeof fill !== 'object' || fill === null) {
        Logger.error(
          `❌ [POSITION_SYNC] fill é null ou inválido em groupFillsBySymbol - type: ${typeof fill}, value:`,
          fill
        );
        continue;
      }

      const symbol = fill.symbol;
      if (!grouped[symbol]) {
        grouped[symbol] = [];
      }
      grouped[symbol].push(fill);
    }

    return grouped;
  }

  /**
   * Para sincronização de todos os bots
   */
  stopAllSync() {
    // 🚨 VALIDAÇÃO CRÍTICA: Verifica se syncIntervals é iterável
    if (
      !this.syncIntervals ||
      !this.syncIntervals[Symbol.iterator] ||
      typeof this.syncIntervals[Symbol.iterator] !== 'function'
    ) {
      Logger.error(
        `❌ [POSITION_SYNC] syncIntervals não é iterável em stopAllSync - type: ${typeof this.syncIntervals}`
      );
      return;
    }

    for (const [botId, intervalId] of this.syncIntervals.entries()) {
      clearInterval(intervalId);
    }
    this.syncIntervals.clear();
    this.lastSyncTimes.clear();
    Logger.info(`🛑 [POSITION_SYNC] Todas as sincronizações paradas`);
  }

  /**
   * Retorna status das sincronizações
   */
  getSyncStatus() {
    const status = {};

    // 🚨 VALIDAÇÃO CRÍTICA: Verifica se syncIntervals é iterável
    if (
      !this.syncIntervals ||
      !this.syncIntervals[Symbol.iterator] ||
      typeof this.syncIntervals[Symbol.iterator] !== 'function'
    ) {
      Logger.error(
        `❌ [POSITION_SYNC] syncIntervals não é iterável em getSyncStatus - type: ${typeof this.syncIntervals}`
      );
      return {};
    }

    for (const [botId, intervalId] of this.syncIntervals.entries()) {
      status[botId] = {
        isActive: true,
        lastSync: this.lastSyncTimes.get(botId) || null,
      };
    }

    return status;
  }
}

export default PositionSyncService;
