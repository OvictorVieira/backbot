import ExchangeManager from '../Exchange/ExchangeManager.js';
import OrderController from '../Controllers/OrderController.js';
import { StopLossFactory } from '../Decision/Strategies/StopLossFactory.js';
import PnlController from '../Controllers/PnlController.js';
import Markets from '../Backpack/Public/Markets.js';
import AccountController from '../Controllers/AccountController.js';
import { validateLeverageForSymbol, clearLeverageAdjustLog } from '../Utils/Utils.js';
import ColorLogger from '../Utils/ColorLogger.js';
import Logger from '../Utils/Logger.js';
import ConfigManagerSQLite from '../Config/ConfigManagerSQLite.js';
import CachedOrdersService from '../Utils/CachedOrdersService.js';
import BackpackWebSocket from '../Backpack/Public/WebSocket.js';
import { ATR } from 'technicalindicators';
import DatabaseService from '../Services/DatabaseService.js';
import PositionUtils from '../Utils/PositionUtils.js';

class TrailingStop {
  // Cache estático para controlar symbols que devem ser skipados (posição fechada)
  static skippedSymbols = new Map();

  // Cache para evitar múltiplas tentativas simultâneas de fechamento
  static closingInProgress = new Map();

  // Cache para evitar múltiplas operações de stop loss simultâneas por símbolo
  static stopLossInProgress = new Map();

  // Cache para evitar verificações desnecessárias de stop loss (quando já existem)
  static stopLossVerified = new Map();

  // Cache para evitar loops infinitos ao detectar posições que devem ser fechadas por profit configurado
  // Armazena symbols que já foram identificados para fechamento nos últimos 30 segundos
  static profitClosureDetected = new Map();

  // Serviço de WebSocket reativo para atualizações de preço em tempo real
  static backpackWS = null;

  // Proteção contra execução simultânea no sistema reativo
  static reactiveProcessing = new Map(); // symbol -> processing flag

  // Cache para throttling de trailing stop updates (previne concorrência)
  static lastTrailingUpdate = new Map(); // symbol -> timestamp
  static TRAILING_UPDATE_THROTTLE = 10000; // 10 segundos entre updates

  // Cache para throttling de logs (evita spam)
  static lastTrailingLog = new Map(); // symbol -> timestamp
  static TRAILING_LOG_THROTTLE = 30000; // 30 segundos entre logs

  // Gerenciador de estado do trailing stop por bot (chave: botId)
  static trailingStateByBot = new Map(); // { botKey: { symbol: state } }
  static trailingModeLoggedByBot = new Map(); // Cache para logs de modo Trailing Stop por bot

  // Instância do ColorLogger para logs coloridos
  static colorLogger = new ColorLogger('TRAILING', 'STOP');

  // Database service instance
  static dbService = null;

  /**
   * Calcula ATR dinâmico baseado nos candles recentes
   * @param {string} symbol - Símbolo para buscar dados
   * @param {number} period - Período para ATR (padrão: 14)
   * @returns {Promise<number>} - Valor do ATR
   */
  static async calculateDynamicATR(symbol, period = 14) {
    try {
      // Busca candles recentes para calcular ATR (período + buffer extra)
      const markets = new Markets();
      const requiredCandles = Math.max(period + 10, 25); // Mínimo 25 candles para ATR confiável
      const candles = await markets.getKLines(symbol, '1h', requiredCandles);

      if (!candles || candles.length < period) {
        Logger.warn(
          `ATR ${symbol}: Dados insuficientes (${candles?.length || 0} < ${period}), usando padrão`
        );
        return null; // Retorna null para fallback
      }

      // Prepara dados para ATR
      const highs = candles.map(c => parseFloat(c.high));
      const lows = candles.map(c => parseFloat(c.low));
      const closes = candles.map(c => parseFloat(c.close));

      // Calcula ATR
      const atrResults = ATR.calculate({
        period: period,
        high: highs,
        low: lows,
        close: closes,
      });

      if (!atrResults || atrResults.length === 0) {
        Logger.warn(`ATR ${symbol}: Falha no cálculo`);
        return null;
      }

      // Pega o ATR mais recente
      const currentATR = atrResults[atrResults.length - 1];

      return currentATR;
    } catch (error) {
      Logger.error(`ATR ${symbol}: Erro no cálculo: ${error.message}`);
      return null;
    }
  }

  // Limpa entries do cache que são mais antigas que 24 horas
  static cleanupSkippedSymbolsCache() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 horas

    for (const [key, timestamp] of TrailingStop.skippedSymbols.entries()) {
      if (now - timestamp > maxAge) {
        TrailingStop.skippedSymbols.delete(key);
      }
    }
  }

  // Limpa entries do cache de fechamento em progresso mais antigas que 5 minutos
  static cleanupClosingInProgressCache() {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutos

    for (const [key, timestamp] of TrailingStop.closingInProgress.entries()) {
      if (now - timestamp > maxAge) {
        TrailingStop.closingInProgress.delete(key);
      }
    }
  }

  // Limpa entries do cache de stop loss em progresso mais antigas que 2 minutos
  static cleanupStopLossInProgressCache() {
    const now = Date.now();
    const maxAge = 2 * 60 * 1000; // 2 minutos

    for (const [key, timestamp] of TrailingStop.stopLossInProgress.entries()) {
      if (now - timestamp > maxAge) {
        TrailingStop.stopLossInProgress.delete(key);
      }
    }
  }

  // Limpa entries do cache de verificação mais antigas que 5 minutos
  static cleanupStopLossVerifiedCache() {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutos

    for (const [key, timestamp] of TrailingStop.stopLossVerified.entries()) {
      if (now - timestamp > maxAge) {
        TrailingStop.stopLossVerified.delete(key);
      }
    }
  }

  // Limpa entries do cache de profit closure detectado mais antigas que 30 segundos
  static cleanupProfitClosureDetectedCache() {
    const now = Date.now();
    const maxAge = 30 * 1000; // 30 segundos

    for (const [key, timestamp] of TrailingStop.profitClosureDetected.entries()) {
      if (now - timestamp > maxAge) {
        TrailingStop.profitClosureDetected.delete(key);
      }
    }
  }

  // Função protegida para fechamento de posição
  static async protectedForceClose(position, Account, config, reason = 'unknown') {
    const symbol = position.symbol;
    const now = Date.now();

    // Limpa cache periodicamente
    TrailingStop.cleanupClosingInProgressCache();

    // Verifica se já está sendo fechada
    if (TrailingStop.closingInProgress.has(symbol)) {
      const startTime = TrailingStop.closingInProgress.get(symbol);
      const elapsedMs = now - startTime;
      Logger.info(`${symbol}: Fechamento já em progresso há ${Math.round(elapsedMs / 1000)}s`);
      return { success: false, reason: 'already_closing' };
    }

    // Marca como fechamento em progresso
    TrailingStop.closingInProgress.set(symbol, now);

    try {
      await OrderController.forceClose(position, Account, config);
      Logger.info(`${symbol}: Fechamento concluído com sucesso`);
      return { success: true, reason: 'completed' };
    } catch (error) {
      Logger.error(`${symbol}: Erro no fechamento:`, error.message);
      return { success: false, reason: 'error', error: error.message };
    } finally {
      // Remove do cache após tentativa
      TrailingStop.closingInProgress.delete(symbol);
    }
  }

  // Função protegida para operações de stop loss
  static async protectedStopLossOperation(position, config, reason = 'unknown') {
    const symbol = position.symbol;
    const now = Date.now();

    // Limpa caches periodicamente
    TrailingStop.cleanupStopLossInProgressCache();
    TrailingStop.cleanupStopLossVerifiedCache();

    // Verifica se já foi verificado recentemente (cache de 5 minutos)
    if (TrailingStop.stopLossVerified.has(symbol)) {
      const lastVerified = TrailingStop.stopLossVerified.get(symbol);
      const elapsedMs = now - lastVerified;
      if (elapsedMs < 5 * 60 * 1000) {
        // 5 minutos
        Logger.debug(
          `⚡ [STOP_LOSS_CACHE] ${symbol}: Verificação em cache há ${Math.round(elapsedMs / 1000)}s - pulando verificação (${reason})`
        );
        return { success: true, reason: 'cached' };
      }
    }

    // Verifica se já está criando stop loss para este símbolo
    if (TrailingStop.stopLossInProgress.has(symbol)) {
      const startTime = TrailingStop.stopLossInProgress.get(symbol);
      const elapsedMs = now - startTime;
      Logger.info(
        `${symbol}: Criação de stop loss já em progresso há ${Math.round(elapsedMs / 1000)}s`
      );
      return { success: false, reason: 'already_creating' };
    }

    // Marca como criação de stop loss em progresso
    TrailingStop.stopLossInProgress.set(symbol, now);

    try {
      const result = OrderController.validateAndCreateStopLoss(position, config.botName, config);
      // Marca como verificado no cache
      TrailingStop.stopLossVerified.set(symbol, now);

      return { success: true, reason: 'completed', result };
    } catch (error) {
      Logger.error(`${symbol}: Erro na criação de stop loss:`, error.message);
      return { success: false, reason: 'error', error: error.message };
    } finally {
      // Remove do cache após tentativa
      TrailingStop.stopLossInProgress.delete(symbol);
    }
  }

  constructor(strategyType = null, config = null, ordersService = null) {
    const finalStrategyType = strategyType || 'DEFAULT';
    this.strategyType = finalStrategyType;
    this.config = config; // Armazena a configuração do bot
    this.ordersService = ordersService; // Injeção de dependência para gerenciar ordens
    this.stopLossStrategy = null; // Será inicializado de forma assíncrona
    this.lastVolumeCheck = 0;
    this.cachedVolume = null;
    this.volumeCacheTimeout = 24 * 60 * 60 * 1000; // 24 horas em ms

    // Loga a configuração do trailing stop
    TrailingStop.logTrailingStopConfig(config);
  }

  async initializeStopLoss() {
    if (!this.stopLossStrategy) {
      this.stopLossStrategy = await StopLossFactory.createStopLoss(this.strategyType, this.config);
    }
    return this.stopLossStrategy;
  }

  /**
   * Inicializa o sistema reativo de WebSocket para trailing stop
   */
  static async initializeReactiveSystem() {
    if (TrailingStop.backpackWS && TrailingStop.backpackWS.isConnected) {
      Logger.debug('🔌 [REACTIVE_SYSTEM] WebSocket já conectado, reutilizando conexão');
      return;
    }

    try {
      Logger.info('🚀 [REACTIVE_SYSTEM] Inicializando sistema reativo WebSocket...');
      TrailingStop.backpackWS = new BackpackWebSocket();

      // Configurar throttling padrão (3 segundos para evitar rate limit)
      TrailingStop.backpackWS.setUpdateThrottle(3000);

      await TrailingStop.backpackWS.connect();
      Logger.info('✅ [REACTIVE_SYSTEM] Sistema reativo WebSocket inicializado com sucesso');
    } catch (error) {
      Logger.error('❌ [REACTIVE_SYSTEM] Falha ao inicializar sistema reativo:', error.message);
      TrailingStop.backpackWS = null;
    }
  }

  /**
   * Para o sistema reativo de WebSocket
   */
  static stopReactiveSystem() {
    if (TrailingStop.backpackWS) {
      TrailingStop.backpackWS.disconnect();
      TrailingStop.backpackWS = null;
    }
  }

  /**
   * Subscribe a uma posição para monitoramento reativo
   */
  static async subscribePositionReactive(position, Account, config, trailingStopInstance) {
    if (!TrailingStop.backpackWS || !TrailingStop.backpackWS.connected) {
      return false;
    }

    const symbol = position.symbol;

    const priceUpdateCallback = async (symbol, currentPrice, rawData) => {
      try {
        if (TrailingStop.reactiveProcessing.get(symbol)) {
          return;
        }

        TrailingStop.reactiveProcessing.set(symbol, true);

        const updatedPosition = {
          ...position,
          markPrice: currentPrice.toString(),
          lastPrice: currentPrice.toString(),
        };

        // 🚨 NOVA FUNCIONALIDADE: Verifica se deve fechar por SL/TP via WebSocket
        const shouldClosePosition = await TrailingStop.checkPositionThresholds(
          updatedPosition,
          Account,
          config
        );

        if (shouldClosePosition.shouldClose) {
          Logger.info(
            `🔥 [WS_AUTO_CLOSE] ${symbol}: Fechamento automático acionado via WebSocket - Razão: ${shouldClosePosition.reason}, PnL: ${shouldClosePosition.pnlPct?.toFixed(2)}%`
          );

          // Fecha a posição imediatamente a mercado
          const closeResult = await TrailingStop.protectedForceClose(
            updatedPosition,
            Account,
            config
          );

          if (closeResult.success) {
            Logger.info(
              `✅ [WS_AUTO_CLOSE] ${symbol}: Posição fechada com sucesso via WebSocket`
            );
            // Unsubscribe após fechamento bem-sucedido
            await TrailingStop.unsubscribePositionReactive(symbol);
          } else {
            Logger.warn(
              `⚠️ [WS_AUTO_CLOSE] ${symbol}: Falha ao fechar posição - ${closeResult.reason}`
            );
          }

          return; // Não atualiza trailing stop se posição foi fechada
        }

        // Se não fechou, atualiza trailing stop normalmente
        await trailingStopInstance.updateTrailingStopForPosition(updatedPosition);
      } catch (error) {
        Logger.error(`❌ [WS_REACTIVE] Sistema reativo ${symbol}: Erro:`, error.message);
      } finally {
        TrailingStop.reactiveProcessing.set(symbol, false);
      }
    };

    try {
      await TrailingStop.backpackWS.subscribeSymbol(symbol, priceUpdateCallback);
      return true;
    } catch (error) {
      Logger.error(`❌ [WS_SUBSCRIBE] Falha ao subscribe ${symbol}:`, error.message);
      return false;
    }
  }

  /**
   * Unsubscribe de uma posição do monitoramento reativo
   */
  static async unsubscribePositionReactive(symbol) {
    if (TrailingStop.backpackWS && TrailingStop.backpackWS.connected) {
      try {
        await TrailingStop.backpackWS.unsubscribeSymbol(symbol);
        TrailingStop.reactiveProcessing.delete(symbol);
      } catch (error) {
        Logger.error(`Falha ao unsubscribe ${symbol}:`, error.message);
      }
    }
  }

  /**
   * Verifica se a posição atingiu thresholds de SL/TP configurados
   * e deve ser fechada automaticamente via WebSocket
   *
   * @param {object} position - Posição com preço atualizado via WebSocket
   * @param {object} Account - Dados da conta (leverage, etc)
   * @param {object} config - Configuração do bot (maxNegativePnlStopPct, minProfitPercentage)
   * @returns {Promise<object>} { shouldClose: boolean, reason: string, pnlPct: number }
   */
  static async checkPositionThresholds(position, Account, config) {
    try {
      const symbol = position.symbol;

      // Valida dados obrigatórios
      if (!Account || !Account.leverage) {
        Logger.error(
          `❌ [WS_THRESHOLD] ${symbol}: Dados da conta inválidos - leverage ausente`
        );
        return { shouldClose: false, reason: 'invalid_account_data' };
      }

      // Calcula PnL atual
      const { pnl, pnlPct } = TrailingStop.calculatePnL(position, Account);

      if (isNaN(pnlPct) || !isFinite(pnlPct)) {
        Logger.error(`❌ [WS_THRESHOLD] ${symbol}: PnL inválido - ${pnlPct}`);
        return { shouldClose: false, reason: 'invalid_pnl' };
      }

      // 1️⃣ VERIFICA STOP LOSS (maxNegativePnlStopPct)
      const maxNegativePnlStopPct = parseFloat(config?.maxNegativePnlStopPct || -10);

      if (
        maxNegativePnlStopPct !== undefined &&
        maxNegativePnlStopPct !== null &&
        !isNaN(maxNegativePnlStopPct)
      ) {
        if (pnlPct <= maxNegativePnlStopPct) {
          Logger.warn(
            `🚨 [WS_THRESHOLD] ${symbol}: STOP LOSS atingido via WebSocket - PnL: ${pnlPct.toFixed(3)}% <= Limite: ${maxNegativePnlStopPct.toFixed(3)}%`
          );
          return {
            shouldClose: true,
            reason: `STOP_LOSS (${pnlPct.toFixed(2)}% <= ${maxNegativePnlStopPct.toFixed(2)}%)`,
            pnlPct: pnlPct,
            pnl: pnl,
          };
        }
      }

      // 2️⃣ VERIFICA TAKE PROFIT (minProfitPercentage)
      const minProfitPercentage = parseFloat(config?.minProfitPercentage || 0.5);

      if (
        minProfitPercentage !== undefined &&
        minProfitPercentage !== null &&
        !isNaN(minProfitPercentage)
      ) {
        // Calcula taxas estimadas
        const notional = parseFloat(position.netExposureNotional || position.notional || 0);

        // Usa taxas padrão se não disponível (maker + taker)
        const makerFee = 0.0002; // 0.02%
        const takerFee = 0.0005; // 0.05%
        const totalFeeRate = makerFee + takerFee;
        const totalFees = notional * totalFeeRate;

        // PnL líquido após taxas
        const netProfit = pnl - totalFees;
        const netProfitPct = notional > 0 ? (netProfit / notional) * 100 : 0;

        if (netProfitPct >= minProfitPercentage) {
          Logger.info(
            `💰 [WS_THRESHOLD] ${symbol}: TAKE PROFIT atingido via WebSocket - PnL Líquido: ${netProfitPct.toFixed(3)}% >= Mínimo: ${minProfitPercentage.toFixed(3)}%`
          );
          return {
            shouldClose: true,
            reason: `TAKE_PROFIT (${netProfitPct.toFixed(2)}% >= ${minProfitPercentage.toFixed(2)}%)`,
            pnlPct: netProfitPct,
            pnl: netProfit,
          };
        }
      }

      // Nenhum threshold atingido
      return { shouldClose: false, reason: 'thresholds_not_reached', pnlPct: pnlPct };
    } catch (error) {
      Logger.error(
        `❌ [WS_THRESHOLD] Erro ao verificar thresholds para ${position.symbol}:`,
        error.message
      );
      return { shouldClose: false, reason: 'error', error: error.message };
    }
  }

  /**
   * Obtém a chave única do bot
   */
  getBotKey() {
    if (!this.config) {
      throw new Error('Configuração do bot é obrigatória - deve ser passada no construtor');
    }
    const botId = String(this.config.id); // 🔧 FIX: Converte botId para string
    if (!botId) {
      throw new Error('ID do bot é obrigatório - deve ser passado da config do bot');
    }
    return `bot_${botId}`;
  }

  /**
   * Obtém o estado do trailing stop para este bot
   */
  getTrailingState() {
    const botKey = this.getBotKey();
    if (!TrailingStop.trailingStateByBot.has(botKey)) {
      TrailingStop.trailingStateByBot.set(botKey, new Map());
    }
    return TrailingStop.trailingStateByBot.get(botKey);
  }

  /**
   * Obtém o cache de logs para este bot
   */
  getTrailingModeLogged() {
    const botKey = this.getBotKey();
    if (!TrailingStop.trailingModeLoggedByBot.has(botKey)) {
      TrailingStop.trailingModeLoggedByBot.set(botKey, new Set());
    }
    return TrailingStop.trailingModeLoggedByBot.get(botKey);
  }

  /**
   * Carrega o estado do trailing stop da base de dados durante a inicialização
   */
  static async initializeFromDB(dbService) {
    try {
      if (!dbService || !dbService.isInitialized()) {
        throw new Error('Database service must be initialized before loading state');
      }

      TrailingStop.dbService = dbService;

      // Load all trailing states from database
      const results = await dbService.getAll('SELECT botId, symbol, state FROM trailing_state');

      // Clear existing state
      TrailingStop.trailingStateByBot.clear();

      let totalStates = 0;

      for (const row of results) {
        try {
          const state = JSON.parse(row.state);
          const symbol = row.symbol;
          const botId = row.botId;

          // Use actual botId instead of default key
          const botKey = `bot_${botId}`;
          if (!TrailingStop.trailingStateByBot.has(botKey)) {
            TrailingStop.trailingStateByBot.set(botKey, new Map());
          }

          const trailingStateMap = TrailingStop.trailingStateByBot.get(botKey);
          trailingStateMap.set(symbol, state);
          totalStates++;
        } catch (error) {
          Logger.error(`Erro ao processar estado para ${row.symbol}:`, error.message);
        }
      }

      Logger.info(`Estado carregado: ${totalStates} posições`);
    } catch (error) {
      Logger.error(`Erro ao carregar estado:`, error.message);
      Logger.info(`Iniciando com estado vazio devido ao erro`);
      TrailingStop.trailingStateByBot.clear();
    }
  }

  /**
   * 🎯 FONTE ÚNICA DE DADOS: Método centralizado para acessar estado do trailing stop
   * Prioridade: Cache (memória) -> Database -> null
   * Garante sincronização entre memória e banco de dados
   * @param {string} botId - O ID do bot para o qual carregar o estado.
   * @param {string} symbol - O símbolo do mercado (ex: "SOL_USDC") para o qual carregar o estado.
   * @returns {Promise<object|null>} O objeto de estado carregado ou null se não for encontrado.
   */
  static async getState(botId, symbol) {
    try {
      // Validate parameters
      if (!symbol) {
        Logger.error(
          `❌ [VALIDATION] getState called with undefined symbol for botId: ${botId} (type: ${typeof botId})`
        );
        return null;
      }

      if (!botId || typeof botId !== 'string') {
        Logger.error(
          `❌ [VALIDATION] getState called with invalid botId: ${botId} (type: ${typeof botId}), symbol: ${symbol}`
        );
        Logger.error(`❌ [STACK_TRACE] Call stack:`, new Error().stack);
        return null;
      }
      const botKey = `bot_${botId}`;

      // 1. PRIMEIRO: Tenta buscar do cache (memória)
      const inMemoryState = TrailingStop.trailingStateByBot.get(botKey)?.get(symbol);
      if (inMemoryState) {
        return inMemoryState;
      }

      // 2. FALLBACK: Se não tem na memória, busca do banco
      const dbState = await TrailingStop.loadStateFromDB(botId, symbol);

      // 3. SINCRONIZAÇÃO: Se encontrou no banco, atualiza a memória
      if (dbState) {
        TrailingStop.setStateInMemory(botId, symbol, dbState);
        return dbState;
      }
      return null;
    } catch (error) {
      Logger.error(`Erro ao buscar estado para ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * 🎯 FONTE ÚNICA DE DADOS: Método centralizado para salvar estado do trailing stop
   * Salva SIMULTANEAMENTE no banco E na memória para garantir sincronização
   * @param {string} botId - O ID do bot
   * @param {string} symbol - O símbolo do mercado
   * @param {object} state - O estado completo para salvar
   * @returns {Promise<boolean>} True se salvou com sucesso
   */
  static async setState(botId, symbol, state) {
    try {
      // 1. SALVA NO BANCO primeiro (fonte da verdade)
      const dbSaved = await TrailingStop.saveStateToDBSynchronized(botId, symbol, state);

      if (dbSaved) {
        // 2. ATUALIZA A MEMÓRIA apenas se o banco foi salvo com sucesso
        TrailingStop.setStateInMemory(botId, symbol, state);
        return true;
      } else {
        Logger.error(`${symbol}: Falha ao salvar no banco`);
        return false;
      }
    } catch (error) {
      Logger.error(`Erro ao salvar estado para ${symbol}:`, error.message);
      return false;
    }
  }

  /**
   * Define estado apenas na memória (método auxiliar)
   * @param {string} botId - O ID do bot
   * @param {string} symbol - O símbolo
   * @param {object} state - O estado para definir
   */
  static setStateInMemory(botId, symbol, state) {
    const botKey = `bot_${botId}`;

    if (!TrailingStop.trailingStateByBot.has(botKey)) {
      TrailingStop.trailingStateByBot.set(botKey, new Map());
    }

    TrailingStop.trailingStateByBot.get(botKey).set(symbol, state);
  }

  /**
   * Carrega estado apenas do banco de dados (método auxiliar)
   * @param {string} botId - O ID do bot
   * @param {string} symbol - O símbolo
   * @returns {Promise<object|null>} Estado do banco ou null
   */
  static async loadStateFromDB(botId, symbol) {
    try {
      // Validate parameters
      if (!symbol) {
        Logger.error(
          `❌ [VALIDATION] loadStateFromDB called with undefined symbol for botId: ${botId} (type: ${typeof botId})`
        );
        return null;
      }

      if (!botId || typeof botId !== 'string') {
        Logger.error(
          `❌ [VALIDATION] loadStateFromDB called with invalid botId: ${botId} (type: ${typeof botId}), symbol: ${symbol}`
        );
        Logger.error(`❌ [STACK_TRACE] Call stack:`, new Error().stack);
        return null;
      }
      if (!TrailingStop.dbService || !TrailingStop.dbService.isInitialized()) {
        Logger.warn(`❌ [DB_SAVE] Serviço de banco não inicializado para ${symbol}`);
        TrailingStop.dbService = new DatabaseService();
        await TrailingStop.dbService.init();
      }

      // 1. Prepara a query SQL parametrizada para segurança e eficiência
      const query =
        'SELECT state, active_stop_order_id FROM trailing_state WHERE botId = ? AND symbol = ?';

      // 2. Executa a busca por um único registro
      const row = await TrailingStop.dbService.get(query, [botId, symbol]);

      // 3. Se um registro for encontrado, processa-o
      if (row && row.state) {
        const state = JSON.parse(row.state);
        state.activeStopOrderId = row.active_stop_order_id || null;

        Logger.debug(
          `📂 [DB_LOAD] Estado do trailing stop carregado para bot ${botId} - ${symbol}`
        );

        return state;
      } else {
        return null;
      }
    } catch (error) {
      Logger.error(
        `❌ [PERSISTENCE] Erro ao carregar estado para botId: ${botId}, symbol: ${symbol}:`,
        error.message
      );
      return null; // Retorna null em caso de erro
    }
  }

  /**
   * 🎯 FONTE ÚNICA DE DADOS: Salva estado no banco com controle de integridade
   * Método sincronizado que garante atomicidade da operação
   * @param {string} botId - O ID do bot
   * @param {string} symbol - O símbolo do mercado
   * @param {object} state - O estado completo para salvar
   * @returns {Promise<boolean>} True se salvou com sucesso
   */
  static async saveStateToDBSynchronized(botId, symbol, state) {
    try {
      if (!TrailingStop.dbService || !TrailingStop.dbService.isInitialized()) {
        Logger.warn(`❌ [DB_SAVE] Serviço de banco não inicializado para ${symbol}`);
        TrailingStop.dbService = new DatabaseService();
        await TrailingStop.dbService.init();
      }

      // Verifica se o bot tem trailing stop habilitado
      const botConfig = await ConfigManagerSQLite.getBotConfigById(parseInt(botId));
      if (!botConfig || !botConfig.enableTrailingStop) {
        Logger.warn(`⚠️ [DB_SAVE] Trailing Stop desabilitado para bot ${botId}, símbolo ${symbol}`);
        return false;
      }

      // Salva no banco com o activeStopOrderId se presente
      await TrailingStop.dbService.run(
        'INSERT OR REPLACE INTO trailing_state (botId, symbol, state, active_stop_order_id, updatedAt) VALUES (?, ?, ?, ?, ?)',
        [
          botId,
          symbol,
          JSON.stringify(state),
          state.activeStopOrderId || null,
          new Date().toISOString(),
        ]
      );

      return true;
    } catch (error) {
      Logger.error(`Erro ao salvar estado para ${symbol}:`, error.message);
      return false;
    }
  }

  static async createTrailingStopOrder(position, state, botId, config) {
    // Validate position has symbol
    if (!position || !position.symbol) {
      Logger.error(
        `❌ [VALIDATION] createTrailingStopOrder called with invalid position:`,
        position
      );
      return;
    }

    const symbol = position.symbol;

    try {
      if (!TrailingStop.dbService || !TrailingStop.dbService.isInitialized()) {
        Logger.warn(`❌ [DB_SAVE] Serviço de banco não inicializado para ${symbol}`);
        TrailingStop.dbService = new DatabaseService();
        await TrailingStop.dbService.init();
      }

      let externalOrderId = null;

      let foundState = null;

      // Busca tanto stop loss quanto take profit orders para trailing stop
      let stopLossOrder = await PositionUtils.getStopLossOrders(symbol, position, config);

      if (stopLossOrder && stopLossOrder.length > 0) {
        stopLossOrder = stopLossOrder[0];

        externalOrderId = stopLossOrder.id;

        // 🎯 FONTE ÚNICA DE DADOS: Usa método centralizado
        foundState = await TrailingStop.getState(botId, symbol);

        // Valida se tem as propriedades essenciais
        if (!foundState || (foundState.isLong === undefined && foundState.isShort === undefined)) {
          Logger.warn(
            `⚠️ [STATE_ERROR] ${symbol}: Estado inválido ou sem direção (isLong/isShort), abortando trailing stop`
          );
          return;
        }

        // Debug: mostrar estado obtido
        Logger.info(
          `🔍 [STATE_LOADED] ${symbol}: TrailingPrice=${foundState.trailingStopPrice}, isLong=${foundState.isLong}, isShort=${foundState.isShort}`
        );

        // Se houve atualização do activeStopOrderId, salva de volta
        if (foundState.activeStopOrderId !== externalOrderId) {
          foundState.activeStopOrderId = externalOrderId;
          Logger.info(
            `🔄 [ORDER_ID_UPDATE] ${symbol}: Atualizando activeStopOrderId para ${externalOrderId}`
          );
        }

        let trailingStopIsBetterThanSL = false;

        // Determina o preço atual da ordem (stop loss, take profit ou price)
        const currentOrderPrice = parseFloat(stopLossOrder.triggerPrice || stopLossOrder.price);

        if (foundState?.isLong) {
          trailingStopIsBetterThanSL = foundState.trailingStopPrice > currentOrderPrice;
        } else if (foundState && !foundState.isLong) {
          trailingStopIsBetterThanSL = foundState.trailingStopPrice < currentOrderPrice;
        }

        if (trailingStopIsBetterThanSL) {
          // 2. Compara o preço do trailing calculado com o preço da ordem ATUAL na corretora
          //    Só atualiza se o trailing stop melhorou E a diferença é significativa (mín. 0.1%)
          const priceDifference = Math.abs(foundState.trailingStopPrice - currentOrderPrice);
          const percentageChange = (priceDifference / currentOrderPrice) * 100;
          const priceChangedSignificantly = percentageChange >= 0.1; // Mínimo 0.1% de mudança

          if (trailingStopIsBetterThanSL && priceChangedSignificantly) {
            // 🚨 THROTTLING: Previne atualizações muito frequentes para evitar concorrência
            const now = Date.now();
            const lastUpdate = TrailingStop.lastTrailingUpdate.get(symbol) || 0;
            const timeSinceLastUpdate = now - lastUpdate;

            if (timeSinceLastUpdate < TrailingStop.TRAILING_UPDATE_THROTTLE) {
              const timeLeft = Math.ceil(
                (TrailingStop.TRAILING_UPDATE_THROTTLE - timeSinceLastUpdate) / 1000
              );
              Logger.debug(
                `⏱️ [TRAILING_THROTTLE] ${symbol}: Update muito recente, aguardando ${timeLeft}s antes de atualizar trailing stop`
              );
              return; // Bloqueia update para prevenir concorrência
            }

            // Registra timestamp do update atual
            TrailingStop.lastTrailingUpdate.set(symbol, now);

            Logger.info(
              `${symbol}: Trailing stop ${currentOrderPrice} -> ${foundState.trailingStopPrice} (${percentageChange.toFixed(3)}%)`
            );
          } else if (trailingStopIsBetterThanSL && !priceChangedSignificantly) {
            Logger.debug(
              `⏭️ [TRAILING_SKIP] ${symbol}: Trailing stop melhorou mas mudança insignificante (${priceDifference.toFixed(8)} = ${percentageChange.toFixed(3)}% < 0.1%), mantendo ordem atual`
            );
            return;
          }

          if (trailingStopIsBetterThanSL && priceChangedSignificantly) {
            const apiKey = config.apiKey;
            const apiSecret = config.apiSecret;

            const Account = await AccountController.get({
              apiKey,
              apiSecret,
              strategy: config?.strategyName || 'DEFAULT',
              symbol,
            });

            // 🚫 VERIFICAÇÃO: Durante manutenção, dados de conta não estão disponíveis
            if (!Account) {
              const DepressurizationManager = await import('../Utils/DepressurizationManager.js');
              if (DepressurizationManager.default.isSystemInMaintenance()) {
                Logger.debug(
                  `🚫 [TRAILING_SKIP] ${symbol}: Stop loss pausado durante manutenção - dados de conta indisponíveis`
                );
              } else {
                Logger.error(`❌ [TRAILING_STOP] ${symbol}: Dados da conta não disponíveis`);
              }
              return;
            }

            const marketInfo = Account.markets.find(m => m.symbol === symbol);
            if (!marketInfo) {
              Logger.error(`❌ [TRAILING_STOP] Market info não encontrada para ${symbol}`);
              return;
            }

            const decimal_price = marketInfo.decimal_price;

            const formatPrice = value => parseFloat(value).toFixed(decimal_price).toString();

            // Determina se a ordem atual é stop loss, take profit ou price
            const isStopLossOrder = stopLossOrder.triggerPrice !== null;
            const isTakeProfitOrder = stopLossOrder.takeProfitTriggerPrice !== null;
            const isPriceOrder =
              stopLossOrder.price !== null && !isStopLossOrder && !isTakeProfitOrder;

            const bodyPayload = {
              symbol: symbol,
              side: foundState.isLong ? 'Ask' : 'Bid',
              orderType: 'Limit',
              quantity: stopLossOrder.triggerQuantity,
              clientId: await OrderController.generateUniqueOrderId(config),
              apiKey: apiKey,
              apiSecret: apiSecret,
            };

            // Define o tipo de trigger baseado na ordem existente
            if (isStopLossOrder) {
              bodyPayload.stopLossTriggerPrice = formatPrice(foundState.trailingStopPrice);
            } else if (isTakeProfitOrder) {
              bodyPayload.takeProfitTriggerPrice = formatPrice(foundState.trailingStopPrice);
            } else if (isPriceOrder) {
              bodyPayload.price = formatPrice(foundState.trailingStopPrice);
            }

            // 🚨 CORREÇÃO: CANCELA ordem antiga PRIMEIRO para evitar "Maximum stop orders per position reached"
            const orderType = isStopLossOrder
              ? 'stop loss'
              : isTakeProfitOrder
                ? 'take profit'
                : 'limit';

            // 3. Cancela a ordem ANTIGA primeiro (se existir)
            if (foundState && foundState.activeStopOrderId) {
              try {
                const cancelOrderPayload = {
                  symbol: symbol,
                  orderId: foundState.activeStopOrderId,
                  apiKey: apiKey,
                  apiSecret: apiSecret,
                };
                await OrderController.ordersService.cancelOrder(cancelOrderPayload);

                // Pequena pausa para garantir que o cancelamento foi processado
                await new Promise(resolve => setTimeout(resolve, 500));
              } catch (cancelError) {
                Logger.warn(`${symbol}: Erro ao cancelar ordem antiga: ${cancelError.message}`);
              }
            }

            // 4. Agora cria a NOVA ordem (stop loss, take profit ou limit) com o preço atualizado
            let stopResult;
            if (isStopLossOrder) {
              stopResult = await OrderController.ordersService.createStopLossOrder(bodyPayload);
            } else if (isTakeProfitOrder) {
              stopResult = await OrderController.ordersService.createTakeProfitOrder(bodyPayload);
            }

            // 5. Se a nova ordem foi criada com sucesso
            if (stopResult && stopResult.id) {
              Logger.info(`${symbol}: Nova ordem ${orderType} criada (${stopResult.id})`);

              externalOrderId = stopResult.id;
              foundState.activeStopOrderId = stopResult.id;

              await TrailingStop.setState(config?.id, symbol, foundState);
            } else {
              Logger.error(
                `${symbol}: Falha ao criar nova ordem ${orderType}: ${stopResult?.error || 'Desconhecido'}`
              );
            }
          }

          Logger.info(`Stop loss ativo encontrado para ${symbol}. Order ID: ${externalOrderId}`);
        } else {
          // Cache para evitar logs repetidos do mesmo símbolo
          const logCacheKey = `${symbol}_not_better`;
          const now = Date.now();
          const lastLogTime = TrailingStop.logCache?.get(logCacheKey) || 0;

          // Log apenas a cada 30 segundos para evitar spam
          if (now - lastLogTime > 30000) {
            if (!TrailingStop.logCache) {
              TrailingStop.logCache = new Map();
            }
            TrailingStop.logCache.set(logCacheKey, now);
          }
        }
      } else {
        Logger.warn(
          `Nenhuma ordem de stop loss ativa (TriggerPending) foi encontrada para ${symbol}.`
        );
      }
    } catch (error) {
      Logger.error(
        `❌ [PERSISTENCE] Erro ao salvar estado do trailing stop para ${symbol}:`,
        error.message
      );
    }
  }

  /**
   * Limpa o estado do trailing stop da base de dados
   */
  static async clearStateFromDB(symbol) {
    try {
      if (!TrailingStop.dbService || !TrailingStop.dbService.isInitialized()) {
        Logger.warn(`❌ [DB_SAVE] Serviço de banco não inicializado para ${symbol}`);
        TrailingStop.dbService = new DatabaseService();
        await TrailingStop.dbService.init();
      }

      await TrailingStop.dbService.run('DELETE FROM trailing_state WHERE symbol = ?', [symbol]);

      TrailingStop.debug(`🗑️ [PERSISTENCE] Estado do trailing stop removido para ${symbol}`);
    } catch (error) {
      Logger.error(
        `❌ [PERSISTENCE] Erro ao limpar estado do trailing stop para ${symbol}:`,
        error.message
      );
    }
  }

  /**
   * Limpa estados obsoletos que não correspondem a posições abertas atuais.
   */
  static async cleanupObsoleteStates(config = null) {
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      const exchangeManager = ExchangeManager.createFromConfig({ apiKey, apiSecret });
      const positions = await exchangeManager.getFuturesPositions(apiKey, apiSecret);

      // 🔧 CORREÇÃO: Filtra apenas posições realmente abertas (netQuantity > 0)
      const activePositions = positions
        ? positions.filter(p => Math.abs(parseFloat(p.netQuantity || 0)) > 0)
        : [];
      const openSymbols = activePositions.map(p => p.symbol);

      let cleanedStates = 0;
      const statesToRemove = [];

      // Itera sobre todos os bots
      for (const [botKey, trailingStateMap] of TrailingStop.trailingStateByBot.entries()) {
        for (const [symbol, state] of trailingStateMap.entries()) {
          if (!openSymbols.includes(symbol)) {
            statesToRemove.push({ botKey, symbol });
            Logger.debug(
              `🗑️ [CLEANUP] ${botKey} - ${symbol}: Estado removido - posição não está mais aberta`
            );
          }
        }
      }

      for (const { botKey, symbol } of statesToRemove) {
        const trailingStateMap = TrailingStop.trailingStateByBot.get(botKey);
        if (trailingStateMap) {
          trailingStateMap.delete(symbol);
          cleanedStates++;
        }
      }

      if (cleanedStates > 0) {
        Logger.debug(
          `💾 [CLEANUP] Salvando estado limpo com ${cleanedStates} estados removidos...`
        );
        // Save all remaining states to database
        for (const [botKey, trailingStateMap] of TrailingStop.trailingStateByBot.entries()) {
          const botId = parseInt(botKey.replace('bot_', '')) || 1;
          for (const [symbol, state] of trailingStateMap.entries()) {
            await TrailingStop.setState(botId, symbol, state);
          }
        }
        Logger.info(`Limpeza concluída: ${cleanedStates} estados removidos`);
      } else {
      }
    } catch (error) {
      Logger.error(`Erro durante limpeza:`, error.message);
    }
  }

  static async createTakeProfitForPosition(position, Account, config) {
    const entryPrice = parseFloat(position.entryPrice || position.markPrice || 0);
    const currentPrice = parseFloat(position.markPrice || 0);

    const netQuantity = parseFloat(position.netQuantity);
    const isLong = netQuantity > 0;
    const isShort = netQuantity < 0;

    const { pnl, pnlPct } = TrailingStop.calculatePnL(position, Account);
    const shouldActivate = pnl > 0;

    // Verifica se deve usar estratégia híbrida ATR
    const enableHybridStrategy = config?.enableHybridStopStrategy || false;
    let initialState;

    if (enableHybridStrategy) {
      // Recupera ou calcula ATR para estratégia híbrida
      const atrValue = await TrailingStop.getAtrValue(position.symbol);
      const initialStopAtrMultiplier = Number(config?.initialStopAtrMultiplier || 2.0);
      const takeProfitAtrMultiplier = Number(config?.partialTakeProfitAtrMultiplier || 1.5);

      const initialAtrStopPrice = TrailingStop.calculateAtrStopLossPrice(
        position,
        Account,
        atrValue,
        initialStopAtrMultiplier
      );
      const partialTakeProfitPrice = TrailingStop.calculateAtrTakeProfitPrice(
        position,
        atrValue,
        takeProfitAtrMultiplier
      );

      Logger.info(
        `${position.symbol}: Stop Loss ATR configurado - Stop: $${initialAtrStopPrice.toFixed(4)}, TP Parcial: $${partialTakeProfitPrice.toFixed(4)}`
      );

      initialState = {
        symbol: position.symbol,
        entryPrice: entryPrice,
        isLong: isLong,
        isShort: isShort,
        initialStopLossPrice: initialAtrStopPrice,
        trailingStopPrice: initialAtrStopPrice,
        initialAtrStopPrice: initialAtrStopPrice,
        partialTakeProfitPrice: partialTakeProfitPrice,
        atrValue: atrValue,
        atrMultiplier: initialStopAtrMultiplier,
        takeProfitAtrMultiplier: takeProfitAtrMultiplier,
        strategyType: 'HYBRID_ATR',
        phase: 'INITIAL_RISK',
        highestPrice: isLong ? currentPrice : null,
        lowestPrice: isShort ? currentPrice : null,
        activated: shouldActivate,
        initialized: shouldActivate,
        createdAt: new Date().toISOString(),
      };
    } else {
      const initialStopLossPrice = TrailingStop.calculateInitialStopLossPrice(position, Account);

      initialState = {
        symbol: position.symbol,
        entryPrice: entryPrice,
        isLong: isLong,
        isShort: isShort,
        initialStopLossPrice: initialStopLossPrice,
        highestPrice: isLong ? currentPrice : null,
        lowestPrice: isShort ? currentPrice : null,
        trailingStopPrice: initialStopLossPrice,
        strategyType: 'DEFAULT',
        activated: shouldActivate,
        initialized: shouldActivate,
        createdAt: new Date().toISOString(),
        takeProfitPrice: null,
      };
    }

    if (shouldActivate) {
      Logger.info(
        `${position.symbol}: Trailing Stop ATIVADO - PnL: ${pnlPct.toFixed(2)}%, ${isLong ? 'LONG' : 'SHORT'}`
      );
    } else {
      Logger.info(
        `✅ [TRAILING STOP] ${position.symbol}: Estado criado (aguardando lucro) - PnL: ${pnlPct.toFixed(2)}%, Entry: $${entryPrice.toFixed(4)}, Atual: $${currentPrice.toFixed(4)}, Stop Inicial: $${initialState.initialStopLossPrice?.toFixed(4) || 'N/A'}, Tipo: ${isLong ? 'LONG' : 'SHORT'}`
      );
    }

    return initialState;
  }

  /**
   * Recupera estado ATR para posições existentes
   * @param {string} symbol - Símbolo do mercado
   * @param {object} position - Dados da posição
   * @param {object} account - Dados da conta
   * @returns {object|null} - Estado ATR recuperado ou null
   */
  static async recoverAtrState(symbol, position, account, config) {
    try {
      // Procura o estado em todos os bots
      for (const [botKey, trailingStateMap] of TrailingStop.trailingStateByBot.entries()) {
        const existingState = trailingStateMap.get(symbol);

        if (existingState && existingState.strategyType === 'HYBRID_ATR') {
          Logger.info(
            `🔄 [ATR_RECOVERY] ${botKey} - ${symbol}: Recuperando estado ATR existente - ATR: ${existingState.atrValue?.toFixed(6) || 'N/A'}, Stop: $${existingState.initialAtrStopPrice?.toFixed(4) || 'N/A'}, Fase: ${existingState.phase || 'N/A'}`
          );
          return existingState;
        }
      }

      const enableHybridStrategy = true; // Assume que está habilitado
      if (enableHybridStrategy) {
        const atrValue = await TrailingStop.getAtrValue(symbol);
        const initialStopAtrMultiplier = 2.0; // Valor padrão
        const takeProfitAtrMultiplier = 1.5; // Valor padrão

        const initialAtrStopPrice = TrailingStop.calculateAtrStopLossPrice(
          position,
          account,
          atrValue,
          initialStopAtrMultiplier
        );
        const partialTakeProfitPrice = TrailingStop.calculateAtrTakeProfitPrice(
          position,
          atrValue,
          takeProfitAtrMultiplier
        );

        const recoveredState = {
          symbol: symbol,
          entryPrice: parseFloat(position.entryPrice || position.markPrice || 0),
          initialStopLossPrice: initialAtrStopPrice,
          trailingStopPrice: initialAtrStopPrice,
          initialAtrStopPrice: initialAtrStopPrice,
          partialTakeProfitPrice: partialTakeProfitPrice,
          atrValue: atrValue,
          atrMultiplier: initialStopAtrMultiplier,
          takeProfitAtrMultiplier: takeProfitAtrMultiplier,
          strategyType: 'HYBRID_ATR',
          phase: 'INITIAL_RISK',
          isLong: parseFloat(position.netQuantity) > 0,
          isShort: parseFloat(position.netQuantity) < 0,
          highestPrice: null,
          lowestPrice: null,
          activated: true,
          initialized: true,
          createdAt: new Date().toISOString(),
        };

        // Salva o estado no bot atual (assumindo que é o primeiro bot encontrado)
        const firstBotKey = Array.from(TrailingStop.trailingStateByBot.keys())[0];
        if (firstBotKey) {
          const trailingStateMap = TrailingStop.trailingStateByBot.get(firstBotKey);
          trailingStateMap.set(symbol, recoveredState);
          await TrailingStop.setState(config?.id, symbol, recoveredState);
        }

        Logger.info(
          `${symbol}: Stop Loss ATR recuperado - Stop: $${initialAtrStopPrice.toFixed(4)}, TP: $${partialTakeProfitPrice.toFixed(4)}`
        );
        return recoveredState;
      }

      return null;
    } catch (error) {
      Logger.error(`❌ [ATR_RECOVERY] Erro ao recuperar estado ATR para ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Função de debug condicional
   * @param {string} message - Mensagem de debug
   */
  static debug(message) {
    // Sempre loga em modo debug para facilitar o desenvolvimento
    Logger.debug(message);
  }

  /**
   * Versão estática da função calculatePnL para uso externo
   * @param {object} position - Dados da posição
   * @param {object} account - Dados da conta
   * @returns {object} - Objeto com pnl e pnlPct
   */
  static calculatePnL(position, account) {
    try {
      // ✅ DEFENSIVE CHECK: Se account é null, retorna valores seguros
      if (!account || !account.leverage) {
        Logger.debug(
          `⚠️ [PNL_CALC] ${position.symbol}: Dados da conta não disponíveis - usando PnL da exchange`
        );
        return {
          pnl: parseFloat(position.pnlRealized ?? '0') + parseFloat(position.pnlUnrealized ?? '0'),
          pnlPct: 0, // Não podemos calcular % sem alavancagem
          costBasis: 0,
        };
      }

      // Usa pnlRealized + pnlUnrealized para obter o PnL total correto
      const pnlRealized = parseFloat(position.pnlRealized ?? '0');
      const pnlUnrealized = parseFloat(position.pnlUnrealized ?? '0');
      const pnl = pnlRealized + pnlUnrealized;

      const notionalValue = Math.abs(parseFloat(position.netCost ?? '0'));

      const rawLeverage = Number(account.leverage);

      const leverage = validateLeverageForSymbol(position.symbol, rawLeverage);

      const costBasis = notionalValue / leverage;

      let pnlPct = 0;
      if (costBasis > 0) {
        pnlPct = (pnl / costBasis) * 100;
      }

      return {
        pnl: pnl,
        pnlPct: pnlPct,
      };
    } catch (error) {
      Logger.error('[PNL_CALC] Erro ao calcular PnL:', error.message);
      return { pnl: 0, pnlPct: 0 };
    }
  }

  /**
   * Calcula o preço de stop loss inicial baseado na configuração
   * @param {object} position - Dados da posição
   * @param {object} account - Dados da conta
   * @returns {number} - Preço de stop loss inicial
   */
  static calculateInitialStopLossPrice(position, account) {
    try {
      const currentPrice = parseFloat(position.markPrice || position.lastPrice || 0);

      if (!account?.leverage) {
        Logger.error(
          `❌ [STOP_LOSS_ERROR] ${position.symbol}: Alavancagem não encontrada na Account`
        );
        return null;
      }

      const rawLeverage = Number(account.leverage);

      const leverage = validateLeverageForSymbol(position.symbol, rawLeverage);

      const baseStopLossPct = Math.abs(Number(-10)); // Valor padrão, será sobrescrito pela config do bot

      const actualStopLossPct = baseStopLossPct / leverage;

      const isLong = parseFloat(position.netQuantity) > 0;

      const initialStopLossPrice = isLong
        ? currentPrice * (1 - actualStopLossPct / 100)
        : currentPrice * (1 + actualStopLossPct / 100);

      return initialStopLossPrice;
    } catch (error) {
      Logger.error(
        `[INITIAL_STOP] Erro ao calcular stop loss inicial para ${position.symbol}:`,
        error.message
      );
      return 0;
    }
  }

  /**
   * Re-inicializa o stop loss com uma nova estratégia
   * @param {string} strategyType - Novo tipo de estratégia
   */
  async reinitializeStopLoss(strategyType) {
    if (!strategyType) {
      return;
    }

    this.strategyType = strategyType;
    this.stopLossStrategy = await StopLossFactory.createStopLoss(strategyType);
  }

  /**
   * Limpa o estado do trailing stop para uma posição específica
   * @param {string} symbol - Símbolo da posição
   * @param {string} reason - Motivo da limpeza (opcional)
   */
  static async clearTrailingState(symbol, reason = 'manual') {
    // Limpa para todos os bots (método estático)
    for (const [botKey, trailingStateMap] of TrailingStop.trailingStateByBot.entries()) {
      if (trailingStateMap.has(symbol)) {
        const state = trailingStateMap.get(symbol);
        trailingStateMap.delete(symbol);
        TrailingStop.colorLogger.trailingCleanup(
          `${symbol}: Estado limpo (${reason}) - Trailing Stop: $${state?.trailingStopPrice?.toFixed(4) || 'N/A'}`
        );

        // Remove do cache de logs também
        const trailingModeLogged = TrailingStop.trailingModeLoggedByBot.get(botKey);
        if (trailingModeLogged) {
          trailingModeLogged.delete(symbol);
        }
      }
    }

    await TrailingStop.clearStateFromDB(symbol);
  }

  /**
   * Limpa o estado do trailing stop quando uma posição é fechada
   * @param {object} position - Dados da posição que foi fechada
   * @param {string} closeReason - Motivo do fechamento
   */
  static async onPositionClosed(position, closeReason) {
    if (position && position.symbol) {
      await TrailingStop.clearTrailingState(position.symbol, `posição fechada: ${closeReason}`);

      // Limpa do cache de profit closure detectado ao fechar a posição
      TrailingStop.profitClosureDetected.delete(position.symbol);

      // Limpa do cache de fechamento em progresso se estiver lá
      TrailingStop.closingInProgress.delete(position.symbol);

      clearLeverageAdjustLog(position.symbol);
    }
  }

  /**
   * Força a limpeza completa do estado do Trailing Stop
   * Útil quando o bot é reiniciado e precisa começar do zero
   */
  static async forceCleanupAllStates() {
    try {
      let totalStateCount = 0;
      for (const [botKey, trailingStateMap] of TrailingStop.trailingStateByBot.entries()) {
        totalStateCount += trailingStateMap.size;
        trailingStateMap.clear();
      }

      TrailingStop.trailingStateByBot.clear();
      TrailingStop.trailingModeLoggedByBot.clear();

      clearLeverageAdjustLog();

      // Clear all states from database
      if (TrailingStop.dbService && TrailingStop.dbService.isInitialized()) {
        try {
          await TrailingStop.dbService.run('DELETE FROM trailing_state');
        } catch (error) {
          Logger.error(`Erro ao limpar base de dados:`, error.message);
        }
      }

      Logger.info(`Limpeza completa concluída: ${totalStateCount} estados removidos`);
    } catch (error) {
      Logger.error(`Erro durante limpeza completa:`, error.message);
    }
  }

  /**
   * Limpa estados de trailing stop órfãos (sem posição correspondente na exchange)
   * @param {string} apiKey - Chave da API
   * @param {string} apiSecret - Segredo da API
   * @param {number} botId - ID do bot (opcional, default = 1)
   */
  static async cleanOrphanedTrailingStates(apiKey, apiSecret, botId = 1) {
    try {
      Logger.debug(`🧹 [TRAILING_CLEANER] Iniciando limpeza de estados órfãos para bot ${botId}`);

      // Inicializa database se necessário
      if (!TrailingStop.dbService || !TrailingStop.dbService.isInitialized()) {
        Logger.warn(`❌ [DB_SAVE] Serviço de banco não inicializado para limpeza`);
        TrailingStop.dbService = new DatabaseService();
        await TrailingStop.dbService.init();
      }

      // Busca todos os estados do bot diretamente do banco de dados
      const dbStates = await TrailingStop.dbService.getAll(
        'SELECT symbol FROM trailing_state WHERE botId = ?',
        [botId]
      );

      if (!dbStates || dbStates.length === 0) {
        Logger.debug(
          `[TRAILING_CLEANER] Nenhum estado de trailing stop para bot ${botId} no banco`
        );
        return;
      }

      // Busca todas as posições abertas na exchange
      const exchangeManager = ExchangeManager.createFromConfig({ apiKey, apiSecret });
      const openPositionsResult = await exchangeManager.getFuturesPositions(apiKey, apiSecret);
      const openPositions = Array.isArray(openPositionsResult) ? openPositionsResult : [];
      const openSymbols = new Set(openPositions.map(pos => pos.symbol));

      let cleanedCount = 0;
      const symbolsToClean = [];

      // Verifica cada estado do banco contra posições abertas
      for (const row of dbStates) {
        const symbol = row.symbol;
        if (!openSymbols.has(symbol)) {
          symbolsToClean.push(symbol);
        }
      }

      // Limpa os estados órfãos (remove do banco E da memória)
      for (const symbol of symbolsToClean) {
        await TrailingStop.clearTrailingState(symbol, 'órfão - sem posição aberta');
        cleanedCount++;
      }

      if (cleanedCount > 0) {
        Logger.info(`✅ [TRAILING_CLEANER] ${cleanedCount} estados órfãos removidos`);
      } else {
        Logger.debug(`[TRAILING_CLEANER] Nenhum estado órfão encontrado`);
      }
    } catch (error) {
      Logger.error(`❌ [TRAILING_CLEANER] Erro durante limpeza:`, error.message);
    }
  }

  /**
   * Calcula o preço de stop loss baseado em ATR
   * @param {object} position - Dados da posição
   * @param {object} account - Dados da conta
   * @param {number} atrValue - Valor do ATR
   * @param {number} multiplier - Multiplicador do ATR
   * @returns {number} - Preço de stop loss baseado em ATR
   */
  static calculateAtrStopLossPrice(position, account, atrValue, multiplier = 2.0) {
    try {
      const currentPrice = parseFloat(position.markPrice || position.lastPrice || 0);
      if (currentPrice <= 0 || !atrValue || atrValue <= 0) {
        return TrailingStop.calculateInitialStopLossPrice(position, account);
      }

      const isLong = parseFloat(position.netQuantity) > 0;
      const atrDistance = atrValue * multiplier;

      if (isLong) {
        return currentPrice - atrDistance;
      } else {
        return currentPrice + atrDistance;
      }
    } catch (error) {
      Logger.error(
        `[ATR_STOP_CALC] Erro ao calcular stop loss ATR para ${position.symbol}:`,
        error.message
      );
      return TrailingStop.calculateInitialStopLossPrice(position, account);
    }
  }

  /**
   * Calcula o preço de take profit parcial baseado em ATR
   * @param {object} position - Dados da posição
   * @param {number} atrValue - Valor do ATR
   * @param {number} multiplier - Multiplicador do ATR
   * @returns {number} - Preço de take profit parcial
   */
  static calculateAtrTakeProfitPrice(position, atrValue, multiplier = 1.5) {
    const currentPrice = parseFloat(position.markPrice || 0);
    try {
      if (currentPrice <= 0 || !atrValue || atrValue <= 0) {
        return currentPrice;
      }

      const isLong = parseFloat(position.netQuantity) > 0;
      const atrDistance = atrValue * multiplier;

      if (isLong) {
        return currentPrice + atrDistance;
      } else {
        return currentPrice - atrDistance;
      }
    } catch (error) {
      Logger.error(
        `[ATR_TP_CALC] Erro ao calcular take profit ATR para ${position.symbol}:`,
        error.message
      );
      return currentPrice;
    }
  }

  /**
   * Obtém o valor do ATR para um símbolo
   * @param {string} symbol - Símbolo da posição
   * @returns {Promise<number|null>} - Valor do ATR ou null se não disponível
   */
  static async getAtrValue(symbol, timeframe = '30m') {
    try {
      const markets = new Markets();
      const candles = await markets.getKLines(symbol, timeframe, 30);

      if (!candles || candles.length < 14) {
        return null;
      }

      const { calculateIndicators } = await import('../Decision/Indicators.js');
      const indicators = await calculateIndicators(candles, timeframe, symbol);

      return indicators.atr?.atr || null;
    } catch (error) {
      Logger.error(`[ATR_GET] Erro ao obter ATR para ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Atualiza o trailing stop para uma posição específica
   *
   * 🛡️ IMPORTANTE: Este método trabalha em PARALELO com o failsafe de segurança.
   * O failsafe (MAX_NEGATIVE_PNL_STOP_PCT) é SEMPRE criado na corretora como rede de segurança.
   * Este monitoramento tático (ATR) é uma camada adicional de inteligência que pode fechar
   * a posição antes que o failsafe seja atingido.
   *
   * @param {object} position - Dados da posição
   * @returns {object|null} - Estado atualizado do trailing stop ou null se não aplicável
   */
  async updateTrailingStopForPosition(position) {
    let trailingState = null;
    try {
      // Throttling para logs (evita spam)
      const now = Date.now();
      const lastLog = TrailingStop.lastTrailingLog.get(position.symbol) || 0;
      const shouldLog = now - lastLog > TrailingStop.TRAILING_LOG_THROTTLE;

      if (shouldLog) {
        Logger.debug(
          `🚀 [TRAILING_START] ${position.symbol}: Iniciando atualização do trailing stop`
        );
        TrailingStop.lastTrailingLog.set(position.symbol, now);
      }

      const enableTrailingStop = this.config?.enableTrailingStop || false;
      const enableHybridStrategy = this.config?.enableHybridStopStrategy || false;

      if (shouldLog) {
        Logger.debug(
          `🔧 [TRAILING_CONFIG] ${position.symbol}: enableTrailingStop=${enableTrailingStop}, enableHybridStrategy=${enableHybridStrategy}`
        );
      }

      if (!enableTrailingStop) {
        Logger.debug(`⚠️ [TRAILING_SKIP] ${position.symbol}: Trailing stop desabilitado`);
        return null;
      }

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!this.config?.apiKey || !this.config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = this.config.apiKey;
      const apiSecret = this.config.apiSecret;

      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: this.strategyType,
      });

      // 🚫 VERIFICAÇÃO: Durante manutenção, dados de conta não estão disponíveis
      if (!Account) {
        const DepressurizationManager = await import('../Utils/DepressurizationManager.js');
        if (DepressurizationManager.default.isSystemInMaintenance()) {
          Logger.debug(
            `🚫 [TRAILING_SKIP] ${position.symbol}: Trailing stop pausado durante manutenção - dados de conta indisponíveis`
          );
        } else {
          Logger.error(`❌ [TRAILING_ERROR] ${position.symbol}: Dados da conta não disponíveis`);
        }
        return null;
      }

      if (!Account.leverage) {
        Logger.error(
          `❌ [TRAILING_ERROR] ${position.symbol}: Alavancagem não encontrada na Account`
        );
        return null;
      }

      const { pnl, pnlPct } = TrailingStop.calculatePnL(position, Account);
      const currentPrice = parseFloat(position.markPrice || 0);
      const entryPrice = parseFloat(position.entryPrice || 0);

      if (currentPrice <= 0 || entryPrice <= 0) {
        Logger.error(
          `❌ [TRAILING_ERROR] Preços inválidos para ${position.symbol}: Current: ${currentPrice}, Entry: ${entryPrice}`
        );
        return null;
      }

      const isLong = parseFloat(position.netQuantity) > 0;
      const isShort = parseFloat(position.netQuantity) < 0;

      if (!isLong && !isShort) {
        return null;
      }

      const trailingStateMap = this.getTrailingState();
      trailingState = trailingStateMap.get(position.symbol);

      // === ESTRATÉGIA HÍBRIDA (ATR) ===
      Logger.debug(
        `🔍 [TRAILING_STRATEGY] ${position.symbol}: enableHybridStrategy=${enableHybridStrategy}, config.enableHybridStopStrategy=${this.config?.enableHybridStopStrategy}`
      );

      if (enableHybridStrategy) {
        // Se não existe estado, tenta recuperar estado ATR
        if (!trailingState) {
          trailingState = await TrailingStop.recoverAtrState(
            position.symbol,
            position,
            Account,
            this.config
          );
        }
        return await this.updateTrailingStopHybrid(
          position,
          trailingState,
          Account,
          pnl,
          pnlPct,
          currentPrice,
          entryPrice,
          isLong,
          isShort
        );
      }

      return await this.updateTrailingStopTraditional(
        position,
        trailingState,
        Account,
        pnl,
        pnlPct,
        currentPrice,
        entryPrice,
        isLong,
        isShort
      );
    } catch (error) {
      Logger.error(
        `[TRAILING_UPDATE] Erro ao atualizar trailing stop para ${position.symbol}:`,
        error.message
      );
      return null;
    } finally {
      if (trailingState) {
        await TrailingStop.setState(String(this.config?.id), position.symbol, trailingState); // 🔧 FIX: Converte botId
      }
    }
  }

  /**
   * Atualiza trailing stop usando a estratégia híbrida (ATR)
   *
   * 🛡️ SEGURANÇA: Este método trabalha em PARALELO com o failsafe.
   * O failsafe (MAX_NEGATIVE_PNL_STOP_PCT) é SEMPRE criado na corretora.
   * Este monitoramento tático pode fechar a posição antes do failsafe.
   */
  async updateTrailingStopHybrid(
    position,
    trailingState,
    account,
    pnl,
    pnlPct,
    currentPrice,
    entryPrice,
    isLong,
    isShort
  ) {
    try {
      // Verifica se este symbol está na lista de skip (posição fechada)
      const symbolKey = `${position.symbol}_${this.config.botName}`;
      if (TrailingStop.skippedSymbols.has(symbolKey)) {
        Logger.debug(
          `⏭️ [TRAILING_SKIP] Symbol ${position.symbol} está sendo skipado (posição fechada)`
        );
        return null;
      }

      // Valida se a posição ainda existe na exchange
      const exchangeManager = ExchangeManager.createFromConfig(this.config);
      const exchangePositionsResult = await exchangeManager.getFuturesPositions(
        this.config.apiKey,
        this.config.apiSecret
      );
      const exchangePositions = Array.isArray(exchangePositionsResult)
        ? exchangePositionsResult
        : [];
      const activePosition = exchangePositions.find(
        pos => pos.symbol === position.symbol && pos.netQuantity !== '0'
      );

      if (!activePosition) {
        Logger.warn(`${position.symbol}: Posição fechada, pausando monitoramento`);
        TrailingStop.skippedSymbols.set(symbolKey, Date.now());
        return null;
      } else {
        // Remove do skip se posição foi reaberta
        if (TrailingStop.skippedSymbols.has(symbolKey)) {
          Logger.info(`${position.symbol}: Posição reaberta, retomando monitoramento`);
          TrailingStop.skippedSymbols.delete(symbolKey);
        }
      }

      let stopLossOrder = await PositionUtils.getStopLossOrders(
        position.symbol,
        position,
        this.config
      );

      // === FASE 1: RISCO INICIAL ===
      if (!trailingState) {
        // Inicializa nova posição na fase de risco inicial
        const atrValue = await TrailingStop.getAtrValue(position.symbol);
        const initialStopAtrMultiplier = Number(this.config?.initialStopAtrMultiplier || 2.0);
        const takeProfitAtrMultiplier = Number(this.config?.partialTakeProfitAtrMultiplier || 1.5);
        let atrStopPrice;

        if (stopLossOrder && stopLossOrder.length > 0) {
          atrStopPrice = stopLossOrder[0]?.price || stopLossOrder[0]?.triggerPrice;
        }

        if (!atrStopPrice) {
          // 1. CALCULAR OS DOIS STOPS
          // a) Stop Tático (ATR)
          atrStopPrice = TrailingStop.calculateAtrStopLossPrice(
            position,
            account,
            atrValue,
            initialStopAtrMultiplier
          );
        }

        // b) Stop de Segurança Máxima (PnL)
        const maxPnlStopPrice = TrailingStop.calculateInitialStopLossPrice(position, account);

        // 2. LOGAR OS CÁLCULOS PARA TRANSPARÊNCIA
        Logger.info(
          `🔍 [STOP_CALC] ${position.symbol}: Stop Tático (ATR) calculado em $${atrStopPrice?.toFixed(4) || 'N/A'}`
        );
        const maxNegativePnlStopPct = this.config?.maxNegativePnlStopPct || -10;
        Logger.info(
          `🔍 [STOP_CALC] ${position.symbol}: Stop de Segurança Máxima (${maxNegativePnlStopPct}%) calculado em $${maxPnlStopPrice?.toFixed(4) || 'N/A'}`
        );

        // 3. TOMAR E LOGAR A DECISÃO
        // Para uma COMPRA (LONG), o stop mais seguro é o mais ALTO.
        // Para uma VENDA (SHORT), o stop mais seguro é o mais BAIXO.
        const finalStopPrice = isLong
          ? Math.max(atrStopPrice || 0, maxPnlStopPrice || 0)
          : Math.min(atrStopPrice || 0, maxPnlStopPrice || 0);

        Logger.info(
          `✅ [STOP_DECISION] ${position.symbol}: Stop tático ATIVO definido para $${finalStopPrice.toFixed(4)} (o mais seguro dos dois).`
        );

        const partialTakeProfitPrice = TrailingStop.calculateAtrTakeProfitPrice(
          position,
          atrValue,
          takeProfitAtrMultiplier
        );

        // 🎯 MONITORAR ORDEM LIMIT DE TAKE PROFIT PARCIAL (não criar nova)
        const partialPercentage = Number(this.config?.partialTakeProfitPercentage || 50);
        Logger.info(
          `🎯 [TP_LIMIT_SETUP] ${position.symbol}: Monitorando ordem LIMIT de take profit parcial existente`
        );
        Logger.info(
          `📊 [TP_LIMIT_SETUP] ${position.symbol}: Preço esperado: $${partialTakeProfitPrice?.toFixed(4) || 'N/A'}, Quantidade: ${partialPercentage}%`
        );

        // NÃO cria nova ordem - apenas monitora a existente
        Logger.info(
          `ℹ️ [TP_LIMIT_SETUP] ${position.symbol}: Ordem de TP parcial já foi criada pelo sistema principal. Apenas monitorando.`
        );

        const newState = {
          symbol: position.symbol,
          entryPrice: entryPrice,
          initialStopLossPrice: finalStopPrice,
          trailingStopPrice: finalStopPrice,
          initialAtrStopPrice: finalStopPrice,
          partialTakeProfitPrice: partialTakeProfitPrice,
          originalQuantity: Math.abs(parseFloat(position.netQuantity)), // Para rastrear take profit
          atrValue: atrValue,
          atrMultiplier: initialStopAtrMultiplier,
          takeProfitAtrMultiplier: takeProfitAtrMultiplier,
          strategyType: 'HYBRID_ATR',
          highestPrice: isLong ? currentPrice : null,
          lowestPrice: isShort ? currentPrice : null,
          isLong: isLong,
          isShort: isShort,
          phase: 'INITIAL_RISK',
          activated: true,
          initialized: true,
          active_stop_order_id: null, // Será preenchido quando sistema ativo criar ordem
          createdAt: new Date().toISOString(),
        };

        // Salva o estado no bot atual
        const trailingStateMap = this.getTrailingState();
        trailingStateMap.set(position.symbol, newState);
        await TrailingStop.setState(String(this.config?.id), position.symbol, newState); // 🔧 FIX: Converte botId

        TrailingStop.colorLogger.trailingActivated(
          `${position.symbol}: 🎯 Stop Loss Inteligente ATIVADO! Fase: Proteção Inicial - PnL: ${pnlPct.toFixed(2)}%, Entrada: $${entryPrice.toFixed(4)}, Atual: $${currentPrice.toFixed(4)}, Volatilidade: ${atrValue?.toFixed(6) || 'N/A'}, Stop Loss Final: $${finalStopPrice?.toFixed(4) || 'N/A'}, Take Profit: $${partialTakeProfitPrice?.toFixed(4) || 'N/A'}`
        );

        return newState;
      }

      if (stopLossOrder && stopLossOrder.length > 0) {
        trailingState.trailingStopPrice = parseFloat(
          stopLossOrder[0]?.price || stopLossOrder[0]?.triggerPrice
        );
      }

      // === LÓGICA UNIFICADA DE TRAILING STOP ===
      // O trailing stop sempre se move baseado no melhor preço, independente da fase
      const trailingStopDistance = Number(this.config?.trailingStopDistance || 1.5);

      if (isLong) {
        if (currentPrice > trailingState.highestPrice || trailingState.highestPrice === null) {
          trailingState.highestPrice = currentPrice;

          const trailingStopAtrMultiplier = Number(this.config?.trailingStopAtrMultiplier || 1.5);
          const atrValue = await TrailingStop.calculateDynamicATR(position.symbol);

          let newTrailingStopPrice;
          if (atrValue) {
            newTrailingStopPrice =
              trailingState.highestPrice - atrValue * trailingStopAtrMultiplier;
            Logger.debug(
              `📊 [ATR_POS] ${position.symbol} LONG: HighestPrice=${trailingState.highestPrice.toFixed(4)}, ATR=${atrValue.toFixed(4)}, Multiplier=${trailingStopAtrMultiplier}, NewStop=${newTrailingStopPrice.toFixed(4)}`
            );
          } else {
            // Fallback: usa percentual fixo se ATR não disponível
            newTrailingStopPrice = currentPrice * (1 - trailingStopDistance / 100);
            Logger.debug(
              `⚠️ [ATR_FALLBACK_POS] ${position.symbol} LONG: Usando cálculo percentual ${trailingStopDistance}%`
            );
          }

          const currentStopPrice = trailingState.trailingStopPrice;

          const finalStopPrice = Math.max(currentStopPrice, newTrailingStopPrice);

          if (finalStopPrice > currentStopPrice) {
            const improvement = finalStopPrice - currentStopPrice;
            const improvementPct = (improvement / currentStopPrice) * 100;

            const initialStopAtrMultiplier = Number(this.config?.initialStopAtrMultiplier || 2.0);
            const atrValue = await TrailingStop.calculateDynamicATR(position.symbol);
            let minImprovementPct;

            if (atrValue) {
              const atrDistance = atrValue * initialStopAtrMultiplier;
              minImprovementPct = (atrDistance / currentPrice) * 100 * 0.1;
              Logger.debug(
                `📊 [ATR_MIN] ${position.symbol}: ATR=${atrValue.toFixed(4)}, Distância=${atrDistance.toFixed(4)}, Mín=${minImprovementPct.toFixed(3)}%`
              );
            } else {
              minImprovementPct = trailingStopDistance * 0.1;
              Logger.warn(
                `⚠️ [ATR_FALLBACK] ${position.symbol}: Usando distância fixa ${minImprovementPct.toFixed(3)}%`
              );
            }

            if (improvementPct >= minImprovementPct) {
              trailingState.trailingStopPrice = finalStopPrice;
              TrailingStop.colorLogger.trailingUpdate(
                `${position.symbol}: LONG Trailing Stop -> $${finalStopPrice.toFixed(4)} (melhoria: ${improvementPct.toFixed(3)}%)`
              );
              await TrailingStop.createTrailingStopOrder(
                position,
                trailingState,
                String(this.config?.id), // 🔧 FIX: Converte botId para string
                this.config
              );
            } else {
              Logger.debug(
                `⏭️ [TRAILING_SKIP] ${position.symbol} LONG: Melhoria insuficiente (${improvementPct.toFixed(3)}% < ${minImprovementPct.toFixed(3)}%), mantendo stop atual`
              );
            }
          }
        }
      } else if (isShort) {
        if (currentPrice < trailingState.lowestPrice || trailingState.lowestPrice === null) {
          trailingState.lowestPrice = currentPrice;

          const trailingStopAtrMultiplier = Number(this.config?.trailingStopAtrMultiplier || 1.5);
          const atrValue = await TrailingStop.calculateDynamicATR(position.symbol);

          let newTrailingStopPrice;
          if (atrValue) {
            // ATR dinâmico: lowest price + (ATR × trailingStopAtrMultiplier)
            newTrailingStopPrice = trailingState.lowestPrice + atrValue * trailingStopAtrMultiplier;
            Logger.debug(
              `📊 [ATR_POS] ${position.symbol} SHORT: LowestPrice=${trailingState.lowestPrice.toFixed(4)}, ATR=${atrValue.toFixed(4)}, Multiplier=${trailingStopAtrMultiplier}, NewStop=${newTrailingStopPrice.toFixed(4)}`
            );
          } else {
            // Fallback: usa percentual fixo se ATR não disponível
            newTrailingStopPrice = currentPrice * (1 + trailingStopDistance / 100);
            Logger.info(
              `⚠️ [ATR_FALLBACK] ${position.symbol} SHORT: ATR indisponível, usando percentual ${trailingStopDistance}% - NewStop=${newTrailingStopPrice.toFixed(4)}`
            );
          }

          const currentStopPrice = trailingState.trailingStopPrice;

          const finalStopPrice = Math.min(currentStopPrice, newTrailingStopPrice);

          if (finalStopPrice < currentStopPrice) {
            const improvement = currentStopPrice - finalStopPrice;
            const improvementPct = (improvement / currentStopPrice) * 100;

            // Calcula melhoria mínima baseada no ATR dinâmico
            const initialStopAtrMultiplier = Number(this.config?.initialStopAtrMultiplier || 2.0);
            const atrValue = await TrailingStop.calculateDynamicATR(position.symbol);
            let minImprovementPct;

            if (atrValue) {
              // ATR dinâmico: 10% da distância ATR como melhoria mínima
              const atrDistance = atrValue * initialStopAtrMultiplier;
              minImprovementPct = (atrDistance / currentPrice) * 100 * 0.1;
              Logger.debug(
                `📊 [ATR_MIN] ${position.symbol}: ATR=${atrValue.toFixed(4)}, Distância=${atrDistance.toFixed(4)}, Mín=${minImprovementPct.toFixed(3)}%`
              );
            } else {
              // Fallback: usa distância fixa se ATR não disponível
              minImprovementPct = trailingStopDistance * 0.1;
              Logger.debug(
                `⚠️ [ATR_FALLBACK] ${position.symbol}: Usando distância fixa ${minImprovementPct.toFixed(3)}%`
              );
            }

            if (improvementPct >= minImprovementPct) {
              trailingState.trailingStopPrice = finalStopPrice;
              TrailingStop.colorLogger.trailingUpdate(
                `${position.symbol}: SHORT Trailing Stop -> $${finalStopPrice.toFixed(4)} (melhoria: ${improvementPct.toFixed(3)}%)`
              );

              await TrailingStop.createTrailingStopOrder(
                position,
                trailingState,
                String(this.config?.id), // 🔧 FIX: Converte botId para string
                this.config
              );
            } else {
              Logger.debug(
                `⏭️ [TRAILING_SKIP] ${position.symbol} SHORT: Melhoria insuficiente (${improvementPct.toFixed(3)}% < ${minImprovementPct.toFixed(3)}%), mantendo stop atual`
              );
            }
          }
        }
      }

      Logger.debug(
        `📊 [TRAILING_STOP] ${position.symbol}: CurrentPrice: ${currentPrice?.toFixed(5)}, ${trailingState.lowestPrice ? `LowestPrice: ${trailingState.lowestPrice.toFixed(5)}` : `HighestPrice: ${trailingState.highestPrice.toFixed(5)}`}, InitialStopLoss: ${trailingState.initialStopLossPrice?.toFixed(5)}, TrailingStopPrice: ${trailingState.trailingStopPrice?.toFixed(5)}`
      );

      return trailingState;
    } catch (error) {
      Logger.error(
        `[HYBRID_TRAILING] Erro ao atualizar trailing stop híbrido para ${position.symbol}:`,
        error.message
      );
      return null;
    }
  }

  /**
   * Atualiza trailing stop usando a estratégia tradicional
   */
  async updateTrailingStopTraditional(
    position,
    trailingState,
    account,
    pnl,
    pnlPct,
    currentPrice,
    entryPrice,
    isLong,
    isShort
  ) {
    try {
      const trailingStopDistance = Number(this.config?.trailingStopDistance || 1.5);

      if (isNaN(trailingStopDistance) || trailingStopDistance <= 0) {
        Logger.error(
          `❌ [TRAILING_ERROR] TRAILING_STOP_DISTANCE inválido: ${this.config?.trailingStopDistance || 1.5}`
        );
        return null;
      }

      if (!trailingState && pnl > 0) {
        const initialStopLossPrice = TrailingStop.calculateInitialStopLossPrice(position, account);

        const newState = {
          symbol: position.symbol,
          entryPrice: entryPrice,
          initialStopLossPrice: initialStopLossPrice,
          trailingStopPrice: initialStopLossPrice,
          highestPrice: isLong ? currentPrice : null,
          lowestPrice: isShort ? currentPrice : null,
          isLong: isLong,
          isShort: isShort,
          phase: 'TRAILING',
          activated: true,
          initialized: true,
          active_stop_order_id: null,
          createdAt: new Date().toISOString(),
        };

        const trailingStateMap = this.getTrailingState();
        trailingStateMap.set(position.symbol, newState);
        await TrailingStop.setState(String(this.config?.id), position.symbol, newState); // 🔧 FIX: Converte botId

        TrailingStop.colorLogger.trailingActivated(
          `${position.symbol}: Trailing Stop ATIVADO! Posição lucrativa detectada - PnL: ${pnlPct.toFixed(2)}%, Preço de Entrada: $${entryPrice.toFixed(4)}, Preço Atual: $${currentPrice.toFixed(4)}, Stop Inicial: $${initialStopLossPrice.toFixed(4)}`
        );

        return newState;
      }

      if (trailingState && !trailingState.activated && pnl > 0) {
        trailingState.activated = true;
        trailingState.initialized = true;
        trailingState.phase = 'TRAILING';

        if (isLong && currentPrice > trailingState.highestPrice) {
          trailingState.highestPrice = currentPrice;
        }
        if (isShort && currentPrice < trailingState.lowestPrice) {
          trailingState.lowestPrice = currentPrice;
        }

        await TrailingStop.setState(String(this.config?.id), position.symbol, trailingState); // 🔧 FIX: Converte botId

        TrailingStop.colorLogger.trailingActivated(
          `${position.symbol}: Trailing Stop REATIVADO! Estado existente ativado - PnL: ${pnlPct.toFixed(2)}%, Preço Atual: $${currentPrice.toFixed(4)}, Stop: $${trailingState.trailingStopPrice.toFixed(4)}`
        );

        return trailingState;
      }

      if (pnl <= 0) {
        if (trailingState && trailingState.activated) {
          TrailingStop.colorLogger.trailingHold(
            `${position.symbol}: Posição em prejuízo mas Trailing Stop mantido ativo para proteção - Trailing Stop: $${trailingState.trailingStopPrice?.toFixed(4) || 'N/A'}`
          );
          return trailingState;
        }

        TrailingStop.clearTrailingState(position.symbol);
        return null;
      }

      if (isLong) {
        if (currentPrice > trailingState.highestPrice || trailingState.highestPrice === null) {
          trailingState.highestPrice = currentPrice;

          // 🚨 CORREÇÃO: Calcula trailing stop baseado no HIGHEST PRICE - (ATR × multiplier)
          const trailingStopAtrMultiplier = Number(this.config?.trailingStopAtrMultiplier || 1.5);
          const atrValue = await TrailingStop.calculateDynamicATR(position.symbol);

          let newTrailingStopPrice;
          if (atrValue) {
            // ATR dinâmico: highest price - (ATR × trailingStopAtrMultiplier)
            newTrailingStopPrice =
              trailingState.highestPrice - atrValue * trailingStopAtrMultiplier;
            Logger.debug(
              `📊 [ATR_POS] ${position.symbol} LONG: HighestPrice=${trailingState.highestPrice.toFixed(4)}, ATR=${atrValue.toFixed(4)}, Multiplier=${trailingStopAtrMultiplier}, NewStop=${newTrailingStopPrice.toFixed(4)}`
            );
          } else {
            // Fallback: usa percentual fixo se ATR não disponível
            newTrailingStopPrice = currentPrice * (1 - trailingStopDistance / 100);
            Logger.debug(
              `⚠️ [ATR_FALLBACK_POS] ${position.symbol} LONG: Usando cálculo percentual ${trailingStopDistance}%`
            );
          }

          const currentStopPrice = trailingState.trailingStopPrice;

          const finalStopPrice = Math.max(currentStopPrice, newTrailingStopPrice);

          // 🚨 CORREÇÃO: Só atualiza se a melhoria for SIGNIFICATIVA (baseada no ATR dinâmico)
          if (finalStopPrice > currentStopPrice) {
            const improvement = finalStopPrice - currentStopPrice;
            const improvementPct = (improvement / currentStopPrice) * 100;

            // Calcula melhoria mínima baseada no ATR dinâmico
            const initialStopAtrMultiplier = Number(this.config?.initialStopAtrMultiplier || 2.0);
            const atrValue = await TrailingStop.calculateDynamicATR(position.symbol);
            let minImprovementPct;

            if (atrValue) {
              // ATR dinâmico: 10% da distância ATR como melhoria mínima
              const atrDistance = atrValue * initialStopAtrMultiplier;
              minImprovementPct = (atrDistance / currentPrice) * 100 * 0.1;
              Logger.debug(
                `📊 [ATR_MIN] ${position.symbol}: ATR=${atrValue.toFixed(4)}, Distância=${atrDistance.toFixed(4)}, Mín=${minImprovementPct.toFixed(3)}%`
              );
            } else {
              // Fallback: usa distância fixa se ATR não disponível
              minImprovementPct = trailingStopDistance * 0.1;
              Logger.debug(
                `⚠️ [ATR_FALLBACK] ${position.symbol}: Usando distância fixa ${minImprovementPct.toFixed(3)}%`
              );
            }

            if (improvementPct >= minImprovementPct) {
              // Se OrdersService estiver disponível, usa o sistema ativo
              if (this.ordersService) {
                const activeStopResult = await this.manageActiveStopOrder(
                  position,
                  finalStopPrice,
                  String(this.config?.id) // 🔧 FIX: Converte botId
                );
                if (activeStopResult) {
                  trailingState.trailingStopPrice = finalStopPrice;
                  trailingState.activated = true;
                  TrailingStop.colorLogger.trailingUpdate(
                    `${position.symbol}: LONG - Preço melhorou para $${currentPrice.toFixed(4)}, Stop ATIVO movido para: $${finalStopPrice.toFixed(4)} | Melhoria: ${improvementPct.toFixed(3)}% (ATR mín: ${minImprovementPct.toFixed(3)}%)`
                  );
                } else {
                  Logger.warn(
                    `⚠️ [ACTIVE_STOP] ${position.symbol}: Falha ao mover stop ativo, mantendo modo passivo`
                  );
                  trailingState.trailingStopPrice = finalStopPrice;
                  trailingState.activated = true;
                  TrailingStop.colorLogger.trailingUpdate(
                    `${position.symbol}: LONG - Preço melhorou para $${currentPrice.toFixed(4)}, Novo Stop PASSIVO para: $${finalStopPrice.toFixed(4)} | Melhoria: ${improvementPct.toFixed(3)}%`
                  );
                }
              } else {
                // Modo passivo tradicional
                trailingState.trailingStopPrice = finalStopPrice;
                trailingState.activated = true;
                TrailingStop.colorLogger.trailingUpdate(
                  `${position.symbol}: LONG - Preço melhorou para $${currentPrice.toFixed(4)}, Novo Stop PASSIVO para: $${finalStopPrice.toFixed(4)} | Melhoria: ${improvementPct.toFixed(3)}%`
                );
              }

              // Salva o estado atualizado no banco
              await TrailingStop.setState(String(this.config?.id), position.symbol, trailingState); // 🔧 FIX: Converte botId
            } else {
              Logger.debug(
                `⏭️ [TRAILING_SKIP] ${position.symbol} LONG: Melhoria insuficiente (${improvementPct.toFixed(3)}% < ${minImprovementPct.toFixed(3)}%), mantendo stop atual`
              );
            }
          }
        }
      } else if (isShort) {
        if (currentPrice < trailingState.lowestPrice || trailingState.lowestPrice === null) {
          trailingState.lowestPrice = currentPrice;

          // 🚨 CORREÇÃO: Calcula trailing stop baseado no LOWEST PRICE + (ATR × multiplier)
          const trailingStopAtrMultiplier = Number(this.config?.trailingStopAtrMultiplier || 1.5);
          const atrValue = await TrailingStop.calculateDynamicATR(position.symbol);

          let newTrailingStopPrice;
          if (atrValue) {
            // ATR dinâmico: lowest price + (ATR × trailingStopAtrMultiplier)
            newTrailingStopPrice = trailingState.lowestPrice + atrValue * trailingStopAtrMultiplier;
            Logger.info();
          } else {
            // Fallback: usa percentual fixo se ATR não disponível
            newTrailingStopPrice = trailingState.lowestPrice * (1 + trailingStopDistance / 100);
            Logger.info(
              `⚠️ [ATR_FALLBACK] ${position.symbol} SHORT: ATR indisponível, usando percentual ${trailingStopDistance}% - NewStop=${newTrailingStopPrice.toFixed(4)}`
            );
          }

          const currentStopPrice = trailingState.trailingStopPrice;
          const finalStopPrice = Math.min(currentStopPrice, newTrailingStopPrice);

          // 🚨 CORREÇÃO: Só atualiza se a melhoria for SIGNIFICATIVA (baseada no ATR dinâmico)
          if (finalStopPrice < currentStopPrice) {
            const improvement = currentStopPrice - finalStopPrice;
            const improvementPct = (improvement / currentStopPrice) * 100;

            // Calcula melhoria mínima baseada no ATR dinâmico
            const initialStopAtrMultiplier = Number(this.config?.initialStopAtrMultiplier || 2.0);
            const atrValue = await TrailingStop.calculateDynamicATR(position.symbol);
            let minImprovementPct;

            if (atrValue) {
              // ATR dinâmico: 10% da distância ATR como melhoria mínima
              const atrDistance = atrValue * initialStopAtrMultiplier;
              minImprovementPct = (atrDistance / currentPrice) * 100 * 0.1;
              Logger.debug(
                `📊 [ATR_MIN] ${position.symbol}: ATR=${atrValue.toFixed(4)}, Distância=${atrDistance.toFixed(4)}, Mín=${minImprovementPct.toFixed(3)}%`
              );
            } else {
              // Fallback: usa distância fixa se ATR não disponível
              minImprovementPct = trailingStopDistance * 0.1;
              Logger.debug(
                `⚠️ [ATR_FALLBACK] ${position.symbol}: Usando distância fixa ${minImprovementPct.toFixed(3)}%`
              );
            }

            if (improvementPct >= minImprovementPct) {
              // Se OrdersService estiver disponível, usa o sistema ativo
              if (this.ordersService) {
                const activeStopResult = await this.manageActiveStopOrder(
                  position,
                  finalStopPrice,
                  String(this.config?.id) // 🔧 FIX: Converte botId
                );
                if (activeStopResult) {
                  trailingState.trailingStopPrice = finalStopPrice;
                  trailingState.activated = true;
                  TrailingStop.colorLogger.trailingUpdate(
                    `${position.symbol}: SHORT - Preço melhorou para $${currentPrice.toFixed(4)}, Stop ATIVO movido para $${finalStopPrice.toFixed(4)} | Melhoria: ${improvementPct.toFixed(3)}%`
                  );
                } else {
                  Logger.warn(
                    `⚠️ [ACTIVE_STOP] ${position.symbol}: Falha ao mover stop ativo, mantendo modo passivo`
                  );
                  trailingState.trailingStopPrice = finalStopPrice;
                  trailingState.activated = true;
                  TrailingStop.colorLogger.trailingUpdate(
                    `${position.symbol}: SHORT - Preço melhorou para $${currentPrice.toFixed(4)}, Stop PASSIVO para $${finalStopPrice.toFixed(4)} | Melhoria: ${improvementPct.toFixed(3)}%`
                  );
                }
              } else {
                // Modo passivo tradicional
                trailingState.trailingStopPrice = finalStopPrice;
                trailingState.activated = true;
                TrailingStop.colorLogger.trailingUpdate(
                  `${position.symbol}: SHORT - Preço melhorou para $${currentPrice.toFixed(4)}, Stop PASSIVO para $${finalStopPrice.toFixed(4)} | Melhoria: ${improvementPct.toFixed(3)}%`
                );
              }

              // Salva o estado atualizado no banco
              await TrailingStop.setState(String(this.config?.id), position.symbol, trailingState); // 🔧 FIX: Converte botId
            } else {
              Logger.debug(
                `⏭️ [TRAILING_SKIP] ${position.symbol} SHORT: Melhoria insuficiente (${improvementPct.toFixed(3)}% < ${minImprovementPct.toFixed(3)}%), mantendo stop atual`
              );
            }
          }
        }

        if (pnl > 0 && !trailingState.activated) {
          // 🚨 CORREÇÃO: Ativação inicial usa ATR dinâmico para SHORT
          const trailingStopAtrMultiplier = Number(this.config?.trailingStopAtrMultiplier || 1.5);
          const atrValue = await TrailingStop.calculateDynamicATR(position.symbol);

          let newTrailingStopPrice;
          if (atrValue) {
            // ATR dinâmico: current price + (ATR × trailingStopAtrMultiplier) para ativação inicial
            newTrailingStopPrice = currentPrice + atrValue * trailingStopAtrMultiplier;
            Logger.debug(
              `📊 [ATR_INIT] ${position.symbol} SHORT: CurrentPrice=${currentPrice.toFixed(4)}, ATR=${atrValue.toFixed(4)}, Multiplier=${trailingStopAtrMultiplier}, InitialStop=${newTrailingStopPrice.toFixed(4)}`
            );
          } else {
            // Fallback: usa percentual fixo se ATR não disponível
            newTrailingStopPrice = currentPrice * (1 + trailingStopDistance / 100);
            Logger.debug(
              `⚠️ [ATR_FALLBACK_INIT] ${position.symbol} SHORT: Usando cálculo percentual ${trailingStopDistance}%`
            );
          }

          const finalStopPrice = Math.min(trailingState.initialStopLossPrice, newTrailingStopPrice);
          trailingState.trailingStopPrice = finalStopPrice;
          trailingState.activated = true;
          TrailingStop.colorLogger.trailingActivate(
            `${position.symbol}: SHORT - Ativando Trailing Stop com lucro existente! Preço: $${currentPrice.toFixed(4)}, Stop inicial: $${finalStopPrice.toFixed(4)} (ATR: ${atrValue ? atrValue.toFixed(4) : 'N/A'})`
          );

          // Salva o estado atualizado no banco
          await TrailingStop.setState(String(this.config?.id), position.symbol, trailingState); // 🔧 FIX: Converte botId
        }
      }

      return trailingState;
    } catch (error) {
      Logger.error(
        `[TRADITIONAL_TRAILING] Erro ao atualizar trailing stop tradicional para ${position.symbol}:`,
        error.message
      );
      return null;
    }
  }

  /**
   * Verifica se uma posição deve ser fechada por trailing stop
   * @param {object} position - Dados da posição
   * @param {object} trailingState - Estado do trailing stop
   * @returns {object|null} - Decisão de fechamento ou null
   */
  checkTrailingStopTrigger(position, trailingState) {
    try {
      // Early return if trailingState is not properly defined
      if (!trailingState || !trailingState.activated || !trailingState.trailingStopPrice) {
        return null;
      }

      const currentPrice = parseFloat(position.markPrice || 0);
      if (currentPrice <= 0) {
        return null;
      }

      let shouldClose = false;
      let reason = '';
      let type = 'TRAILING_STOP';

      // === ESTRATÉGIA HÍBRIDA ===
      const enableHybridStrategy = this.config?.enableHybridStopStrategy || false;

      if (enableHybridStrategy && trailingState.phase) {
        // Verifica stop loss inicial da estratégia híbrida
        if (trailingState.phase === 'INITIAL_RISK' && trailingState.initialAtrStopPrice) {
          if (trailingState.isLong && currentPrice <= trailingState.initialAtrStopPrice) {
            shouldClose = true;
            reason = `Stop Loss Inteligente: Preço atual $${currentPrice.toFixed(4)} <= Stop Loss $${trailingState.initialAtrStopPrice?.toFixed(4) || 'N/A'}`;
            type = 'HYBRID_INITIAL_STOP';
          } else if (trailingState.isShort && currentPrice >= trailingState.initialAtrStopPrice) {
            shouldClose = true;
            reason = `Stop Loss Inteligente: Preço atual $${currentPrice.toFixed(4)} >= Stop Loss $${trailingState.initialAtrStopPrice?.toFixed(4) || 'N/A'}`;
            type = 'HYBRID_INITIAL_STOP';
          }
        }

        // Verifica trailing stop da fase de maximização
        if (
          (trailingState.phase === 'TRAILING' || trailingState.phase === 'PARTIAL_PROFIT_TAKEN') &&
          trailingState.trailingStopPrice
        ) {
          if (trailingState.isLong && currentPrice <= trailingState.trailingStopPrice) {
            shouldClose = true;
            reason = `Trailing Stop: Preço atual $${currentPrice.toFixed(4)} <= Stop Loss $${trailingState.trailingStopPrice?.toFixed(4) || 'N/A'}`;
            type = 'HYBRID_TRAILING_STOP';
          } else if (trailingState.isShort && currentPrice >= trailingState.trailingStopPrice) {
            shouldClose = true;
            reason = `Trailing Stop: Preço atual $${currentPrice.toFixed(4)} >= Stop Loss $${trailingState.trailingStopPrice?.toFixed(4) || 'N/A'}`;
            type = 'HYBRID_TRAILING_STOP';
          }
        }
      } else {
        // === ESTRATÉGIA TRADICIONAL ===
        if (trailingState.isLong) {
          if (currentPrice <= trailingState.trailingStopPrice) {
            shouldClose = true;
            reason = `Stop Loss: Preço atual $${currentPrice.toFixed(4)} <= Stop Loss $${trailingState.trailingStopPrice?.toFixed(4) || 'N/A'}`;
          }
        } else if (trailingState.isShort) {
          if (currentPrice >= trailingState.trailingStopPrice) {
            shouldClose = true;
            reason = `Stop Loss: Preço atual $${currentPrice.toFixed(4)} >= Stop Loss $${trailingState.trailingStopPrice?.toFixed(4) || 'N/A'}`;
          }
        }
      }

      if (shouldClose) {
        const phaseInfo = trailingState.phase ? ` (Fase: ${trailingState.phase})` : '';
        TrailingStop.colorLogger.trailingTrigger(
          `${position.symbol}: POSIÇÃO FECHADA! Preço $${currentPrice.toFixed(4)} cruzou stop $${trailingState.trailingStopPrice?.toFixed(4) || 'N/A'}`
        );
        return {
          shouldClose: true,
          reason: reason,
          type: type,
          trailingStopPrice: trailingState.trailingStopPrice,
          currentPrice: currentPrice,
          phase: trailingState.phase,
        };
      }

      return null;
    } catch (error) {
      Logger.error(
        `[TRAILING_CHECK] Erro ao verificar trailing stop para ${position.symbol}:`,
        error.message
      );
      return null;
    }
  }

  /**
   * Verifica se o trailing stop está ativo para uma posição
   * @param {string} symbol - Símbolo da posição
   * @returns {boolean} - True se o trailing stop está ativo
   */
  isTrailingStopActive(symbol) {
    const enableTrailingStop = this.config?.enableTrailingStop || false;
    const trailingStateMap = this.getTrailingState();
    const trailingState = trailingStateMap.get(symbol);
    return enableTrailingStop && trailingState && trailingState.activated;
  }

  /**
   * Obtém informações detalhadas sobre o estado do trailing stop
   * @param {string} symbol - Símbolo da posição
   * @returns {object|null} - Informações do trailing stop ou null
   */
  getTrailingStopInfo(symbol) {
    const trailingStateMap = this.getTrailingState();
    const trailingState = trailingStateMap.get(symbol);
    if (!trailingState) {
      return null;
    }

    return {
      isActive: trailingState.activated,
      trailingStopPrice: trailingState.trailingStopPrice,
      highestPrice: trailingState.highestPrice,
      lowestPrice: trailingState.lowestPrice,
      isLong: trailingState.isLong,
      isShort: trailingState.isShort,
      entryPrice: trailingState.entryPrice,
    };
  }

  /**
   * Obtém o tier de taxas baseado no volume de 30 dias
   * @returns {Promise<object>} Objeto com maker, taker e tier
   */
  async getFeeTier() {
    try {
      const now = Date.now();

      if (!this.cachedVolume || now - this.lastVolumeCheck > this.volumeCacheTimeout) {
        this.cachedVolume = await PnlController.get30DayVolume();
        this.lastVolumeCheck = now;
      }

      const volume30Days = this.cachedVolume || 0;

      let tier;

      if (volume30Days >= 10000000) {
        tier = { maker: 0.0001, taker: 0.0002, name: 'DIAMOND' };
      } else if (volume30Days >= 5000000) {
        // $5M+
        tier = { maker: 0.0002, taker: 0.0003, name: 'PLATINUM' };
      } else if (volume30Days >= 1000000) {
        // $1M+
        tier = { maker: 0.0003, taker: 0.0004, name: 'GOLD' };
      } else if (volume30Days >= 500000) {
        // $500K+
        tier = { maker: 0.0004, taker: 0.0005, name: 'SILVER' };
      } else if (volume30Days >= 100000) {
        // $100K+
        tier = { maker: 0.0005, taker: 0.0006, name: 'BRONZE' };
      } else {
        // < $100K
        tier = { maker: 0.0006, taker: 0.0007, name: 'STANDARD' };
      }

      return {
        makerFee: tier.maker,
        takerFee: tier.taker,
        totalFee: tier.maker + tier.taker,
        tier: tier,
      };
    } catch (error) {
      return {
        makerFee: 0.0006,
        takerFee: 0.0007,
        totalFee: 0.0013,
        tier: { name: 'STANDARD_FALLBACK' },
      };
    }
  }

  /**
   * Calcula PnL de uma posição
   * @param {object} position - Dados da posição
   * @param {object} account - Dados da conta
   * @returns {object} - PnL em USD e porcentagem
   */
  calculatePnL(position, account) {
    try {
      // Usa pnlRealized + pnlUnrealized para obter o PnL total correto
      const pnlRealized = parseFloat(position.pnlRealized ?? '0');
      const pnlUnrealized = parseFloat(position.pnlUnrealized ?? '0');
      const pnl = pnlRealized + pnlUnrealized;

      const notionalValue = Math.abs(parseFloat(position.netCost ?? '0'));

      const rawLeverage = Number(account?.leverage);

      const leverage = validateLeverageForSymbol(position.symbol, rawLeverage);

      const costBasis = notionalValue / leverage;

      let pnlPct = 0;
      if (costBasis > 0) {
        pnlPct = (pnl / costBasis) * 100;
      }

      return {
        pnl: pnl,
        pnlPct: pnlPct,
      };
    } catch (error) {
      Logger.error('[PNL_CALC] Erro ao calcular PnL:', error.message);
      return { pnl: 0, pnlPct: 0 };
    }
  }

  /**
   * Calcula o profit mínimo necessário para cobrir as taxas
   * @param {object} position - Dados da posição
   * @param {object} fees - Objeto com as taxas
   * @returns {object} - Profit mínimo em USD e porcentagem
   */
  calculateMinimumProfitForFees(position, fees) {
    try {
      const notional = parseFloat(position.netExposureNotional || position.notional || 0);

      if (notional <= 0) {
        return { minProfitUSD: 0, minProfitPct: 0 };
      }

      const totalFees = notional * fees.totalFee;

      const minProfitUSD = totalFees;
      const minProfitPct = (minProfitUSD / notional) * 100;

      return {
        minProfitUSD: minProfitUSD,
        minProfitPct: minProfitPct,
        totalFees: totalFees,
      };
    } catch (error) {
      return { minProfitUSD: 0, minProfitPct: 0, totalFees: 0 };
    }
  }

  /**
   * Verifica se deve fechar posição por stop loss (emergência)
   *
   * Esta função é APENAS uma verificação de segurança para stop loss emergencial.
   * NÃO deve fechar por lucro mínimo - isso é responsabilidade do shouldCloseForConfiguredProfit.
   *
   * REMOVIDO: A verificação de lucro mínimo foi movida para shouldCloseForConfiguredProfit
   * que considera corretamente o minProfitPercentage.
   *
   * @param {object} position - Dados da posição
   * @returns {Promise<boolean>} - True se deve fechar por stop loss emergencial
   */
  async shouldCloseForMinimumProfit(position) {
    try {
      if (!this.config?.apiKey || !this.config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = this.config.apiKey;
      const apiSecret = this.config.apiSecret;

      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: this.strategyType,
        symbol: position.symbol,
      });

      // 🚫 VERIFICAÇÃO: Durante manutenção, dados de conta não estão disponíveis
      if (!Account) {
        const DepressurizationManager = await import('../Utils/DepressurizationManager.js');
        if (DepressurizationManager.default.isSystemInMaintenance()) {
          Logger.debug(
            `🚫 [TRAILING_SKIP] ${position.symbol}: Verificação de lucro pausada durante manutenção`
          );
        } else {
          Logger.error(`❌ [STOP_LOSS_CHECK] ${position.symbol}: Dados da conta não disponíveis`);
        }
        return false;
      }

      if (!Account.leverage) {
        Logger.error(
          `❌ [STOP_LOSS_CHECK] ${position.symbol}: Alavancagem não encontrada na Account`
        );
        return false;
      }

      const { pnl, pnlPct } = TrailingStop.calculatePnL(position, Account);

      const MAX_NEGATIVE_PNL_STOP_PCT = this.config?.maxNegativePnlStopPct || -10;

      if (
        MAX_NEGATIVE_PNL_STOP_PCT !== undefined &&
        MAX_NEGATIVE_PNL_STOP_PCT !== null &&
        MAX_NEGATIVE_PNL_STOP_PCT !== ''
      ) {
        const maxNegativePnlStopPct = parseFloat(MAX_NEGATIVE_PNL_STOP_PCT);

        if (isNaN(maxNegativePnlStopPct) || !isFinite(maxNegativePnlStopPct)) {
          Logger.error(
            `❌ [STOP_LOSS_CHECK] Valor inválido para MAX_NEGATIVE_PNL_STOP_PCT: ${MAX_NEGATIVE_PNL_STOP_PCT}`
          );
          return false;
        }

        if (isNaN(pnlPct) || !isFinite(pnlPct)) {
          Logger.error(`❌ [STOP_LOSS_CHECK] PnL inválido para ${position.symbol}: ${pnlPct}`);
          return false;
        }

        if (pnlPct <= maxNegativePnlStopPct) {
          Logger.info(
            `🚨 [STOP_LOSS_CHECK] ${position.symbol}: Fechando por stop loss emergencial - PnL ${pnlPct.toFixed(3)}% <= limite ${maxNegativePnlStopPct.toFixed(3)}%`
          );
          return true;
        }
      }

      // REMOVIDO: A verificação de lucro mínimo foi movida para shouldCloseForConfiguredProfit
      // Este método agora é APENAS para stop loss emergencial

      return false;
    } catch (error) {
      Logger.error('[STOP_LOSS_CHECK] Erro ao verificar stop loss emergencial:', error.message);
      return false;
    }
  }

  /**
   * Verifica se deve fechar posição por profit mínimo configurado
   *
   * ⚠️ ATENÇÃO: Configurar MIN_PROFIT_PERCENTAGE=0 fará o sistema fechar trades
   * assim que o lucro líquido cobrir as taxas (entrada + saída). Isso pode resultar
   * em fechamentos muito rápidos com lucro mínimo. Recomenda-se configurar um valor
   * maior (ex: 5-10%) para evitar perdas significativas no stop loss e garantir
   * um lucro real após todas as taxas.
   *
   * @param {object} position - Dados da posição
   * @returns {Promise<boolean>} - True se deve fechar por profit configurado
   */
  async shouldCloseForConfiguredProfit(position) {
    try {
      const symbol = position.symbol;
      const now = Date.now();

      // Limpa cache de profit closure detectado periodicamente
      TrailingStop.cleanupProfitClosureDetectedCache();

      // Verifica se esta posição já foi marcada para fechamento recentemente (30s)
      // Evita loops infinitos quando o fechamento real demora mais que a verificação
      if (TrailingStop.profitClosureDetected.has(symbol)) {
        const lastDetected = TrailingStop.profitClosureDetected.get(symbol);
        const elapsedMs = now - lastDetected;
        if (elapsedMs < 30 * 1000) {
          // 30 segundos
          Logger.debug(
            `⏩ [PROFIT_CACHE] ${symbol}: Fechamento já detectado há ${Math.round(elapsedMs / 1000)}s - pulando verificação`
          );
          return false;
        }
      }

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!this.config?.apiKey || !this.config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = this.config.apiKey;
      const apiSecret = this.config.apiSecret;

      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: this.strategyType,
        symbol: position.symbol,
      });

      // 🚫 VERIFICAÇÃO: Durante manutenção, dados de conta não estão disponíveis
      if (!Account) {
        const DepressurizationManager = await import('../Utils/DepressurizationManager.js');
        if (DepressurizationManager.default.isSystemInMaintenance()) {
          Logger.debug(
            `🚫 [TRAILING_SKIP] ${position.symbol}: Verificação de fechamento pausada durante manutenção`
          );
        } else {
          Logger.error(`❌ [PROFIT_CHECK] ${position.symbol}: Dados da conta não disponíveis`);
        }
        return false;
      }

      if (!Account.leverage) {
        Logger.error(`${position.symbol}: Alavancagem não encontrada`);
        return false;
      }

      const { pnl, pnlPct } = TrailingStop.calculatePnL(position, Account);

      const MAX_NEGATIVE_PNL_STOP_PCT = this.config?.maxNegativePnlStopPct || -10;

      if (
        MAX_NEGATIVE_PNL_STOP_PCT !== undefined &&
        MAX_NEGATIVE_PNL_STOP_PCT !== null &&
        MAX_NEGATIVE_PNL_STOP_PCT !== ''
      ) {
        const maxNegativePnlStopPct = parseFloat(MAX_NEGATIVE_PNL_STOP_PCT);

        if (isNaN(maxNegativePnlStopPct) || !isFinite(maxNegativePnlStopPct)) {
          Logger.error(
            `Valor inválido para MAX_NEGATIVE_PNL_STOP_PCT: ${MAX_NEGATIVE_PNL_STOP_PCT}`
          );
          return false;
        }

        if (isNaN(pnlPct) || !isFinite(pnlPct)) {
          Logger.error(`${position.symbol}: PnL inválido: ${pnlPct}`);
          return false;
        }

        if (pnlPct <= maxNegativePnlStopPct) {
          Logger.info(`${position.symbol}: Fechando por stop loss - PnL ${pnlPct.toFixed(3)}%`);
          // Marca no cache que esta posição foi detectada para fechamento
          TrailingStop.profitClosureDetected.set(symbol, now);
          return true;
        }
      }

      const minProfitPct = Number(this.config?.minProfitPercentage || 0.5);

      const fees = await this.getFeeTier();

      const notional = parseFloat(position.netExposureNotional || position.notional || 0);
      const totalFees = notional * fees.totalFee;

      const netProfit = pnl - totalFees;
      const netProfitPct = notional > 0 ? (netProfit / notional) * 100 : 0;

      // Log detalhado dos cálculos para debug
      Logger.debug(`   • PnL bruto: $${pnl.toFixed(4)} (${pnlPct.toFixed(3)}%)`);
      Logger.debug(
        `   • Taxas estimadas: $${totalFees.toFixed(4)} (${((totalFees / notional) * 100).toFixed(3)}%)`
      );
      Logger.debug(`   • PnL líquido: $${netProfit.toFixed(4)} (${netProfitPct.toFixed(3)}%)`);
      Logger.debug(`   • Min profit configurado: ${minProfitPct.toFixed(3)}%`);
      Logger.debug(`   • Notional: $${notional.toFixed(2)}`);

      if (netProfit > 0 && netProfitPct >= minProfitPct) {
        Logger.info(
          `\n✅ [CONFIG_PROFIT] ${position.symbol}: Fechando por lucro ${netProfitPct.toFixed(3)}% >= mínimo ${minProfitPct.toFixed(3)}%`
        );
        Logger.debug(`   💰 Lucro líquido após taxas: $${netProfit.toFixed(4)}`);
        // Marca no cache que esta posição foi detectada para fechamento
        TrailingStop.profitClosureDetected.set(symbol, now);
        return true;
      }

      if (netProfit > 0.01) {
        if (netProfitPct < minProfitPct) {
          Logger.debug(
            `\n⚠️ [CONFIG_PROFIT] ${position.symbol}: Aguardando lucro mínimo - Atual: ${netProfitPct.toFixed(3)}% < Mínimo: ${minProfitPct.toFixed(3)}%`
          );
          Logger.debug(
            `   📈 Precisa de mais ${(minProfitPct - netProfitPct).toFixed(3)}% para atingir o lucro mínimo`
          );
        }
      } else if (netProfit <= 0) {
        Logger.debug(
          `\n🔴 [CONFIG_PROFIT] ${position.symbol}: Posição em prejuízo líquido: $${netProfit.toFixed(4)}`
        );
      }

      return false;
    } catch (error) {
      Logger.error('[CONFIG_PROFIT] Erro ao verificar profit configurado:', error.message);
      return false;
    }
  }

  async stopLoss() {
    try {
      Logger.debug(
        `🔄 [TRAILING_START] ${this.strategyType}: Iniciando verificação de trailing stop...`
      );

      // Verifica se a configuração está presente
      if (!this.config) {
        throw new Error('Configuração do bot é obrigatória - deve ser passada no construtor');
      }

      const enableTrailingStop = this.config.enableTrailingStop || false;
      Logger.debug(
        `🔍 [TRAILING_CONFIG] ${this.strategyType}: enableTrailingStop=${enableTrailingStop}`
      );

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!this.config.apiKey || !this.config.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = this.config.apiKey;
      const apiSecret = this.config.apiSecret;

      const exchangeManager = ExchangeManager.createFromConfig({ apiKey, apiSecret });
      const positions = await exchangeManager.getFuturesPositions(apiKey, apiSecret);

      if (!positions || !Array.isArray(positions) || positions.length === 0) {
        Logger.debug(`[TRAILING_STOP] Nenhuma posição encontrada ou positions não é array`);
        return;
      }

      // 🔧 CORREÇÃO: Filtra apenas posições realmente abertas (netQuantity > 0)
      const activePositions = Array.isArray(positions)
        ? positions.filter(position => {
            const netQuantity = parseFloat(position.netQuantity || 0);
            return Math.abs(netQuantity) > 0;
          })
        : [];

      // 📡 SISTEMA REATIVO: Inicializa WebSocket se trailing stop estiver ativo

      if (enableTrailingStop) {
        Logger.info(
          `🚀 [REACTIVE_INIT] ${this.strategyType}: Inicializando sistema reativo do WebSocket...`
        );
        await TrailingStop.initializeReactiveSystem();

        if (TrailingStop.backpackWS && TrailingStop.backpackWS.isConnected) {
          Logger.info(
            `✅ [REACTIVE_WS] ${this.strategyType}: WebSocket conectado e pronto para monitoramento`
          );
        } else {
          Logger.warn(`❌ [REACTIVE_WS] ${this.strategyType}: Falha ao conectar WebSocket`);
        }
      } else {
        Logger.debug(
          `⏸️ [REACTIVE_SKIP] ${this.strategyType}: Trailing stop não habilitado - sistema reativo desabilitado`
        );
      }

      if (activePositions.length === 0) {
        TrailingStop.debug(
          `🔍 [TRAILING_MONITOR] Todas as ${positions.length} posições estão fechadas (netQuantity = 0) - nada para monitorar`
        );
        return;
      }

      TrailingStop.debug(
        `🔍 [TRAILING_MONITOR] Verificando ${activePositions.length} posições ativas abertas (${positions.length - activePositions.length} posições fechadas filtradas)...`
      );

      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: this.strategyType,
      });

      // 🚫 VERIFICAÇÃO: Durante manutenção, dados de conta não estão disponíveis
      if (!Account) {
        const DepressurizationManager = await import('../Utils/DepressurizationManager.js');
        if (DepressurizationManager.default.isSystemInMaintenance()) {
          Logger.debug(
            `🚫 [TRAILING_SKIP] Monitor pausado durante manutenção - dados de conta indisponíveis`
          );
        } else {
          Logger.error(`❌ [TRAILING_MONITOR] Dados da conta não disponíveis`);
        }
        return;
      }

      for (const position of activePositions) {
        // Stop loss é gerenciado pela corretora através das orders criadas
        // Não fechamos manualmente por stop loss - apenas monitoramos

        // 📡 SISTEMA REATIVO: Subscribe posição para monitoramento em tempo real (se não estiver já subscrito)
        if (enableTrailingStop && TrailingStop.backpackWS && TrailingStop.backpackWS.connected) {
          // Verifica se já está subscrito para evitar spam de subscriptions
          if (!TrailingStop.backpackWS.subscribedSymbols.has(position.symbol)) {
            const subscribed = await TrailingStop.subscribePositionReactive(
              position,
              Account,
              this.config,
              this
            );
            if (subscribed) {
              Logger.debug(
                `📡 [REACTIVE_TRAILING] ${position.symbol}: Monitoramento reativo ativado`
              );
              // Continua para próxima posição - o sistema reativo cuidará dela
              continue;
            } else {
              Logger.debug(
                `⚠️ [REACTIVE_TRAILING] ${position.symbol}: Fallback para método tradicional`
              );
            }
          } else {
            Logger.debug(
              `📡 [REACTIVE_TRAILING] ${position.symbol}: Já subscrito - sistema reativo já ativo`
            );
            continue; // Já está sendo monitorado pelo sistema reativo
          }
        }

        // Profit parcial é gerenciado pela corretora através das orders criadas
        // Não fechamos manualmente - apenas monitoramos

        const trailingStateMap = this.getTrailingState();
        const positionState = trailingStateMap.get(position.symbol);
        const currentPrice = parseFloat(position.markPrice);

        if (positionState && positionState.strategyName === 'AlphaFlowStrategy') {
          // Modo ALPHA FLOW: Verifica apenas o alvo de TP fixo calculado pela estratégia
          Logger.debug(
            `📋 [PROFIT_MODE] ${position.symbol}: Modo Alpha Flow ativo. Verificando alvo de TP fixo...`
          );

          // Obtenha o 'targetPrice' que foi salvo quando a ordem foi criada
          const targetPrice = positionState.takeProfitPrice;

          if (targetPrice) {
            const isLong = parseFloat(position.netQuantity) > 0;
            const isShort = parseFloat(position.netQuantity) < 0;

            if (
              (isLong && currentPrice >= targetPrice) ||
              (isShort && currentPrice <= targetPrice)
            ) {
              Logger.info(
                `🎯 [PROFIT_TARGET] ${position.symbol}: Alvo de preço da Alpha Flow atingido! Fechando posição.`
              );
              const result = await TrailingStop.protectedForceClose(
                position,
                Account,
                this.config,
                'alpha_flow_target'
              );
              if (result.success) {
                await TrailingStop.onPositionClosed(position, 'alpha_flow_target');
              } else if (result.reason === 'already_closing') {
                // Se o fechamento já está em progresso, pula para evitar loop infinito
                // mas não chama onPositionClosed para evitar limpeza prematura
                Logger.debug(
                  `⏭️ [ALPHA_FLOW_TARGET] ${position.symbol}: Pulando - fechamento em progresso`
                );
              }
              continue;
            }
          } else {
            Logger.debug(
              `⚠️ [PROFIT_MODE] ${position.symbol}: Alvo de TP não encontrado no estado da posição`
            );
          }

          // Para Alpha Flow, pula as verificações de profit mínimo e configurado
          Logger.debug(
            `📋 [PROFIT_MODE] ${position.symbol}: Alpha Flow - aguardando alvo específico...`
          );
        } else {
          // Modo DEFAULT ou outros: Usa a lógica antiga de PROFIT_CHECK e Trailing Stop
          Logger.debug(
            `📋 [PROFIT_MODE] ${position.symbol}: Modo ${positionState?.strategyName || 'DEFAULT'} ativo.`
          );

          if (enableTrailingStop) {
            const trailingModeLogged = this.getTrailingModeLogged();
            if (!trailingModeLogged.has(position.symbol)) {
              Logger.debug(`🎯 [TRAILING_MODE] ${position.symbol}: Modo Trailing Stop ativo`);
              trailingModeLogged.add(position.symbol);
            }

            await this.updateTrailingStopForPosition(position);

            const trailingState = trailingStateMap.get(position.symbol);

            if (trailingState && trailingState.activated) {
              const priceType = position.markPrice ? 'Current Price' : 'Last Price';
              const distance = trailingState.isLong
                ? (
                    ((currentPrice - (trailingState.trailingStopPrice || 0)) / currentPrice) *
                    100
                  ).toFixed(2)
                : (
                    (((trailingState.trailingStopPrice || 0) - currentPrice) / currentPrice) *
                    100
                  ).toFixed(2);

              const direction = trailingState.isLong ? 'LONG' : 'SHORT';
              const priceRecordLabel = trailingState.isLong ? 'Preço Máximo' : 'Preço Mínimo';
              const priceRecordValue = trailingState.isLong
                ? trailingState.highestPrice
                : trailingState.lowestPrice;

              // Cache para evitar logs repetidos do trailing ativo
              const logCacheKey = `${position.symbol}_trailing_active`;
              const now = Date.now();
              const lastLogTime = TrailingStop.logCache?.get(logCacheKey) || 0;

              // Log apenas a cada 10 segundos para reduzir spam
              if (now - lastLogTime > 10000) {
                if (!TrailingStop.logCache) {
                  TrailingStop.logCache = new Map();
                }
                TrailingStop.logCache.set(logCacheKey, now);

                TrailingStop.colorLogger.trailingActive(
                  `${position.symbol} (${direction}): Trailing ativo - ` +
                    `${priceType}: $${currentPrice.toFixed(4)}, ` +
                    `TrailingStop: $${trailingState.trailingStopPrice?.toFixed(4) || 'N/A'}, ` +
                    `${priceRecordLabel}: $${priceRecordValue?.toFixed(4) || 'N/A'}, ` +
                    `Distância até Stop: ${distance}%\n`
                );
              }
            } else {
              const priceType = position.markPrice ? 'Current Price' : 'Last Price';
              const pnl = TrailingStop.calculatePnL(position, Account);
              const entryPrice = parseFloat(position.entryPrice || position.price);

              if (pnl.pnlPct < 0) {
                TrailingStop.colorLogger.trailingWaitingProfitable(
                  `${position.symbol}: Trailing Stop aguardando posição ficar lucrativa - ${priceType}: $${currentPrice.toFixed(4)}, Preço de Entrada: $${entryPrice.toFixed(4)}, PnL: ${pnl.pnlPct.toFixed(2)}% (prejuízo)\n`
                );
              } else {
                TrailingStop.colorLogger.trailingWaitingActivation(
                  `${position.symbol}: Trailing Stop aguardando ativação - ${priceType}: $${currentPrice.toFixed(4)}, Preço de Entrada: $${entryPrice.toFixed(4)}, PnL: ${pnl.pnlPct.toFixed(2)}%\n`
                );
              }
            }
          } else {
            TrailingStop.colorLogger.profitFixed(`${position.symbol}: Modo Take Profit fixo ativo`);

            if (await this.shouldCloseForConfiguredProfit(position)) {
              TrailingStop.colorLogger.positionClosed(
                `💰 [PROFIT_CONFIGURED] ${position.symbol}: Fechando por profit mínimo configurado`
              );
              const result = await TrailingStop.protectedForceClose(
                position,
                Account,
                this.config,
                'profit_configured'
              );
              if (result.success) {
                await TrailingStop.onPositionClosed(position, 'profit_configured');
              } else if (result.reason === 'already_closing') {
                // Se o fechamento já está em progresso, pula para evitar loop infinito
                // mas não chama onPositionClosed para evitar limpeza prematura
                Logger.debug(
                  `⏭️ [PROFIT_CONFIGURED] ${position.symbol}: Pulando - fechamento em progresso`
                );
              }
              continue;
            }

            // Stop loss emergencial é gerenciado pela corretora através das orders criadas
            // Não fechamos manualmente - apenas monitoramos

            const adxCrossoverDecision = await this.checkADXCrossover(position);
            if (adxCrossoverDecision && adxCrossoverDecision.shouldClose) {
              TrailingStop.colorLogger.positionClosed(
                `📈 [ADX_CROSSOVER] ${position.symbol}: ${adxCrossoverDecision.reason}`
              );
              const result = await TrailingStop.protectedForceClose(
                position,
                Account,
                this.config,
                'adx_crossover'
              );
              if (result.success) {
                await TrailingStop.onPositionClosed(position, 'adx_crossover');
              } else if (result.reason === 'already_closing') {
                // Se o fechamento já está em progresso, pula para evitar loop infinito
                // mas não chama onPositionClosed para evitar limpeza prematura
                Logger.debug(
                  `⏭️ [ADX_CROSSOVER] ${position.symbol}: Pulando - fechamento em progresso`
                );
              }
              continue;
            }

            const priceType = position.markPrice ? 'Current Price' : 'Last Price';
            const pnl = TrailingStop.calculatePnL(position, Account);
            const entryPrice = parseFloat(position.entryPrice || 0);
            TrailingStop.colorLogger.profitMonitor(
              `${position.symbol}: Take Profit fixo - ${priceType}: $${currentPrice.toFixed(4)}, Preço de Entrada: $${entryPrice.toFixed(4)}, PnL: ${pnl.pnlPct.toFixed(2)}%\n`
            );
          }
        }

        try {
          // 🚫 VERIFICAÇÃO: Account pode ser null durante manutenção
          if (!Account || !Account.markets) {
            const DepressurizationManager = await import('../Utils/DepressurizationManager.js');
            if (DepressurizationManager.default.isSystemInMaintenance()) {
              Logger.debug(
                `🚫 [FAILSAFE_SKIP] ${position.symbol}: Failsafe pausado durante manutenção`
              );
            } else {
              Logger.error(
                `❌ [FAILSAFE_ERROR] ${position.symbol}: Account inválido para failsafe check`
              );
            }
            continue;
          }

          const marketInfo = Account.markets.find(m => m.symbol === position.symbol);

          if (!marketInfo) {
            TrailingStop.debug(
              `ℹ️ [MANUAL_POSITION] ${position.symbol}: Par não autorizado - pulando criação de stop loss`
            );
          } else {
            // ✅ CORREÇÃO: Só executa failsafe se trailing stop NÃO estiver ativo
            const enableTrailingStop = this.config?.enableTrailingStop || false;
            const trailingStateMap = this.getTrailingState();
            const trailingState = trailingStateMap.get(position.symbol);
            const isTrailingActive = enableTrailingStop && trailingState && trailingState.activated;

            if (isTrailingActive) {
              TrailingStop.debug(
                `🎯 [FAILSAFE_SKIP] ${position.symbol}: Trailing stop ativo - pulando verificação failsafe para evitar conflito`
              );
            } else {
              TrailingStop.debug(
                `🛡️ [FAILSAFE_CHECK] ${position.symbol}: Verificando stop loss de proteção...`
              );
              await TrailingStop.protectedStopLossOperation(
                position,
                this.config,
                'failsafe_check'
              );
            }
          }
        } catch (error) {
          Logger.error(
            `❌ [FAILSAFE_ERROR] Erro ao validar/criar stop loss para ${position.symbol}:`,
            error.message
          );
        }
      }
    } catch (error) {
      Logger.error(`❌ [TRAILING_ERROR] Erro no stopLoss:`, error.message);
      throw error;
    }
  }

  /**
   * Verifica se deve fechar posição baseada no cruzamento do ADX (estratégia PRO_MAX)
   * @param {object} position - Dados da posição
   * @returns {Promise<object|null>} - Decisão de fechamento ou null
   */
  async checkADXCrossover(position) {
    try {
      const strategyType = this.config?.strategy || 'DEFAULT';
      if (strategyType !== 'PRO_MAX') {
        return null;
      }

      const adxTimeframe = this.config?.time || '5m';
      const markets = new Markets();
      const candles = await markets.getKLines(position.symbol, adxTimeframe, 30);

      if (!candles || candles.length < 20) {
        return null;
      }

      const { calculateIndicators } = await import('../Decision/Indicators.js');
      const indicators = await calculateIndicators(candles, adxTimeframe, position.symbol);

      if (!indicators.adx || !indicators.adx.diPlus || !indicators.adx.diMinus) {
        return null;
      }

      const { ProMaxStrategy } = await import('../Decision/Strategies/ProMaxStrategy.js');
      const strategy = new ProMaxStrategy();

      const data = { ...indicators, market: { symbol: position.symbol } };
      const crossoverDecision = strategy.shouldClosePositionByADX(position, data);

      return crossoverDecision;
    } catch (error) {
      Logger.error(
        `[ADX_CROSSOVER] Erro ao verificar crossover para ${position.symbol}:`,
        error.message
      );
      return null;
    }
  }

  /**
   * Verifica se o trailing stop está configurado corretamente
   * @param {object} config - Configuração do bot (opcional)
   * @returns {object} - Status da configuração
   */
  static getTrailingStopConfig(config = null) {
    const enableTrailingStop = config?.enableTrailingStop || false;
    const trailingStopDistance = Number(config?.trailingStopDistance || 2.0);

    return {
      enabled: enableTrailingStop,
      distance: trailingStopDistance,
      isValid: enableTrailingStop && !isNaN(trailingStopDistance) && trailingStopDistance > 0,
      config: {
        ENABLE_TRAILING_STOP: config?.enableTrailingStop || false,
        TRAILING_STOP_DISTANCE: config?.trailingStopDistance || 2.0,
      },
    };
  }

  /**
   * Loga o status da configuração do trailing stop
   * @param {object} config - Configuração do bot (opcional)
   */
  static logTrailingStopConfig(config = null) {
    const configStatus = TrailingStop.getTrailingStopConfig(config);
  }

  /**
   * Gerencia ativamente uma ordem STOP_MARKET real na exchange
   * Implementa a estratégia "cancelar e substituir" para ajustar o preço do stop
   */
  async manageActiveStopOrder(position, newStopPrice, botId = 1) {
    try {
      // Verifica se OrdersService está disponível
      if (!this.ordersService) {
        Logger.warn(
          `⚠️ [ACTIVE_STOP] ${position.symbol}: OrdersService não disponível - usando modo passivo`
        );
        return null;
      }

      const symbol = position.symbol;
      const botKey = TrailingStop.getBotKey(botId);

      // Busca o estado atual do trailing stop
      const currentState = await TrailingStop.loadStateFromDB(botId, symbol);

      if (!currentState) {
        Logger.debug(
          `🔍 [ACTIVE_STOP] ${symbol}: Nenhum estado encontrado - criando primeira ordem stop`
        );
        return await this.createInitialStopOrder(position, newStopPrice, botId);
      }

      const currentStopPrice = parseFloat(currentState.stop_loss_price || 0);
      const activeOrderId = currentState.active_stop_order_id;

      // Determina se é posição LONG ou SHORT
      const netQuantity = parseFloat(position.netQuantity || 0);
      const isLong = netQuantity > 0;
      const isShort = netQuantity < 0;

      // Verifica se o novo preço é mais vantajoso
      const isNewPriceBetter = isLong
        ? newStopPrice > currentStopPrice // Para LONG, stop mais alto é melhor
        : newStopPrice < currentStopPrice; // Para SHORT, stop mais baixo é melhor

      if (!isNewPriceBetter || Math.abs(newStopPrice - currentStopPrice) < 0.0001) {
        Logger.debug(
          `📊 [ACTIVE_STOP] ${symbol}: Preço atual (${currentStopPrice}) já é ótimo, não atualizando`
        );
        return currentState;
      }

      Logger.info(
        `🔄 [ACTIVE_STOP] ${symbol}: Atualizando stop de ${currentStopPrice} para ${newStopPrice}`
      );

      // Etapa 1: Cancelar ordem antiga se existir
      if (activeOrderId) {
        try {
          await this.ordersService.cancelOrder(activeOrderId);
          Logger.debug(`✅ [ACTIVE_STOP] ${symbol}: Ordem antiga ${activeOrderId} cancelada`);
        } catch (cancelError) {
          Logger.warn(
            `⚠️ [ACTIVE_STOP] ${symbol}: Erro ao cancelar ordem ${activeOrderId}: ${cancelError.message}`
          );
          // Continua mesmo se o cancelamento falhar (ordem pode já ter sido executada)
        }
      }

      // Etapa 2: Criar nova ordem STOP_MARKET
      const newOrderResult = await this.createStopMarketOrder(position, newStopPrice);

      if (!newOrderResult || newOrderResult.error) {
        Logger.error(
          `❌ [ACTIVE_STOP] ${symbol}: Falha ao criar nova ordem stop: ${newOrderResult?.error || 'erro desconhecido'}`
        );
        return null;
      }

      // Etapa 3: Salvar novo estado no banco
      const updatedState = {
        ...currentState,
        stop_loss_price: newStopPrice,
        updatedAt: new Date().toISOString(),
      };

      await TrailingStop.setState(botId, symbol, updatedState);

      return updatedState;
    } catch (error) {
      Logger.error(
        `❌ [ACTIVE_STOP] Erro ao gerenciar stop ativo para ${position.symbol}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Cria a primeira ordem stop loss para uma posição
   */
  async createInitialStopOrder(position, stopPrice, botId = 1) {
    try {
      const symbol = position.symbol;

      Logger.info(`🛡️ [ACTIVE_STOP] ${symbol}: Criando primeira ordem stop em ${stopPrice}`);

      const orderResult = await this.createStopMarketOrder(position, stopPrice);

      if (!orderResult || orderResult.error) {
        Logger.error(
          `❌ [ACTIVE_STOP] ${symbol}: Falha ao criar ordem stop inicial: ${orderResult?.error || 'erro desconhecido'}`
        );
        return null;
      }

      const orderId = orderResult.id || orderResult.orderId;

      // Salva estado inicial no banco
      const initialState = {
        symbol,
        botId,
        stop_loss_price: stopPrice,
        active_stop_order_id: orderId,
        trailing_enabled: true,
        updatedAt: new Date().toISOString(),
      };

      await TrailingStop.setState(botId.toString(), symbol, initialState);

      return initialState;
    } catch (error) {
      Logger.error(
        `❌ [ACTIVE_STOP] Erro ao criar ordem stop inicial para ${position.symbol}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Cria uma ordem STOP_MARKET usando o OrdersService
   */
  async createStopMarketOrder(position, stopPrice) {
    try {
      const netQuantity = Math.abs(parseFloat(position.netQuantity || 0));
      const isLong = parseFloat(position.netQuantity || 0) > 0;

      const orderBody = {
        symbol: position.symbol,
        side: isLong ? 'SELL' : 'BUY', // Ordem reversa para fechar posição
        orderType: 'STOP_MARKET',
        quantity: netQuantity.toString(),
        triggerPrice: stopPrice.toString(),
        reduceOnly: true,
        timeInForce: 'GTC',
      };

      Logger.debug(`🔧 [ACTIVE_STOP] Criando ordem STOP_MARKET:`, orderBody);

      // Usa OrdersService para enviar a ordem
      const result = await this.ordersService.createOrder(orderBody, this.config);

      return result;
    } catch (error) {
      Logger.error(`❌ [ACTIVE_STOP] Erro ao criar ordem STOP_MARKET: ${error.message}`);
      return { error: error.message };
    }
  }
}

const trailingStopInstance = new TrailingStop('DEFAULT');

trailingStopInstance.saveStateToDB = TrailingStop.createTrailingStopOrder;
trailingStopInstance.loadStateFromDB = TrailingStop.loadStateFromDB;
trailingStopInstance.clearStateFromDB = TrailingStop.clearStateFromDB;
trailingStopInstance.clearTrailingState = TrailingStop.clearTrailingState;
trailingStopInstance.cleanOrphanedTrailingStates = TrailingStop.cleanOrphanedTrailingStates;
trailingStopInstance.onPositionClosed = TrailingStop.onPositionClosed;
trailingStopInstance.calculatePnL = TrailingStop.calculatePnL;
trailingStopInstance.calculateInitialStopLossPrice = TrailingStop.calculateInitialStopLossPrice;
trailingStopInstance.debug = TrailingStop.debug;
trailingStopInstance.getTrailingStopConfig = TrailingStop.getTrailingStopConfig;
trailingStopInstance.logTrailingStopConfig = TrailingStop.logTrailingStopConfig;
trailingStopInstance.cleanupObsoleteStates = TrailingStop.cleanupObsoleteStates;
trailingStopInstance.forceCleanupAllStates = TrailingStop.forceCleanupAllStates;

export default TrailingStop;
