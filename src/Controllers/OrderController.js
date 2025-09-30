// 🔧 MIGRAÇÃO PARA EXCHANGE FACTORY
import ExchangeManager from '../Exchange/ExchangeManager.js';
import AccountController from './AccountController.js';
import Utils, { validateLeverageForSymbol } from '../Utils/Utils.js';
import TrailingStop from '../TrailingStop/TrailingStop.js';
import ConfigManagerSQLite from '../Config/ConfigManagerSQLite.js';
import BotOrdersManager from '../Config/BotOrdersManager.js';
import Logger from '../Utils/Logger.js';
import Semaphore from '../Utils/Semaphore.js';
import { calculateIndicators } from '../Decision/Indicators.js';
import { ProMaxStrategy } from '../Decision/Strategies/ProMaxStrategy.js';
import OrdersService from '../Services/OrdersService.js';
import RiskManager from '../Risk/RiskManager.js';
import PositionUtils from '../Utils/PositionUtils.js';
import CacheInvalidator from '../Utils/CacheInvalidator.js';
import StopLossUtilsModule from '../Utils/PositionUtils.js';
import QuantityCalculator from '../Utils/QuantityCalculator.js';
import OrderBookAnalyzer from '../Utils/OrderBookAnalyzer.js';
import LimitOrderValidator from '../Utils/LimitOrderValidator.js';

class OrderController {
  // Instância centralizada do OrdersService
  static ordersService = new OrdersService();

  // Armazena ordens de entrada pendentes para monitoramento POR BOT (apenas estratégia PRO_MAX)
  static pendingEntryOrdersByBot = {};

  // Contador de tentativas de stop loss por símbolo
  static stopLossAttempts = null;

  // Cache de posições que já foram validadas para stop loss
  static validatedStopLossPositions = new Set();

  // Lock para criação de stop loss (evita múltiplas criações simultâneas)
  static stopLossCreationInProgress = new Set(); // Armazena os símbolos que estão com uma criação de SL em andamento

  // Lock para criação de take profit (evita múltiplas criações simultâneas)
  static takeProfitCreationInProgress = new Set(); // Armazena os símbolos que estão com uma criação de TP em andamento

  // Cache de verificação de stop loss para evitar múltiplas chamadas desnecessárias
  static stopLossCheckCache = new Map(); // { symbol: { lastCheck: timestamp, hasStopLoss: boolean } }
  static stopLossCheckCacheTimeout = 30000; // 30 segundos de cache

  // Cache de verificação de take profit para evitar múltiplas chamadas desnecessárias
  static takeProfitCheckCache = new Map(); // { symbol: { lastCheck: timestamp, hasTakeProfit: boolean } }
  static takeProfitCheckCacheTimeout = 30000; // 30 segundos de cache
  static marketInfo;

  // Sistema de rastreamento de timeouts ativos para cancelamento adequado
  static activeTimeouts = new Map(); // { timeoutId: { symbol, description, timestamp } }

  // 🔧 Exchange Manager para migração gradual
  static exchangeManagerCache = new Map(); // Cache de ExchangeManager por config

  /**
   * 🔧 MIGRAÇÃO: Obtém ExchangeManager configurado para uma config específica
   * @param {object} config - Configuração do bot
   * @returns {ExchangeManager} - Instância configurada do ExchangeManager
   */
  static getExchangeManager(config) {
    const exchangeName = config?.exchangeName || config?.exchange || 'backpack';
    const cacheKey = `${exchangeName}_${config?.apiKey || 'default'}`;

    if (!OrderController.exchangeManagerCache.has(cacheKey)) {
      const exchangeManager = ExchangeManager.createFromConfig(config);
      OrderController.exchangeManagerCache.set(cacheKey, exchangeManager);
      Logger.debug(`🔄 [OrderController] ExchangeManager criado para ${exchangeName}`);
    }

    return OrderController.exchangeManagerCache.get(cacheKey);
  }

  /**
   * Cria um timeout rastreado que pode ser cancelado
   * @param {Function} callback - Função a ser executada
   * @param {number} delay - Delay em milliseconds
   * @param {string} symbol - Símbolo relacionado
   * @param {string} description - Descrição do timeout
   * @returns {NodeJS.Timeout} - ID do timeout
   */
  static createTrackedTimeout(callback, delay, symbol, description = 'Unknown') {
    const timeoutId = setTimeout(() => {
      // Remove do rastreamento quando executar
      OrderController.activeTimeouts.delete(timeoutId);
      callback();
    }, delay);

    // Adiciona ao rastreamento
    OrderController.activeTimeouts.set(timeoutId, {
      symbol,
      description,
      timestamp: Date.now(),
      delay,
    });

    Logger.debug(`⏱️ [TIMEOUT_TRACKER] Criado timeout para ${symbol}: ${description} (${delay}ms)`);
    return timeoutId;
  }

  /**
   * Cancela todos os timeouts ativos
   */
  static cancelAllActiveTimeouts() {
    const count = OrderController.activeTimeouts.size;
    if (count > 0) {
      Logger.info(`🚫 [TIMEOUT_TRACKER] Cancelando ${count} timeouts ativos...`);

      for (const [timeoutId, info] of OrderController.activeTimeouts.entries()) {
        clearTimeout(timeoutId);
        Logger.debug(`🚫 [TIMEOUT_TRACKER] Cancelado: ${info.symbol} - ${info.description}`);
      }

      OrderController.activeTimeouts.clear();
      Logger.info(`✅ [TIMEOUT_TRACKER] Todos os timeouts foram cancelados`);
    }
  }

  /**
   * Cancela timeouts específicos de um símbolo
   * @param {string} symbol - Símbolo para cancelar timeouts
   */
  static cancelTimeoutsForSymbol(symbol) {
    const timeoutsToCancel = [];

    for (const [timeoutId, info] of OrderController.activeTimeouts.entries()) {
      if (info.symbol === symbol) {
        timeoutsToCancel.push(timeoutId);
      }
    }

    if (timeoutsToCancel.length > 0) {
      Logger.info(
        `🚫 [TIMEOUT_TRACKER] Cancelando ${timeoutsToCancel.length} timeouts para ${symbol}`
      );

      for (const timeoutId of timeoutsToCancel) {
        const info = OrderController.activeTimeouts.get(timeoutId);
        clearTimeout(timeoutId);
        OrderController.activeTimeouts.delete(timeoutId);
        Logger.debug(`🚫 [TIMEOUT_TRACKER] Cancelado: ${symbol} - ${info.description}`);
      }
    }
  }

  /**
   * Formata preço de forma segura, limitando a 6 casas decimais para evitar erro "Price decimal too long"
   * @param {number} value - Valor a ser formatado
   * @param {number} decimal_price - Número de casas decimais desejado
   * @param {number} tickSize - Tamanho do tick para validação
   * @returns {string} - Preço formatado como string
   */
  static formatPriceSafely(value, decimal_price, tickSize = null) {
    // Limita decimal_price a 6 casas decimais para evitar erro da API
    const safeDecimalPrice = Math.min(decimal_price, 6);
    let formattedPrice = parseFloat(value).toFixed(safeDecimalPrice);

    // Se temos tickSize, valida se o preço é múltiplo do tickSize
    if (tickSize && tickSize > 0) {
      const price = parseFloat(formattedPrice);
      const remainder = price % tickSize;

      // Se não é múltiplo exato, ajusta para o múltiplo mais próximo
      if (remainder !== 0) {
        const adjustedPrice = Math.round(price / tickSize) * tickSize;
        formattedPrice = adjustedPrice.toFixed(safeDecimalPrice);
        Logger.warn(
          `⚠️ [PRICE_ADJUST] Preço ${price} não é múltiplo de ${tickSize}, ajustado para ${adjustedPrice}`
        );
      }
    }

    return formattedPrice.toString();
  }

  /**
   * Gera um ID único de ordem para um bot
   * @param {object} config - Configuração do bot
   * @returns {number} ID único da ordem como Int (ex: 1548001)
   */
  static async generateUniqueOrderId(config) {
    try {
      // Se temos o config, usamos diretamente o botClientOrderId
      if (config && config.botClientOrderId) {
        const orderId = await ConfigManagerSQLite.getNextOrderId(config.id);
        Logger.debug(
          `🆔 [ORDER_ID] Gerado ID único usando config: ${orderId} (Bot ID: ${config.id}, botClientOrderId: ${config.botClientOrderId})`
        );
        // Converte para número inteiro para compatibilidade com a API da Backpack
        // Garante que orderId seja uma string antes de usar replace()
        const orderIdStr = String(orderId);
        const numericId = parseInt(orderIdStr.replace(/_/g, ''));
        Logger.debug(`🆔 [ORDER_ID] ID convertido para número: ${numericId}`);
        return numericId;
      }

      // Fallback: tenta obter o bot por nome se config não for null
      if (config && config.id) {
        const botConfig = await ConfigManagerSQLite.getBotConfigByBotName(config.id);
        if (botConfig && botConfig.id) {
          const orderId = await ConfigManagerSQLite.getNextOrderId(botConfig.id);
          Logger.debug(
            `🆔 [ORDER_ID] Gerado ID único por nome: ${orderId} (Bot ID: ${botConfig.id})`
          );
          const orderIdStr = String(orderId);
          const numericId = parseInt(orderIdStr.replace(/_/g, ''));
          Logger.debug(`🆔 [ORDER_ID] ID convertido para número: ${numericId}`);
          return numericId;
        }
      }

      // Se não conseguiu gerar ID único, ERRO - não deve gerar aleatório
      throw new Error(
        `Não foi possível gerar ID único. Config ou botClientOrderId não encontrado.`
      );
    } catch (error) {
      Logger.error(`❌ [ORDER_ID] Erro ao gerar ID único:`, error.message);
      // Em vez de parar o bot, gera um ID de emergência baseado no timestamp
      const emergencyId = Math.floor(Date.now() / 1000) % 1000000;
      Logger.warn(`⚠️ [ORDER_ID] Usando ID de emergência: ${emergencyId}`);
      return emergencyId;
    }
  }

  /**
   * Gera ID único para ordens de take profit
   */
  static async generateTakeProfitOrderId(config, targetIndex = 0) {
    try {
      const baseId = await this.generateUniqueOrderId(config);
      // Adiciona sufixo para identificar que é take profit
      return parseInt(`${baseId}${targetIndex + 1}`);
    } catch (error) {
      Logger.error(`❌ [ORDER_ID] Erro ao gerar ID para take profit:`, error.message);
      // Em vez de parar o bot, gera um ID de emergência
      const emergencyId = (Math.floor(Date.now() / 1000) % 1000000) + (targetIndex + 1);
      Logger.warn(`⚠️ [ORDER_ID] Usando ID de emergência para take profit: ${emergencyId}`);
      return emergencyId;
    }
  }

  /**
   * Gera ID único para ordens de stop loss
   */
  static async generateStopLossOrderId(config) {
    try {
      const baseId = await this.generateUniqueOrderId(config);
      return parseInt(`${baseId}999`);
    } catch (error) {
      Logger.error(`❌ [ORDER_ID] Erro ao gerar ID para stop loss:`, error.message);
      const emergencyId = (Math.floor(Date.now() / 1000) % 1000000) + 999;
      Logger.warn(`⚠️ [ORDER_ID] Usando ID de emergência para stop loss: ${emergencyId}`);
      return emergencyId;
    }
  }

  /**
   * Gera ID único para ordens de failsafe
   */
  static async generateFailsafeOrderId(config, type = 'stop') {
    try {
      const baseId = await this.generateUniqueOrderId(config);
      // Adiciona sufixo para identificar que é failsafe
      const suffix = type === 'stop' ? '1001' : '1002';
      return parseInt(`${baseId}${suffix}`);
    } catch (error) {
      Logger.error(`❌ [ORDER_ID] Erro ao gerar ID para failsafe:`, error.message);
      // Em vez de parar o bot, gera um ID de emergência
      const emergencyId =
        (Math.floor(Date.now() / 1000) % 1000000) + (type === 'stop' ? 1001 : 1002);
      Logger.warn(`⚠️ [ORDER_ID] Usando ID de emergência para failsafe: ${emergencyId}`);
      return emergencyId;
    }
  }

  /**
   * Recupera todas as ordens de um bot específico por ID
   * @param {number} botId - ID do bot
   * @param {object} config - Configurações do bot
   * @returns {Array} Lista de ordens do bot
   */
  static async getBotOrdersById(botId, config = null) {
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }

      // Obtém todas as ordens da exchange
      Logger.debug(
        `🔍 [BOT_ORDERS] Buscando todas as ordens da conta para filtrar por bot ID: ${botId}`
      );
      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
      const exchangeManager = OrderController.getExchangeManager(config);
      const allOrders = await exchangeManager.getOpenOrdersForSymbol(null, config.apiKey, config.apiSecret);

      if (!allOrders || allOrders.length === 0) {
        Logger.debug(`📋 [BOT_ORDERS] Nenhuma ordem encontrada na conta`);
        return [];
      }

      Logger.debug(`📋 [BOT_ORDERS] Total de ordens na conta: ${allOrders.length}`);

      // Obtém configuração do bot por ID
      const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
      if (!botConfig || !botConfig.botClientOrderId) {
        Logger.warn(`⚠️ [BOT_ORDERS] Bot ID ${botId} não encontrado ou sem botClientOrderId`);
        return [];
      }

      Logger.debug(
        `🔍 [BOT_ORDERS] Filtrando ordens para bot: ${botConfig.botName} (botClientOrderId: ${botConfig.botClientOrderId})`
      );

      // Filtra ordens do bot específico usando botClientOrderId e validação de tempo
      const botOrders = allOrders.filter(order => {
        // Usa a validação centralizada
        return OrderController.validateOrderForImport(order, botConfig);
      });

      Logger.debug(
        `📋 [BOT_ORDERS] Encontradas ${botOrders.length} ordens para bot ID ${botId} (${botConfig.botName})`
      );

      // Log detalhado das ordens encontradas
      botOrders.forEach(order => {
        Logger.debug(
          `   📄 [BOT_ORDERS] ${order.symbol}: ${order.orderType} ${order.side} @ ${order.price} (ID: ${order.clientId})`
        );
      });

      return botOrders;
    } catch (error) {
      Logger.error(`❌ [BOT_ORDERS] Erro ao recuperar ordens do bot ID ${botId}:`, error.message);
      return [];
    }
  }

  /**
   * Recupera todas as ordens de um bot específico (método legado por nome)
   * @param {string} botName - Nome do bot
   * @param {object} config - Configurações do bot
   * @returns {Array} Lista de ordens do bot
   */
  static async getBotOrders(botName, config = null) {
    try {
      // Busca configuração do bot por nome
      const botConfig = await ConfigManagerSQLite.getBotConfigByBotName(botName);
      if (!botConfig) {
        Logger.warn(`⚠️ [BOT_ORDERS] Bot ${botName} não encontrado`);
        return [];
      }

      // Usa o método por ID
      return await OrderController.getBotOrdersById(botConfig.id, config);
    } catch (error) {
      Logger.error(`❌ [BOT_ORDERS] Erro ao recuperar ordens de ${botName}:`, error.message);
      return [];
    }
  }

  /**
   * Recupera todas as ordens de todos os bots
   * @param {object} config - Configurações do bot (para credenciais)
   * @returns {object} Objeto com ordens organizadas por bot
   */
  static async getAllBotsOrders(config = null) {
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }

      // Obtém todas as ordens da exchange
      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
      const exchangeManager = OrderController.getExchangeManager(config);
      const allOrders = await exchangeManager.getOpenOrdersForSymbol(null, config.apiKey, config.apiSecret);
      if (!allOrders || allOrders.length === 0) {
        Logger.debug(`📋 [ALL_BOTS_ORDERS] Nenhuma ordem encontrada`);
        return {};
      }

      // Obtém apenas bots tradicionais (não HFT)
      const allBots = await ConfigManagerSQLite.loadTraditionalBots();
      const botsOrders = {};

      // Para cada bot, filtra suas ordens
      for (const botConfig of allBots) {
        if (!botConfig.botClientOrderId) continue;

        const botOrders = allOrders.filter(order => {
          if (!order.clientId) return false;

          const clientIdStr = order.clientId.toString();
          const botClientOrderIdStr = botConfig.botClientOrderId.toString();

          const isBotOrder = clientIdStr.startsWith(botClientOrderIdStr);

          if (!isBotOrder) return false;

          // Usa a validação centralizada
          return OrderController.validateOrderForImport(order, botConfig);
        });

        if (botOrders.length > 0) {
          botsOrders[botConfig.botName] = {
            botId: botConfig.id,
            strategyName: botConfig.strategyName,
            orders: botOrders,
          };
        }
      }

      Logger.debug(`📋 [ALL_BOTS_ORDERS] Resumo:`);
      Object.keys(botsOrders).forEach(botName => {
        const botData = botsOrders[botName];
        Logger.debug(`   🤖 ${botName} (${botData.strategyName}): ${botData.orders.length} ordens`);
      });

      return botsOrders;
    } catch (error) {
      Logger.error(
        `❌ [ALL_BOTS_ORDERS] Erro ao recuperar ordens de todos os bots:`,
        error.message
      );
      return {};
    }
  }

  /**
   * Valida se uma ordem deve ser importada baseado no tempo de criação do bot
   * @param {Object} order - Dados da ordem
   * @param {Object} botConfig - Configuração do bot
   * @returns {boolean} True se a ordem deve ser importada
   */
  static validateOrderForImport(order, botConfig) {
    const clientIdStr = order.clientId?.toString();
    const botClientOrderIdStr = botConfig.botClientOrderId.toString();

    if (!clientIdStr?.startsWith(botClientOrderIdStr)) {
      Logger.debug(
        `   ⚠️ [ORDER_VALIDATION] Ordem ${order.symbol} ignorada - não pertence ao bot (clientId: ${clientIdStr}, botClientOrderId: ${botClientOrderIdStr})`
      );
      return false;
    }

    // VALIDAÇÃO DE TEMPO: Verifica se a ordem foi criada após a criação do bot
    if (botConfig.createdAt && order.createdAt) {
      const botCreatedAt = new Date(botConfig.createdAt).getTime();
      const orderTime = new Date(order.createdAt).getTime();

      if (orderTime < botCreatedAt) {
        Logger.debug(
          `   ⏰ [ORDER_VALIDATION] Ordem antiga ignorada: ${order.symbol} (ID: ${order.clientId}) - Ordem: ${new Date(orderTime).toISOString()}, Bot criado: ${new Date(botCreatedAt).toISOString()}`
        );
        return false;
      }

      Logger.debug(
        `   ✅ [ORDER_VALIDATION] Ordem válida: ${order.symbol} (ID: ${order.clientId}) - Tempo: ${new Date(orderTime).toISOString()}`
      );
    } else {
      Logger.debug(
        `   ✅ [ORDER_VALIDATION] Ordem do bot encontrada (sem validação de tempo): ${order.symbol} (ID: ${order.clientId})`
      );
    }

    return true;
  }

  /**
   * Adiciona ordem de entrada para monitoramento (apenas estratégia PRO_MAX)
   * @param {string} market - Símbolo do mercado
   * @param {object} orderData - Dados da ordem (stop, isLong, etc.)
   * @param {string} botName - Nome único do bot
   */
  static addPendingEntryOrder(market, orderData, botName = 'DEFAULT') {
    if (!OrderController.pendingEntryOrdersByBot[botName]) {
      OrderController.pendingEntryOrdersByBot[botName] = {};
    }
    // Adiciona timestamp de criação da ordem
    const orderDataWithTimestamp = {
      ...orderData,
      createdAt: Date.now(),
    };
    OrderController.pendingEntryOrdersByBot[botName][market] = orderDataWithTimestamp;
    Logger.debug(`\n[MONITOR-${botName}] Ordem registrada para monitoramento: ${market}`);
  }

  /**
   * Remove ordem de entrada do monitoramento
   * @param {string} market - Símbolo do mercado
   * @param {string} botName - Nome único do bot
   */
  static removePendingEntryOrder(market, botName = 'DEFAULT') {
    if (OrderController.pendingEntryOrdersByBot[botName]) {
      delete OrderController.pendingEntryOrdersByBot[botName][market];
    }
  }

  /**
   * Monitora ordens de entrada pendentes e cria take profits quando executadas
   * @param {string} botName - Nome único do bot para monitorar
   * @param {object} config - Configurações específicas do bot (apiKey, apiSecret, etc.)
   */
  static async monitorPendingEntryOrders(botName = 'DEFAULT', config = null) {
    // Executa para todas as estratégias (DEFAULT e PRO_MAX)
    // A lógica de timeout de ordens é aplicada para todas as contas
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      const accountOrders = OrderController.pendingEntryOrdersByBot[botName];
      if (!accountOrders) {
        // Mesmo sem ordens pendentes, verifica se há posições abertas que precisam de alvos
        await OrderController.checkForUnmonitoredPositions(botName, config);
        return;
      }

      const markets = Object.keys(accountOrders);
      if (markets.length === 0) {
        // Mesmo sem ordens pendentes, verifica se há posições abertas que precisam de alvos
        await OrderController.checkForUnmonitoredPositions(botName, config);
        return;
      }

      // Tenta obter posições com retry
      let positions = [];
      try {
        // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Futures direto
        const exchangeMgr = OrderController.getExchangeManager({ apiKey, apiSecret });
        positions = (await exchangeManager.getFuturesPositions(apiKey, apiSecret)) || [];

        if (positions.length > 0) {
          // Verifica se há posições que não estão sendo monitoradas
          const monitoredMarkets = Object.keys(accountOrders || {});
        }
      } catch (error) {
        Logger.warn(
          `⚠️ [MONITOR-${botName}] Falha ao obter posições, continuando monitoramento...`
        );
        Logger.error(`❌ [MONITOR-${botName}] Erro detalhado:`, error.message);
        positions = [];
      }

      for (const market of markets) {
        const orderData = accountOrders[market];
        const position = positions.find(
          p => p.symbol === market && Math.abs(Number(p.netQuantity)) > 0
        );

        if (position) {
          // Log detalhado de taxa total e PnL atual
          const Account = await AccountController.get({
            apiKey,
            apiSecret,
            strategy: config?.strategyName || 'DEFAULT',
          });

          // ✅ DEFENSIVE CHECK: Se Account ou markets não disponíveis, pula processamento
          if (!Account) {
            Logger.debug(
              `⚠️ [ORDER_MONITOR] ${market}: Dados da conta não disponíveis - pulando processamento`
            );
            continue;
          }

          // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
          const exchangeMgr = OrderController.getExchangeManager({ apiKey, apiSecret });
          const allMarkets = await exchangeManager.getMarkets();
          const marketInfo = allMarkets?.find(m => m.symbol === market);

          // Verifica se marketInfo existe antes de acessar a propriedade fee
          if (!marketInfo) {
            Logger.warn(
              `⚠️ [MONITOR-${botName}] Market info não encontrada para ${market}, usando fee padrão`
            );
            return; // Retorna se não encontrar as informações do mercado
          }

          const fee = marketInfo.fee || config?.fee || 0.0004;
          const entryPrice = parseFloat(
            position.avgEntryPrice || position.entryPrice || position.markPrice
          );
          const currentPrice = parseFloat(position.markPrice);
          const quantity = Math.abs(Number(position.netQuantity));
          const orderValue = entryPrice * quantity;
          const exitValue = currentPrice * quantity;
          const entryFee = orderValue * fee;
          const exitFee = exitValue * fee;
          const totalFee = entryFee + exitFee;

          // Usa a função calculatePnL do TrailingStop para calcular o PnL corretamente
          const leverage = Account.leverage;
          const { pnl, pnlPct } = TrailingStop.calculatePnL(position, Account);

          const percentFee = orderValue > 0 ? (totalFee / orderValue) * 100 : 0;
          OrderController.debug(
            `📋 [MANUAL_POSITION] ${position.symbol} | Volume: $${orderValue.toFixed(2)} | Taxa estimada: $${totalFee.toFixed(6)} (≈ ${percentFee.toFixed(2)}%) | PnL: $${pnl.toFixed(6)} (${pnlPct.toFixed(3)}%) | ⚠️ Par não configurado`
          );
          continue; // Pula criação de ordens para pares não autorizados
        }

        const fee = this.marketInfo.fee || config?.fee || 0.0004;
        const entryPrice = parseFloat(
          position.avgEntryPrice || position.entryPrice || position.markPrice
        );
        const currentPrice = parseFloat(position.markPrice);
        const quantity = Math.abs(Number(position.netQuantity));
        const orderValue = entryPrice * quantity;
        const exitValue = currentPrice * quantity;
        const entryFee = orderValue * fee;
        const exitFee = exitValue * fee;
        const totalFee = entryFee + exitFee;

        // Usa a função calculatePnL do TrailingStop para calcular o PnL corretamente
        const leverage = Account.leverage;
        const { pnl, pnlPct } = TrailingStop.calculatePnL(position, Account);

        const percentFee = orderValue > 0 ? (totalFee / orderValue) * 100 : 0;
        OrderController.debug(
          `[MONITOR][ALL] ${position.symbol} | Volume: $${orderValue.toFixed(2)} | Taxa total estimada (entrada+saída): $${totalFee.toFixed(6)} (≈ ${percentFee.toFixed(2)}%) | PnL atual: $${pnl.toFixed(6)} | PnL%: ${pnlPct.toFixed(3)}%`
        );
      }

      // Verifica se há posições que não estão sendo monitoradas
      const pendingAccountOrders = OrderController.pendingEntryOrdersByBot[botName] || {};
      const monitoredMarkets = Object.keys(pendingAccountOrders);
      const unmonitoredPositions = positions.filter(pos => !monitoredMarkets.includes(pos.symbol));

      if (unmonitoredPositions.length > 0) {
        // Verifica se já foram criados alvos para essas posições (evita loop infinito)
        for (const position of unmonitoredPositions) {
          // Verifica se o par está autorizado antes de tentar criar ordens
          const Account = await AccountController.get({
            apiKey,
            apiSecret,
            strategy: config?.strategyName,
          });

          // Verifica se os dados da conta foram carregados com sucesso
          if (!Account) {
            Logger.warn(
              `⚠️ [WEBSOCKET] Dados da conta indisponíveis para ${position.symbol} - ignorando operação`
            );
            continue;
          }

          // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
          const exchangeManager = OrderController.getExchangeManager({ symbol: position.symbol });
          const markets = await exchangeManager.getMarkets();
          const marketInfo = markets.find(m => m.symbol === position.symbol);

          if (!marketInfo) {
            OrderController.debug(
              `ℹ️ [MANUAL_POSITION] ${position.symbol}: Par não autorizado - pulando criação de ordens automáticas`
            );
            continue; // Pula posições em pares não autorizados
          }

          // SEMPRE valida e cria stop loss para todas as posições AUTORIZADAS
          await OrderController.validateAndCreateStopLoss(position, botName, config);

          // Log de debug para monitoramento
          OrderController.debug(`🛡️ [MONITOR] ${position.symbol}: Stop loss validado/criado`);
        }
      }
    } catch (error) {
      Logger.warn(
        `⚠️ [MONITOR-${botName}] Falha ao verificar posições não monitoradas:`,
        error.message
      );
    }
  }

  /**
   * Lógica dedicada para tratar a criação dos Take Profits após execução da ordem PRO_MAX
   */
  static async handlePositionOpenedForProMax(market, position, orderData, botName, config = null) {
    // Só executa para estratégias PRO_MAX
    if (botName !== 'PRO_MAX') {
      return;
    }
    try {
      // Busca informações do mercado
      // Usa credenciais do config se disponível, senão usa variáveis de ambiente
      const apiKey = config?.apiKey;
      const apiSecret = config?.apiSecret;

      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: config?.strategyName || 'DEFAULT',
      });

      // Verifica se os dados da conta foram carregados com sucesso
      if (!Account) {
        Logger.warn(
          `⚠️ [${config?.botName || 'BOT'}] Dados da conta indisponíveis para ${market} - ignorando operação`
        );
        return;
      }

      // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
      const exchangeManager = OrderController.getExchangeManager({ symbol: market });
      const markets = await exchangeManager.getMarkets();
      const marketInfo = markets.find(m => m.symbol === market);
      if (!marketInfo) {
        Logger.error(`❌ [PRO_MAX] Market info não encontrada para ${market}`);
        return;
      }
      const decimal_quantity = marketInfo.decimal_quantity;
      const decimal_price = marketInfo.decimal_price;
      const stepSize_quantity = marketInfo.stepSize_quantity;
      const tickSize = marketInfo.tickSize;

      // Preço real de entrada
      const entryPrice = parseFloat(
        position.avgEntryPrice || position.entryPrice || position.markPrice
      );
      const isLong = parseFloat(position.netQuantity) > 0;

      // Recalcula os targets usando a estratégia PRO_MAX
      // Importa a estratégia para usar o cálculo
      const strategy = new ProMaxStrategy();
      // Para o cálculo, precisamos de dados de mercado (ATR, etc). Usamos o último candle disponível.
      // Usa o timeframe da ordem ou fallback para configuração
      const timeframe = orderData?.time || config?.time || '5m';
      const marketsAPI = new Markets();
      const candles = await marketsAPI.getKLines(market, timeframe, 30);
      const indicators = await calculateIndicators(candles, timeframe, market);
      const data = { ...indicators, market: marketInfo, marketPrice: entryPrice };
      const action = isLong ? 'long' : 'short';
      const stopAndTargets = strategy.calculateStopAndMultipleTargets(data, entryPrice, action);
      if (!stopAndTargets) {
        Logger.error(`❌ [PRO_MAX] Não foi possível calcular targets para ${market}`);
        return;
      }
      const { stop, targets } = stopAndTargets;
      if (!targets || targets.length === 0) {
        Logger.error(`❌ [PRO_MAX] Nenhum target calculado para ${market}`);
        return;
      }

      // Quantidade total da posição
      const totalQuantity = Math.abs(Number(position.netQuantity));
      // Número máximo de TPs possíveis baseado no step size
      const maxTPs = Math.floor(totalQuantity / stepSize_quantity);
      const nTPs = Math.min(targets.length, maxTPs);

      // Limita pelo número máximo de ordens de take profit definido na configuração
      const maxTakeProfitOrders = config?.maxTakeProfitOrders || 5;
      const finalTPs = Math.min(nTPs, maxTakeProfitOrders);

      if (finalTPs === 0) {
        Logger.error(
          `❌ [PRO_MAX] Posição muito pequena para criar qualquer TP válido para ${market}`
        );
        return;
      }

      // Log explicativo quando são criadas menos ordens do que o esperado
      if (finalTPs < targets.length) {
        Logger.debug(`📊 [PRO_MAX] ${market}: Ajuste de quantidade de TPs:`);
        Logger.debug(`   • Targets calculados: ${targets.length}`);
        Logger.debug(`   • Tamanho da posição: ${totalQuantity}`);
        Logger.debug(`   • Step size mínimo: ${stepSize_quantity}`);
        Logger.debug(
          `   • Máximo de TPs possíveis: ${maxTPs} (${totalQuantity} ÷ ${stepSize_quantity})`
        );
        Logger.debug(`   • Limite configurado: ${maxTakeProfitOrders} (MAX_TAKE_PROFIT_ORDERS)`);
        Logger.debug(`   • TPs que serão criados: ${finalTPs}`);
        if (finalTPs < nTPs) {
          Logger.debug(
            `   • Motivo: Limitado pela configuração MAX_TAKE_PROFIT_ORDERS=${maxTakeProfitOrders}`
          );
        } else {
          Logger.debug(
            `   • Motivo: Posição pequena não permite dividir em ${targets.length} ordens de ${stepSize_quantity} cada`
          );
        }
      }

      const quantities = [];
      let remaining = totalQuantity;

      // Para posições pequenas, tenta criar pelo menos 3 alvos se possível
      const minTargets = Math.min(3, targets.length);
      const actualTargets = Math.max(finalTPs, minTargets);

      for (let i = 0; i < actualTargets; i++) {
        let qty;
        if (i === actualTargets - 1) {
          qty = remaining; // tudo que sobrou
        } else {
          // Para posições pequenas, divide igualmente
          qty = Math.floor(totalQuantity / actualTargets / stepSize_quantity) * stepSize_quantity;
          if (qty < stepSize_quantity) {
            qty = stepSize_quantity;
            // Log quando a quantidade calculada é menor que o step size
            if (actualTargets < targets.length) {
              Logger.debug(
                `   • TP ${i + 1}: Quantidade calculada (${(totalQuantity / actualTargets).toFixed(6)}) < step size (${stepSize_quantity}), ajustado para ${stepSize_quantity}`
              );
            }
          }
          if (qty > remaining) qty = remaining;
        }
        quantities.push(qty);
        remaining -= qty;
      }

      // Ajusta targets para o número real de TPs
      const usedTargets = targets.slice(0, actualTargets);
      const formatPrice = value => parseFloat(value).toFixed(decimal_price).toString();
      const formatQuantity = value => {
        if (value <= 0) {
          throw new Error(`Quantidade deve ser positiva: ${value}`);
        }
        let formatted = parseFloat(value).toFixed(decimal_quantity);
        if (parseFloat(formatted) === 0 && stepSize_quantity > 0) {
          return stepSize_quantity.toString();
        }
        return formatted.toString();
      };
      Logger.info(
        `🎯 [PRO_MAX] ${market}: Criando ${actualTargets} take profits. Quantidades: [${quantities.join(', ')}] (total: ${totalQuantity})`
      );
      // Cria ordens de take profit
      for (let i = 0; i < actualTargets; i++) {
        const targetPrice = parseFloat(usedTargets[i]);

        // 🎯 INTEGRAÇÃO ORDER BOOK: Ajusta preço TP para evitar execução imediata
        const adjustedTPPrice = await OrderBookAnalyzer.findClosestOrderBookPrice(
          market,
          isLong ? 'SELL' : 'BUY', // Lado da ordem de fechamento
          targetPrice,
          1.0 // Max 1% de desvio para TP
        );

        const finalTPPrice = adjustedTPPrice || targetPrice;

        if (adjustedTPPrice && adjustedTPPrice !== targetPrice) {
          Logger.debug(
            `📊 [PRO_MAX] [ORDER_BOOK] TP ${i + 1} ajustado: $${targetPrice.toFixed(6)} → $${adjustedTPPrice.toFixed(6)}`
          );
        }

        const takeProfitTriggerPrice = finalTPPrice;
        const qty = quantities[i];
        const orderBody = {
          symbol: market,
          side: isLong ? 'Ask' : 'Bid',
          orderType: 'Limit',
          postOnly: true,
          reduceOnly: true,
          quantity: formatQuantity(qty),
          price: formatPrice(finalTPPrice), // 🎯 Usa preço ajustado
          takeProfitTriggerBy: 'LastPrice',
          takeProfitTriggerPrice: formatPrice(takeProfitTriggerPrice), // 🎯 Usa preço ajustado
          takeProfitLimitPrice: formatPrice(finalTPPrice), // 🎯 Usa preço ajustado
          timeInForce: 'GTC',
          selfTradePrevention: 'RejectTaker',
          clientId: await OrderController.generateUniqueOrderId(config),
        };
        const result = await OrderController.ordersService.createTakeProfitOrder({
          symbol: market,
          side: orderBody.side,
          quantity: orderBody.quantity,
          takeProfitTriggerPrice: orderBody.takeProfitTriggerPrice,
          takeProfitLimitPrice: orderBody.takeProfitLimitPrice,
          clientId: orderBody.clientId,
          apiKey: config?.apiKey,
          apiSecret: config?.apiSecret,
          additionalParams: {
            takeProfitTriggerBy: orderBody.takeProfitTriggerBy,
            timeInForce: orderBody.timeInForce,
            selfTradePrevention: orderBody.selfTradePrevention,
            postOnly: orderBody.postOnly,
            reduceOnly: orderBody.reduceOnly,
          },
        });
        if (result && !result.error) {
          Logger.info(
            `✅ [PRO_MAX] ${market}: Take Profit ${i + 1}/${actualTargets} criado - Preço: ${targetPrice.toFixed(6)}, Quantidade: ${qty}, OrderID: ${result.id || 'N/A'}`
          );
        } else {
          Logger.error(
            `❌ [PRO_MAX] ${market}: Take Profit ${i + 1}/${actualTargets} FALHOU - Preço: ${targetPrice.toFixed(6)}, Quantidade: ${qty}, Motivo: ${result?.error || 'desconhecido'}`
          );
        }
      }

      // Cria ordem de stop loss simples se necessário
      if (stop !== undefined && !isNaN(parseFloat(stop))) {
        const stopBody = {
          symbol: market,
          side: isLong ? 'Ask' : 'Bid', // Para LONG, vende (Ask) para fechar. Para SHORT, compra (Bid) para fechar
          orderType: 'Limit',
          postOnly: true,
          reduceOnly: true,
          quantity: formatQuantity(totalQuantity),
          price: formatPrice(stop),
          timeInForce: 'GTC',
          clientId: await OrderController.generateUniqueOrderId(config),
        };
        const stopResult = await OrderController.ordersService.createStopLossOrder({
          symbol: market,
          side: stopBody.side,
          quantity: stopBody.quantity,
          stopLossTriggerPrice: stopBody.price,
          stopLossLimitPrice: stopBody.price,
          clientId: stopBody.clientId,
          apiKey: config?.apiKey,
          apiSecret: config?.apiSecret,
          additionalParams: {
            timeInForce: stopBody.timeInForce,
            postOnly: stopBody.postOnly,
            reduceOnly: stopBody.reduceOnly,
          },
        });

        if (stopResult && !stopResult.error) {
          Logger.info(
            `🛡️ [PRO_MAX] ${market}: Stop loss criado - Preço: ${stop.toFixed(6)}, Quantidade: ${totalQuantity}`
          );
        } else {
          Logger.warn(
            `⚠️ [PRO_MAX] ${market}: Não foi possível criar stop loss. Motivo: ${stopResult && stopResult.error ? stopResult.error : 'desconhecido'}`
          );
        }
      }

      // Valida se existe stop loss e cria se necessário
      await OrderController.validateAndCreateStopLoss(position, botName, config);
    } catch (error) {
      Logger.error(`❌ [PRO_MAX] Erro ao processar posição aberta para ${market}:`, error.message);
    }
  }

  /**
   * Força a criação de alvos para posições já abertas que não foram monitoradas
   */
  static async forceCreateTargetsForExistingPosition(position, botName, config = null) {
    // Só executa para estratégias PRO_MAX
    if (botName !== 'PRO_MAX') {
      return;
    }
    try {
      // Usa credenciais do config se disponível
      const apiKey = config?.apiKey;
      const apiSecret = config?.apiSecret;

      if (!apiKey || !apiSecret) {
        Logger.error(`❌ [PRO_MAX] Credenciais de API não fornecidas para ${position.symbol}`);
        return;
      }

      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: config?.strategyName || 'DEFAULT',
      });

      // Verifica se os dados da conta foram carregados com sucesso
      if (!Account) {
        Logger.warn(
          `⚠️ [PRO_MAX] Dados da conta indisponíveis para ${position.symbol} - ignorando operação`
        );
        return;
      }

      // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
      const exchangeManager = OrderController.getExchangeManager({ symbol: position.symbol });
      const markets = await exchangeManager.getMarkets();
      const marketInfo = markets.find(m => m.symbol === position.symbol);
      if (!marketInfo) {
        Logger.error(`❌ [PRO_MAX] Market info não encontrada para ${position.symbol}`);
        return;
      }

      const decimal_quantity = marketInfo.decimal_quantity;
      const decimal_price = marketInfo.decimal_price;
      const stepSize_quantity = marketInfo.stepSize_quantity;

      // Preço real de entrada
      const entryPrice = parseFloat(
        position.avgEntryPrice || position.entryPrice || position.markPrice
      );
      const isLong = parseFloat(position.netQuantity) > 0;

      // Recalcula os targets usando a estratégia PRO_MAX
      const { ProMaxStrategy } = await import('../Decision/Strategies/ProMaxStrategy.js');
      const strategy = new ProMaxStrategy();

      // Usa timeframe da configuração
      const timeframe = config?.time || '5m';
      const marketsAPI = new Markets();
      const candles = await marketsAPI.getKLines(position.symbol, timeframe, 30);
      const indicators = await calculateIndicators(candles, timeframe, position.symbol);
      const data = { ...indicators, market: marketInfo, marketPrice: entryPrice };
      const action = isLong ? 'long' : 'short';

      const stopAndTargets = strategy.calculateStopAndMultipleTargets(data, entryPrice, action);
      if (!stopAndTargets) {
        Logger.error(`❌ [PRO_MAX] Não foi possível calcular targets para ${position.symbol}`);
        return;
      }

      const { stop, targets } = stopAndTargets;
      if (!targets || targets.length === 0) {
        Logger.error(`❌ [PRO_MAX] Nenhum target calculado para ${position.symbol}`);
        return;
      }

      // Quantidade total da posição
      const totalQuantity = Math.abs(Number(position.netQuantity));
      // Número máximo de TPs possíveis baseado no step size
      const maxTPs = Math.floor(totalQuantity / stepSize_quantity);
      const nTPs = Math.min(targets.length, maxTPs);

      // Limita pelo número máximo de ordens de take profit definido na configuração
      const maxTakeProfitOrders = config?.maxTakeProfitOrders || 5;
      const finalTPs = Math.min(nTPs, maxTakeProfitOrders);

      if (finalTPs === 0) {
        Logger.error(
          `❌ [PRO_MAX] Posição muito pequena para criar qualquer TP válido para ${position.symbol}`
        );
        return;
      }

      // Log explicativo quando são criadas menos ordens do que o esperado
      if (finalTPs < targets.length) {
        Logger.debug(`📊 [PRO_MAX] ${position.symbol}: Ajuste de quantidade de TPs:`);
        Logger.debug(`   • Targets calculados: ${targets.length}`);
        Logger.debug(`   • Tamanho da posição: ${totalQuantity}`);
        Logger.debug(`   • Step size mínimo: ${stepSize_quantity}`);
        Logger.debug(
          `   • Máximo de TPs possíveis: ${maxTPs} (${totalQuantity} ÷ ${stepSize_quantity})`
        );
        Logger.debug(`   • Limite configurado: ${maxTakeProfitOrders} (MAX_TAKE_PROFIT_ORDERS)`);
        Logger.debug(`   • TPs que serão criados: ${finalTPs}`);
        if (finalTPs < nTPs) {
          Logger.debug(
            `   • Motivo: Limitado pela configuração MAX_TAKE_PROFIT_ORDERS=${maxTakeProfitOrders}`
          );
        } else {
          Logger.debug(
            `   • Motivo: Posição pequena não permite dividir em ${targets.length} ordens de ${stepSize_quantity} cada`
          );
        }
      }

      const quantities = [];
      let remaining = totalQuantity;

      // Para posições pequenas, tenta criar pelo menos 3 alvos se possível
      const minTargets = Math.min(3, targets.length);
      const actualTargets = Math.max(finalTPs, minTargets);

      for (let i = 0; i < actualTargets; i++) {
        let qty;
        if (i === actualTargets - 1) {
          qty = remaining; // tudo que sobrou
        } else {
          // Para posições pequenas, divide igualmente
          qty = Math.floor(totalQuantity / actualTargets / stepSize_quantity) * stepSize_quantity;
          if (qty < stepSize_quantity) {
            qty = stepSize_quantity;
            // Log quando a quantidade calculada é menor que o step size
            if (actualTargets < targets.length) {
              Logger.debug(
                `   • TP ${i + 1}: Quantidade calculada (${(totalQuantity / actualTargets).toFixed(6)}) < step size (${stepSize_quantity}), ajustado para ${stepSize_quantity}`
              );
            }
          }
          if (qty > remaining) qty = remaining;
        }
        quantities.push(qty);
        remaining -= qty;
      }

      // Ajusta targets para o número real de TPs
      const usedTargets = targets.slice(0, actualTargets);
      const formatPrice = value => parseFloat(value).toFixed(decimal_price).toString();
      const formatQuantity = value => {
        if (value <= 0) {
          throw new Error(`Quantidade deve ser positiva: ${value}`);
        }
        let formatted = parseFloat(value).toFixed(decimal_quantity);
        if (parseFloat(formatted) === 0 && stepSize_quantity > 0) {
          return stepSize_quantity.toString();
        }
        return formatted.toString();
      };

      Logger.debug(
        `\n🎯 [PRO_MAX] ${position.symbol}: Criando ${actualTargets} take profits. Quantidades: [${quantities.join(', ')}] (total: ${totalQuantity})`
      );

      // Cria ordens de take profit
      for (let i = 0; i < actualTargets; i++) {
        const targetPrice = parseFloat(usedTargets[i]);

        // 🎯 INTEGRAÇÃO ORDER BOOK: Ajusta preço TP para evitar execução imediata
        const adjustedTPPrice = await OrderBookAnalyzer.findClosestOrderBookPrice(
          position.symbol,
          isLong ? 'SELL' : 'BUY', // Lado da ordem de fechamento
          targetPrice,
          1.0 // Max 1% de desvio para TP
        );

        const finalTPPrice = adjustedTPPrice || targetPrice;

        if (adjustedTPPrice && adjustedTPPrice !== targetPrice) {
          Logger.debug(
            `📊 [PRO_MAX] [ORDER_BOOK] ${position.symbol} TP ${i + 1} ajustado: $${targetPrice.toFixed(6)} → $${adjustedTPPrice.toFixed(6)}`
          );
        }

        const takeProfitTriggerPrice = finalTPPrice;
        const qty = quantities[i];
        const orderBody = {
          symbol: position.symbol,
          side: isLong ? 'Ask' : 'Bid',
          orderType: 'Limit',
          postOnly: true,
          reduceOnly: true,
          quantity: formatQuantity(qty),
          price: formatPrice(finalTPPrice), // 🎯 Usa preço ajustado
          takeProfitTriggerBy: 'LastPrice',
          takeProfitTriggerPrice: formatPrice(takeProfitTriggerPrice), // 🎯 Usa preço ajustado
          takeProfitLimitPrice: formatPrice(finalTPPrice), // 🎯 Usa preço ajustado
          timeInForce: 'GTC',
          selfTradePrevention: 'RejectTaker',
          clientId: await OrderController.generateUniqueOrderId(config),
        };
        // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
        const exchangeManager = OrderController.getExchangeManager(config);
        const result = await exchangeManager.executeOrder(orderBody, config?.apiKey, config?.apiSecret);
        if (result && !result.error) {
          Logger.debug(
            `✅ [PRO_MAX] ${position.symbol}: Take Profit ${i + 1}/${actualTargets} criado - Preço: ${targetPrice.toFixed(6)}, Quantidade: ${qty}, OrderID: ${result.id || 'N/A'}`
          );
        } else {
          Logger.debug(
            `❌ [PRO_MAX] ${position.symbol}: Take Profit ${i + 1}/${actualTargets} FALHOU - Preço: ${targetPrice.toFixed(6)}, Quantidade: ${qty}, Motivo: ${result?.error || 'desconhecido'}`
          );
        }
      }

      // Cria ordem de stop loss se necessário
      if (stop !== undefined && !isNaN(parseFloat(stop))) {
        // 🎯 INTEGRAÇÃO ORDER BOOK: Ajusta preço SL para evitar execução imediata
        const adjustedSLPrice = await OrderBookAnalyzer.findClosestOrderBookPrice(
          position.symbol,
          isLong ? 'SELL' : 'BUY', // Lado da ordem de fechamento
          stop,
          1.0 // Max 1% de desvio para SL
        );

        const finalSLPrice = adjustedSLPrice || stop;

        if (adjustedSLPrice && adjustedSLPrice !== stop) {
          Logger.debug(
            `📊 [PRO_MAX] [ORDER_BOOK] ${position.symbol} SL ajustado: $${stop.toFixed(6)} → $${adjustedSLPrice.toFixed(6)}`
          );
        }

        const stopLossTriggerPrice = finalSLPrice;
        const stopBody = {
          symbol: position.symbol,
          side: isLong ? 'Ask' : 'Bid',
          orderType: 'Limit',
          postOnly: true,
          reduceOnly: true,
          quantity: formatQuantity(totalQuantity),
          price: formatPrice(finalSLPrice), // 🎯 Usa preço ajustado
          stopLossTriggerBy: 'LastPrice',
          stopLossTriggerPrice: formatPrice(stopLossTriggerPrice), // 🎯 Usa preço ajustado
          stopLossLimitPrice: formatPrice(finalSLPrice), // 🎯 Usa preço ajustado
          timeInForce: 'GTC',
          selfTradePrevention: 'RejectTaker',
          clientId: await OrderController.generateUniqueOrderId(config),
        };
        // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
        const exchangeManager = OrderController.getExchangeManager(config);
        const stopResult = await exchangeManager.executeOrder(stopBody, config?.apiKey, config?.apiSecret);
        if (stopResult) {
          Logger.debug(
            `🛡️ [PRO_MAX] ${position.symbol}: Stop loss criado - Preço: ${stop.toFixed(6)}`
          );
        }
      }

      // Valida se existe stop loss e cria se necessário
      await OrderController.validateAndCreateStopLoss(position, botName, config);
    } catch (error) {
      Logger.error(
        `❌ [PRO_MAX] Erro ao forçar criação de alvos para ${position.symbol}:`,
        error.message
      );
    }
  }

  /**
   * Valida se há margem suficiente para abrir uma ordem
   * @param {string} market - Símbolo do mercado
   * @param {number} volume - Volume em USD
   * @param {object} accountInfo - Informações da conta
   * @param {string} apiKey - API Key do bot
   * @param {string} apiSecret - API Secret do bot
   * @returns {object} - { isValid: boolean, message: string }
   */
  async validateMargin(market, volume, accountInfo, apiKey = null, apiSecret = null) {
    try {
      // Obtém posições abertas para calcular margem em uso
      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Futures direto
      const exchangeManager = OrderController.getExchangeManager({ apiKey, apiSecret });
      const positions = await exchangeManager.getFuturesPositions(apiKey, apiSecret);
      const currentPosition = positions?.find(p => p.symbol === market);

      // Calcula margem necessária para a nova ordem (volume / leverage)
      const requiredMargin = volume / accountInfo.leverage;

      // Calcula margem já em uso
      let usedMargin = 0;
      if (positions && positions.length > 0) {
        usedMargin = positions.reduce((total, pos) => {
          const positionValue = Math.abs(parseFloat(pos.netQuantity) * parseFloat(pos.markPrice));
          return total + positionValue;
        }, 0);
      }

      // Margem disponível (com margem de segurança de 95%)
      const availableMargin = accountInfo.capitalAvailable * 0.95;
      const remainingMargin = availableMargin - usedMargin;

      // Verifica se há margem suficiente
      if (requiredMargin > remainingMargin) {
        return {
          isValid: false,
          message: `Necessário: $${requiredMargin.toFixed(2)}, Disponível: $${remainingMargin.toFixed(2)}, Em uso: $${usedMargin.toFixed(2)}`,
        };
      }

      return {
        isValid: true,
        message: `Margem OK - Disponível: $${remainingMargin.toFixed(2)}, Necessário: $${requiredMargin.toFixed(2)}`,
      };
    } catch (error) {
      Logger.error('❌ Erro na validação de margem:', error.message);
      return {
        isValid: false,
        message: `Erro ao validar margem: ${error.message}`,
      };
    }
  }

  static async cancelPendingOrders(symbol, config = null) {
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Obtém ordens abertas para o símbolo
      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
      const exchangeManager = OrderController.getExchangeManager({ apiKey, apiSecret });
      const openOrders = await exchangeManager.getOpenOrdersForSymbol(symbol, apiKey, apiSecret);

      if (!openOrders || openOrders.length === 0) {
        return true;
      }

      // Filtra apenas ordens de entrada pendentes (não ordens de stop loss ou take profit)
      const pendingEntryOrders = openOrders.filter(order => {
        // Verifica se é uma ordem pendente
        const isPending =
          order.status === 'Pending' ||
          order.status === 'New' ||
          order.status === 'PartiallyFilled';

        // Verifica se NÃO é uma ordem de stop loss ou take profit
        const isNotStopLoss = !order.stopLossTriggerPrice && !order.stopLossLimitPrice;
        const isNotTakeProfit = !order.takeProfitTriggerPrice && !order.takeProfitLimitPrice;

        // Verifica se NÃO é uma ordem reduceOnly (que são ordens de saída)
        const isNotReduceOnly = !order.reduceOnly;

        return isPending && isNotStopLoss && isNotTakeProfit && isNotReduceOnly;
      });

      if (pendingEntryOrders.length === 0) {
        Logger.debug(`ℹ️ ${symbol}: Nenhuma ordem de entrada pendente encontrada para cancelar`);
        return true;
      }

      // Log detalhado das ordens que serão canceladas
      Logger.debug(
        `🔍 ${symbol}: Encontradas ${pendingEntryOrders.length} ordens de entrada pendentes para cancelar:`
      );
      pendingEntryOrders.forEach((order, index) => {
        Logger.debug(
          `   ${index + 1}. ID: ${order.id}, Status: ${order.status}, ReduceOnly: ${order.reduceOnly}, StopLoss: ${!!order.stopLossTriggerPrice}, TakeProfit: ${!!order.takeProfitTriggerPrice}`
        );
      });

      // Cancela apenas as ordens de entrada pendentes específicas
      const cancelPromises = pendingEntryOrders.map(async order => {
        // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
        const cancelResult = await exchangeManager.cancelOpenOrder(
          symbol,
          order.id,
          order.clientId,
          apiKey,
          apiSecret
        );

        // Se cancelamento foi bem-sucedido, atualiza status no banco
        if (cancelResult && !cancelResult.error) {
          try {
            await BotOrdersManager.updateOrder(order.id, {
              status: 'CANCELLED',
              closeTime: new Date().toISOString(),
              closeType: 'PENDING_ENTRY_CLEANUP',
            });
            Logger.debug(
              `📝 [CANCEL_PENDING] ${symbol}: Status da ordem ${order.id} atualizado no banco para CANCELLED`
            );
          } catch (dbError) {
            Logger.warn(
              `⚠️ [CANCEL_PENDING] ${symbol}: Erro ao atualizar status da ordem ${order.id} no banco: ${dbError.message}`
            );
          }
        }

        return cancelResult;
      });

      const cancelResults = await Promise.all(cancelPromises);
      const successfulCancels = cancelResults.filter(
        result => result !== null && !result.error
      ).length;

      if (successfulCancels > 0) {
        Logger.info(
          `🗑️ ${symbol}: ${successfulCancels} ordens de entrada pendentes canceladas com sucesso`
        );
        return true;
      } else {
        Logger.error(`❌ ${symbol}: Falha ao cancelar ordens de entrada pendentes`);
        return false;
      }
    } catch (error) {
      Logger.error(
        `❌ Erro ao cancelar ordens de entrada pendentes para ${symbol}:`,
        error.message
      );
      return false;
    }
  }

  static async forceClose(position, account = null, config = null) {
    // Se account não foi fornecido, obtém da API
    const configWithSymbol = { ...config, symbol: position.symbol };
    const Account = account || (await AccountController.get(configWithSymbol));

    // Log detalhado para debug
    // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
    const exchangeManager = OrderController.getExchangeManager(config || {});
    const allMarkets = await exchangeManager.getMarkets();

    Logger.debug(
      `🔍 [FORCE_CLOSE] Procurando market ${position.symbol} entre ${allMarkets?.length || 0} disponíveis`
    );

    let market = allMarkets.find(el => {
      return el.symbol === position.symbol;
    });

    // Se não encontrou, tenta uma busca case-insensitive
    if (!market) {
      const marketCaseInsensitive = allMarkets.find(el => {
        return el.symbol.toLowerCase() === position.symbol.toLowerCase();
      });
      if (marketCaseInsensitive) {
        Logger.debug(
          `⚠️ [FORCE_CLOSE] Market encontrado com case diferente para ${position.symbol}: ${marketCaseInsensitive.symbol}`
        );
        market = marketCaseInsensitive;
      }
    }

    // Verifica se o market foi encontrado
    if (!market) {
      Logger.error(
        `❌ [FORCE_CLOSE] Market não encontrado para ${position.symbol}. Markets disponíveis: ${allMarkets?.map(m => m.symbol).join(', ') || 'nenhum'}`
      );
      throw new Error(`Market não encontrado para ${position.symbol}`);
    }

    Logger.debug(
      `✅ [FORCE_CLOSE] Market encontrado para ${position.symbol}: decimal_quantity=${market.decimal_quantity}`
    );

    const isLong = parseFloat(position.netQuantity) > 0;
    const quantity = Math.abs(parseFloat(position.netQuantity));
    const decimal = market.decimal_quantity;

    const body = {
      symbol: position.symbol,
      orderType: 'Market',
      side: isLong ? 'Ask' : 'Bid', // Ask if LONG , Bid if SHORT
      reduceOnly: true,
      clientId: await OrderController.generateUniqueOrderId(config),
      quantity: String(quantity.toFixed(decimal)),
    };

    // Fecha a posição
    const closeResult = await OrderController.ordersService.createMarketOrder({
      symbol: position.symbol,
      side: body.side,
      quantity: body.quantity,
      clientId: body.clientId,
      apiKey: config?.apiKey,
      apiSecret: config?.apiSecret,
      additionalParams: {
        reduceOnly: body.reduceOnly,
      },
    });
    // Log detalhado da taxa de fechamento
    const fee = market.fee || config?.fee || 0.0004;
    // Tente obter o preço de execução real
    let closePrice = closeResult?.price || position.markPrice || position.entryPrice;
    const exitValue = parseFloat(body.quantity) * parseFloat(closePrice);
    const exitFee = exitValue * fee;
    Logger.info(
      `[LOG][FEE] Fechamento: ${position.symbol} | Valor: $${exitValue.toFixed(2)} | Fee saída: $${exitFee.toFixed(6)} (${(fee * 100).toFixed(4)}%)`
    );
    // Cancela ordens pendentes para este símbolo
    if (closeResult) {
      await this.cancelPendingOrders(position.symbol, config);
      // Cancela ordens de segurança (failsafe)
      await OrderController.cancelFailsafeOrders(position.symbol, 'DEFAULT', config);

      // Limpa o estado do trailing stop após fechar a posição
      try {
        const TrailingStop = (await import('../TrailingStop/TrailingStop.js')).default;
        TrailingStop.clearTrailingState(position.symbol);
      } catch (error) {
        Logger.error(
          `[FORCE_CLOSE] Erro ao limpar trailing state para ${position.symbol}:`,
          error.message
        );
      }

      // Limpeza automática de ordens órfãs para este símbolo
      try {
        Logger.debug(
          `🧹 [FORCE_CLOSE] ${position.symbol}: Verificando ordens órfãs após fechamento...`
        );
        const orphanResult = await OrderController.monitorAndCleanupOrphanedOrders(
          'DEFAULT',
          config
        );
        if (orphanResult.orphaned > 0) {
          Logger.info(
            `🧹 [FORCE_CLOSE] ${position.symbol}: ${orphanResult.orphaned} ordens órfãs limpas após fechamento`
          );
        }
      } catch (error) {
        Logger.error(
          `[FORCE_CLOSE] Erro ao limpar ordens órfãs para ${position.symbol}:`,
          error.message
        );
      }
    }

    return closeResult;
  }

  /**
   * Realiza take profit parcial de uma posição
   * @param {object} position - Dados da posição
   * @param {number} partialPercentage - Porcentagem da posição para realizar
   * @param {object} account - Dados da conta (opcional)
   * @param {object} config - Configuração do bot (opcional)
   * @returns {boolean} - Sucesso da operação
   */
  static async takePartialProfit(position, partialPercentage = 50, account = null, config = null) {
    try {
      // Se account não foi fornecido, obtém da API
      const Account = account || (await AccountController.get(config));
      // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
      const exchangeManager = OrderController.getExchangeManager(config || {});
      const allMarkets = await exchangeManager.getMarkets();
      const market = allMarkets.find(el => {
        return el.symbol === position.symbol;
      });

      // Verifica se o market foi encontrado
      if (!market) {
        Logger.error(
          `❌ [TAKE_PARTIAL] Market não encontrado para ${position.symbol}. Markets disponíveis: ${allMarkets?.map(m => m.symbol).join(', ') || 'nenhum'}`
        );
        throw new Error(`Market não encontrado para ${position.symbol}`);
      }

      // Usa porcentagem da configuração se não fornecida
      const partialPercentageToUse = partialPercentage || config?.partialTakeProfitPercentage || 50;

      const isLong = parseFloat(position.netQuantity) > 0;
      const totalQuantity = Math.abs(parseFloat(position.netQuantity));
      const partialQuantity = (totalQuantity * partialPercentageToUse) / 100;
      const decimal = market.decimal_quantity;

      const body = {
        symbol: position.symbol,
        orderType: 'Market',
        side: isLong ? 'Ask' : 'Bid', // Ask if LONG , Bid if SHORT
        reduceOnly: true,
        clientId: await OrderController.generateUniqueOrderId(config),
        quantity: String(partialQuantity.toFixed(decimal)),
      };

      // Realiza o take profit parcial
      const partialResult = await OrderController.ordersService.createPartialCloseOrder({
        symbol: position.symbol,
        side: body.side,
        quantity: body.quantity,
        clientId: body.clientId,
        apiKey: config?.apiKey,
        apiSecret: config?.apiSecret,
        additionalParams: {
          reduceOnly: body.reduceOnly,
        },
      });

      if (partialResult) {
        // Se o take profit parcial fechou toda a posição, limpa o trailing state
        const remainingQuantity = totalQuantity - partialQuantity;
        if (remainingQuantity <= 0) {
          try {
            const TrailingStop = (await import('../TrailingStop/TrailingStop.js')).default;
            TrailingStop.clearTrailingState(position.symbol);
          } catch (error) {
            Logger.error(
              `[TAKE_PARTIAL] Erro ao limpar trailing state para ${position.symbol}:`,
              error.message
            );
          }
        }
        return true;
      } else {
        return false;
      }
    } catch (error) {
      Logger.error(
        `❌ Erro ao realizar take profit parcial para ${position.symbol}:`,
        error.message
      );
      return false;
    }
  }

  static async hasPartialTakeProfitOrder(position, config) {
    try {
      const isLong = parseFloat(position.netQuantity) > 0;

      const OrderModule = await import('../Backpack/Authenticated/Order.js');
      const openOrders = await OrderModule.default.getOpenOrders(
        position.symbol,
        'PERP',
        config?.apiKey,
        config?.apiSecret
      );

      if (!openOrders || openOrders.length === 0) {
        return false;
      }

      // Procura por ordem LIMIT reduce-only com a quantidade parcial
      const partialOrder = openOrders.find(order => {
        let isReducePrice;
        if (isLong) {
          isReducePrice =
            parseFloat(order.triggerPrice || order.price) > parseFloat(position.entryPrice);
        } else {
          isReducePrice =
            parseFloat(order.triggerPrice || order.price) < parseFloat(position.entryPrice);
        }

        return order.reduceOnly === true && isReducePrice;
      });

      return !!partialOrder;
    } catch (error) {
      Logger.error(
        `❌ [TP_CHECK] Erro ao verificar ordem de take profit parcial para ${symbol}:`,
        error.message
      );
      return false;
    }
  }

  /**
   * Cria ordem LIMIT de take profit parcial na corretora
   * @param {object} position - Dados da posição
   * @param {number} takeProfitPrice - Preço do take profit
   * @param {number} percentageToClose - Porcentagem da posição para fechar (ex: 50 = 50%)
   * @param {object} account - Dados da conta (opcional)
   * @param config
   * @returns {object|null} - Resultado da operação ou null se falhar
   */
  static async createPartialTakeProfitOrder(
    position,
    takeProfitPrice,
    percentageToClose = 50,
    account = null,
    config = null
  ) {
    try {
      // Se account não foi fornecido, obtém da API
      const Account = account || (await AccountController.get(config));
      // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
      const exchangeManager = OrderController.getExchangeManager(config || {});
      const allMarkets = await exchangeManager.getMarkets();

      let market = allMarkets.find(el => {
        return el.symbol === position.symbol;
      });

      // Se não encontrou, tenta uma busca case-insensitive
      if (!market) {
        const marketCaseInsensitive = allMarkets.find(el => {
          return el.symbol.toLowerCase() === position.symbol.toLowerCase();
        });
        if (marketCaseInsensitive) {
          Logger.info(
            `⚠️ [TP_LIMIT] Market encontrado com case diferente para ${position.symbol}: ${marketCaseInsensitive.symbol}`
          );
          market = marketCaseInsensitive;
        }
      }

      // Verifica se o market foi encontrado
      if (!market) {
        Logger.error(
          `❌ [TP_LIMIT] Market não encontrado para ${position.symbol}. Markets disponíveis: ${allMarkets?.map(m => m.symbol).join(', ') || 'nenhum'}`
        );
        throw new Error(`Market não encontrado para ${position.symbol}`);
      }

      const isLong = parseFloat(position.netQuantity) > 0;
      const totalQuantity = Math.abs(parseFloat(position.netQuantity));
      const quantityToClose = (totalQuantity * percentageToClose) / 100;
      const decimal_quantity = market.decimal_quantity;
      const decimal_price = market.decimal_price;

      Logger.info(`🎯 [TP_LIMIT] ${position.symbol}: Criando ordem LIMIT de take profit parcial`);
      Logger.info(
        `📊 [TP_LIMIT] ${position.symbol}: Preço: $${takeProfitPrice.toFixed(decimal_price)}, Quantidade: ${quantityToClose.toFixed(decimal_quantity)} (${percentageToClose}%)`
      );

      const formatPrice = value => parseFloat(value).toFixed(decimal_price).toString();
      const formatQuantity = value => {
        if (value <= 0) {
          throw new Error(`Quantidade deve ser positiva: ${value}`);
        }
        let formatted = parseFloat(value).toFixed(decimal_quantity);
        if (parseFloat(formatted) === 0 && market.stepSize_quantity > 0) {
          return market.stepSize_quantity.toString();
        }
        return formatted.toString();
      };

      const orderBody = {
        symbol: position.symbol,
        orderType: 'Limit',
        side: isLong ? 'Ask' : 'Bid', // Ask if LONG, Bid if SHORT
        reduceOnly: true,
        quantity: formatQuantity(quantityToClose),
        price: formatPrice(takeProfitPrice),
        timeInForce: 'GTC',
        clientId: await OrderController.generateUniqueOrderId(config),
      };

      Logger.info(`🔄 [TP_LIMIT] ${position.symbol}: Enviando ordem LIMIT para corretora...`);

      const result = await OrderController.ordersService.createLimitOrder({
        symbol: position.symbol,
        side: orderBody.side,
        quantity: orderBody.quantity,
        price: orderBody.price,
        clientId: orderBody.clientId,
        apiKey: config?.apiKey,
        apiSecret: config?.apiSecret,
        additionalParams: {
          timeInForce: orderBody.timeInForce,
          reduceOnly: orderBody.reduceOnly,
        },
      });

      if (result && !result.error) {
        Logger.info(
          `✅ [TP_LIMIT] ${position.symbol}: Ordem LIMIT de take profit parcial criada com sucesso!`
        );
        Logger.info(`   • Order ID: ${result.id || 'N/A'}`);
        Logger.info(`   • Preço: $${takeProfitPrice.toFixed(decimal_price)}`);
        Logger.info(`   • Quantidade: ${quantityToClose.toFixed(decimal_quantity)}`);
        Logger.info(`   • Tipo: ${isLong ? 'LONG' : 'SHORT'}`);
        Logger.info(`   • ReduceOnly: true`);
        Logger.info(`   • OrderType: Limit`);
        return result;
      } else {
        const errorMsg = result && result.error ? result.error : 'desconhecido';
        Logger.error(
          `❌ [TP_LIMIT] ${position.symbol}: Falha ao criar ordem LIMIT - Erro: ${errorMsg}`
        );
        return null;
      }
    } catch (error) {
      Logger.error(
        `❌ [TP_LIMIT] Erro ao criar ordem LIMIT de take profit parcial para ${position.symbol}:`,
        error.message
      );
      return null;
    }
  }

  /**
   * Fecha parcialmente uma posição (usado pela Estratégia Híbrida)
   * @param {object} position - Dados da posição
   * @param {number} percentageToClose - Porcentagem da posição para fechar (ex: 50 = 50%)
   * @param {object} account - Dados da conta (opcional)
   * @returns {object|null} - Resultado da operação ou null se falhar
   */
  static async closePartialPosition(position, percentageToClose, account = null, config = null) {
    try {
      // Se account não foi fornecido, obtém da API
      const Account = account || (await AccountController.get(config));
      // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
      const exchangeManager = OrderController.getExchangeManager(config || {});
      const allMarkets = await exchangeManager.getMarkets();

      // Log detalhado para debug
      Logger.info(`🔍 [CLOSE_PARTIAL] Procurando market para ${position.symbol}`);
      Logger.info(
        `🔍 [CLOSE_PARTIAL] Total de markets disponíveis: ${allMarkets?.length || 0}`
      );

      let market = allMarkets.find(el => {
        return el.symbol === position.symbol;
      });

      // Se não encontrou, tenta uma busca case-insensitive
      if (!market) {
        const marketCaseInsensitive = allMarkets.find(el => {
          return el.symbol.toLowerCase() === position.symbol.toLowerCase();
        });
        if (marketCaseInsensitive) {
          Logger.info(
            `⚠️ [CLOSE_PARTIAL] Market encontrado com case diferente para ${position.symbol}: ${marketCaseInsensitive.symbol}`
          );
          market = marketCaseInsensitive;
        }
      }

      // Verifica se o market foi encontrado
      if (!market) {
        Logger.error(
          `❌ [CLOSE_PARTIAL] Market não encontrado para ${position.symbol}. Markets disponíveis: ${allMarkets?.map(m => m.symbol).join(', ') || 'nenhum'}`
        );
        throw new Error(`Market não encontrado para ${position.symbol}`);
      }

      Logger.info(
        `✅ [CLOSE_PARTIAL] Market encontrado para ${position.symbol}: decimal_quantity=${market.decimal_quantity}`
      );

      const isLong = parseFloat(position.netQuantity) > 0;
      const totalQuantity = Math.abs(parseFloat(position.netQuantity));
      const quantityToClose = (totalQuantity * percentageToClose) / 100;
      const decimal = market.decimal_quantity;

      Logger.info(
        `📊 [CLOSE_PARTIAL] ${position.symbol}: Fechando ${percentageToClose}% da posição`
      );
      Logger.info(
        `📊 [CLOSE_PARTIAL] ${position.symbol}: Quantidade total: ${totalQuantity}, Quantidade a fechar: ${quantityToClose.toFixed(decimal)}`
      );

      const body = {
        symbol: position.symbol,
        orderType: 'Market',
        side: isLong ? 'Ask' : 'Bid', // Ask if LONG , Bid if SHORT
        reduceOnly: true,
        clientId: await OrderController.generateUniqueOrderId(config),
        quantity: String(quantityToClose.toFixed(decimal)),
      };

      // Fecha parcialmente a posição
      // 🔧 MIGRAÇÃO: Reutiliza ExchangeManager já criado acima
      const closeResult = await exchangeManager.executeOrder(body, config?.apiKey, config?.apiSecret);

      if (closeResult) {
        // Log detalhado da taxa de fechamento parcial
        const fee = market.fee || 0.0004;
        let closePrice = closeResult?.price || position.markPrice || position.entryPrice;
        const exitValue = parseFloat(body.quantity) * parseFloat(closePrice);
        const exitFee = exitValue * fee;

        Logger.info(
          `💰 [CLOSE_PARTIAL] ${position.symbol}: Fechamento parcial realizado com sucesso!`
        );
        Logger.info(
          `💰 [CLOSE_PARTIAL] ${position.symbol}: Valor fechado: $${exitValue.toFixed(2)} | Fee: $${exitFee.toFixed(6)} (${(fee * 100).toFixed(4)}%)`
        );
        Logger.info(
          `💰 [CLOSE_PARTIAL] ${position.symbol}: Quantidade restante: ${(totalQuantity - quantityToClose).toFixed(decimal)}`
        );

        return closeResult;
      } else {
        Logger.error(
          `❌ [CLOSE_PARTIAL] ${position.symbol}: Falha ao executar ordem de fechamento parcial`
        );
        return null;
      }
    } catch (error) {
      Logger.error(
        `❌ [CLOSE_PARTIAL] Erro ao fechar parcialmente ${position.symbol}:`,
        error.message
      );
      return null;
    }
  }

  // Função auxiliar para calcular slippage percentual
  static calcSlippagePct(priceLimit, priceCurrent) {
    return (Math.abs(priceCurrent - priceLimit) / priceLimit) * 100;
  }

  // Função auxiliar para revalidar sinal
  static async revalidateSignal({ market, botName, originalSignalData, config = null }) {
    try {
      // Se não temos dados originais do sinal, assume válido
      if (!originalSignalData) {
        Logger.info(
          `ℹ️ [${botName}] ${market}: Sem dados originais para revalidação. Assumindo sinal válido.`
        );
        return true;
      }

      // Usa a estratégia passada como parâmetro
      const strategyNameToUse = botName || config?.strategyName || 'DEFAULT';

      // Importa a estratégia apropriada
      const { StrategyFactory } = await import('../Decision/Strategies/StrategyFactory.js');
      const strategy = StrategyFactory.createStrategy(strategyNameToUse);

      Logger.info(
        `🔍 [${botName}] ${market}: Usando estratégia: ${strategyNameToUse} (${strategy?.constructor?.name || 'NÃO ENCONTRADA'})`
      );

      if (!strategy) {
        Logger.warn(
          `⚠️ [${botName}] ${market}: Estratégia ${strategyNameToUse} não encontrada. Assumindo sinal válido.`
        );
        return true;
      }

      // Obtém dados de mercado atualizados
      const timeframe = originalSignalData.config?.time || config?.time || '5m';
      const markets = new Markets();
      const candles = await markets.getKLines(market, timeframe, 30);

      if (!candles || candles.length < 20) {
        Logger.warn(
          `⚠️ [${botName}] ${market}: Dados insuficientes para revalidação. Assumindo sinal válido.`
        );
        return true;
      }

      // Calcula indicadores atualizados
      const { calculateIndicators } = await import('../Decision/Indicators.js');
      const indicators = await calculateIndicators(candles, timeframe, market);

      // Obtém informações do mercado
      const Account = await AccountController.get(config);

      // Verifica se os dados da conta foram carregados com sucesso
      if (!Account) {
        Logger.warn(
          `⚠️ [${botName}] Dados da conta indisponíveis para ${market} - ignorando operação`
        );
        return null;
      }

      // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
      const exchangeManager = OrderController.getExchangeManager(config || {});
      const allMarkets = await exchangeManager.getMarkets();
      const marketInfo = allMarkets.find(m => m.symbol === market);
      const currentPrice = parseFloat(candles[candles.length - 1].close);

      // Cria dados para análise
      const data = {
        ...indicators,
        market: marketInfo,
        marketPrice: currentPrice,
      };

      // Reanalisa o trade com dados atualizados
      const fee = marketInfo.fee || config?.fee || 0.0004;

      // ✅ USA RISKMANAGER: Calcula investimento baseado no capitalPercentage
      const investmentUSD = RiskManager.calculateInvestmentAmount(Account.capitalAvailable, config);

      const media_rsi = config?.mediaRsi || 50;

      Logger.info(
        `🔍 [${botName}] ${market}: Revalidando com dados atualizados - Preço atual: $${currentPrice.toFixed(6)}, Fee: ${fee}, Investment: $${investmentUSD}`
      );

      const decision = await strategy.analyzeTrade(
        fee,
        data,
        investmentUSD,
        media_rsi,
        originalSignalData.config || {},
        'NEUTRAL' // btcTrend - assume neutro para revalidação
      );

      // Verifica se o sinal ainda é válido
      const originalAction = originalSignalData.action;
      const currentAction = decision?.action;

      // Normaliza as ações para comparação (remove espaços, converte para lowercase)
      const normalizedOriginalAction = originalAction?.toLowerCase()?.trim();
      const normalizedCurrentAction = currentAction?.toLowerCase()?.trim();

      // Se não há decisão atual, significa que não há sinal válido
      if (!decision) {
        Logger.info(
          `🔍 [${botName}] ${market}: Estratégia retornou null - não há sinal válido atualmente`
        );
        return false;
      }

      // Se não há ação atual, significa que não há sinal válido
      if (!currentAction) {
        Logger.info(
          `🔍 [${botName}] ${market}: Estratégia não retornou ação - não há sinal válido atualmente`
        );
        return false;
      }

      const isStillValid = normalizedCurrentAction === normalizedOriginalAction;

      if (isStillValid) {
        Logger.info(`✅ [${botName}] ${market}: Sinal revalidado com sucesso.`);
      } else {
        Logger.info(
          `❌ [${botName}] ${market}: Sinal não é mais válido. Condições de mercado mudaram.`
        );
        Logger.info(
          `🔍 [${botName}] ${market}: Ação original: ${originalAction} (normalizada: ${normalizedOriginalAction}), Ação atual: ${currentAction || 'NENHUMA'} (normalizada: ${normalizedCurrentAction || 'NENHUMA'})`
        );
        Logger.info(`🔍 [${botName}] ${market}: Decision completo:`, decision);
      }

      return isStillValid;
    } catch (error) {
      Logger.warn(
        `⚠️ [${botName}] ${market}: Erro na revalidação do sinal: ${error.message}. Assumindo válido.`
      );
      return true; // Em caso de erro, assume válido para não perder oportunidades
    }
  }

  // Função principal de execução híbrida
  static async openHybridOrder({
    entry,
    stop,
    target,
    action,
    market,
    volume, // 🗑️ DEPRECATED: será calculado internamente
    decimal_quantity,
    decimal_price,
    stepSize_quantity,
    minQuantity,
    botName = 'DEFAULT',
    originalSignalData,
    config = null,
    account = null, // ✅ NOVO: dados da conta para cálculo interno
  }) {
    // Define strategy name early for error handling
    const strategyNameToUse = config?.strategyName || botName || 'UNKNOWN';

    try {
      const formatPrice = value => parseFloat(value).toFixed(decimal_price).toString();

      // Validações básicas
      if (!entry || !stop || !target || !action || !market) {
        return { error: 'Parâmetros obrigatórios ausentes' };
      }

      const entryPrice = parseFloat(entry);

      // ✅ NOVA ABORDAGEM CENTRALIZADA: QuantityCalculator calcula volume internamente
      const marketInfo = {
        decimal_quantity,
        decimal_price,
        stepSize_quantity: stepSize_quantity || 0,
        minQuantity: minQuantity,
      };

      // Se account não foi fornecida, busca dinamicamente
      const configWithSymbol = { ...config, symbol: market };
      const accountData = account || (await AccountController.get(configWithSymbol));
      if (!accountData) {
        Logger.error(
          `❌ [QUANTITY_ERROR] ${market}: AccountController retornou null - API temporariamente indisponível`
        );
        return { error: 'Dados da conta temporariamente indisponíveis - aguardando reconexão' };
      }

      if (!accountData.capitalAvailable && accountData.capitalAvailable !== 0) {
        Logger.error(
          `❌ [QUANTITY_ERROR] ${market}: capitalAvailable é ${accountData.capitalAvailable} - dados de capital inválidos`
        );
        Logger.error(
          `❌ [QUANTITY_ERROR] ${market}: accountData keys disponíveis:`,
          Object.keys(accountData)
        );
        return { error: 'Capital disponível não encontrado nos dados da conta' };
      }

      const quantityResult = QuantityCalculator.calculatePositionSize(
        entryPrice,
        marketInfo,
        config || {},
        accountData,
        market
      );

      if (!quantityResult.isValid) {
        Logger.error(`❌ [QUANTITY_ERROR] ${market}: ${quantityResult.error}`);
        return { error: quantityResult.error };
      }

      const quantity = quantityResult.quantity;
      const orderValue = quantityResult.orderValue;
      const side = action === 'long' ? 'Bid' : 'Ask';
      const finalPrice = parseFloat(entryPrice); // ✅ CORREÇÃO: Mantém como número para poder usar .toFixed()

      // Debug dos valores calculados
      Logger.debug(
        `🔍 [ORDER_CALC] ${market}: Entry=${entryPrice}, Qty=${quantity}, Vol=$${quantityResult.volumeUSD.toFixed(2)}, Side=${side}`
      );

      // Validação de quantidade
      if (parseFloat(quantity) <= 0) {
        return { error: `Quantidade inválida: ${quantity}` };
      }

      // Log inicial da execução híbrida
      Logger.info(`\n🚀 [${strategyNameToUse}] ${market}: Iniciando execução híbrida`);
      Logger.info(
        `📊 [${strategyNameToUse}] ${market}: Preço de entrada: $${entryPrice.toFixed(6)} | Quantidade: ${quantity} | Valor: $${orderValue.toFixed(2)}`
      );

      // Calcula preços de stop loss e take profit (com ajuste por alavancagem)
      const stopPrice = parseFloat(stop);
      let targetPrice = parseFloat(target); // Será ajustado por alavancagem

      // Ajusta Stop Loss pelo leverage do bot/símbolo
      let leverageAdjustedStopPrice = stopPrice;
      let actualStopLossPct = Math.abs(Number(config?.maxNegativePnlStopPct ?? 10)); // Default value
      let actualTakeProfitPct = Math.abs(Number(config?.minProfitPercentage ?? 10)); // Default value

      try {
        const Account = await AccountController.get({
          apiKey: config?.apiKey,
          apiSecret: config?.apiSecret,
          strategy: config?.strategyName || 'DEFAULT',
        });
        if (Account && Account.leverage) {
          const rawLeverage = Number(Account.leverage);
          const leverage = validateLeverageForSymbol(market, rawLeverage);
          const baseStopLossPct = Math.abs(Number(config?.maxNegativePnlStopPct ?? 10));
          actualStopLossPct = baseStopLossPct / leverage;
          const isLong = action === 'long';
          const computedLeverageStop = isLong
            ? entryPrice * (1 - actualStopLossPct / 100)
            : entryPrice * (1 + actualStopLossPct / 100);

          // Usa o stop mais conservador (mais próximo do entry, portanto mais protetor)
          if (isFinite(computedLeverageStop)) {
            if (isLong) {
              leverageAdjustedStopPrice =
                Math.max(computedLeverageStop, stopPrice || 0) || computedLeverageStop;
            } else {
              leverageAdjustedStopPrice =
                Math.min(computedLeverageStop, stopPrice || Infinity) || computedLeverageStop;
            }
          }

          Logger.info(
            `🛡️ [STOP_LEVERAGE] ${market}: base=${baseStopLossPct}% leverage=${leverage}x → efetivo=${actualStopLossPct.toFixed(2)}% | stop(orig)=${isFinite(stopPrice) ? stopPrice.toFixed(6) : 'NaN'} → stop(lev)=${leverageAdjustedStopPrice.toFixed(6)}`
          );

          // 🔧 CORREÇÃO CRÍTICA: Ajusta o Take Profit considerando a alavancagem
          const baseTakeProfitPct = Math.abs(Number(config?.minProfitPercentage ?? 10));
          actualTakeProfitPct = baseTakeProfitPct / leverage;

          const leverageAdjustedTakeProfit = isLong
            ? entryPrice * (1 + actualTakeProfitPct / 100)
            : entryPrice * (1 - actualTakeProfitPct / 100);

          // Usa o take profit mais conservador (mais próximo do entry quando alavancagem é alta)
          if (isFinite(leverageAdjustedTakeProfit)) {
            if (isLong) {
              // Para LONG: TP menor (mais próximo) é mais conservador
              targetPrice =
                Math.min(leverageAdjustedTakeProfit, targetPrice || Infinity) ||
                leverageAdjustedTakeProfit;
            } else {
              // Para SHORT: TP maior (mais próximo) é mais conservador
              targetPrice =
                Math.max(leverageAdjustedTakeProfit, targetPrice || 0) ||
                leverageAdjustedTakeProfit;
            }
          }

          Logger.info(
            `🎯 [TP_LEVERAGE] ${market}: base=${baseTakeProfitPct}% leverage=${leverage}x → efetivo=${actualTakeProfitPct.toFixed(2)}% | tp(orig)=${isFinite(parseFloat(target)) ? parseFloat(target).toFixed(6) : 'NaN'} → tp(lev)=${targetPrice.toFixed(6)}`
          );
        } else {
          Logger.warn(
            `⚠️ [TP_LEVERAGE] ${market}: Não foi possível obter leverage para ajuste do take profit. Usando TP informado.`
          );
        }
      } catch (levErr) {
        Logger.warn(
          `⚠️ [TP_LEVERAGE] ${market}: Erro ao ajustar TP por leverage: ${levErr.message}. Usando TP informado.`
        );
      }

      // Verifica se o Trailing Stop está habilitado para determinar se deve criar Take Profit fixo
      const enableTrailingStop = config?.enableTrailingStop === true;

      Logger.info(
        `🛡️ [${strategyNameToUse}] ${market}: Configurando ordens de segurança integradas`
      );
      Logger.info(
        `   • Stop Loss: $${leverageAdjustedStopPrice.toFixed(6)} (ajustado por alavancagem)`
      );

      if (enableTrailingStop) {
        Logger.info(`   • Take Profit: Será gerenciado dinamicamente pelo Trailing Stop`);
      } else {
        Logger.info(`   • Take Profit: $${targetPrice.toFixed(6)} (ajustado por alavancagem)`);
      }

      // 🎯 INTEGRAÇÃO ORDER BOOK: Ajusta preços para evitar execução imediata
      Logger.info(`🔍 [ORDER_BOOK] ${market}: Ajustando preços com base no order book...`);

      // Ajusta preço principal da ordem (busca por preços próximos ao preço final calculado)
      // Para a entrada, queremos preços muito próximos (0.1% de diferença máxima)
      const entryPriceRef = finalPrice; // Usar o preço final como referência
      const entryDeviation = 0.1; // Máximo 0.1% de diferença para entrada
      // Para bot tradicional: usa preço calculado sem ajuste de OrderBook para entrada
      // Apenas Stop Loss e Take Profit usam OrderBook para encontrar preços EXATOS
      const adjustedEntryPrice = finalPrice;

      // Para bot tradicional: usa preço calculado (não precisa verificar null)

      // Ajusta preço de Stop Loss baseado na porcentagem configurada
      const stopLossPercentage = action === 'long' ? -actualStopLossPct : actualStopLossPct;
      const adjustedStopLossPrice = await OrderBookAnalyzer.findClosestOrderBookPrice(
        market,
        side === 'BUY' ? 'SELL' : 'BUY', // Lado oposto para SL
        entryPrice, // Usar preço de entrada como referência
        stopLossPercentage // Usar porcentagem configurada
      );

      // 🚨 CRÍTICO: Se OrderBook não encontrou preço de Stop Loss, CANCELAR
      if (adjustedStopLossPrice === null) {
        Logger.error(
          `❌ [ORDER_EXECUTION] ${market}: Impossível ajustar Stop Loss via OrderBook - CANCELANDO operação`
        );
        return {
          error:
            'OrderBook falhou ao encontrar preço de Stop Loss - operação cancelada por segurança',
        };
      }

      // Ajusta preço de Take Profit baseado na porcentagem configurada (apenas se não for trailing stop)
      let adjustedTakeProfitPrice = targetPrice;
      if (!enableTrailingStop) {
        const takeProfitPercentage = action === 'long' ? actualTakeProfitPct : -actualTakeProfitPct;

        // Log dos valores para Take Profit
        Logger.debug(
          `🎯 [TP_CALC] ${market}: Entry=${entryPrice.toFixed(6)}, TP%=${takeProfitPercentage}%, Target=${(entryPrice * (1 + takeProfitPercentage / 100)).toFixed(6)}`
        );

        adjustedTakeProfitPrice = await OrderBookAnalyzer.findClosestOrderBookPrice(
          market,
          action === 'long' ? 'SELL' : 'BUY', // LONG = SELL para TP, SHORT = BUY para TP
          entryPrice, // Usar preço de entrada como referência
          takeProfitPercentage // Usar porcentagem configurada
        );

        Logger.debug(`🎯 [TP_BOOK] ${market}: Adjusted TP price: ${adjustedTakeProfitPrice}`);

        // 🚨 CRÍTICO: Se OrderBook não encontrou preço, CANCELAR operação
        if (adjustedTakeProfitPrice === null) {
          Logger.error(
            `❌ [ORDER_EXECUTION] ${market}: Impossível ajustar Take Profit via OrderBook - CANCELANDO operação`
          );
          return {
            error:
              'OrderBook falhou ao encontrar preço de Take Profit - operação cancelada por segurança',
          };
        }
      }

      // Log dos ajustes realizados
      if (adjustedEntryPrice && adjustedEntryPrice !== finalPrice) {
        Logger.debug(
          `   📊 [ORDER_BOOK] Preço entrada ajustado: $${finalPrice.toFixed(6)} → $${adjustedEntryPrice.toFixed(6)}`
        );
      }
      if (adjustedStopLossPrice && adjustedStopLossPrice !== leverageAdjustedStopPrice) {
        Logger.debug(
          `   📊 [ORDER_BOOK] Stop Loss ajustado: $${leverageAdjustedStopPrice.toFixed(6)} → $${adjustedStopLossPrice.toFixed(6)}`
        );
      }
      if (
        !enableTrailingStop &&
        adjustedTakeProfitPrice &&
        adjustedTakeProfitPrice !== targetPrice
      ) {
        Logger.debug(
          `   📊 [ORDER_BOOK] Take Profit ajustado: $${targetPrice.toFixed(6)} → $${adjustedTakeProfitPrice.toFixed(6)}`
        );
      }

      // Log de debug dos preços ajustados
      Logger.debug(
        `📊 [PRICE_ADJ] ${market}: Entry=${adjustedEntryPrice || finalPrice}, Original=${finalPrice}`
      );

      // Usa preços ajustados ou fallback para os originais
      const finalEntryPrice = adjustedEntryPrice || finalPrice;
      const finalStopLossPrice = adjustedStopLossPrice || leverageAdjustedStopPrice;
      const finalTakeProfitPrice = adjustedTakeProfitPrice || targetPrice;

      const body = {
        symbol: market,
        side,
        orderType: 'Limit',
        postOnly: true,
        quantity: parseFloat(quantity).toFixed(decimal_quantity).toString(), // ✅ CORREÇÃO: Formata quantidade usando decimal_quantity (0 casas decimais para LINEA)
        price: formatPrice(finalEntryPrice), // ✅ CORREÇÃO: Formata preço com decimal_price (6 casas decimais)
        // Parâmetros de stop loss integrados (sempre criados)
        stopLossTriggerBy: 'LastPrice',
        stopLossTriggerPrice: formatPrice(finalStopLossPrice), // 🎯 Usa SL ajustado
        stopLossLimitPrice: formatPrice(finalStopLossPrice), // 🎯 Usa SL ajustado
        timeInForce: 'GTC',
        selfTradePrevention: 'RejectTaker',
        clientId: await OrderController.generateUniqueOrderId(config),
      };

      // Adiciona parâmetros de take profit APENAS se o Trailing Stop estiver desabilitado
      if (!enableTrailingStop) {
        body.takeProfitTriggerBy = 'LastPrice';
        body.takeProfitTriggerPrice = formatPrice(finalTakeProfitPrice); // 🎯 Usa TP ajustado
        body.takeProfitLimitPrice = formatPrice(finalTakeProfitPrice); // 🎯 Usa TP ajustado
      }

      // 1. Envia ordem LIMIT (post-only)
      let limitResult;
      try {
        // SEMPRE usa credenciais do config - lança exceção se não disponível
        if (!config?.apiKey || !config?.apiSecret) {
          throw new Error(
            'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
          );
        }

        // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
        const exchangeManager = OrderController.getExchangeManager(config);
        limitResult = await exchangeManager.executeOrder(body, config.apiKey, config.apiSecret);

        if (!limitResult || limitResult.error) {
          const errorMessage = limitResult && limitResult.error ? limitResult.error.toString() : '';

          if (errorMessage.includes('Order would immediately match and take')) {
            Logger.info(
              `🟡 [INFO] ${market}: A ordem com desconto (LIMIT) não foi aceita porque o mercado se moveu muito rápido.`
            );
            Logger.info(`[AÇÃO] ${market}: Cancelando e acionando plano B com ordem a MERCADO.`);

            return await OrderController.executeMarketFallback({
              market,
              side,
              quantity,
              botName,
              originalSignalData,
              entryPrice,
              config,
            });
          } else {
            Logger.error(
              `❌ [${botName}] ${market}: Falha ao enviar ordem LIMIT: ${limitResult && limitResult.error}`
            );
            return { error: limitResult && limitResult.error };
          }
        }

        Logger.info(
          `✅ [${strategyNameToUse}] ${market}: Ordem LIMIT enviada com sucesso (ID: ${limitResult.id || 'N/A'})`
        );

        // Registra a ordem no sistema de persistência
        if (limitResult && limitResult.id && config && config.id) {
          await BotOrdersManager.addOrder(
            config.id,
            limitResult.id,
            market,
            side === 'Bid' ? 'BUY' : 'SELL',
            parseFloat(quantity),
            parseFloat(finalPrice),
            'LIMIT',
            limitResult.exchangeCreatedAt || null,
            body.clientId // Passa o clientId gerado
          );
        }
      } catch (error) {
        const errorMessage = error.message || error.toString();

        if (errorMessage.includes('Order would immediately match and take')) {
          Logger.info(
            `🟡 [INFO] ${market}: A ordem com desconto (LIMIT) não foi aceita porque o mercado se moveu muito rápido.`
          );
          Logger.info(`[AÇÃO] ${market}: Cancelando e acionando plano B com ordem a MERCADO.`);

          return await OrderController.executeMarketFallback({
            market,
            side,
            quantity,
            botName,
            originalSignalData,
            entryPrice,
            config,
          });
        } else {
          Logger.error(
            `❌ [${strategyNameToUse}] ${market}: Erro ao enviar ordem LIMIT:`,
            error.message
          );
          return { error: error.message };
        }
      }

      // 2. Monitora execução baseado no orderExecutionMode
      const orderExecutionMode = config?.orderExecutionMode || 'HYBRID';

      if (orderExecutionMode === 'LIMIT') {
        // Modo LIMIT: Não monitora timeout, deixa ordem no livro
        Logger.info(
          `📋 [${strategyNameToUse}] ${market}: Modo LIMIT ativo - ordem permanecerá no livro até executar`
        );

        // Aguarda apenas 3 segundos para confirmar que a ordem foi criada
        await new Promise(r => setTimeout(r, 3000));

        try {
          // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
          const exchangeManager = OrderController.getExchangeManager(config);
          const openOrders = await exchangeManager.getOpenOrdersForSymbol(
            market,
            config.apiKey,
            config.apiSecret
          );
          const orderExists = openOrders && openOrders.some(o => o.id === limitResult.id);

          if (orderExists) {
            Logger.info(
              `✅ [${strategyNameToUse}] ${market}: Ordem LIMIT criada com sucesso - ID: ${limitResult.id}`
            );

            // 🎯 INTEGRAÇÃO: Adiciona ordem ao LimitOrderValidator para monitoramento de slippage
            try {
              // Inicia validator se ainda não estiver ativo
              if (!LimitOrderValidator.isActive) {
                await LimitOrderValidator.start();
              }

              // Adiciona ordem para monitoramento
              await LimitOrderValidator.addOrderToMonitor({
                orderId: limitResult.id,
                symbol: market,
                side: side, // 'Bid' ou 'Ask'
                price: finalPrice,
                botConfig: config,
                slippageThreshold: config?.limitOrderSlippageThreshold || 0.8, // 0.8% padrão
              });

              Logger.info(
                `🎯 [LIMIT_VALIDATOR] ${market}: Ordem ${limitResult.id} adicionada ao monitoramento de slippage`
              );
            } catch (error) {
              Logger.warn(
                `⚠️ [LIMIT_VALIDATOR] ${market}: Erro ao adicionar ordem ${limitResult.id} ao monitoramento: ${error.message}`
              );
            }

            return { success: true, orderId: limitResult.id, mode: 'LIMIT' };
          } else {
            Logger.warn(
              `⚠️ [${strategyNameToUse}] ${market}: Ordem LIMIT pode ter sido executada imediatamente`
            );
          }
        } catch (error) {
          Logger.error(
            `❌ [${strategyNameToUse}] ${market}: Erro ao verificar ordem LIMIT: ${error.message}`
          );
        }

        return { success: true, orderId: limitResult.id, mode: 'LIMIT' };
      }

      // Modo HYBRID: Monitora por timeout e faz fallback a mercado
      const timeoutSec = Number(config?.orderExecutionTimeoutSeconds || 12);
      Logger.info(
        `⚡ [${strategyNameToUse}] ${market}: Modo HÍBRIDO ativo - monitorando por ${timeoutSec}s, depois fallback a mercado`
      );

      let filled = false;
      for (let i = 0; i < timeoutSec; i++) {
        await new Promise(r => setTimeout(r, 1000));

        try {
          // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
          const exchangeManager = OrderController.getExchangeManager(config);
          const openOrders = await exchangeManager.getOpenOrdersForSymbol(
            market,
            config.apiKey,
            config.apiSecret
          );
          const stillOpen =
            openOrders &&
            openOrders.some(
              o =>
                o.id === limitResult.id &&
                (o.status === 'Pending' || o.status === 'New' || o.status === 'PartiallyFilled')
            );

          if (!stillOpen) {
            filled = true;
            break;
          }

          // Log de progresso a cada 3 segundos
          if (i % 3 === 0 && i > 0) {
            Logger.info(
              `⏳ [${strategyNameToUse}] ${market}: Aguardando execução... ${i}/${timeoutSec}s`
            );
          }
        } catch (monitorError) {
          Logger.warn(
            `⚠️ [${botName}] ${market}: Erro ao monitorar ordem: ${monitorError.message}`
          );
        }
      }

      if (filled) {
        Logger.info(
          `✅ [SUCESSO] ${market}: Ordem LIMIT executada normalmente em ${timeoutSec} segundos.`
        );

        // 🛡️ CRÍTICO: Criar ordens de Stop Loss e Take Profit após execução da ordem principal
        try {
          Logger.info(`🛡️ [SECURITY] ${market}: Criando ordens de segurança SL/TP...`);

          // ⏱️ Aguarda 10s para API processar a posição
          Logger.debug(`⏱️ [SECURITY] ${market}: Aguardando 10s para API processar posição...`);
          await new Promise(resolve => setTimeout(resolve, 10000));

          // Buscar posição atualizada para obter preço real de entrada
          const Account = await AccountController.get({
            apiKey: config?.apiKey,
            apiSecret: config?.apiSecret,
            strategy: config?.strategyName || 'DEFAULT',
          });

          if (!Account?.positions) {
            throw new Error('Não foi possível obter posições atualizadas');
          }

          const position = Account.positions.find(
            p => p.symbol === market && Math.abs(Number(p.netQuantity)) > 0
          );
          if (!position) {
            throw new Error('Posição não encontrada após execução');
          }

          const securityResult = await OrderController.createPositionSafetyOrders(position, config);
          if (securityResult?.success || securityResult?.partial) {
            Logger.info(`✅ [SECURITY] ${market}: Ordens de segurança criadas com sucesso!`);
          } else {
            Logger.warn(
              `⚠️ [SECURITY] ${market}: Falha ao criar ordens de segurança: ${securityResult?.error || 'Erro desconhecido'}`
            );
          }
        } catch (securityError) {
          Logger.warn(
            `⚠️ [SECURITY] ${market}: Erro ao criar ordens de segurança: ${securityError.message}`
          );
        }

        return { success: true, type: 'LIMIT', limitResult };
      }

      // 3. Timeout: cancela ordem LIMIT com retry robusto
      Logger.info(
        `⏰ [${strategyNameToUse}] ${market}: Ordem LIMIT não executada em ${timeoutSec} segundos. Cancelando...`
      );

      let orderCancelled = false;
      let cancelAttempts = 0;
      const maxCancelAttempts = 3;

      // Retry de cancelamento com backoff
      while (!orderCancelled && cancelAttempts < maxCancelAttempts) {
        cancelAttempts++;
        try {
          Logger.info(
            `🔄 [${strategyNameToUse}] ${market}: Tentativa ${cancelAttempts}/${maxCancelAttempts} de cancelamento...`
          );

          // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
          const exchangeManager = OrderController.getExchangeManager(config);
          await exchangeManager.cancelOpenOrder(
            market,
            limitResult.id,
            null,
            config?.apiKey,
            config?.apiSecret
          );
          Logger.info(
            `✅ [${botName}] ${market}: Ordem LIMIT cancelada com sucesso na tentativa ${cancelAttempts}.`
          );
          orderCancelled = true;

          // CRÍTICO: Atualizar status da ordem no banco para CANCELLED
          try {
            const { default: OrdersService } = await import('../Services/OrdersService.js');
            await OrdersService.updateOrderStatus(limitResult.id, 'CANCELLED', 'LIMIT_TIMEOUT');
            Logger.info(
              `✅ [${botName}] ${market}: Status da ordem atualizado para CANCELLED no banco`
            );
          } catch (updateError) {
            Logger.error(
              `❌ [${botName}] ${market}: Erro crítico ao atualizar status no banco: ${updateError.message}`
            );
            // Mesmo com erro de update, continuamos o processo
          }
        } catch (cancelError) {
          Logger.warn(
            `⚠️ [${botName}] ${market}: Erro na tentativa ${cancelAttempts} de cancelamento: ${cancelError.message}`
          );

          // Se não é a última tentativa, aguarda antes de tentar novamente
          if (cancelAttempts < maxCancelAttempts) {
            const waitTime = cancelAttempts * 1000; // 1s, 2s, 3s
            Logger.info(
              `⏳ [${strategyNameToUse}] ${market}: Aguardando ${waitTime}ms antes da próxima tentativa...`
            );
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
      }

      // Se falhou em cancelar após todas as tentativas
      if (!orderCancelled) {
        Logger.error(
          `❌ [${botName}] ${market}: FALHA CRÍTICA - Não foi possível cancelar ordem LIMIT após ${maxCancelAttempts} tentativas!`
        );

        // Força atualização no banco para CANCELLED mesmo sem confirmação da corretora
        // Isso evita ordens fantasma no futuro
        try {
          const { default: OrdersService } = await import('../Services/OrdersService.js');
          await OrdersService.updateOrderStatus(limitResult.id, 'CANCELLED', 'LIMIT_TIMEOUT_FORCE');
          Logger.warn(
            `⚠️ [${botName}] ${market}: Ordem marcada como CANCELLED no banco (sem confirmação da corretora)`
          );
        } catch (forceUpdateError) {
          Logger.error(
            `❌ [${botName}] ${market}: Erro ao forçar atualização no banco: ${forceUpdateError.message}`
          );
        }

        // OPCIONAL: Pode abortar aqui em vez de continuar com market order
        Logger.info(
          `🚫 [${strategyNameToUse}] ${market}: Abortando entrada devido a falha no cancelamento`
        );
        return { error: 'Failed to cancel limit order', limitOrderId: limitResult.id };
      }

      // 4. Revalida sinal e slippage
      Logger.info(
        `🔍 [${strategyNameToUse}] ${market}: Revalidando sinal e verificando slippage...`
      );

      const signalValid = await OrderController.revalidateSignal({
        market,
        botName: strategyNameToUse,
        originalSignalData,
        config,
      });
      const markets = new Markets();
      const markPrices2 = await markets.getAllMarkPrices(market);

      // Find the correct price for this symbol
      let priceCurrent;
      if (Array.isArray(markPrices2)) {
        const symbolPriceData = markPrices2.find(item => item.symbol === market);
        priceCurrent = parseFloat(
          symbolPriceData ? symbolPriceData.markPrice : markPrices2[0]?.markPrice || entryPrice
        );
      } else {
        priceCurrent = parseFloat(markPrices2?.markPrice || markPrices2 || entryPrice);
      }
      const slippage = OrderController.calcSlippagePct(entryPrice, priceCurrent);

      Logger.info(
        `📊 [${strategyNameToUse}] ${market}: Revalidação - Sinal: ${signalValid ? '✅ VÁLIDO' : '❌ INVÁLIDO'} | Slippage: ${slippage.toFixed(3)}%`
      );

      if (!signalValid) {
        Logger.info(
          `🚫 [${strategyNameToUse}] ${market}: Sinal não é mais válido. Abortando entrada.`
        );
        return { aborted: true, reason: 'signal' };
      }

      const maxSlippage = parseFloat(config?.maxSlippagePct || 0.2);
      if (slippage > maxSlippage) {
        Logger.info(
          `🚫 [${strategyNameToUse}] ${market}: Slippage de ${slippage.toFixed(3)}% excede o máximo permitido (${maxSlippage}%). Abortando entrada.`
        );
        return { aborted: true, reason: 'slippage' };
      }

      // 5. Fallback: envia ordem a mercado
      Logger.info(`[AÇÃO] ${market}: Acionando plano B com ordem a MERCADO para garantir entrada.`);

      return await OrderController.executeMarketFallback({
        market,
        side,
        quantity,
        botName,
        originalSignalData,
        entryPrice,
        config,
      });
    } catch (error) {
      Logger.error(`❌ [${strategyNameToUse}] ${market}: Erro no fluxo híbrido:`, error.message);
      return { error: error.message };
    }
  }

  /**
   * NOVO: Método auxiliar para executar fallback a mercado
   * @param {object} params - Parâmetros para execução do fallback
   * @returns {object} - Resultado da execução
   */
  static async executeMarketFallback({
    market,
    side,
    quantity,
    botName,
    originalSignalData,
    entryPrice,
    config = null,
  }) {
    try {
      Logger.info(
        `⚡ [${botName}] ${market}: Executando fallback a MERCADO para garantir entrada...`
      );

      const marketBody = {
        symbol: market,
        side,
        orderType: 'Market',
        quantity,
        timeInForce: 'IOC',
        selfTradePrevention: 'RejectTaker',
        clientId: await OrderController.generateUniqueOrderId(config),
      };

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }

      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
      const exchangeManager = OrderController.getExchangeManager(config);
      const marketResult = await exchangeManager.executeOrder(marketBody, config.apiKey, config.apiSecret);
      if (marketResult && !marketResult.error) {
        // Calcula slippage real
        const executionPrice = parseFloat(
          marketResult.price || marketResult.avgPrice || entryPrice
        );
        const slippage = OrderController.calcSlippagePct(entryPrice, executionPrice);

        Logger.info(`✅ [SUCESSO] ${market}: Operação aberta com sucesso via fallback a MERCADO!`);
        Logger.info(
          `📊 [${botName}] ${market}: Preço de execução: $${executionPrice.toFixed(6)} | Slippage: ${slippage.toFixed(3)}%`
        );

        // Registra a ordem no sistema de persistência
        if (marketResult && marketResult.id && config && config.id) {
          await BotOrdersManager.addOrder(
            config.id,
            marketResult.id,
            market,
            side === 'Bid' ? 'BUY' : 'SELL',
            parseFloat(quantity),
            executionPrice,
            'MARKET',
            marketResult.exchangeCreatedAt || null,
            marketBody.clientId // Passa o clientId gerado
          );
        }

        // 🔧 NOVO: Detecta posição aberta e cria TP/SL automaticamente
        Logger.info(`🛡️ [FAILSAFE] ${market}: Detectando posição aberta e criando TP/SL...`);
        OrderController.createTrackedTimeout(
          async () => {
            try {
              await OrderController.detectPositionOpenedAndCreateFailsafe(
                market,
                botName,
                {
                  ...marketResult,
                  botName,
                  executionPrice,
                },
                config
              ); // 🔧 CORREÇÃO: Passa config com credenciais
            } catch (error) {
              Logger.error(
                `❌ [FAILSAFE] ${market}: Erro ao criar TP/SL automático:`,
                error.message
              );
            }
          },
          2000,
          market,
          'Failsafe TP/SL Creation'
        ); // Aguarda 2 segundos para posição ser registrada

        return { success: true, type: 'MARKET', marketResult, executionPrice, slippage };
      } else {
        Logger.info(
          `❌ [${botName}] ${market}: Fallback - Falha ao executar ordem a mercado: ${marketResult && marketResult.error}`
        );
        return { error: marketResult && marketResult.error };
      }
    } catch (error) {
      Logger.error(`❌ [${botName}] ${market}: Erro no fluxo híbrido:`, error.message);
      return { error: error.message };
    }
  }

  /**
   * Método openOrder - wrapper para openHybridOrder
   * @param {object} orderData - Dados da ordem
   * @returns {object} - Resultado da execução da ordem
   */
  static async openOrder(orderData, config = null) {
    try {
      // Valida se os parâmetros obrigatórios estão presentes
      const requiredParams = [
        'entry',
        'action',
        'market',
        'decimal_quantity',
        'decimal_price',
        'stepSize_quantity',
      ];

      // Para Alpha Flow, valida 'quantity' em vez de 'volume'
      if (orderData.orderNumber) {
        requiredParams.push('quantity');
      } else {
        requiredParams.push('volume');
      }

      for (const param of requiredParams) {
        if (orderData[param] === undefined || orderData[param] === null) {
          Logger.error(`❌ [openOrder] Parâmetro obrigatório ausente: ${param}`);
          return { error: `Parâmetro obrigatório ausente: ${param}` };
        }
      }

      // Verifica se é uma ordem da Alpha Flow Strategy (com orderNumber)
      if (orderData.orderNumber) {
        Logger.info(
          `🔄 [openOrder] Ordem Alpha Flow detectada: ${orderData.market} (Ordem ${orderData.orderNumber})`
        );

        // Debug: Verifica os valores antes do cálculo
        Logger.info(`🔍 [DEBUG] Valores para cálculo de quantidade:`);
        Logger.info(`   • Quantity: ${orderData.quantity}`);
        Logger.info(`   • Entry: ${orderData.entry}`);
        Logger.info(`   • Volume calculado: ${orderData.quantity * orderData.entry}`);

        // Usa o método específico para ordens com triggers
        const result = await OrderController.createLimitOrderWithTriggers({
          market: orderData.market,
          action: orderData.action,
          entry: orderData.entry,
          quantity: orderData.quantity, // Usa a quantidade diretamente da ordem
          stop: orderData.stop,
          target: orderData.target,
          decimal_quantity: orderData.decimal_quantity,
          decimal_price: orderData.decimal_price,
          stepSize_quantity: orderData.stepSize_quantity,
          minQuantity: orderData.minQuantity,
          botName: orderData.botName || 'DEFAULT',
          config: config,
        });

        return result;
      } else {
        // Chama o método openHybridOrder com os dados fornecidos (estratégias tradicionais)
        const result = await OrderController.openHybridOrder({
          entry: orderData.entry,
          stop: orderData.stop,
          target: orderData.target,
          action: orderData.action,
          market: orderData.market,
          volume: orderData.volume,
          decimal_quantity: orderData.decimal_quantity,
          decimal_price: orderData.decimal_price,
          stepSize_quantity: orderData.stepSize_quantity,
          minQuantity: orderData.minQuantity,
          botName: orderData.botName || 'DEFAULT',
          originalSignalData: orderData.originalSignalData,
          config: config,
        });

        return result;
      }
    } catch (error) {
      Logger.error(`❌ [openOrder] Erro ao executar ordem:`, error.message);
      // Retorna erro mas NÃO para o bot - apenas registra o erro
      return { error: error.message };
    }
  }

  static async getRecentOpenOrders(market, config = null) {
    // SEMPRE usa credenciais do config - lança exceção se não disponível
    if (!config?.apiKey || !config?.apiSecret) {
      throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
    }

    // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
    const exchangeManager = OrderController.getExchangeManager(config);
    const orders = await exchangeManager.getOpenOrdersForSymbol(market, config.apiKey, config.apiSecret);

    if (!orders || orders.length === 0) {
      return [];
    }

    // Filtra apenas ordens de entrada Limit (não stop loss/take profit)
    const entryOrders = orders.filter(order => {
      // Verifica se é uma ordem pendente
      const isPending =
        order.status === 'Pending' || order.status === 'New' || order.status === 'PartiallyFilled';

      // Verifica se é uma ordem Limit (ordens de entrada)
      const isLimitOrder = order.orderType === 'Limit';

      // Verifica se NÃO é uma ordem de stop loss ou take profit
      const isNotStopLoss = !order.stopLossTriggerPrice && !order.stopLossLimitPrice;
      const isNotTakeProfit = !order.takeProfitTriggerPrice && !order.takeProfitLimitPrice;

      // Verifica se NÃO é uma ordem reduceOnly (que são ordens de saída)
      const isNotReduceOnly = !order.reduceOnly;

      const isEntryOrder =
        isPending && isLimitOrder && isNotStopLoss && isNotTakeProfit && isNotReduceOnly;

      // Log detalhado para debug
      if (isPending) {
        Logger.info(
          `   📋 ${market}: ID=${order.id}, Type=${order.orderType}, Status=${order.status}, ReduceOnly=${order.reduceOnly}, StopLoss=${!!order.stopLossTriggerPrice}, TakeProfit=${!!order.takeProfitTriggerPrice} → ${isEntryOrder ? 'ENTRADA' : 'OUTRO'}`
        );
      }

      return isEntryOrder;
    });

    const orderShorted = entryOrders.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return orderShorted;
  }

  /**
   * Obtém apenas ordens de entrada recentes (não stop loss/take profit)
   * @param {string} market - Símbolo do mercado
   * @returns {Array} - Lista de ordens de entrada
   */
  async getRecentEntryOrders(market) {
    // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
    const exchangeManager = OrderController.getExchangeManager({ symbol: market });
    const orders = await exchangeManager.getOpenOrdersForSymbol(market, null, null);

    if (!orders || orders.length === 0) {
      return [];
    }

    // Filtra apenas ordens de entrada Limit (não stop loss/take profit)
    const entryOrders = orders.filter(order => {
      // Verifica se é uma ordem pendente
      const isPending =
        order.status === 'Pending' || order.status === 'New' || order.status === 'PartiallyFilled';

      // Verifica se é uma ordem Limit (ordens de entrada)
      const isLimitOrder = order.orderType === 'Limit';

      // Verifica se NÃO é uma ordem de stop loss ou take profit
      const isNotStopLoss = !order.stopLossTriggerPrice && !order.stopLossLimitPrice;
      const isNotTakeProfit = !order.takeProfitTriggerPrice && !order.takeProfitLimitPrice;

      // Verifica se NÃO é uma ordem reduceOnly (que são ordens de saída)
      const isNotReduceOnly = !order.reduceOnly;

      const isEntryOrder =
        isPending && isLimitOrder && isNotStopLoss && isNotTakeProfit && isNotReduceOnly;

      // Log detalhado para debug
      if (isPending) {
        Logger.info(
          `   📋 ${market}: ID=${order.id}, Type=${order.orderType}, Status=${order.status}, ReduceOnly=${order.reduceOnly}, StopLoss=${!!order.stopLossTriggerPrice}, TakeProfit=${!!order.takeProfitTriggerPrice} → ${isEntryOrder ? 'ENTRADA' : 'OUTRO'}`
        );
      }

      return isEntryOrder;
    });

    const orderShorted = entryOrders.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const result = orderShorted.map(el => {
      const minutes = Utils.minutesAgo(el.createdAt);
      Logger.info(`   ⏰ ${market}: Ordem ${el.id} criada há ${minutes} minutos`);
      return {
        id: el.id,
        minutes: minutes,
        triggerPrice: parseFloat(el.triggerPrice),
        price: parseFloat(el.price),
      };
    });

    return result;
  }

  async getAllOrdersSchedule(markets_open) {
    // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
    const exchangeManager = OrderController.getExchangeManager({});
    const orders = await exchangeManager.getOpenOrdersForSymbol(null, null, null);
    const orderShorted = orders.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const list = orderShorted.map(el => {
      return {
        id: el.id,
        minutes: Utils.minutesAgo(el.createdAt),
        triggerPrice: parseFloat(el.triggerPrice),
        symbol: el.symbol,
      };
    });

    return list.filter(el => !markets_open.includes(el.symbol));
  }

  async createStopTS({ symbol, price, isLong, quantity, config = null }) {
    // SEMPRE usa credenciais do config - lança exceção se não disponível
    if (!config?.apiKey || !config?.apiSecret) {
      throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
    }

    const Account = await AccountController.get({
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      strategy: config?.strategyName || 'DEFAULT',
    });

    // Verifica se os dados da conta foram carregados com sucesso
    if (!Account) {
      throw new Error('Dados da conta indisponíveis - não é possível criar stop loss');
    }

    // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
    const exchangeManager = OrderController.getExchangeManager(config || {});
    const allMarkets = await exchangeManager.getMarkets();
    const find = allMarkets.find(el => el.symbol === symbol);

    if (!find) throw new Error(`Symbol ${symbol} not found in account data`);

    const decimal_quantity = find.decimal_quantity;
    const decimal_price = find.decimal_price;
    const tickSize = find.tickSize * 10;

    if (price <= 0) throw new Error('Invalid price: must be > 0');

    price = Math.abs(price);

    // 🎯 INTEGRAÇÃO ORDER BOOK: Ajusta preço para evitar execução imediata
    const adjustedPrice = await OrderBookAnalyzer.findClosestOrderBookPrice(
      symbol,
      isLong ? 'SELL' : 'BUY', // Lado da ordem de fechamento
      price,
      1.0 // Max 1% de desvio
    );

    const finalPrice = adjustedPrice || price;

    if (adjustedPrice && adjustedPrice !== price) {
      Logger.debug(
        `📊 [STOP_TS] [ORDER_BOOK] ${symbol} ajustado: $${price.toFixed(6)} → $${adjustedPrice.toFixed(6)}`
      );
    }

    const triggerPrice = isLong ? finalPrice - tickSize : finalPrice + tickSize;
    const formatPrice = value => parseFloat(value).toFixed(decimal_price).toString();
    const formatQuantity = value => {
      if (value <= 0) {
        throw new Error(`Quantidade deve ser positiva: ${value}`);
      }
      let formatted = parseFloat(value).toFixed(decimal_quantity);
      if (parseFloat(formatted) === 0 && find.stepSize_quantity > 0) {
        return find.stepSize_quantity.toString();
      }
      return formatted.toString();
    };
    const body = {
      symbol,
      orderType: 'Limit',
      side: isLong ? 'Ask' : 'Bid',
      reduceOnly: true,
      postOnly: true,
      timeInForce: 'GTC',
      selfTradePrevention: 'RejectTaker',
      price: formatPrice(finalPrice), // 🎯 Usa preço ajustado
      triggerBy: 'LastPrice',
      triggerPrice: formatPrice(triggerPrice), // 🎯 Usa trigger ajustado
      triggerQuantity: formatQuantity(quantity),
      clientId: await OrderController.generateUniqueOrderId(config),
    };

    // 🔧 MIGRAÇÃO: Reutiliza ExchangeManager já criado acima
    const orderResult = await exchangeManager.executeOrder(body, config?.apiKey, config?.apiSecret);

    if (orderResult && orderResult.id) {
      Logger.debug(
        `✅ [STOP_ORDER] ${symbol}: Stop loss criado com sucesso. ID: ${orderResult.id}`
      );

      // 🔧 CORREÇÃO: Invalida cache após criar SL para evitar duplicação
      if (config?.apiKey && config?.apiSecret) {
        try {
          CacheInvalidator.onOrderCreated(config.apiKey, config.apiSecret, symbol);
          Logger.debug(
            `🧹 [STOP_ORDER] ${symbol}: Cache invalidado. Aguardando processamento da API...`
          );

          // Aguarda 1s para a ordem ser processada pela API
          await new Promise(resolve => setTimeout(resolve, 1000));
          Logger.debug(`✅ [STOP_ORDER] ${symbol}: Stop loss processado com sucesso`);
        } catch (error) {
          Logger.debug(`⚠️ [STOP_ORDER] ${symbol}: Erro ao invalidar cache: ${error.message}`);
        }
      }

      return { success: true, orderId: orderResult.id, result: orderResult };
    } else {
      Logger.error(`❌ [STOP_ORDER] ${symbol}: Falha ao criar stop loss ou ID não retornado.`);
      return { success: false, orderId: null, result: orderResult };
    }
  }

  /**
   * Valida se existe stop loss para uma posição e cria se não existir
   * @param {object} position - Dados da posição
   * @param {string} botName - Nome único do bot
   * @param config
   * @returns {boolean} - True se stop loss foi criado ou já existia
   */
  static async validateAndCreateStopLoss(position, botName, config) {
    const symbol = position.symbol;

    // 1. VERIFICA O LOCK
    if (OrderController.stopLossCreationInProgress.has(symbol)) {
      Logger.debug(`🔒 [${botName}] ${symbol}: Lock ativo, pulando criação de stop loss`);
      return false;
    }

    try {
      // 2. ADQUIRE O LOCK
      OrderController.stopLossCreationInProgress.add(symbol);
      Logger.debug(`🔒 [${botName}] ${symbol}: Lock adquirido para criação de stop loss`);

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Verifica se o par está autorizado antes de tentar criar stop loss
      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: config?.strategyName || 'DEFAULT',
      });
      // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
      const exchangeManager = OrderController.getExchangeManager(config || {});
      const allMarkets = await exchangeManager.getMarkets();
      const marketInfo = allMarkets.find(m => m.symbol === position.symbol);
      if (!marketInfo) {
        // Par não autorizado - retorna silenciosamente sem tentar criar stop loss
        OrderController.debug(
          `ℹ️ [${botName}] ${position.symbol}: Par não autorizado - pulando criação de stop loss`
        );
        return false;
      }

      // Verifica se já existe uma ordem de stop loss para esta posição
      Logger.debug(`🔍 [${botName}] ${position.symbol}: Verificando se já existe stop loss...`);
      const hasStopLossOrders = await PositionUtils.hasStopLoss(position.symbol, position, config);

      if (hasStopLossOrders) {
        Logger.debug(`✅ [${botName}] ${position.symbol}: Stop loss já existe, não criando novo`);
        return true;
      }

      Logger.info(`❌ [${botName}] ${position.symbol}: Stop loss não encontrado, criando novo...`);

      // Verifica se a posição tem quantidade suficiente
      const totalQuantity = Math.abs(parseFloat(position.netQuantity));
      if (totalQuantity <= 0) {
        Logger.info(
          `⚠️ [${botName}] ${position.symbol}: Quantidade inválida para stop loss: ${totalQuantity}`
        );
        return false;
      }

      // Obtém informações do mercado
      const { decimal_price, decimal_quantity } = marketInfo;

      // Determina se é LONG ou SHORT
      const isLong = parseFloat(position.netQuantity) > 0;

      // Calcula o preço de stop loss baseado na porcentagem definida
      const currentPrice = parseFloat(position.markPrice || position.lastPrice);
      const entryPrice = parseFloat(position.entryPrice || 0);

      // VALIDAÇÃO: Verifica se a alavancagem existe na Account
      if (!Account.leverage) {
        Logger.error(
          `❌ [STOP_LOSS_ERROR] ${position.symbol}: Alavancagem não encontrada na Account`
        );
        return false;
      }

      const rawLeverage = Account.leverage;

      // VALIDAÇÃO: Ajusta a alavancagem baseada nas regras da Backpack
      const leverage = validateLeverageForSymbol(position.symbol, rawLeverage);

      // 🛡️ CAMADA 1: FAILSAFE DE SEGURANÇA MÁXIMA (SEMPRE ATIVO)
      // Esta é a rede de segurança final que SEMPRE deve ser criada
      const baseStopLossPct = Math.abs(config?.maxNegativePnlStopPct || -10);
      const actualStopLossPct = baseStopLossPct / leverage;

      const failsafeStopLossPrice = isLong
        ? entryPrice * (1 - actualStopLossPct / 100)
        : entryPrice * (1 + actualStopLossPct / 100);

      Logger.info(
        `🛡️ [${botName}] ${position.symbol}: FAILSAFE DE SEGURANÇA - ${baseStopLossPct}% -> ${actualStopLossPct.toFixed(2)}% (leverage ${leverage}x), Preço: $${failsafeStopLossPrice.toFixed(6)}`
      );

      // 🎯 CAMADA 2: STOP LOSS TÁTICO (se estratégia híbrida ativada)
      let tacticalStopLossPrice = null;
      const enableHybridStrategy = config?.enableHybridStopStrategy === true;

      if (enableHybridStrategy) {
        // Usa ATR para calcular o stop loss tático (mais apertado)
        const markets = new Markets();
        const atrValue = await OrderController.calculateATR(
          await markets.getKLines(position.symbol, config?.time || '30m', 30),
          14
        );

        if (atrValue && atrValue > 0) {
          const atrMultiplier = Number(config?.initialStopAtrMultiplier || 2.0);
          const atrDistance = atrValue * atrMultiplier;

          tacticalStopLossPrice = isLong ? currentPrice - atrDistance : currentPrice + atrDistance;

          Logger.info(
            `🎯 [${botName}] ${position.symbol}: STOP TÁTICO ATR - ATR: ${atrValue.toFixed(6)}, Multiplicador: ${atrMultiplier}, Distância: ${atrDistance.toFixed(6)}, Preço: $${tacticalStopLossPrice.toFixed(6)}`
          );
        } else {
          Logger.info(`⚠️ [${botName}] ${position.symbol}: ATR não disponível para stop tático`);
        }
      }

      const stopLossPrice =
        tacticalStopLossPrice &&
        ((isLong && tacticalStopLossPrice > failsafeStopLossPrice) ||
          (!isLong && tacticalStopLossPrice < failsafeStopLossPrice))
          ? tacticalStopLossPrice
          : failsafeStopLossPrice;

      Logger.info(
        `✅ [${botName}] ${position.symbol}: Stop Loss Final - $${stopLossPrice.toFixed(6)} (${tacticalStopLossPrice ? 'Tático ATR' : 'Failsafe Tradicional'})`
      );

      Logger.info(
        `🛡️ [FAILSAFE] ${position.symbol}: Ordem de segurança máxima (${baseStopLossPct}% PnL) enviada para a corretora com gatilho em $${failsafeStopLossPrice.toFixed(4)}.`
      );

      try {
        const formatPrice = value => parseFloat(value).toFixed(decimal_price).toString();
        const formatQuantity = value => {
          if (value <= 0) {
            throw new Error(`Quantidade deve ser positiva: ${value}`);
          }
          let formatted = parseFloat(value).toFixed(decimal_quantity);
          if (parseFloat(formatted) === 0 && marketInfo.stepSize_quantity > 0) {
            return marketInfo.stepSize_quantity.toString();
          }
          return formatted.toString();
        };

        const stopBody = {
          symbol: position.symbol,
          side: isLong ? 'Ask' : 'Bid',
          orderType: 'Market',
          reduceOnly: true,
          quantity: formatQuantity(totalQuantity),
          triggerPrice: formatPrice(stopLossPrice),
          triggerQuantity: formatQuantity(totalQuantity),
          timeInForce: 'GTC',
          clientId: await OrderController.generateUniqueOrderId(config),
        };

        Logger.info(
          `🔄 [${botName}] ${position.symbol}: Criando stop loss - Trigger Price: $${stopLossPrice.toFixed(6)}`
        );

        // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
        const exchangeManager = OrderController.getExchangeManager(config);
        const stopResult = await exchangeManager.executeOrder(stopBody, config?.apiKey, config?.apiSecret);

        if (stopResult && !stopResult.error) {
          Logger.info(
            `✅ [${botName}] ${position.symbol}: Stop loss criado com sucesso! - Trigger: $${stopLossPrice.toFixed(6)}, Quantidade: ${totalQuantity}`
          );
          const positionKey = `${botName}_${position.symbol}`;
          OrderController.validatedStopLossPositions.add(positionKey);

          OrderController.clearStopLossCheckCache(position.symbol);

          CacheInvalidator.onOrderCreated(config.apiKey, config.apiSecret, position.symbol);

          Logger.info(
            `🧹 [${botName}] ${position.symbol}: Cache invalidado. Aguardando 2s para processamento da API...`
          );
          await new Promise(resolve => setTimeout(resolve, 2000));

          Logger.info(
            `✅ [${botName}] ${position.symbol}: Stop loss criado e processado com sucesso!`
          );
          return true;
        } else {
          const errorMsg = stopResult && stopResult.error ? stopResult.error : 'desconhecido';
          Logger.info(
            `❌ [${botName}] ${position.symbol}: Falha ao criar stop loss - Erro: ${errorMsg}`
          );
          return false;
        }
      } catch (error) {
        Logger.info(
          `❌ [${botName}] ${position.symbol}: Erro ao criar stop loss: ${error.message}`
        );
        return false;
      }
    } catch (error) {
      Logger.error(
        `❌ [${botName}] Erro ao validar/criar stop loss para ${position.symbol}:`,
        error.message
      );
      return false;
    } finally {
      OrderController.stopLossCreationInProgress.delete(symbol);
      Logger.debug(`🔓 [${botName}] ${symbol}: Lock liberado após criação de stop loss`);
    }
  }

  /**
   * Remove posição do cache de stop loss validado (quando posição é fechada)
   * @param {string} symbol - Símbolo do mercado
   * @param {string} botName - Nome único do bot
   */
  static removeFromStopLossCache(symbol, botName) {
    const positionKey = `${botName}_${symbol}`;
    OrderController.validatedStopLossPositions.delete(positionKey);
  }

  /**
   * Valida se existe take profit para uma posição e cria se não existir
   * @param {object} position - Dados da posição
   * @param {string} botName - Nome único do bot
   * @returns {boolean} - True se take profit foi criado ou já existia
   */
  static async validateAndCreateTakeProfit(position, botName, config = null) {
    const symbol = position.symbol;

    // 1. VERIFICA O LOCK
    if (OrderController.takeProfitCreationInProgress.has(symbol)) {
      Logger.debug(`🔒 [${botName}] ${symbol}: Lock ativo, pulando criação de take profit`);
      return false;
    }

    try {
      // 2. ADQUIRE O LOCK
      OrderController.takeProfitCreationInProgress.add(symbol);
      Logger.debug(`🔒 [${botName}] ${symbol}: Lock adquirido para criação de take profit`);

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Verifica se o par está autorizado antes de tentar criar take profit
      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: config?.strategyName || 'DEFAULT',
      });
      // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
      const exchangeManager = OrderController.getExchangeManager(config || {});
      const allMarkets = await exchangeManager.getMarkets();
      const marketInfo = allMarkets.find(m => m.symbol === position.symbol);
      if (!marketInfo) {
        // Par não autorizado - retorna silenciosamente sem tentar criar take profit
        OrderController.debug(
          `ℹ️ [${botName}] ${position.symbol}: Par não autorizado - pulando criação de take profit`
        );
        return { success: false, message: `Par não autorizado - pulando criação de take profit` };
      }

      // Verifica se já existe uma ordem de take profit para esta posição
      Logger.info(`🔍 [${botName}] ${position.symbol}: Verificando se já existe take profit...`);
      const hasTakeProfitOrders = await OrderController.hasTakeProfitOrder(
        position.symbol,
        position,
        config
      );

      if (hasTakeProfitOrders) {
        Logger.info(`✅ [${botName}] ${position.symbol}: Take profit já existe, não criando novo`);
        return { success: true, message: `Take profit já existe, não criando novo` };
      }

      Logger.info(
        `❌ [${botName}] ${position.symbol}: Take profit não encontrado, criando novo...`
      );

      // Verifica se a posição tem quantidade suficiente
      const totalQuantity = Math.abs(parseFloat(position.netQuantity));
      if (totalQuantity <= 0) {
        Logger.info(
          `⚠️ [${botName}] ${position.symbol}: Quantidade inválida para take profit: ${totalQuantity}`
        );
        return {
          success: false,
          message: `Quantidade inválida para take profit: ${totalQuantity}`,
        };
      }

      const takeProfitResult = await OrderController.createTakeProfitForPosition(position, config);

      if (takeProfitResult && !takeProfitResult.message) {
        Logger.info(`✅ [${botName}] ${position.symbol}: Take profit criado com sucesso!`);

        // Atualiza o cache para refletir que agora EXISTE take profit
        const cacheKey = `${position.symbol}_TP_${position.netQuantity > 0 ? 'LONG' : 'SHORT'}`;
        OrderController.takeProfitCheckCache.set(cacheKey, {
          lastCheck: Date.now(),
          hasTakeProfit: true,
        });

        Logger.info(
          `🧹 [${botName}] ${position.symbol}: Cache de take profit atualizado para TRUE após criação`
        );
        return { success: true, message: `Cache de take profit atualizado para TRUE após criação` };
      } else {
        const errorMsg =
          takeProfitResult && takeProfitResult.message ? takeProfitResult.message : 'Desconhecido';
        Logger.info(
          `❌ [${botName}] ${position.symbol}: Falha ao criar take profit - Erro: ${errorMsg}`
        );
        return { success: false, message: `Falha ao criar take profit - Erro: ${errorMsg}` };
      }
    } catch (error) {
      Logger.error(
        `❌ [${botName}] Erro ao validar/criar take profit para ${position.symbol}:`,
        error.message
      );
      return false;
    } finally {
      OrderController.takeProfitCreationInProgress.delete(symbol);
      Logger.debug(`🔓 [${botName}] ${symbol}: Lock liberado após criação de take profit`);
    }
  }

  /**
   * Calcula o ATR (Average True Range) manualmente
   * @param {Array} candles - Array de candles
   * @param {number} period - Período para o cálculo (padrão 14)
   * @returns {number|null} - Valor do ATR ou null se não conseguir calcular
   */
  static calculateATR(candles, period = 14) {
    try {
      if (!candles || candles.length < period + 1) {
        Logger.warn(
          `⚠️ ATR: Dados insuficientes. Necessário: ${period + 1}, Disponível: ${candles?.length || 0}`
        );
        return null;
      }

      // Calcula True Range para cada candle
      const trueRanges = [];
      for (let i = 1; i < candles.length; i++) {
        const current = candles[i];
        const previous = candles[i - 1];

        const high = parseFloat(current.high);
        const low = parseFloat(current.low);
        const prevClose = parseFloat(previous.close);

        const tr1 = high - low; // High - Low
        const tr2 = Math.abs(high - prevClose); // |High - Previous Close|
        const tr3 = Math.abs(low - prevClose); // |Low - Previous Close|

        const trueRange = Math.max(tr1, tr2, tr3);
        trueRanges.push(trueRange);
      }

      // Calcula ATR como média móvel simples dos True Ranges
      if (trueRanges.length < period) {
        return null;
      }

      const atrValues = trueRanges.slice(-period);
      const atr = atrValues.reduce((sum, tr) => sum + tr, 0) / period;

      return atr;
    } catch (error) {
      Logger.error('❌ Erro ao calcular ATR:', error.message);
      return null;
    }
  }

  /**
   * Valida se o limite de posições abertas foi atingido
   * @param {string} botName - Nome único do bot para logs
   * @param {string} apiKey - API Key do bot
   * @param {string} apiSecret - API Secret do bot
   * @param {object} config - Configuração do bot (opcional)
   * @returns {object} - { isValid: boolean, message: string, currentCount: number, maxCount: number }
   */
  static async validateMaxOpenTrades(
    botName = 'DEFAULT',
    apiKey = null,
    apiSecret = null,
    config = null,
    forceRefresh = false
  ) {
    try {
      // Se forceRefresh for true, força busca na exchange (usado quando há suspeita de dados stale)
      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Futures direto
      const exchangeManager = OrderController.getExchangeManager({ apiKey, apiSecret });
      const positions = forceRefresh
        ? await exchangeManager.getFuturesPositionsForceRefresh(apiKey, apiSecret)
        : await exchangeManager.getFuturesPositions(apiKey, apiSecret);

      // 🚨 VALIDAÇÃO CRÍTICA: Verifica se positions é um array válido
      if (!Array.isArray(positions)) {
        Logger.error(
          `❌ [${botName}] positions não é um array válido - type: ${typeof positions}, value:`,
          positions
        );
        return {
          isValid: false,
          message: `Erro na validação: positions retornado como ${typeof positions} (esperado array)`,
          currentCount: 0,
          maxCount: 0,
        };
      }

      const maxOpenTrades = Number(config?.maxOpenOrders || 5);
      const currentOpenPositions = positions.filter(
        p => Math.abs(Number(p.netQuantity)) > 0
      ).length;

      // Debug log para verificar a validação
      const refreshMethod = forceRefresh ? 'FORCE_REFRESH' : 'CACHE_OK';
      Logger.debug(
        `🔍 [MAX_ORDERS_CHECK] ${botName}: ${currentOpenPositions}/${maxOpenTrades} posições abertas (${refreshMethod}, config.maxOpenOrders: ${config?.maxOpenOrders})`
      );

      if (currentOpenPositions >= maxOpenTrades) {
        return {
          isValid: false,
          message: `🚫 Máximo de ordens atingido: ${currentOpenPositions}/${maxOpenTrades} posições abertas`,
          currentCount: currentOpenPositions,
          maxCount: maxOpenTrades,
        };
      }

      return {
        isValid: true,
        message: `✅ Posições abertas: ${currentOpenPositions}/${maxOpenTrades}`,
        currentCount: currentOpenPositions,
        maxCount: maxOpenTrades,
      };
    } catch (error) {
      Logger.error(`❌ [${botName}] Erro ao validar máximo de ordens:`, error.message);
      return {
        isValid: false,
        message: `Erro ao validar máximo de ordens: ${error.message}`,
        currentCount: 0,
        maxCount: 0,
      };
    }
  }

  /**
   * Cria ordens de segurança (failsafe) para uma posição recém-aberta
   * Implementa cálculo correto considerando alavancagem
   * @param {object} position - Dados da posição
   * @param {string} botName - Nome único do bot
   * @param {object} config - Configuração do bot (opcional)
   * @returns {object} - Resultado da criação das ordens
   */
  static async createFailsafeOrders(position, botName = 'DEFAULT', config = null) {
    try {
      // Usa credenciais do config se disponível
      const apiKey = config?.apiKey;
      const apiSecret = config?.apiSecret;

      if (!apiKey || !apiSecret) {
        Logger.error(`❌ [FAILSAFE] Credenciais de API não fornecidas para ${position.symbol}`);
        return { error: 'Credenciais de API não fornecidas' };
      }

      // Busca informações do mercado
      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: config?.strategyName || 'DEFAULT',
      });
      // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
      const exchangeManager = OrderController.getExchangeManager(config || {});
      const allMarkets = await exchangeManager.getMarkets();
      const marketInfo = allMarkets.find(m => m.symbol === position.symbol);
      if (!marketInfo) {
        Logger.error(`❌ [FAILSAFE] Market info não encontrada para ${position.symbol}`);
        return { error: 'Market info não encontrada' };
      }

      // VERIFICAÇÃO ADICIONAL: Verifica se já existe stop loss antes de criar
      const hasStopLossOrders = await PositionUtils.hasStopLoss(position.symbol, position, config);

      if (hasStopLossOrders) {
        Logger.info(
          `✅ [FAILSAFE] ${position.symbol}: Stop loss já existe, pulando criação de failsafe orders`
        );
        return { success: true, message: 'Stop loss já existe' };
      }

      const decimal_quantity = marketInfo.decimal_quantity;
      const decimal_price = marketInfo.decimal_price;

      // 1. Obter os dados necessários da posição e da configuração
      const entryPrice = parseFloat(
        position.avgEntryPrice || position.entryPrice || position.markPrice
      );
      const leverage = parseFloat(position.leverage || Account.leverage || 20); // Fallback para 20x se não disponível
      const targetProfitPct = parseFloat(config?.minProfitPercentage || 0.5); // ex: 0.5
      const stopLossPct = Math.abs(parseFloat(config?.maxNegativePnlStopPct || 4.0)); // ex: 4.0 (usa valor absoluto)
      const isLong = parseFloat(position.netQuantity) > 0;
      const totalQuantity = Math.abs(Number(position.netQuantity));

      // Debug das variáveis de configuração
      Logger.info(`🔍 [FAILSAFE_VARS] ${position.symbol}: Variáveis de configuração`);
      Logger.info(
        `   • MIN_PROFIT_PERCENTAGE: ${config?.minProfitPercentage || 'não definido'} -> ${targetProfitPct}%`
      );
      Logger.info(
        `   • MAX_NEGATIVE_PNL_STOP_PCT: ${config?.maxNegativePnlStopPct || 'não definido'} -> ${stopLossPct}%`
      );
      Logger.info(`   • Leverage: ${leverage}x`);

      // 2. Calcular os preços de gatilho considerando alavancagem
      let takeProfitPrice;
      let stopLossPrice;

      if (isLong) {
        // Se a posição for de COMPRA (LONG)
        // O lucro acontece quando o preço sobe
        takeProfitPrice = entryPrice * (1 + targetProfitPct / 100 / leverage);
        // A perda acontece quando o preço cai
        stopLossPrice = entryPrice * (1 - stopLossPct / 100 / leverage);
      } else {
        // Se a posição for de VENDA (SHORT)
        // O lucro acontece quando o preço cai (take profit abaixo do preço de entrada)
        takeProfitPrice = entryPrice * (1 - targetProfitPct / 100 / leverage);
        // A perda acontece quando o preço sobe (stop loss acima do preço de entrada)
        stopLossPrice = entryPrice * (1 + stopLossPct / 100 / leverage);
      }

      // Log adicional para debug da lógica
      Logger.info(`🔍 [FAILSAFE_LOGIC] ${position.symbol}: Lógica de cálculo`);
      Logger.info(
        `   • Posição: ${isLong ? 'LONG' : 'SHORT'} (quantidade: ${position.netQuantity})`
      );
      Logger.info(
        `   • Para ${isLong ? 'LONG' : 'SHORT'}: TP ${isLong ? 'acima' : 'abaixo'} do preço, SL ${isLong ? 'abaixo' : 'acima'} do preço`
      );

      // 3. Logar os preços calculados para verificação
      Logger.info(
        `🛡️ [FAILSAFE_CALC] ${position.symbol}: Entry=${entryPrice.toFixed(6)}, Leverage=${leverage}x`
      );
      Logger.info(
        `  -> TP Target: ${targetProfitPct}% -> Preço Alvo: $${takeProfitPrice.toFixed(6)}`
      );
      Logger.info(`  -> SL Target: ${stopLossPct}% -> Preço Alvo: $${stopLossPrice.toFixed(6)}`);

      // 🛡️ LOG DE ALTA VISIBILIDADE - ORDEM DE SEGURANÇA MÁXIMA
      Logger.info(
        `🛡️ [FAILSAFE] ${position.symbol}: Ordem de segurança máxima (${stopLossPct}% PnL) enviada para a corretora com gatilho em $${stopLossPrice.toFixed(4)}.`
      );

      // Valida se os preços são válidos
      if (stopLossPrice <= 0 || takeProfitPrice <= 0) {
        Logger.error(
          `❌ [FAILSAFE] ${position.symbol}: Preços calculados inválidos - SL: ${stopLossPrice}, TP: ${takeProfitPrice}`
        );
        return { error: 'Preços calculados inválidos' };
      }

      // Valida distância mínima dos preços (0.1% do preço de entrada)
      const minDistance = entryPrice * 0.001; // 0.1%
      const currentPrice = parseFloat(position.markPrice || entryPrice);

      Logger.info(`🔍 [FAILSAFE_DEBUG] ${position.symbol}: Validando distâncias mínimas`);
      Logger.info(`   • Preço atual: $${currentPrice.toFixed(6)}`);
      Logger.info(`   • Distância mínima: $${minDistance.toFixed(6)}`);

      const slDistance = Math.abs(stopLossPrice - currentPrice);
      const tpDistance = Math.abs(takeProfitPrice - currentPrice);

      Logger.info(
        `   • Distância SL: $${slDistance.toFixed(6)} (${slDistance < minDistance ? 'MUITO PRÓXIMO' : 'OK'})`
      );
      Logger.info(
        `   • Distância TP: $${tpDistance.toFixed(6)} (${tpDistance < minDistance ? 'MUITO PRÓXIMO' : 'OK'})`
      );

      if (slDistance < minDistance) {
        Logger.warn(
          `⚠️ [FAILSAFE] ${position.symbol}: Stop Loss muito próximo do preço atual (${slDistance.toFixed(6)} < ${minDistance.toFixed(6)})`
        );
        const newStopLossPrice = currentPrice + (isLong ? -minDistance : minDistance);
        Logger.warn(
          `   • Ajustando Stop Loss de ${stopLossPrice.toFixed(6)} para ${newStopLossPrice.toFixed(6)}`
        );
        stopLossPrice = newStopLossPrice;
      }

      if (tpDistance < minDistance) {
        Logger.warn(
          `⚠️ [FAILSAFE] ${position.symbol}: Take Profit muito próximo do preço atual (${tpDistance.toFixed(6)} < ${minDistance.toFixed(6)})`
        );
        const newTakeProfitPrice = currentPrice + (isLong ? minDistance : -minDistance);
        Logger.warn(
          `   • Ajustando Take Profit de ${takeProfitPrice.toFixed(6)} para ${newTakeProfitPrice.toFixed(6)}`
        );
        takeProfitPrice = newTakeProfitPrice;
      }

      // Funções de formatação
      const formatPrice = value => parseFloat(value).toFixed(decimal_price).toString();
      const formatQuantity = value => {
        if (value <= 0) {
          throw new Error(`Quantidade deve ser positiva: ${value}`);
        }
        let formatted = parseFloat(value).toFixed(decimal_quantity);
        if (parseFloat(formatted) === 0 && marketInfo.stepSize_quantity > 0) {
          return marketInfo.stepSize_quantity.toString();
        }
        return formatted.toString();
      };

      // Verifica se o Trailing Stop está habilitado para determinar se deve criar Take Profit fixo
      const enableTrailingStop = config?.enableTrailingStop === true;

      Logger.info(`🛡️ [FAILSAFE] ${position.symbol}: Criando ordens de segurança`);
      Logger.info(`   • Preço de entrada: $${entryPrice.toFixed(6)}`);
      Logger.info(
        `   • Stop Loss: $${stopLossPrice.toFixed(6)} (${stopLossPct}% com ${leverage}x leverage)`
      );

      if (enableTrailingStop) {
        Logger.info(`   • Take Profit: Será gerenciado dinamicamente pelo Trailing Stop`);
      } else {
        Logger.info(
          `   • Take Profit: $${takeProfitPrice.toFixed(6)} (${targetProfitPct}% com ${leverage}x leverage)`
        );
      }
      Logger.info(`   • Quantidade: ${totalQuantity}`);

      // 4. Cria ordem de Stop Loss (STOP_MARKET com reduceOnly) - SEMPRE criada
      const stopLossBody = {
        symbol: position.symbol,
        side: isLong ? 'Ask' : 'Bid', // Para LONG, vende (Ask) para fechar. Para SHORT, compra (Bid) para fechar
        orderType: 'Limit',
        reduceOnly: true,
        quantity: formatQuantity(totalQuantity),
        price: formatPrice(stopLossPrice),
        stopLossTriggerBy: 'LastPrice',
        stopLossTriggerPrice: formatPrice(stopLossPrice),
        stopLossLimitPrice: formatPrice(stopLossPrice),
        timeInForce: 'GTC',
        selfTradePrevention: 'RejectTaker',
        clientId: await OrderController.generateUniqueOrderId(config),
      };

      // 5. Cria ordem de Take Profit APENAS se o Trailing Stop estiver desabilitado
      let takeProfitBody = null;
      if (!enableTrailingStop) {
        takeProfitBody = {
          symbol: position.symbol,
          side: isLong ? 'Ask' : 'Bid', // Para LONG, vende (Ask) para fechar. Para SHORT, compra (Bid) para fechar
          orderType: 'Limit',
          reduceOnly: true,
          quantity: formatQuantity(totalQuantity),
          price: formatPrice(takeProfitPrice),
          takeProfitTriggerBy: 'LastPrice',
          takeProfitTriggerPrice: formatPrice(takeProfitPrice),
          takeProfitLimitPrice: formatPrice(takeProfitPrice),
          timeInForce: 'GTC',
          selfTradePrevention: 'RejectTaker',
          clientId: await OrderController.generateUniqueOrderId(config),
        };
      }

      // 6. Envia ordens para a corretora
      // 🔧 MIGRAÇÃO: Reutiliza ExchangeManager já criado acima
      const stopLossResult = await exchangeManager.executeOrder(
        stopLossBody,
        config?.apiKey,
        config?.apiSecret
      );
      let takeProfitResult = null;

      if (takeProfitBody) {
        // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
        takeProfitResult = await exchangeManager.executeOrder(
          takeProfitBody,
          config?.apiKey,
          config?.apiSecret
        );
      }

      // 7. Verifica resultados
      let successCount = 0;
      let errorMessages = [];

      if (stopLossResult && !stopLossResult.error) {
        Logger.info(
          `✅ [FAILSAFE] ${position.symbol}: Stop Loss criado - OrderID: ${stopLossResult.id || 'N/A'}`
        );
        successCount++;
      } else {
        const error = stopLossResult?.error || 'desconhecido';
        Logger.info(`❌ [FAILSAFE] ${position.symbol}: Stop Loss FALHOU - Motivo: ${error}`);
        errorMessages.push(`Stop Loss: ${error}`);
      }

      if (enableTrailingStop) {
        // Se o Trailing Stop está ativo, não criamos Take Profit fixo
        Logger.info(
          `ℹ️ [FAILSAFE] ${position.symbol}: Take Profit será gerenciado dinamicamente pelo Trailing Stop`
        );
      } else if (takeProfitResult && !takeProfitResult.error) {
        Logger.info(
          `✅ [FAILSAFE] ${position.symbol}: Take Profit criado - OrderID: ${takeProfitResult.id || 'N/A'}`
        );
        successCount++;
      } else if (takeProfitResult && takeProfitResult.error) {
        const error = takeProfitResult.error || 'desconhecido';
        Logger.info(`❌ [FAILSAFE] ${position.symbol}: Take Profit FALHOU - Motivo: ${error}`);
        errorMessages.push(`Take Profit: ${error}`);
      }

      // 8. Log final
      if (enableTrailingStop) {
        // Quando Trailing Stop está ativo, só precisamos do Stop Loss
        if (successCount === 1) {
          Logger.info(`🛡️ [FAILSAFE] ${position.symbol}: Ordem de segurança criada com sucesso!`);
          Logger.info(`   • Stop Loss em $${stopLossPrice.toFixed(6)}`);
          Logger.info(`   • Take Profit será gerenciado dinamicamente pelo Trailing Stop`);
          return { success: true, stopLossResult, takeProfitResult: null };
        } else {
          Logger.info(`❌ [FAILSAFE] ${position.symbol}: Falha ao criar Stop Loss`);
          return { error: errorMessages.join(', ') };
        }
      } else {
        // Quando Trailing Stop está desabilitado, precisamos de ambas as ordens
        if (successCount === 2) {
          Logger.info(`🛡️ [FAILSAFE] ${position.symbol}: Ordens de segurança criadas com sucesso!`);
          Logger.info(`   • Stop Loss em $${stopLossPrice.toFixed(6)}`);
          Logger.info(`   • Take Profit em $${takeProfitPrice.toFixed(6)}`);
          return { success: true, stopLossResult, takeProfitResult };
        } else if (successCount === 1) {
          Logger.info(`⚠️ [FAILSAFE] ${position.symbol}: Apenas uma ordem de segurança foi criada`);
          return { partial: true, stopLossResult, takeProfitResult, errors: errorMessages };
        } else {
          Logger.info(`❌ [FAILSAFE] ${position.symbol}: Falha ao criar ordens de segurança`);
          return { error: errorMessages.join(', ') };
        }
      }
    } catch (error) {
      Logger.error(
        `❌ [FAILSAFE] Erro ao criar ordens de segurança para ${position.symbol}:`,
        error.message
      );
      return { error: error.message };
    }
  }

  /**
   * Detecta quando uma posição é aberta e cria ordens de segurança (failsafe)
   * @param {string} market - Símbolo do mercado
   * @param {string} botName - Nome do bot
   * @param {object} orderResult - Resultado da ordem de entrada
   * @param config
   * @returns {object} - Resultado da criação das ordens de segurança
   */
  static async detectPositionOpenedAndCreateFailsafe(market, botName, orderResult, config = null) {
    try {
      // Aguarda um momento para a posição ser registrada
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Busca posições abertas
      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Futures direto
      const exchangeManager = OrderController.getExchangeManager(config);
      const positions = await exchangeManager.getFuturesPositions(config?.apiKey, config?.apiSecret);
      const position = positions?.find(
        p => p.symbol === market && Math.abs(Number(p.netQuantity)) > 0
      );

      if (!position) {
        Logger.info(`⚠️ [FAILSAFE] ${market}: Posição não encontrada após abertura`);
        return { error: 'Posição não encontrada' };
      }

      Logger.info(`🎯 [FAILSAFE] ${market}: Posição detectada, criando ordens de segurança...`);

      if (orderResult && orderResult.botName) {
        try {
          const trailingStateMap = TrailingStop.trailingStateByBot;
          let trailingState = null;

          for (const [botKey, stateMap] of trailingStateMap.entries()) {
            if (stateMap.has(market)) {
              trailingState = stateMap.get(market);
              break;
            }
          }

          if (trailingState) {
            trailingState.botName = orderResult.botName;

            if (orderResult.botName === 'AlphaFlowStrategy' && orderResult.target) {
              trailingState.takeProfitPrice = orderResult.target;
              Logger.info(
                `📋 [STRATEGY_TAG] ${market}: Bot marcado como "${orderResult.botName}" com alvo $${orderResult.target}`
              );
            } else {
              Logger.info(`📋 [STRATEGY_TAG] ${market}: Bot marcado como "${orderResult.botName}"`);
            }

            // Validate position has required symbol before creating trailing stop
            if (position && position.symbol) {
              await TrailingStop.createTrailingStopOrder(
                position,
                trailingState,
                String(config?.id), // 🔧 Convert to string for TrailingStop validation
                config
              );
            } else {
              Logger.warn(
                `⚠️ [VALIDATION] Position missing symbol field, skipping trailing stop creation:`,
                position
              );
            }
          }
        } catch (trailingError) {
          Logger.warn(
            `⚠️ [FAILSAFE] ${market}: Erro ao atualizar estado do trailing stop:`,
            trailingError.message
          );
        }
      }

      // Cria ordens de segurança
      const failsafeResult = await OrderController.createFailsafeOrders(position, botName, config);

      if (failsafeResult.success) {
        Logger.info(`🛡️ [FAILSAFE] ${market}: Rede de segurança ativada com sucesso!`);
      } else if (failsafeResult.partial) {
        Logger.info(`⚠️ [FAILSAFE] ${market}: Rede de segurança parcialmente ativada`);
      } else {
        Logger.info(`❌ [FAILSAFE] ${market}: Falha ao ativar rede de segurança`);
      }

      return failsafeResult;
    } catch (error) {
      Logger.error(`❌ [FAILSAFE] Erro ao detectar posição aberta para ${market}:`, error.message);
      return { error: error.message };
    }
  }

  /**
   * Cancela ordens de segurança (failsafe) para um símbolo
   * @param {string} symbol - Símbolo do mercado
   * @param {string} botName - Nome único do bot
   * @returns {boolean} - True se as ordens foram canceladas com sucesso
   */
  static async cancelFailsafeOrders(symbol, botName = 'DEFAULT', config = null) {
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Busca ordens abertas para o símbolo
      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
      const exchangeManager = OrderController.getExchangeManager({ apiKey, apiSecret });
      const openOrders = await exchangeManager.getOpenOrdersForSymbol(symbol, apiKey, apiSecret);

      if (!openOrders || openOrders.length === 0) {
        return true;
      }

      // Filtra apenas ordens de segurança (stop loss e take profit com reduceOnly)
      const failsafeOrders = openOrders.filter(order => {
        const isReduceOnly = order.reduceOnly;
        const hasStopLoss = order.stopLossTriggerPrice || order.stopLossLimitPrice;
        const hasTakeProfit = order.takeProfitTriggerPrice || order.takeProfitLimitPrice;
        const isPending =
          order.status === 'Pending' ||
          order.status === 'New' ||
          order.status === 'PartiallyFilled' ||
          order.status === 'TriggerPending';

        return isReduceOnly && (hasStopLoss || hasTakeProfit) && isPending;
      });

      if (failsafeOrders.length === 0) {
        Logger.debug(
          `ℹ️ [FAILSAFE] ${symbol}: Nenhuma ordem de segurança encontrada para cancelar`
        );
        return true;
      }

      Logger.info(
        `🛡️ [FAILSAFE] ${symbol}: Cancelando ${failsafeOrders.length} ordem(ns) de segurança...`
      );

      // Cancela todas as ordens de segurança
      const cancelPromises = failsafeOrders.map(async order => {
        // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
        const exchangeManager = OrderController.getExchangeManager(config);
        const cancelResult = await exchangeManager.cancelOpenOrder(
          symbol,
          order.id,
          order.clientId,
          config?.apiKey,
          config?.apiSecret
        );

        // Se cancelamento foi bem-sucedido, atualiza status no banco
        if (cancelResult && !cancelResult.error) {
          try {
            await BotOrdersManager.updateOrder(order.id, {
              status: 'CANCELLED',
              closeTime: new Date().toISOString(),
              closeType: 'FAILSAFE_CLEANUP',
            });
            Logger.debug(
              `📝 [FAILSAFE] ${symbol}: Status da ordem ${order.id} atualizado no banco para CANCELLED`
            );
          } catch (dbError) {
            Logger.warn(
              `⚠️ [FAILSAFE] ${symbol}: Erro ao atualizar status da ordem ${order.id} no banco: ${dbError.message}`
            );
          }
        }

        return cancelResult;
      });

      const cancelResults = await Promise.all(cancelPromises);
      const successfulCancels = cancelResults.filter(
        result => result !== null && !result.error
      ).length;

      if (successfulCancels > 0) {
        Logger.info(
          `✅ [FAILSAFE] ${symbol}: ${successfulCancels} ordem(ns) de segurança cancelada(s) com sucesso`
        );
        return true;
      } else {
        Logger.info(`❌ [FAILSAFE] ${symbol}: Falha ao cancelar ordens de segurança`);
        return false;
      }
    } catch (error) {
      Logger.error(
        `❌ [FAILSAFE] Erro ao cancelar ordens de segurança para ${symbol}:`,
        error.message
      );
      return false;
    }
  }

  /**
   * Verifica se existem ordens de segurança ativas para um símbolo
   * @param {string} symbol - Símbolo do mercado
   * @param {string} botName - Nome único do bot
   * @returns {object} - { hasStopLoss: boolean, hasTakeProfit: boolean, orders: array }
   */
  static async checkFailsafeOrders(symbol, botName = 'DEFAULT', config = null) {
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Busca ordens abertas para o símbolo
      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
      const exchangeManager = OrderController.getExchangeManager({ apiKey, apiSecret });
      const openOrders = await exchangeManager.getOpenOrdersForSymbol(symbol, apiKey, apiSecret);

      if (!openOrders || openOrders.length === 0) {
        return { hasStopLoss: false, hasTakeProfit: false, orders: [] };
      }

      // Filtra ordens de segurança
      const failsafeOrders = openOrders.filter(order => {
        const isReduceOnly = order.reduceOnly;
        const hasStopLoss = order.stopLossTriggerPrice || order.stopLossLimitPrice;
        const hasTakeProfit = order.takeProfitTriggerPrice || order.takeProfitLimitPrice;
        const isPending =
          order.status === 'Pending' ||
          order.status === 'New' ||
          order.status === 'PartiallyFilled' ||
          order.status === 'TriggerPending';

        return isReduceOnly && (hasStopLoss || hasTakeProfit) && isPending;
      });

      const hasStopLoss = failsafeOrders.some(
        order => order.stopLossTriggerPrice || order.stopLossLimitPrice
      );
      const hasTakeProfit = failsafeOrders.some(
        order => order.takeProfitTriggerPrice || order.takeProfitLimitPrice
      );

      return { hasStopLoss, hasTakeProfit, orders: failsafeOrders };
    } catch (error) {
      Logger.error(
        `❌ [FAILSAFE] Erro ao verificar ordens de segurança para ${symbol}:`,
        error.message
      );
      return { hasStopLoss: false, hasTakeProfit: false, orders: [] };
    }
  }

  /**
   * Monitora e recria ordens de segurança se necessário
   * @param {string} botName - Nome único do bot
   * @returns {object} - Resultado do monitoramento
   */
  static async monitorAndRecreateFailsafeOrders(botName = 'DEFAULT', config = null) {
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Busca posições abertas
      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Futures direto
      const exchangeManager = OrderController.getExchangeManager({ apiKey, apiSecret });
      const positions = await exchangeManager.getFuturesPositions(apiKey, apiSecret);

      if (!positions || positions.length === 0) {
        return { checked: 0, recreated: 0 };
      }

      let checked = 0;
      let recreated = 0;

      for (const position of positions) {
        if (Math.abs(Number(position.netQuantity)) === 0) continue;

        checked++;
        const symbol = position.symbol;

        // Verifica se existem ordens de segurança
        const failsafeStatus = await OrderController.checkFailsafeOrders(symbol, botName, config);

        // VERIFICAÇÃO ADICIONAL: Verifica se já existe stop loss antes de recriar
        const StopLossUtilsModule = await import('../Utils/StopLossUtils.js');
        const hasStopLossOrders = await StopLossUtilsModule.PositionUtils.hasStopLoss(
          symbol,
          position,
          config
        );

        if (hasStopLossOrders && failsafeStatus.hasStopLoss) {
          Logger.info(`✅ [FAILSAFE] ${symbol}: Stop loss já existe, não recriando`);
          continue;
        }

        if (!failsafeStatus.hasStopLoss || !failsafeStatus.hasTakeProfit) {
          Logger.info(`⚠️ [FAILSAFE] ${symbol}: Ordens de segurança incompletas detectadas`);
          Logger.info(`   • Stop Loss: ${failsafeStatus.hasStopLoss ? '✅' : '❌'}`);
          Logger.info(`   • Take Profit: ${failsafeStatus.hasTakeProfit ? '✅' : '❌'}`);

          // Recria ordens de segurança
          const recreateResult = await OrderController.createFailsafeOrders(
            position,
            botName,
            config
          );

          if (recreateResult.success) {
            Logger.info(`✅ [FAILSAFE] ${symbol}: Ordens de segurança recriadas com sucesso`);
            recreated++;
          } else {
            Logger.info(`❌ [FAILSAFE] ${symbol}: Falha ao recriar ordens de segurança`);
          }
        }
      }

      if (checked > 0) {
        Logger.info(
          `🛡️ [FAILSAFE] Monitoramento concluído: ${checked} posições verificadas, ${recreated} redes de segurança recriadas`
        );
      }

      return { checked, recreated };
    } catch (error) {
      Logger.error(`❌ [FAILSAFE] Erro no monitoramento de ordens de segurança:`, error.message);
      return { checked: 0, recreated: 0, error: error.message };
    }
  }

  /**
   * Função de debug condicional
   * @param {string} message - Mensagem de debug
   * @param {object} config - Configuração do bot (opcional)
   */
  static debug(message, config = null) {
    if (config?.logType === 'debug') {
      Logger.info(message);
    }
  }

  /**
   * Verifica se há posições abertas que não estão sendo monitoradas
   */
  static async checkForUnmonitoredPositions(botName, config = null) {
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Cache para evitar verificações excessivas
      const cacheKey = `unmonitored_${botName}`;
      const cached = OrderController.stopLossCheckCache.get(cacheKey);
      const now = Date.now();

      if (cached && now - cached.lastCheck < 10000) {
        // 10 segundos de cache para verificações de posições
        return; // Pula verificação se feita recentemente
      }

      // Busca posições abertas
      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Futures direto
      const exchangeManager = OrderController.getExchangeManager({ apiKey, apiSecret });
      const positions = (await exchangeManager.getFuturesPositions(apiKey, apiSecret)) || [];

      if (positions.length === 0) {
        return;
      }

      // Atualiza cache de verificação
      OrderController.stopLossCheckCache.set(cacheKey, {
        lastCheck: now,
        hasStopLoss: false,
      });

      // Logar todas as posições abertas (monitoradas ou não)
      for (const position of positions) {
        const Account = await AccountController.get({
          apiKey,
          apiSecret,
          strategy: config?.strategyName || 'DEFAULT',
        });
        // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
        const exchangeManager = OrderController.getExchangeManager(config || {});
        const allMarkets = await exchangeManager.getMarkets();
        const marketInfo = allMarkets.find(m => m.symbol === position.symbol);

        // Verifica se marketInfo existe antes de acessar a propriedade fee
        if (!marketInfo) {
          // Posição manual em par não autorizado - usa configurações padrão
          const defaultFee = parseFloat(config?.fee || 0.0004);
          const entryPrice = parseFloat(
            position.avgEntryPrice || position.entryPrice || position.markPrice
          );
          const currentPrice = parseFloat(position.markPrice);
          const quantity = Math.abs(Number(position.netQuantity));
          const orderValue = entryPrice * quantity;
          const exitValue = currentPrice * quantity;
          const entryFee = orderValue * defaultFee;
          const exitFee = exitValue * defaultFee;
          const totalFee = entryFee + exitFee;

          // Usa a função calculatePnL do TrailingStop para calcular o PnL corretamente
          const leverage = Account.leverage;
          const { pnl, pnlPct } = TrailingStop.calculatePnL(position, Account);

          const percentFee = orderValue > 0 ? (totalFee / orderValue) * 100 : 0;
          OrderController.debug(
            `📋 [MANUAL_POSITION] ${position.symbol} | Volume: $${orderValue.toFixed(2)} | Taxa estimada: $${totalFee.toFixed(6)} (≈ ${percentFee.toFixed(2)}%) | PnL: $${pnl.toFixed(6)} (${pnlPct.toFixed(3)}%) | ⚠️ Par não configurado`
          );
          continue; // Pula criação de ordens para pares não autorizados
        }

        const fee = marketInfo.fee || config?.fee || 0.0004;
        const entryPrice = parseFloat(
          position.avgEntryPrice || position.entryPrice || position.markPrice
        );
        const currentPrice = parseFloat(position.markPrice);
        const quantity = Math.abs(Number(position.netQuantity));
        const orderValue = entryPrice * quantity;
        const exitValue = currentPrice * quantity;
        const entryFee = orderValue * fee;
        const exitFee = exitValue * fee;
        const totalFee = entryFee + exitFee;

        // Usa a função calculatePnL do TrailingStop para calcular o PnL corretamente
        const leverage = Account.leverage;
        const { pnl, pnlPct } = TrailingStop.calculatePnL(position, Account);

        const percentFee = orderValue > 0 ? (totalFee / orderValue) * 100 : 0;
        OrderController.debug(
          `[MONITOR][ALL] ${position.symbol} | Volume: $${orderValue.toFixed(2)} | Taxa total estimada (entrada+saída): $${totalFee.toFixed(6)} (≈ ${percentFee.toFixed(2)}%) | PnL atual: $${pnl.toFixed(6)} | PnL%: ${pnlPct.toFixed(3)}%`
        );
      }

      // Verifica se há posições que não estão sendo monitoradas
      const pendingAccountOrders = OrderController.pendingEntryOrdersByBot[botName] || {};
      const monitoredMarkets = Object.keys(pendingAccountOrders);
      const unmonitoredPositions = positions.filter(pos => !monitoredMarkets.includes(pos.symbol));

      if (unmonitoredPositions.length > 0) {
        // Verifica se já foram criados alvos para essas posições (evita loop infinito)
        for (const position of unmonitoredPositions) {
          // Verifica se o par está autorizado antes de tentar criar ordens
          const Account = await AccountController.get({
            apiKey,
            apiSecret,
            strategy: config?.strategyName || 'DEFAULT',
          });
          // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
          const exchangeManager = OrderController.getExchangeManager(config || {});
          const allMarkets = await exchangeManager.getMarkets();
          const marketInfo = allMarkets.find(m => m.symbol === position.symbol);

          if (!marketInfo) {
            OrderController.debug(
              `ℹ️ [MANUAL_POSITION] ${position.symbol}: Par não autorizado - pulando criação de ordens automáticas`
            );
            continue; // Pula posições em pares não autorizados
          }

          // SEMPRE valida e cria stop loss para todas as posições AUTORIZADAS
          await OrderController.validateAndCreateStopLoss(position, botName, config);

          // Log de debug para monitoramento
          OrderController.debug(`🛡️ [MONITOR] ${position.symbol}: Stop loss validado/criado`);

          // ✅ REMOVIDO: Take profit agora é gerenciado APENAS pelo monitor dedicado (startTakeProfitMonitor)
          // Evita duplicação de ordens de take profit
        }
      }
    } catch (error) {
      Logger.warn(
        `⚠️ [MONITOR-${botName}] Falha ao verificar posições não monitoradas:`,
        error.message
      );
    }
  }

  /**
   * Verifica se já existe uma ordem de stop loss para uma posição
   * @param {string} symbol - Símbolo do mercado
   * @param {object} position - Dados da posição
   * @param config
   * @returns {boolean} - True se já existe stop loss
   */
  static async hasExistingStopLoss(symbol, position, config) {
    try {
      // Verifica cache primeiro
      const cacheKey = `${symbol}_${position.netQuantity > 0 ? 'LONG' : 'SHORT'}`;
      const cached = OrderController.stopLossCheckCache.get(cacheKey);
      const now = Date.now();

      if (cached && now - cached.lastCheck < OrderController.stopLossCheckCacheTimeout) {
        // Usa resultado do cache se ainda é válido
        return cached.hasStopLoss;
      }

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
      const exchangeManager = OrderController.getExchangeManager({ apiKey, apiSecret });
      const existingOrders = await exchangeManager.getOpenOrdersForSymbol(symbol, apiKey, apiSecret);

      Logger.debug(
        `🔍 [STOP_LOSS_CHECK] ${symbol}: Encontradas ${existingOrders?.length || 0} ordens abertas`
      );

      if (!existingOrders || existingOrders.length === 0) {
        // Atualiza cache
        OrderController.stopLossCheckCache.set(cacheKey, {
          lastCheck: now,
          hasStopLoss: false,
        });
        Logger.debug(`🔍 [STOP_LOSS_CHECK] ${symbol}: Nenhuma ordem encontrada - retornando false`);
        return false;
      }

      // Obter preço de entrada da posição
      const entryPrice = parseFloat(position.entryPrice || position.avgEntryPrice || 0);
      const isLong = parseFloat(position.netQuantity) > 0;

      Logger.debug(
        `🔍 [STOP_LOSS_CHECK] ${symbol}: Verificando ordens - EntryPrice: ${entryPrice}, IsLong: ${isLong}, NetQuantity: ${position.netQuantity}`
      );

      const hasStopLossOrders = existingOrders.some(order => {
        const isReduceOnly = order.reduceOnly;
        const correctSide = order.side === (isLong ? 'Ask' : 'Bid');
        const isPending =
          order.status === 'Pending' ||
          order.status === 'New' ||
          order.status === 'PartiallyFilled' ||
          order.status === 'TriggerPending';

        // Verifica se tem trigger de stop loss
        const hasStopLossTrigger = order.stopLossTriggerPrice || order.stopLossLimitPrice;

        // Para ordens sem trigger, verifica se está posicionada corretamente
        let isCorrectlyPositioned = false;
        if (order.limitPrice) {
          const orderPrice = parseFloat(order.limitPrice);
          if (isLong) {
            // Para LONG: stop loss deve estar ABAIXO do preço de entrada
            isCorrectlyPositioned = orderPrice < entryPrice;
          } else {
            // Para SHORT: stop loss deve estar ACIMA do preço de entrada
            isCorrectlyPositioned = orderPrice > entryPrice;
          }
        }

        const isConditionalStopLoss =
          isReduceOnly &&
          correctSide &&
          (order.status === 'TriggerPending' || order.status === 'Pending');

        const isStopLossOrder =
          hasStopLossTrigger || isCorrectlyPositioned || isConditionalStopLoss;

        if (isPending) {
          const orderPrice = order.triggerPrice ? parseFloat(order.triggerPrice) : 'N/A';
          const positionType = isLong ? 'LONG' : 'SHORT';
          const expectedPosition = isLong ? 'ABAIXO' : 'ACIMA';
          const isCorrectlyPositioned = order.triggerPrice
            ? isLong
              ? orderPrice < entryPrice
              : orderPrice > entryPrice
            : 'N/A';

          Logger.debug(
            `🔍 [STOP_LOSS_CHECK] ${symbol}: Ordem ${order.id} - Status: ${order.status}, ReduceOnly: ${isReduceOnly}, Side: ${order.side}, Preço: ${orderPrice}, Tipo: ${positionType}, Entrada: ${entryPrice}, Posicionamento: ${isCorrectlyPositioned} (esperado: ${expectedPosition}), HasTrigger: ${hasStopLossTrigger}, IsStopLoss: ${isStopLossOrder}`
          );
        }

        // Log para TODAS as ordens (não apenas pending)
        Logger.debug(
          `🔍 [STOP_LOSS_CHECK] ${symbol}: Ordem ${order.id} - Status: ${order.status}, ReduceOnly: ${isReduceOnly}, Side: ${order.side}, HasTrigger: ${hasStopLossTrigger}, IsPending: ${isPending}, IsConditionalStopLoss: ${isConditionalStopLoss}, IsStopLoss: ${isStopLossOrder}`
        );

        return isStopLossOrder;
      });

      // Atualiza cache
      OrderController.stopLossCheckCache.set(cacheKey, {
        lastCheck: now,
        hasStopLoss: hasStopLossOrders,
      });

      Logger.debug(
        `🔍 [STOP_LOSS_CHECK] ${symbol}: Resultado final - HasStopLoss: ${hasStopLossOrders}, Cache atualizado`
      );

      return hasStopLossOrders;
    } catch (error) {
      Logger.error(
        `❌ [STOP_LOSS_CHECK] Erro ao verificar stop loss existente para ${symbol}:`,
        error.message
      );
      return false;
    }
  }

  /**
   * Limpa o cache de verificação de stop loss para um símbolo específico
   * @param {string} symbol - Símbolo do mercado
   */
  static clearStopLossCheckCache(symbol) {
    const keysToDelete = [];
    for (const [key, value] of OrderController.stopLossCheckCache.entries()) {
      if (key.startsWith(symbol + '_')) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      OrderController.stopLossCheckCache.delete(key);
    });

    if (keysToDelete.length > 0) {
      Logger.info(
        `🧹 [CACHE] Cache de stop loss limpo para ${symbol} (${keysToDelete.length} entradas)`
      );
    }
  }

  /**
   * Limpa o cache de verificação de take profit para um símbolo específico
   * @param {string} symbol - Símbolo do mercado
   */
  static clearTakeProfitCheckCache(symbol) {
    const keysToDelete = [];
    for (const [key, value] of OrderController.takeProfitCheckCache.entries()) {
      if (key.startsWith(symbol + '_')) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      OrderController.takeProfitCheckCache.delete(key);
    });

    if (keysToDelete.length > 0) {
      Logger.info(
        `🧹 [CACHE] Cache de take profit limpo para ${symbol} (${keysToDelete.length} entradas)`
      );
    }
  }

  /**
   * Monitor e limpeza de ordens órfãs (stop loss + take profit)
   * Remove ordens reduceOnly órfãs quando a posição foi fechada
   * @param {string} botName - Nome do bot
   * @param {object} config - Configuração do bot com credenciais
   * @returns {Promise<object>} Resultado da limpeza
   */
  static async monitorAndCleanupOrphanedOrders(botName, config = null) {
    try {
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      Logger.debug(`🧹 [${config.botName}][ORPHAN_MONITOR] Iniciando verificação de ordens órfãs`);

      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Futures direto
      const exchangeManager = OrderController.getExchangeManager({ apiKey, apiSecret });
      const positionsResult = await exchangeManager.getFuturesPositions(apiKey, apiSecret);
      const positions = Array.isArray(positionsResult) ? positionsResult : [];
      Logger.debug(
        `🧹 [${config.botName}][ORPHAN_MONITOR] Encontradas ${positions.length} posições abertas`
      );

      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: config?.strategyName || 'DEFAULT',
      });

      // 🚨 VALIDAÇÃO CRÍTICA: Garante que configuredSymbols é um array válido
      let configuredSymbols = config.authorizedTokens || [];
      if (!Array.isArray(configuredSymbols)) {
        Logger.error(
          `❌ [${config.botName}][ORPHAN_MONITOR] config.authorizedTokens não é um array - type: ${typeof config.authorizedTokens}, value:`,
          config.authorizedTokens
        );
        // Converte para array se for string separada por vírgula
        if (typeof config.authorizedTokens === 'string') {
          configuredSymbols = config.authorizedTokens
            .split(',')
            .map(s => s.trim())
            .filter(s => s);
          Logger.info(
            `🔧 [${config.botName}][ORPHAN_MONITOR] Convertido string para array: ${configuredSymbols.length} símbolos`
          );
        } else {
          configuredSymbols = [];
        }
      }

      // 🔍 VERIFICAÇÃO EXTRA: Testa se o array é iterável
      try {
        if (
          !configuredSymbols[Symbol.iterator] ||
          typeof configuredSymbols[Symbol.iterator] !== 'function'
        ) {
          Logger.error(
            `❌ [${config.botName}][ORPHAN_MONITOR] configuredSymbols não tem iterator válido - @@iterator: ${typeof configuredSymbols[Symbol.iterator]}`
          );
          return { orphaned: 0, cancelled: 0, errors: ['Array não iterável'], totalChecked: 0 };
        }
      } catch (iteratorError) {
        Logger.error(
          `❌ [${config.botName}][ORPHAN_MONITOR] Erro de validação do iterator:`,
          iteratorError.message
        );
        return { orphaned: 0, cancelled: 0, errors: ['Erro de iterator'], totalChecked: 0 };
      }

      Logger.debug(
        `🧹 [${config.botName}][ORPHAN_MONITOR] Verificando ${configuredSymbols.length} símbolos autorizados: ${configuredSymbols.join(', ')}`
      );

      let totalOrphanedOrders = 0;
      let totalCancelledOrders = 0;
      const errors = [];
      let totalOrdersChecked = 0;

      for (const symbol of configuredSymbols) {
        try {
          // Adiciona delay entre chamadas para evitar rate limit
          if (totalOrdersChecked > 0) {
            await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
          }

          // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
      const exchangeManager = OrderController.getExchangeManager({ apiKey, apiSecret });
      const openOrders = await exchangeManager.getOpenOrdersForSymbol(symbol, apiKey, apiSecret);

          if (!openOrders || openOrders.length === 0) {
            Logger.debug(`🧹 [${config.botName}][ORPHAN_MONITOR] ${symbol}: Nenhuma ordem aberta`);
            continue;
          }

          totalOrdersChecked += openOrders.length;
          Logger.debug(
            `🧹 [${config.botName}][ORPHAN_MONITOR] ${symbol}: ${openOrders.length} ordens abertas encontradas`
          );

          // 🔧 MELHORIA: Identifica TODAS as ordens reduceOnly órfãs (stop loss + take profit)
          const orphanedOrders = openOrders.filter(order => {
            // Só considera ordens reduceOnly como potenciais órfãs
            return order.reduceOnly === true;
          });

          if (orphanedOrders.length === 0) {
            Logger.debug(
              `🧹 [${config.botName}][ORPHAN_MONITOR] ${symbol}: Nenhuma ordem reduceOnly encontrada`
            );
            continue;
          }

          // Categoriza as ordens órfãs por tipo para logging melhor
          const stopLossOrders = orphanedOrders.filter(order => {
            const hasStopLossTrigger = order.stopLossTriggerPrice || order.stopLossLimitPrice;
            return (
              hasStopLossTrigger || (!order.takeProfitTriggerPrice && !order.takeProfitLimitPrice)
            );
          });

          const takeProfitOrders = orphanedOrders.filter(order => {
            return order.takeProfitTriggerPrice || order.takeProfitLimitPrice;
          });

          Logger.debug(
            `🧹 [${config.botName}][ORPHAN_MONITOR] ${symbol}: ${orphanedOrders.length} ordens reduceOnly (${stopLossOrders.length} SL + ${takeProfitOrders.length} TP)`
          );

          const position = positions.find(p => p.symbol === symbol);

          // Verifica se posição está fechada (órfã)
          if (!position || Math.abs(Number(position.netQuantity)) === 0) {
            Logger.info(
              `🧹 [${config.botName}][ORPHAN_MONITOR] ${symbol}: POSIÇÃO FECHADA - ${orphanedOrders.length} ordens órfãs detectadas (${stopLossOrders.length} SL + ${takeProfitOrders.length} TP)`
            );

            totalOrphanedOrders += orphanedOrders.length;

            // Log detalhado das ordens órfãs
            for (const order of orphanedOrders) {
              // 🚨 VALIDAÇÃO CRÍTICA: Verifica se order é um objeto válido
              if (!order || typeof order !== 'object' || order === null) {
                Logger.error(
                  `❌ [${config.botName}][ORPHAN_MONITOR] ${symbol}: order é null ou inválido - type: ${typeof order}, value:`,
                  order
                );
                continue;
              }
              const orderType =
                order.stopLossTriggerPrice || order.stopLossLimitPrice
                  ? 'STOP_LOSS'
                  : order.takeProfitTriggerPrice || order.takeProfitLimitPrice
                    ? 'TAKE_PROFIT'
                    : 'REDUCE_ONLY';
              const triggerPrice =
                order.stopLossTriggerPrice || order.takeProfitTriggerPrice || order.limitPrice;
              Logger.debug(
                `🧹 [${config.botName}][ORPHAN_MONITOR] ${symbol}: Ordem órfã ${orderType} - ID: ${order.id}, Preço: ${triggerPrice}, ReduceOnly: ${order.reduceOnly}`
              );
            }

            // Cancela as ordens órfãs
            for (const order of orphanedOrders) {
              // 🚨 VALIDAÇÃO CRÍTICA: Verifica se order é um objeto válido
              if (!order || typeof order !== 'object' || order === null) {
                Logger.error(
                  `❌ [${config.botName}][ORPHAN_MONITOR] ${symbol}: order é null ou inválido no cancelamento - type: ${typeof order}, value:`,
                  order
                );
                continue;
              }
              const orderId = order.id;

              try {
                // Adiciona delay entre cancelamentos
                await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay

                Logger.debug(
                  `🧹 [${config.botName}][ORPHAN_MONITOR] ${symbol}: Tentando cancelar ordem órfã ${orderId}`
                );

                // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
                const exchangeMgr = OrderController.getExchangeManager({ apiKey, apiSecret });
                const cancelResult = await exchangeManager.cancelOpenOrder(
                  symbol,
                  orderId,
                  null,
                  apiKey,
                  apiSecret
                );

                if (cancelResult && !cancelResult.error) {
                  totalCancelledOrders++;
                  Logger.info(
                    `✅ [${config.botName}][ORPHAN_MONITOR] ${symbol}: Ordem órfã ${orderId} cancelada com sucesso`
                  );

                  // Atualiza status no banco de dados
                  try {
                    await BotOrdersManager.updateOrder(orderId, {
                      status: 'CANCELLED',
                      closeTime: new Date().toISOString(),
                      closeType: 'ORPHAN_CLEANUP',
                    });
                    Logger.debug(
                      `📝 [${config.botName}][ORPHAN_MONITOR] ${symbol}: Status da ordem ${orderId} atualizado no banco para CANCELLED`
                    );
                  } catch (dbError) {
                    Logger.warn(
                      `⚠️ [${config.botName}][ORPHAN_MONITOR] ${symbol}: Erro ao atualizar status da ordem ${orderId} no banco: ${dbError.message}`
                    );
                    // Não propaga o erro pois o cancelamento na exchange foi bem-sucedido
                  }

                  OrderController.clearStopLossCheckCache(symbol);
                } else {
                  const errorMsg = cancelResult?.error || 'desconhecido';
                  Logger.warn(
                    `❌ [${config.botName}][ORPHAN_MONITOR] ${symbol}: Falha ao cancelar ordem órfã - OrderID: ${orderId}, Erro: ${errorMsg}`
                  );
                  errors.push(`${symbol} (${orderId}): ${errorMsg}`);
                }
              } catch (error) {
                // Verifica se é erro de rate limit
                if (
                  error?.response?.status === 429 ||
                  String(error).includes('rate limit') ||
                  String(error).includes('429')
                ) {
                  Logger.warn(
                    `⚠️ [${config.botName}][ORPHAN_MONITOR] ${symbol}: Rate limit detectado ao cancelar ordem ${orderId}, pulando`
                  );
                  errors.push(`${symbol} (${orderId}): Rate limit`);
                  // Para de tentar cancelar mais ordens deste símbolo para evitar mais rate limits
                  break;
                } else {
                  Logger.error(
                    `❌ [${config.botName}][ORPHAN_MONITOR] Erro ao cancelar ordem ${orderId} para ${symbol}:`,
                    error.message
                  );
                  errors.push(`${symbol} (${orderId}): ${error.message}`);
                }
              }
            }
          } else {
            Logger.debug(
              `🧹 [${config.botName}][ORPHAN_MONITOR] ${symbol}: Posição ativa (${position.netQuantity}), ${orphanedOrders.length} ordens reduceOnly são válidas`
            );
          }
        } catch (error) {
          // Verifica se é erro de rate limit no nível do símbolo
          if (
            error?.response?.status === 429 ||
            String(error).includes('rate limit') ||
            String(error).includes('429')
          ) {
            Logger.warn(
              `⚠️ [${config.botName}][ORPHAN_MONITOR] ${symbol}: Rate limit detectado, pulando símbolo`
            );
            errors.push(`${symbol}: Rate limit`);
          } else {
            Logger.error(
              `❌ [${config.botName}][ORPHAN_MONITOR] Erro ao verificar ordens para ${symbol}:`,
              error.message
            );
            errors.push(`${symbol}: ${error.message}`);
          }
        }
      }

      // Log do resultado final
      if (totalOrphanedOrders > 0) {
        Logger.info(`🧹 [${config.botName}][ORPHAN_MONITOR] Monitoramento concluído:`);
        Logger.info(`   • Ordens totais verificadas: ${totalOrdersChecked}`);
        Logger.info(`   • Ordens órfãs detectadas: ${totalOrphanedOrders}`);
        Logger.info(`   • Ordens canceladas: ${totalCancelledOrders}`);
        Logger.info(`   • Erros: ${errors.length}`);

        if (errors.length > 0) {
          Logger.warn(`   • Detalhes dos erros: ${errors.join(', ')}`);
        }
      } else {
        Logger.debug(
          `🧹 [${config.botName}][ORPHAN_MONITOR] Nenhuma ordem órfã encontrada (${totalOrdersChecked} ordens verificadas)`
        );
      }

      return {
        orphaned: totalOrphanedOrders,
        cancelled: totalCancelledOrders,
        errors,
        totalChecked: totalOrdersChecked,
      };
    } catch (error) {
      // Verifica se é erro de rate limit no nível global
      if (
        error?.response?.status === 429 ||
        String(error).includes('rate limit') ||
        String(error).includes('429')
      ) {
        Logger.warn(
          `⚠️ [${config.botName}][ORPHAN_MONITOR] Rate limit detectado no monitoramento global`
        );
        return { orphaned: 0, cancelled: 0, errors: ['Rate limit global'], totalChecked: 0 };
      } else {
        Logger.error(
          `❌ [${config.botName}][ORPHAN_MONITOR] Erro no monitoramento de ordens órfãs:`,
          error.message
        );
        return { orphaned: 0, cancelled: 0, errors: [error.message], totalChecked: 0 };
      }
    }
  }

  /**
   * Método para escanear e limpar TODAS as ordens órfãs na corretora (global).
   * Este método verifica na corretora todas as ordens abertas e cancela aquelas
   * que não possuem mais uma posição ativa correspondente.
   *
   * @param {string} botName - Nome do bot para monitorar
   * @param {object} config - Configurações específicas do bot (apiKey, apiSecret, etc.)
   * @returns {object} Resultado da operação: { orphaned, cancelled, errors }
   */
  static async scanAndCleanupAllOrphanedOrders(botName, config = null) {
    try {
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios');
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      Logger.debug(
        `🔍 [${config.botName}][SCAN_CLEANUP] Iniciando limpeza de ordens órfãs na corretora`
      );

      // 1. Busca TODAS as ordens abertas na corretora (sem especificar símbolo)
      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
      const exchangeManager = OrderController.getExchangeManager({ apiKey, apiSecret });
      const allOpenOrders = (await exchangeManager.getOpenOrdersForSymbol(null, apiKey, apiSecret)) || [];
      Logger.debug(
        `🔍 [${config.botName}][SCAN_CLEANUP] Encontradas ${allOpenOrders.length} ordens abertas na corretora`
      );

      if (allOpenOrders.length === 0) {
        Logger.info(`✅ [${config.botName}][SCAN_CLEANUP] Nenhuma ordem aberta encontrada`);
        return { orphaned: 0, cancelled: 0, errors: [], ordersScanned: 0 };
      }

      // 2. Busca TODAS as posições abertas na corretora
      // 🔧 MIGRAÇÃO: Reutiliza ExchangeManager já criado acima
      const positions = (await exchangeManager.getFuturesPositions(apiKey, apiSecret)) || [];
      const activeSymbols = new Set();

      // 🚨 VALIDAÇÃO CRÍTICA: Verifica se positions é iterável
      if (
        !Array.isArray(positions) ||
        !positions[Symbol.iterator] ||
        typeof positions[Symbol.iterator] !== 'function'
      ) {
        Logger.error(
          `❌ [${config.botName}][SCAN_CLEANUP] positions não é iterável - type: ${typeof positions}, isArray: ${Array.isArray(positions)}`
        );
        return { orphaned: 0, cancelled: 0, errors: ['positions not iterable'], ordersScanned: 0 };
      }

      // Mapa de símbolos com posições ativas (quantidade > 0)
      for (const position of positions) {
        // 🚨 VALIDAÇÃO CRÍTICA: Verifica se position é um objeto válido
        if (!position || typeof position !== 'object' || position === null) {
          Logger.error(
            `❌ [${config.botName}][SCAN_CLEANUP] position é null ou inválido - type: ${typeof position}, value:`,
            position
          );
          continue;
        }
        if (Math.abs(Number(position.netQuantity)) > 0) {
          activeSymbols.add(position.symbol);
        }
      }

      Logger.debug(
        `🔍 [${config.botName}][SCAN_CLEANUP] Encontradas ${positions.length} posições, ${activeSymbols.size} símbolos com posição ativa`
      );
      Logger.debug(
        `🔍 [${config.botName}][SCAN_CLEANUP] Símbolos com posição: ${Array.from(activeSymbols).join(', ') || 'nenhum'}`
      );

      // 3. Identifica ordens órfãs: ordens reduceOnly que não possuem posição ativa correspondente
      const orphanedOrders = [];

      // 🚨 VALIDAÇÃO CRÍTICA: Verifica se allOpenOrders é iterável
      if (
        !Array.isArray(allOpenOrders) ||
        !allOpenOrders[Symbol.iterator] ||
        typeof allOpenOrders[Symbol.iterator] !== 'function'
      ) {
        Logger.error(
          `❌ [${config.botName}][SCAN_CLEANUP] allOpenOrders não é iterável - type: ${typeof allOpenOrders}, isArray: ${Array.isArray(allOpenOrders)}`
        );
        return {
          orphaned: 0,
          cancelled: 0,
          errors: ['allOpenOrders not iterable'],
          ordersScanned: 0,
        };
      }

      for (const order of allOpenOrders) {
        // 🚨 VALIDAÇÃO CRÍTICA: Verifica se order é um objeto válido
        if (!order || typeof order !== 'object' || order === null) {
          Logger.error(
            `❌ [${config.botName}][SCAN_CLEANUP] order é null ou inválido - type: ${typeof order}, value:`,
            order
          );
          continue;
        }
        const isReduceOnly = order.reduceOnly === true;
        const hasActivePosition = activeSymbols.has(order.symbol);

        // Se é reduceOnly E não há posição ativa para este símbolo, a ordem é órfã
        if (isReduceOnly && !hasActivePosition) {
          orphanedOrders.push(order);
          Logger.debug(
            `🔍 [${config.botName}][SCAN_CLEANUP] Ordem órfã detectada: ${order.symbol} - ID: ${order.id}, Tipo: ${order.orderType}, ReduceOnly: ${order.reduceOnly}`
          );
        }
      }

      if (orphanedOrders.length === 0) {
        Logger.info(`✅ [${config.botName}][SCAN_CLEANUP] Nenhuma ordem órfã encontrada`);
        return { orphaned: 0, cancelled: 0, errors: [], ordersScanned: allOpenOrders.length };
      }

      Logger.info(
        `🧹 [${config.botName}][SCAN_CLEANUP] ${orphanedOrders.length} ordens órfãs detectadas`
      );

      // 4. Cancela as ordens órfãs encontradas
      let totalCancelledOrders = 0;
      const errors = [];

      // 🚨 VALIDAÇÃO CRÍTICA: Verifica se orphanedOrders é iterável
      if (
        !Array.isArray(orphanedOrders) ||
        !orphanedOrders[Symbol.iterator] ||
        typeof orphanedOrders[Symbol.iterator] !== 'function'
      ) {
        Logger.error(
          `❌ [${config.botName}][SCAN_CLEANUP] orphanedOrders não é iterável - type: ${typeof orphanedOrders}, isArray: ${Array.isArray(orphanedOrders)}`
        );
        return {
          orphaned: 0,
          cancelled: 0,
          errors: ['orphanedOrders not iterable'],
          ordersScanned: allOpenOrders.length,
        };
      }

      for (const order of orphanedOrders) {
        // 🚨 VALIDAÇÃO CRÍTICA: Verifica se order é um objeto válido
        if (!order || typeof order !== 'object' || order === null) {
          Logger.error(
            `❌ [${config.botName}][SCAN_CLEANUP] order é null ou inválido no cancelamento - type: ${typeof order}, value:`,
            order
          );
          continue;
        }
        try {
          await new Promise(resolve => setTimeout(resolve, 150)); // Delay entre cancelamentos

          Logger.debug(
            `🧹 [${config.botName}][SCAN_CLEANUP] Cancelando ordem órfã ${order.symbol} - ID: ${order.id}`
          );

          // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
          const exchangeMgr = OrderController.getExchangeManager({ apiKey, apiSecret });
          const cancelResult = await exchangeManager.cancelOpenOrder(
            order.symbol,
            order.id,
            null,
            apiKey,
            apiSecret
          );

          if (cancelResult && !cancelResult.error) {
            totalCancelledOrders++;
            Logger.info(
              `✅ [${config.botName}][SCAN_CLEANUP] Ordem órfã cancelada: ${order.symbol} - ID: ${order.id}`
            );

            // Atualiza status no banco de dados se existir
            try {
              await BotOrdersManager.updateOrder(order.id, {
                status: 'CANCELLED',
                closeTime: new Date().toISOString(),
                closeType: 'ORPHAN_CLEANUP',
              });
            } catch (dbError) {
              // Ignora erros de banco (ordem pode não estar registrada localmente)
              Logger.debug(
                `📝 [${config.botName}][SCAN_CLEANUP] Ordem ${order.id} não encontrada no banco local (normal para ordens externas)`
              );
            }
          } else {
            const errorMsg = cancelResult?.error || 'desconhecido';
            errors.push(`${order.symbol}:${order.id} - ${errorMsg}`);
            Logger.warn(
              `❌ [${config.botName}][SCAN_CLEANUP] Falha ao cancelar ordem órfã ${order.symbol}:${order.id} - ${errorMsg}`
            );
          }
        } catch (error) {
          if (error?.response?.status === 429 || String(error).includes('rate limit')) {
            Logger.warn(`⚠️ [${config.botName}][SCAN_CLEANUP] Rate limit detectado, pausando 2s`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            errors.push(`${order.symbol}:${order.id} - Rate limit`);
          } else {
            errors.push(`${order.symbol}:${order.id} - ${error.message}`);
            Logger.error(
              `❌ [${config.botName}][SCAN_CLEANUP] Erro ao cancelar ordem ${order.symbol}:${order.id}:`,
              error.message
            );
          }
        }
      }

      // Log do resultado final
      Logger.info(`🧹 [${config.botName}][SCAN_CLEANUP] Limpeza finalizada:`);
      Logger.info(`   • Ordens verificadas: ${allOpenOrders.length}`);
      Logger.info(`   • Ordens órfãs detectadas: ${orphanedOrders.length}`);
      Logger.info(`   • Ordens canceladas: ${totalCancelledOrders}`);
      Logger.info(`   • Erros: ${errors.length}`);

      if (errors.length > 0) {
        Logger.warn(`   • Detalhes dos erros: ${errors.join(', ')}`);
      }

      return {
        orphaned: orphanedOrders.length,
        cancelled: totalCancelledOrders,
        errors,
        ordersScanned: allOpenOrders.length,
      };
    } catch (error) {
      Logger.error(
        `❌ [${config.botName}][SCAN_CLEANUP] Erro na limpeza de ordens órfãs:`,
        error.message
      );
      return { orphaned: 0, cancelled: 0, errors: [error.message], ordersScanned: 0 };
    }
  }

  /**
   * 🧹 MÉTODO UTILITÁRIO para cancelar TODAS as ordens órfãs de forma agressiva
   *
   * Este método é mais agressivo e cancela todas as ordens reduceOnly
   * quando não há posições abertas. Use quando o método principal
   * não conseguir limpar todas as ordens órfãs.
   *
   * @param {string} botName - Nome do bot para monitorar
   * @param {object} config - Configurações específicas do bot (apiKey, apiSecret, etc.)
   * @returns {object} Resultado da operação: { orphaned, cancelled, errors }
   */
  static async forceCleanupAllOrphanedOrders(botName, config = null) {
    try {
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios');
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      Logger.info(
        `🧹 [${config.botName}][FORCE_CLEANUP] Iniciando limpeza agressiva de ordens órfãs`
      );

      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Futures direto
      const exchangeManager = OrderController.getExchangeManager({ apiKey, apiSecret });
      const positions = (await exchangeManager.getFuturesPositions(apiKey, apiSecret)) || [];
      const activeSymbols = positions
        .filter(p => Math.abs(Number(p.netQuantity)) > 0)
        .map(p => p.symbol);

      Logger.info(
        `🧹 [${config.botName}][FORCE_CLEANUP] Posições ativas encontradas: ${activeSymbols.join(', ') || 'nenhuma'}`
      );

      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: config?.strategyName || 'DEFAULT',
      });

      // 🔧 CORREÇÃO: Usa authorizedTokens ao invés de Account.markets
      const configuredSymbols = config.authorizedTokens || [];

      let totalOrphanedOrders = 0;
      let totalCancelledOrders = 0;
      const errors = [];

      for (const symbol of configuredSymbols) {
        try {
          // Pula símbolos com posições ativas
          if (activeSymbols.includes(symbol)) {
            Logger.debug(`🧹 [${config.botName}][FORCE_CLEANUP] ${symbol}: Posição ativa, pulando`);
            continue;
          }

          // Delay para evitar rate limit
          await new Promise(resolve => setTimeout(resolve, 300));

          // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
      const exchangeManager = OrderController.getExchangeManager({ apiKey, apiSecret });
      const openOrders = await exchangeManager.getOpenOrdersForSymbol(symbol, apiKey, apiSecret);

          if (!openOrders || openOrders.length === 0) {
            continue;
          }

          // Identifica TODAS as ordens reduceOnly como potenciais órfãs
          const orphanedOrders = openOrders.filter(order => {
            return order.reduceOnly === true;
          });

          if (orphanedOrders.length === 0) {
            continue;
          }

          Logger.info(
            `🧹 [${config.botName}][FORCE_CLEANUP] ${symbol}: ${orphanedOrders.length} ordens reduceOnly órfãs detectadas`
          );
          totalOrphanedOrders += orphanedOrders.length;

          // Cancela todas as ordens órfãs
          for (const order of orphanedOrders) {
            try {
              await new Promise(resolve => setTimeout(resolve, 150)); // Delay menor para limpeza rápida

              // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
              const exchangeMgr = OrderController.getExchangeManager({ apiKey, apiSecret });
              const cancelResult = await exchangeManager.cancelOpenOrder(
                symbol,
                order.id,
                null,
                apiKey,
                apiSecret
              );

              if (cancelResult && !cancelResult.error) {
                totalCancelledOrders++;
                Logger.info(
                  `✅ [${config.botName}][FORCE_CLEANUP] ${symbol}: Ordem ${order.id} cancelada`
                );

                // Atualiza status no banco de dados
                try {
                  await BotOrdersManager.updateOrder(order.id, {
                    status: 'CANCELLED',
                    closeTime: new Date().toISOString(),
                    closeType: 'FORCE_ORPHAN_CLEANUP',
                  });
                  Logger.debug(
                    `📝 [${config.botName}][FORCE_CLEANUP] ${symbol}: Status da ordem ${order.id} atualizado no banco para CANCELLED`
                  );
                } catch (dbError) {
                  Logger.warn(
                    `⚠️ [${config.botName}][FORCE_CLEANUP] ${symbol}: Erro ao atualizar status da ordem ${order.id} no banco: ${dbError.message}`
                  );
                  // Não propaga o erro pois o cancelamento na exchange foi bem-sucedido
                }
              } else {
                const errorMsg = cancelResult?.error || 'desconhecido';
                Logger.warn(
                  `❌ [${config.botName}][FORCE_CLEANUP] ${symbol}: Falha ao cancelar ${order.id}: ${errorMsg}`
                );
                errors.push(`${symbol} (${order.id}): ${errorMsg}`);
              }
            } catch (error) {
              if (error?.response?.status === 429 || String(error).includes('rate limit')) {
                Logger.warn(
                  `⚠️ [${config.botName}][FORCE_CLEANUP] ${symbol}: Rate limit, pausando 2s`
                );
                await new Promise(resolve => setTimeout(resolve, 2000));
                errors.push(`${symbol} (${order.id}): Rate limit`);
                break; // Para de cancelar ordens deste símbolo
              } else {
                Logger.error(
                  `❌ [${config.botName}][FORCE_CLEANUP] Erro ao cancelar ${order.id}:`,
                  error.message
                );
                errors.push(`${symbol} (${order.id}): ${error.message}`);
              }
            }
          }
        } catch (error) {
          if (error?.response?.status === 429 || String(error).includes('rate limit')) {
            Logger.warn(`⚠️ [${config.botName}][FORCE_CLEANUP] ${symbol}: Rate limit no símbolo`);
            errors.push(`${symbol}: Rate limit`);
          } else {
            Logger.error(
              `❌ [${config.botName}][FORCE_CLEANUP] Erro no símbolo ${symbol}:`,
              error.message
            );
            errors.push(`${symbol}: ${error.message}`);
          }
        }
      }

      Logger.info(`🧹 [${config.botName}][FORCE_CLEANUP] Limpeza agressiva concluída:`);
      Logger.info(`   • Ordens órfãs detectadas: ${totalOrphanedOrders}`);
      Logger.info(`   • Ordens canceladas: ${totalCancelledOrders}`);
      Logger.info(`   • Erros: ${errors.length}`);

      return {
        orphaned: totalOrphanedOrders,
        cancelled: totalCancelledOrders,
        errors,
      };
    } catch (error) {
      Logger.error(
        `❌ [${config.botName}][FORCE_CLEANUP] Erro na limpeza agressiva:`,
        error.message
      );
      return { orphaned: 0, cancelled: 0, errors: [error.message] };
    }
  }

  /**
   * Cria uma ordem LIMIT com triggers de stop loss e take profit anexados
   * @param {object} orderData - Dados da ordem
   * @returns {object} - Resultado da criação da ordem
   */
  static async createLimitOrderWithTriggers(orderData) {
    try {
      const {
        market,
        action,
        entry,
        quantity,
        stop,
        target,
        decimal_quantity,
        decimal_price,
        stepSize_quantity,
        botName = 'DEFAULT',
        config = null,
      } = orderData;

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }

      // TRAVA DE SEGURANÇA: Verifica limite de ordens antes de criar nova ordem de abertura
      const maxOpenOrders = config.maxOpenOrders || 3;
      if (await OrderController.checkOrderLimit(market, config, maxOpenOrders)) {
        Logger.warn(
          `[ORDER_REJECTED] Limite de ordens (${maxOpenOrders}) para ${market} já atingido. Nenhuma nova ordem será criada.`
        );
        return {
          success: false,
          error: `Limite de ${maxOpenOrders} ordens por símbolo atingido`,
          ordersRejected: true,
        };
      }

      // Valida se os dados de decimal estão disponíveis
      if (
        decimal_quantity === undefined ||
        decimal_quantity === null ||
        decimal_price === undefined ||
        decimal_price === null ||
        stepSize_quantity === undefined ||
        stepSize_quantity === null
      ) {
        throw new Error(
          `Dados de decimal ausentes para ${market}. decimal_quantity: ${decimal_quantity}, decimal_price: ${decimal_price}, stepSize_quantity: ${stepSize_quantity}`
        );
      }

      const formatPrice = value => parseFloat(value).toFixed(decimal_price).toString();

      const formattedQuantity = parseFloat(quantity).toFixed(decimal_quantity);

      if (parseFloat(formattedQuantity) <= 0) {
        Logger.error(`❌ [QUANTITY_ERROR] ${market}: Quantidade inválida ${formattedQuantity}`);
        return {
          success: false,
          error: 'Quantidade calculada inválida',
          ordersRejected: true,
        };
      }

      const finalQuantity = parseFloat(formattedQuantity);
      Logger.debug(`✅ [FORMAT] ${market}: Quantidade formatada: ${quantity} → ${finalQuantity}`);

      const formatQuantity = value => {
        // Garante que a quantidade seja sempre positiva
        if (value <= 0) {
          throw new Error(`Quantidade deve ser positiva: ${value}`);
        }

        // Se decimal_quantity é 0, usa pelo menos 1 casa decimal para evitar 0.0
        const decimals = Math.max(decimal_quantity, 1);
        let formatted = parseFloat(value).toFixed(decimals);

        // Se ainda resultar em 0.0, tenta com mais casas decimais
        if (parseFloat(formatted) === 0 && value > 0) {
          formatted = parseFloat(value).toFixed(Math.max(decimals, 4));
        }

        // Se ainda for zero, usa o stepSize_quantity como mínimo
        if (parseFloat(formatted) === 0 && stepSize_quantity > 0) {
          formatted = stepSize_quantity.toString();
        }

        // Limita o número de casas decimais para evitar "decimal too long"
        const maxDecimals = Math.min(decimals, 4);
        const finalFormatted = parseFloat(formatted).toFixed(maxDecimals).toString();

        // Validação final: se ainda for zero, usa o mínimo possível
        if (parseFloat(finalFormatted) === 0) {
          return stepSize_quantity > 0 ? stepSize_quantity.toString() : '0.0001';
        }

        return finalFormatted;
      };

      // Debug: Verifica a quantidade antes da formatação
      Logger.info(`🔍 [DEBUG] Valores na createLimitOrderWithTriggers:`);
      Logger.info(`   • Quantity (raw): ${quantity}`);
      Logger.info(`   • Quantity (validated): ${finalQuantity}`);
      Logger.info(`   • Quantity (formatted): ${formatQuantity(finalQuantity)}`);
      Logger.info(`   • Entry (raw): ${entry}`);
      Logger.info(`   • Entry (formatted): ${formatPrice(entry)}`);
      Logger.info(`   • Market decimals: quantity=${decimal_quantity}, price=${decimal_price}`);

      // Valida se a quantidade é positiva
      if (finalQuantity <= 0) {
        throw new Error(
          `Quantidade inválida: ${finalQuantity}. Original: ${quantity}, Entry: ${entry}`
        );
      }

      // Calcula o valor da ordem para verificar margem
      const orderValue = finalQuantity * entry;
      Logger.info(`   💰 [DEBUG] Valor da ordem: $${orderValue.toFixed(2)}`);

      // Verifica se o preço está muito próximo do preço atual (pode causar "Order would immediately match")
      const currentPrice = await this.getCurrentPrice(market);
      if (currentPrice) {
        const priceDiff = Math.abs(entry - currentPrice) / currentPrice;
        const minSpreadPercent = 0.001; // 0.1% de spread mínimo (reduzido para compatibilidade)

        if (priceDiff < minSpreadPercent) {
          Logger.info(
            `   ⚠️  ${market}: Preço muito próximo do atual (${priceDiff.toFixed(4)}), ajustando...`
          );
          // Ajusta o preço para ter pelo menos 0.1% de spread
          const minSpread = currentPrice * minSpreadPercent;
          if (action === 'long') {
            entry = currentPrice - minSpread;
          } else {
            entry = currentPrice + minSpread;
          }
          Logger.info(
            `   ✅ ${market}: Preço ajustado para ${formatPrice(entry)} (spread: ${(minSpreadPercent * 100).toFixed(1)}%)`
          );
        }
      }

      // Prepara o corpo da requisição para a ordem LIMIT com stop loss e take profit integrados
      const orderBody = {
        symbol: market,
        side: action === 'long' ? 'Bid' : 'Ask',
        orderType: 'Limit',
        postOnly: true,
        quantity: formatQuantity(finalQuantity),
        price: formatPrice(entry),
        timeInForce: 'GTC',
        selfTradePrevention: 'RejectTaker',
        clientId: await OrderController.generateUniqueOrderId(config),
      };

      // Adiciona parâmetros de stop loss se fornecido
      if (stop) {
        orderBody.stopLossTriggerBy = 'LastPrice';
        orderBody.stopLossTriggerPrice = formatPrice(stop);
        orderBody.stopLossLimitPrice = formatPrice(stop);
        Logger.info(`🛑 Stop Loss configurado: ${market} @ ${formatPrice(stop)}`);
      }

      // Adiciona parâmetros de take profit se fornecido
      if (target) {
        orderBody.takeProfitTriggerBy = 'LastPrice';
        orderBody.takeProfitTriggerPrice = formatPrice(target);
        orderBody.takeProfitLimitPrice = formatPrice(target);
        Logger.info(`🎯 Take Profit configurado: ${market} @ ${formatPrice(target)}`);
      }

      Logger.info(
        `🚀 [${botName}] Criando ordem LIMIT: ${market} ${action.toUpperCase()} @ $${formatPrice(entry)}`
      );
      Logger.info(`   📋 Detalhes da ordem:`, {
        symbol: market,
        side: orderBody.side,
        quantity: formatQuantity(finalQuantity),
        price: formatPrice(entry),
        stopLoss: stop ? formatPrice(stop) : 'N/A',
        takeProfit: target ? formatPrice(target) : 'N/A',
        orderValue: (finalQuantity * entry).toFixed(2),
      });

      try {
        // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
        const exchangeManager = OrderController.getExchangeManager(config);
        const response = await exchangeManager.executeOrder(orderBody, config.apiKey, config.apiSecret);

        if (response && (response.orderId || response.id)) {
          const orderId = response.orderId || response.id;
          Logger.info(`✅ [${botName}] Ordem criada com sucesso: ${market} (ID: ${orderId})`);

          // Registra a ordem para monitoramento (apenas para estratégia PRO_MAX)
          if (botName === 'PRO_MAX') {
            OrderController.addPendingEntryOrder(
              market,
              {
                stop: stop,
                isLong: action === 'long',
                orderId: orderId,
              },
              botName
            );
          }

          return {
            success: true,
            orderId: orderId,
            market: market,
            action: action,
            entry: entry,
            quantity: quantity,
            stop: stop,
            target: target,
            botName: orderData.botName || 'DEFAULT',
          };
        } else {
          throw new Error(`Resposta inválida da API: ${JSON.stringify(response)}`);
        }
      } catch (error) {
        // Log detalhado do erro com todos os parâmetros
        const errorDetails = {
          market: market,
          action: action,
          entry: entry,
          quantity: quantity,
          validatedQuantity: finalQuantity,
          stop: stop,
          target: target,
          decimal_quantity: decimal_quantity,
          decimal_price: decimal_price,
          stepSize_quantity: stepSize_quantity,
          orderValue: (finalQuantity * entry).toFixed(2),
          formattedQuantity: formatQuantity(finalQuantity),
          formattedEntry: formatPrice(entry),
        };

        Logger.error(
          `❌ [ORDER_FAIL] Falha ao criar ordem para ${market}. Detalhes: ${JSON.stringify(errorDetails)}. Erro: ${error.message}`
        );

        return {
          success: false,
          error: error.message,
          details: errorDetails,
        };
      }
    } catch (error) {
      Logger.error(`❌ Erro ao criar ordem LIMIT com triggers: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Obtém o preço atual de um mercado
   * @param {string} market - Símbolo do mercado
   * @returns {number|null} - Preço atual ou null se não conseguir obter
   */
  static async getCurrentPrice(market) {
    try {
      const { default: Markets } = await import('../Backpack/Public/Markets.js');
      const markets = new Markets();
      const ticker = await markets.getTicker(market);

      if (ticker && ticker?.lastPrice) {
        return parseFloat(ticker?.lastPrice);
      }

      return null;
    } catch (error) {
      Logger.warn(`⚠️  [PRICE] Erro ao obter preço atual para ${market}:`, error.message);
      return null;
    }
  }

  /**
   * Verifica se uma ordem está posicionada corretamente como stop loss
   * @param {object} order - Dados da ordem
   * @param {object} position - Dados da posição
   * @returns {boolean} - True se a ordem está posicionada corretamente como stop loss
   */
  static isOrderCorrectlyPositionedAsStopLoss(order, position) {
    try {
      // Validações básicas
      if (!order || !position) {
        return false;
      }

      // Precisa ter pelo menos um dos preços
      if (!order.limitPrice && !order.triggerPrice) {
        return false;
      }

      // Determina se é posição LONG ou SHORT
      const isLongPosition = parseFloat(position.netQuantity) > 0;
      const entryPrice = parseFloat(position.avgEntryPrice || position.entryPrice);
      const orderPrice = parseFloat(order.triggerPrice || order.limitPrice);

      if (!entryPrice || !orderPrice) {
        return false;
      }

      // Para posição LONG: stop loss deve estar ABAIXO do preço de entrada
      // Para posição SHORT: stop loss deve estar ACIMA do preço de entrada
      if (isLongPosition) {
        return orderPrice < entryPrice; // Stop loss abaixo da entrada para LONG
      } else {
        return orderPrice > entryPrice; // Stop loss acima da entrada para SHORT
      }
    } catch (error) {
      Logger.error('❌ [ORDER_CONTROLLER] Erro ao validar posição do stop loss:', error.message);
      return false;
    }
  }

  /**
   * Verifica se existe stop loss para uma posição
   * @param {string} symbol - Símbolo do mercado
   * @param {object} position - Dados da posição
   * @param {object} config - Configurações (apiKey, apiSecret)
   * @returns {boolean} - True se existe stop loss
   */
  static async hasStopLossForPosition(symbol, position, config = null) {
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error(
          'API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot'
        );
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Busca ordens abertas para o símbolo
      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
      const exchangeManager = OrderController.getExchangeManager({ apiKey, apiSecret });
      const openOrders = await exchangeManager.getOpenOrdersForSymbol(symbol, apiKey, apiSecret);

      if (!openOrders || openOrders.length === 0) {
        return false;
      }

      // Filtra apenas ordens de stop loss
      const stopLossOrders = openOrders.filter(order => {
        return order.stopLossTriggerPrice || order.stopLossLimitPrice;
      });

      if (stopLossOrders.length === 0) {
        return false;
      }

      // Verifica se existe uma ordem de stop loss posicionada corretamente
      for (const order of stopLossOrders) {
        if (OrderController.isOrderCorrectlyPositionedAsStopLoss(order, position)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      Logger.error(
        `❌ [STOP_LOSS_CHECK] Erro ao verificar stop loss para ${symbol}:`,
        error.message
      );
      return false;
    }
  }

  /**
   * Monitor independente de Take Profit - cria ordens de TP quando não existem
   * @param {object} config - Configuração do bot
   * @returns {Promise<void>}
   */
  static async monitorAndCreateTakeProfit(config) {
    try {
      if (!config?.apiKey || !config?.apiSecret) {
        Logger.warn(`⚠️ [TP_MONITOR] API_KEY e API_SECRET são obrigatórios`);
        return;
      }

      // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Futures direto
      const exchangeManager = OrderController.getExchangeManager(config);
      const positions = await exchangeManager.getFuturesPositions(config.apiKey, config.apiSecret);
      if (!positions || positions.length === 0) {
        return;
      }

      // 🔧 CORREÇÃO: Filtra posições realmente abertas (netQuantity > 0)
      const activePositions = positions.filter(position => {
        const netQuantity = parseFloat(position.netQuantity || 0);
        const isActive = Math.abs(netQuantity) > 0;

        if (!isActive) {
          Logger.debug(
            `⏭️ [TP_MONITOR] ${position.symbol}: Posição fechada (netQuantity: ${netQuantity}) - pulando`
          );
        }

        return isActive;
      });

      Logger.debug(
        `🔍 [TP_MONITOR] Verificando ${activePositions.length} posições ativas para Take Profit (${positions.length - activePositions.length} posições fechadas filtradas)...`
      );

      for (const position of activePositions) {
        try {
          const isBotPosition = await OrderController.isPositionCreatedByBot(position, config);
          if (!isBotPosition) {
            Logger.debug(
              `⏭️ [TP_MONITOR] ${position.symbol}: Posição não criada pelo bot - pulando`
            );
            continue;
          }

          await OrderController.createTakeProfitForPosition(position, config);
        } catch (error) {
          Logger.error(`❌ [TP_MONITOR] Erro ao processar ${position.symbol}:`, error.message);
        }
      }
    } catch (error) {
      Logger.error(`❌ [TP_MONITOR] Erro no monitor de Take Profit:`, error.message);
    }
  }

  /**
   * Cria Take Profit para uma posição específica
   * @param {object} position - Dados da posição
   * @param {object} config - Configuração do bot
   * @returns {Promise<{success: boolean, message: string}>}
   */
  static async createTakeProfitForPosition(position, config) {
    try {
      const symbol = position.symbol;
      const netQuantity = parseFloat(position.netQuantity);

      if (Math.abs(netQuantity) === 0) {
        return { success: false, message: 'Posição fechada' };
      }

      let Account;
      try {
        Account = await AccountController.get({
          apiKey: config.apiKey,
          apiSecret: config.apiSecret,
          strategy: config?.strategyName || 'DEFAULT',
        });
      } catch (error) {
        Logger.error(`❌ [TP_CREATE] ${symbol}: Erro ao obter Account:`, error.message);
        return { success: false, message: `Erro ao obter Account: ${error.message}` };
      }

      if (!Account) {
        // Verificar se é pausa por manutenção
        const DepressurizationManager = (await import('../Utils/DepressurizationManager.js'))
          .default;
        if (DepressurizationManager.isSystemInMaintenance()) {
          Logger.debug(`🚫 [TP_CREATE] ${symbol}: Take Profit pausado durante manutenção`);
        } else {
          Logger.error(`❌ [TP_CREATE] ${symbol}: Account inválido ou sem markets:`, Account);
        }
        return { success: false, message: 'Account inválido ou sem markets' };
      }

      let enableTrailingStop = config?.enableTrailingStop === true;
      let enableHybridStopStrategy = config?.enableHybridStopStrategy === true;

      if (enableTrailingStop && !enableHybridStopStrategy) {
        Logger.debug(
          `⏭️ [TP_CREATE] ${symbol}: Trailing Stop ativo sem opção de saída parcial - Take Profit vai ser monitorado pelo Trailing Stop`
        );
        return { success: false, message: 'Trailing Stop ativo' };
      }

      const hasTakeProfit = await OrderController.hasTakeProfitOrder(symbol, position, config);
      if (hasTakeProfit) {
        Logger.debug(`ℹ️ [TP_CREATE] ${symbol}: Take Profit já existe, pulando criação`);
        return { success: false, message: 'Take Profit já existe' };
      }

      Logger.info(`🎯 [TP_CREATE] ${symbol}: Criando Take Profit...`);

      // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
      const exchangeManager = OrderController.getExchangeManager(config || {});
      const allMarkets = await exchangeManager.getMarkets();
      const marketInfo = allMarkets.find(m => m.symbol === symbol);
      if (!marketInfo) {
        Logger.error(`❌ [TP_CREATE] ${symbol}: Market info não encontrada`);
        return { success: false, message: 'Error: Market info não encontrada' };
      }

      const decimal_quantity = marketInfo.decimal_quantity || 6;
      const stepSize_quantity = marketInfo.stepSize_quantity || 0.000001;
      const decimal_price = marketInfo.decimal_price || 2;
      const tickSize = marketInfo.tickSize || null;

      let currentPositions;
      try {
        // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Futures direto
        const exchangeManager = OrderController.getExchangeManager(config);
        currentPositions = await exchangeManager.getFuturesPositions(config.apiKey, config.apiSecret);
      } catch (error) {
        Logger.error(`❌ [TP_CREATE] ${symbol}: Erro ao obter posições:`, error.message);
        return { success: false, message: `Erro ao obter posições: ${error.message}` };
      }

      if (!currentPositions || !Array.isArray(currentPositions)) {
        Logger.error(`❌ [TP_CREATE] ${symbol}: Posições inválidas:`, currentPositions);
        return { success: false, message: `Posições inválidas: ${currentPositions}` };
      }

      const currentPosition = currentPositions.find(p => p.symbol === symbol);
      if (!currentPosition || Math.abs(parseFloat(currentPosition.netQuantity)) === 0) {
        Logger.warn(`⚠️ [TP_CREATE] ${symbol}: Posição não encontrada ou já fechada`);
        return { success: false, message: `Posição não encontrada ou já fechada` };
      }

      const currentNetQuantity = parseFloat(currentPosition.netQuantity);
      const currentIsLong = currentNetQuantity > 0;
      const entryPrice = parseFloat(currentPosition.entryPrice);

      let takeProfitPrice = null;
      let takeProfitQuantity;

      if (enableHybridStopStrategy) {
        const positionSide = currentIsLong ? 'LONG' : 'SHORT';
        const originalOrder = await OrdersService.getOriginalOpeningOrder(
          symbol,
          config.id,
          positionSide
        );

        if (originalOrder) {
          const originalQuantity = Math.abs(parseFloat(originalOrder.quantity));
          const currentQuantity = Math.abs(currentNetQuantity);

          if (currentQuantity < originalQuantity) {
            Logger.info(
              `⏭️ [TP_PARTIAL_SKIP] ${symbol} (${positionSide}): Posição reduzida (${currentQuantity} < ${originalQuantity}) - TP parcial já executado`
            );
            return { success: false, message: 'Posição foi reduzida - TP parcial já executado' };
          }

          Logger.debug(
            `✅ [TP_PARTIAL_CHECK] ${symbol} (${positionSide}): OK para TP parcial (${currentQuantity} >= ${originalQuantity})`
          );
        } else {
          Logger.warn(
            `⚠️ [TP_PARTIAL_SKIP] ${symbol}: Ordem original não encontrada (botId: ${config.id}, side: ${positionSide})`
          );
          return {
            success: false,
            message: 'Ordem original não encontrada - posição pode ser manual',
          };
        }

        // Modo Híbrido: Usa ATR para calcular TP parcial
        const partialTakeProfitPercentage = Number(config?.partialTakeProfitPercentage || 50);
        const atrValue = await OrderController.getAtrValue(symbol);

        if (atrValue && atrValue > 0) {
          const atrMultiplier = Number(config?.partialTakeProfitAtrMultiplier || 1.5);
          takeProfitPrice = OrderController.calculateAtrTakeProfitPrice(
            currentPosition,
            atrValue,
            atrMultiplier
          );
          takeProfitQuantity = (Math.abs(currentNetQuantity) * partialTakeProfitPercentage) / 100;

          Logger.info(
            `📊 [TP_HYBRID] ${symbol}: TP Parcial ${partialTakeProfitPercentage}% - Preço: $${takeProfitPrice?.toFixed(4)}, Qty: ${takeProfitQuantity.toFixed(6)}`
          );
        } else {
          Logger.info(
            `⚠️ [TP_HYBRID] ${symbol}: ATR não disponível ou inválido (${atrValue}), usando TP total`
          );
          enableHybridStopStrategy = false;
          takeProfitQuantity = Math.abs(currentNetQuantity);
        }
      } else {
        const minProfitPercentage = Number(config?.minProfitPercentage);

        let leverage = 1;
        try {
          const Account = await AccountController.get({
            apiKey: config.apiKey,
            apiSecret: config.apiSecret,
            strategy: config?.strategyName || 'DEFAULT',
          });
          if (Account && Account.leverage) {
            const rawLeverage = parseFloat(Account.leverage);
            leverage = validateLeverageForSymbol(symbol, rawLeverage);
            Logger.info(
              `🔧 [TP_TRADITIONAL] ${symbol}: Alavancagem ${leverage}x (validada, original: ${rawLeverage}x)`
            );
          }
        } catch (error) {
          Logger.warn(
            `⚠️ [TP_TRADITIONAL] ${symbol}: Erro ao obter alavancagem, usando 1x: ${error.message}`
          );
        }

        // 🔧 CORREÇÃO CRÍTICA: Calcula o TP real considerando a alavancagem
        const actualProfitPct = minProfitPercentage / leverage;

        Logger.info(
          `🔧 [TP_TRADITIONAL] ${symbol}: TP - Bruto: ${minProfitPercentage}%, Real: ${actualProfitPct.toFixed(2)}% (leverage ${leverage}x)`
        );

        // Calcula o preço de TP considerando a alavancagem
        if (currentIsLong) {
          // Para LONG: TP acima do preço de entrada
          takeProfitPrice = entryPrice * (1 + actualProfitPct / 100);
        } else {
          // Para SHORT: TP abaixo do preço de entrada
          takeProfitPrice = entryPrice * (1 - actualProfitPct / 100);
        }

        // 🔧 CORREÇÃO: Garante que a quantidade seja total quando não é híbrido
        takeProfitQuantity = Math.abs(currentNetQuantity);

        Logger.info(
          `📊 [TP_TRADITIONAL] ${symbol}: TP Total ${minProfitPercentage}% (efetivo ${actualProfitPct.toFixed(2)}%) - Preço: $${takeProfitPrice?.toFixed(4)}, Qty: ${takeProfitQuantity.toFixed(6)}`
        );
      }

      if (!takeProfitPrice || takeProfitPrice <= 0 || isNaN(takeProfitPrice)) {
        Logger.error(
          `❌ [TP_CREATE] ${symbol}: Preço de TP inválido: ${takeProfitPrice} (entryPrice=${entryPrice}, isLong=${config?.isLong})`
        );
        return {
          success: false,
          message: `Preço de TP inválido: ${takeProfitPrice} (entryPrice=${entryPrice}, isLong=${config?.isLong})`,
        };
      }

      // Função para formatar quantidade corretamente
      const formatQuantity = value => {
        if (value <= 0) {
          throw new Error(`Quantidade deve ser positiva: ${value}`);
        }
        let formatted = parseFloat(value).toFixed(decimal_quantity);
        if (parseFloat(formatted) === 0 && stepSize_quantity > 0) {
          return stepSize_quantity.toString();
        }
        return formatted.toString();
      };

      try {
        const OrderModule = await import('../Backpack/Authenticated/Order.js');
        const openOrders = await OrderModule.default.getOpenOrders(
          symbol,
          'PERP',
          config.apiKey,
          config.apiSecret
        );
        if (Array.isArray(openOrders)) {
          const closeSide = currentIsLong ? 'Ask' : 'Bid';
          const existingReduceOnly = openOrders.filter(
            o => o.symbol === symbol && o.reduceOnly === true && o.side === closeSide
          );

          Logger.debug(
            `🔍 [TP_CREATE] ${symbol}: Ordens reduceOnly encontradas: ${existingReduceOnly.length}`
          );
          existingReduceOnly.forEach((order, index) => {
            Logger.info(
              `🔍 [TP_CREATE] ${symbol}: Ordem ${index + 1} - ID: ${order.id}, Side: ${order.side}, Qty: ${order.triggerQuantity}, Price: ${order.price}`
            );
          });

          const existingQty = existingReduceOnly.reduce(
            (sum, o) => sum + Math.abs(parseFloat(o.triggerQuantity)),
            0
          );

          // Se já existe qualquer TP parcial aberto, não criar outro (evita duplicados)
          if (existingQty > 0) {
            Logger.debug(
              `🔍 [TP_CREATE] ${symbol}: Verificando TPs existentes - Qty existente: ${existingQty}, enableHybrid: ${enableHybridStopStrategy}`
            );

            if (enableHybridStopStrategy) {
              const partialPercentage = Number(config?.partialTakeProfitPercentage || 50);
              const desiredPartial = Math.abs(currentNetQuantity) * (partialPercentage / 100);
              const tolerance = desiredPartial * 0.95;

              Logger.debug(
                `🔍 [TP_CREATE] ${symbol}: TP Parcial - Posição: ${currentNetQuantity}, %: ${partialPercentage}%, Desejado: ${desiredPartial}, Tolerância: ${tolerance}`
              );

              // Verifica se as ordens existentes são realmente TPs parciais (não totais)
              const isPartialTP = existingReduceOnly.some(order => {
                const orderQty = Math.abs(parseFloat(order.triggerQuantity));
                const positionQty = Math.abs(currentNetQuantity);
                const isPartial = orderQty < positionQty * 0.99; // 99% da posição = parcial

                Logger.debug(
                  `🔍 [TP_CREATE] ${symbol}: Ordem ${order.id} - Qty: ${orderQty}, Posição: ${positionQty}, É parcial: ${isPartial}`
                );
                return isPartial;
              });

              if (existingQty >= tolerance && isPartialTP) {
                Logger.debug(
                  `ℹ️ [TP_CREATE] ${symbol}: TP parcial já existe cobrindo ${existingQty} >= desejado ${desiredPartial}. Ignorando.`
                );
                Logger.debug(`✅ [TP_CREATE] ${symbol}: Saindo da função - TP parcial já existe.`);
                return {
                  success: true,
                  message: `TP parcial já existe cobrindo ${existingQty} >= desejado ${desiredPartial}. Ignorando.`,
                };
              } else if (existingQty >= tolerance && !isPartialTP) {
                Logger.debug(
                  `⚠️ [TP_CREATE] ${symbol}: TP total existe (${existingQty}) mas queremos parcial. Continuando criação.`
                );
              } else {
                Logger.debug(
                  `ℹ️ [TP_CREATE] ${symbol}: TP existente insuficiente (${existingQty} < ${tolerance}). Continuando criação.`
                );
              }
            }
          }
        }
      } catch (dupErr) {
        Logger.warn(
          `⚠️ [TP_CREATE] ${symbol}: Falha ao verificar TPs existentes: ${dupErr.message}`
        );
      }

      Logger.debug(
        `📊 [TP_CREATE] ${symbol}: Posição atual: ${currentNetQuantity}, TP Qty: ${takeProfitQuantity}`
      );

      // Verifica se a quantidade é válida
      if (takeProfitQuantity <= 0) {
        Logger.error(`❌ [TP_CREATE] ${symbol}: Quantidade de TP inválida: ${takeProfitQuantity}`);
        return { success: true, message: `Quantidade de TP inválida: ${takeProfitQuantity}` };
      }

      // Verifica se a quantidade não excede a posição atual
      const maxQuantity = Math.abs(currentNetQuantity);
      if (takeProfitQuantity > maxQuantity) {
        Logger.error(
          `❌ [TP_CREATE] ${symbol}: Quantidade de TP (${takeProfitQuantity}) excede posição atual (${maxQuantity})`
        );
        return {
          success: true,
          message: `Quantidade de TP (${takeProfitQuantity}) excede posição atual (${maxQuantity}`,
        };
      }

      // Verifica se o preço é válido
      if (!takeProfitPrice || takeProfitPrice <= 0) {
        Logger.error(`❌ [TP_CREATE] ${symbol}: Preço de TP inválido: ${takeProfitPrice}`);
        return { success: true, message: `Preço de TP inválido: ${takeProfitPrice}` };
      }

      const formattedLimitPrice = OrderController.formatPriceSafely(
        takeProfitPrice,
        decimal_price,
        tickSize
      );

      const quantity = formatQuantity(takeProfitQuantity);

      const takeProfitOrder = {
        symbol: symbol,
        side: currentIsLong ? 'Ask' : 'Bid',
        orderType: 'Market',
        reduceOnly: true,
        quantity: quantity,
        triggerPrice: formattedLimitPrice,
        triggerQuantity: quantity,
        timeInForce: 'GTC',
        clientId: await OrderController.generateUniqueOrderId(config),
      };

      Logger.debug(
        `📊 [TP_CREATE] ${symbol}: Enviando ordem TP - Side: ${takeProfitOrder.side}, Qty: ${takeProfitOrder.quantity}, Price: ${takeProfitOrder.price || takeProfitOrder.triggerPrice}, Current Position: ${currentNetQuantity}`
      );

      const OrderModule = await import('../Backpack/Authenticated/Order.js');
      const result = await OrderModule.default.executeOrder(
        takeProfitOrder,
        config.apiKey,
        config.apiSecret
      );

      if (result && result.id) {
        Logger.info(`✅ [TP_CREATE] ${symbol}: Take Profit criado com sucesso - ID: ${result.id}`);

        // Registra a ordem no sistema de persistência
        await BotOrdersManager.addOrder(
          config.id,
          result.id,
          symbol,
          currentIsLong ? 'SELL' : 'BUY',
          takeProfitQuantity,
          takeProfitPrice,
          'TAKE_PROFIT',
          result.exchangeCreatedAt || null,
          takeProfitOrder.clientId // Passa o clientId gerado
        );
        return { success: true, message: 'Sucesso.' };
      } else {
        Logger.error(`❌ [TP_CREATE] ${symbol}: Falha ao criar Take Profit - Result:`, result);
        return { success: false, message: `Falha ao criar Take Profit - Error: ${result?.error}` };
      }
    } catch (error) {
      Logger.error(
        `❌ [TP_CREATE] Erro ao criar Take Profit para ${position.symbol}:`,
        error.message
      );
      return { success: false, message: `Falha ao criar Take Profit - Error: ${error.message}` };
    }
  }

  /**
   * Verifica se já existe ordem de Take Profit para uma posição
   * @param {string} symbol - Símbolo
   * @param {object} position - Dados da posição
   * @param {object} config - Configuração do bot
   * @returns {Promise<boolean>}
   */
  static async hasTakeProfitOrder(symbol, position, config) {
    try {
      // Verifica cache primeiro
      const cacheKey = `${symbol}_TP_${position.netQuantity > 0 ? 'LONG' : 'SHORT'}`;
      const cached = OrderController.takeProfitCheckCache.get(cacheKey);
      const now = Date.now();

      if (cached && now - cached.lastCheck < OrderController.takeProfitCheckCacheTimeout) {
        Logger.debug(`🔍 [TP_CHECK] ${symbol}: Cache hit - HasTakeProfit: ${cached.hasTakeProfit}`);
        return cached.hasTakeProfit;
      }

      const OrderModule = await import('../Backpack/Authenticated/Order.js');
      const orders = await OrderModule.default.getOpenOrders(
        symbol,
        'PERP',
        config.apiKey,
        config.apiSecret
      );
      const netQuantity = parseFloat(position.netQuantity);
      const isLong = netQuantity > 0;

      Logger.debug(
        `🔍 [TP_CHECK] ${symbol}: Verificando TP existente - Posição: ${netQuantity} (${isLong ? 'LONG' : 'SHORT'})`
      );
      Logger.debug(`🔍 [TP_CHECK] ${symbol}: Ordens encontradas: ${orders?.length || 0}`);

      let hasTakeProfit = false;

      if (orders && orders.length > 0) {
        hasTakeProfit = await StopLossUtilsModule.hasTakeProfit(symbol, position, config);

        const positionQty = Math.abs(netQuantity);
        let existingTpQty = 0;

        const enableHybridStopStrategy = config?.enableHybridStopStrategy === true;

        Logger.debug(
          `🔍 [TP_CREATE] ${symbol}: Verificando TPs existentes - Qty existente: ${existingTpQty}, enableHybrid: ${enableHybridStopStrategy}`
        );
        Logger.debug(
          `🔍 [TP_CREATE] ${symbol}: Coverage ratio: ${(existingTpQty / positionQty).toFixed(2)}x (${existingTpQty} / ${positionQty})`
        );

        if (existingTpQty > 0) {
          if (enableHybridStopStrategy) {
            const partialTakeProfitPercentage = Number(config?.partialTakeProfitPercentage || 50);
            const expectedPartialQty = (positionQty * partialTakeProfitPercentage) / 100;
            const minPartialThreshold = expectedPartialQty * 0.99; // 99% do esperado como mínimo

            Logger.debug(
              `🔍 [TP_CHECK] ${symbol}: TP Híbrido - Esperado: ${expectedPartialQty.toFixed(6)} (${partialTakeProfitPercentage}%), Mínimo: ${minPartialThreshold.toFixed(6)}, Existente: ${existingTpQty.toFixed(6)}`
            );

            if (existingTpQty >= minPartialThreshold) {
              Logger.debug(
                `✅ [TP_CHECK] ${symbol}: TP parcial suficiente encontrado (${existingTpQty.toFixed(6)} >= ${minPartialThreshold.toFixed(6)})`
              );
              hasTakeProfit = true;
            }
          } else {
            const coverageRatio = existingTpQty / positionQty;

            if (coverageRatio >= 2.0) {
              Logger.warn(
                `⚠️ [TP_CREATE] ${symbol}: TP duplicado detectado (${existingTpQty} vs posição ${positionQty}). Bloqueando criação.`
              );
              hasTakeProfit = true;
            } else if (coverageRatio >= 0.9) {
              Logger.debug(
                `✅ [TP_CHECK] ${symbol}: TP total suficiente encontrado (${existingTpQty.toFixed(6)} >= ${(positionQty * 0.9).toFixed(6)})`
              );
              hasTakeProfit = true;
            } else {
              Logger.warn(
                `⚠️ [TP_CREATE] ${symbol}: TP existente é parcial (${existingTpQty}) mas queremos total. Continuando criação.`
              );
            }
          }
        }
      }

      OrderController.takeProfitCheckCache.set(cacheKey, {
        lastCheck: now,
        hasTakeProfit: hasTakeProfit,
      });

      Logger.debug(
        `${hasTakeProfit ? '✅' : '❌'} [TP_CHECK] ${symbol}: ${hasTakeProfit ? 'TP encontrado' : 'Nenhum TP encontrado'}, cache atualizado`
      );
      return hasTakeProfit;
    } catch (error) {
      Logger.error(`❌ [TP_CHECK] Erro ao verificar TP para ${symbol}:`, error.message);
      return false;
    }
  }

  /**
   * Calcula preço de Take Profit baseado em ATR
   * @param {object} position - Dados da posição
   * @param {number} atrValue - Valor do ATR
   * @param {number} multiplier - Multiplicador ATR
   * @returns {number} - Preço do Take Profit
   */
  static calculateAtrTakeProfitPrice(position, atrValue, multiplier = 1.5) {
    try {
      const entryPrice = parseFloat(position.entryPrice);
      const netQuantity = parseFloat(position.netQuantity);
      const isLong = netQuantity > 0;

      if (!entryPrice || entryPrice <= 0 || !atrValue || atrValue <= 0 || isNaN(atrValue)) {
        Logger.warn(
          `⚠️ [TP_ATR] Valores inválidos para cálculo: entryPrice=${entryPrice}, atrValue=${atrValue}`
        );
        return null;
      }

      const atrDistance = atrValue * multiplier;

      if (isNaN(atrDistance)) {
        Logger.warn(
          `⚠️ [TP_ATR] ATR distance é NaN: atrValue=${atrValue}, multiplier=${multiplier}`
        );
        return null;
      }

      const takeProfitPrice = isLong ? entryPrice + atrDistance : entryPrice - atrDistance;

      if (isNaN(takeProfitPrice) || takeProfitPrice <= 0) {
        Logger.warn(
          `⚠️ [TP_ATR] Preço de TP calculado é inválido: ${takeProfitPrice} (entryPrice=${entryPrice}, atrDistance=${atrDistance})`
        );
        return null;
      }

      return takeProfitPrice;
    } catch (error) {
      Logger.error(`❌ [TP_ATR] Erro ao calcular TP ATR:`, error.message);
      return null;
    }
  }

  /**
   * Verifica se uma posição foi criada pelo bot
   * @param {object} position - Dados da posição
   * @param {object} config - Configuração do bot
   * @returns {Promise<boolean>}
   */
  static async isPositionCreatedByBot(position, config) {
    try {
      const symbol = position.symbol;
      const netQuantity = parseFloat(position.netQuantity || 0);

      if (Math.abs(netQuantity) === 0) {
        return false; // Posição fechada
      }

      // Busca histórico de fills (ordens executadas) para este símbolo
      const { default: History } = await import('../Backpack/Authenticated/History.js');
      const fills = await History.getFillHistory(
        symbol,
        null,
        null,
        null,
        100,
        0,
        null,
        'PERP',
        null,
        config.apiKey,
        config.apiSecret
      );

      if (!fills || fills.length === 0) {
        Logger.info(`⚠️ [BOT_VALIDATION] ${symbol}: Nenhum fill encontrado`);
        return false;
      }

      // Verifica se existe alguma ordem executada com clientId do bot
      const botClientOrderId = config.botClientOrderId?.toString() || '';

      const botFill = fills.find(fill => {
        const fillClientId = fill.clientId?.toString() || '';

        // Verifica se o clientId começa com o botClientOrderId
        const isBotClientId = fillClientId.startsWith(botClientOrderId);

        return isBotClientId;
      });

      if (botFill) {
        Logger.debug(
          `✅ [BOT_VALIDATION] ${symbol}: Posição criada pelo bot - ClientId: ${botFill.clientId}`
        );
        return true;
      } else {
        Logger.debug(
          `❌ [BOT_VALIDATION] ${symbol}: Posição não criada pelo bot - ClientIds encontrados: ${fills.map(f => f.clientId).join(', ')}`
        );
        return false;
      }
    } catch (error) {
      Logger.error(
        `❌ [BOT_VALIDATION] Erro ao validar posição ${position.symbol}:`,
        error.message
      );
      return false;
    }
  }

  /**
   * Obtém valor do ATR para um símbolo
   * @param {string} symbol - Símbolo
   * @param {string} timeframe - Timeframe (padrão: 30m)
   * @returns {Promise<number|null>}
   */
  static async getAtrValue(symbol, timeframe = '30m') {
    try {
      const Markets = await import('../Backpack/Public/Markets.js');
      const markets = new Markets.default();
      const candles = await markets.getKLines(symbol, timeframe, 30);

      if (!candles || candles.length < 14) {
        Logger.warn(`⚠️ [TP_ATR] ${symbol}: Candles insuficientes (${candles?.length || 0} < 14)`);
        return null;
      }

      const { calculateIndicators } = await import('../Decision/Indicators.js');
      const indicators = await calculateIndicators(candles, timeframe, symbol);

      const atrValue = indicators.atr?.atr || indicators.atr?.value || null;

      if (!atrValue || atrValue <= 0 || isNaN(atrValue)) {
        Logger.warn(`⚠️ [TP_ATR] ${symbol}: ATR inválido: ${atrValue}`);
        return null;
      }

      Logger.info(`📊 [TP_ATR] ${symbol}: ATR válido: ${atrValue}`);
      return atrValue;
    } catch (error) {
      Logger.error(`❌ [TP_ATR] Erro ao obter ATR para ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Verifica se o limite de ordens por símbolo já foi atingido
   * Combina ordens abertas na exchange + ordens PENDING/SENT no banco local
   * @param {string} symbol - Símbolo da moeda
   * @param {Object} config - Configuração do bot com credenciais
   * @param {number} maxOpenOrders - Limite máximo de ordens por símbolo
   * @returns {Promise<boolean>} True se limite atingido, false caso contrário
   */
  static async checkOrderLimit(symbol, config, maxOpenOrders) {
    try {
      Logger.debug(`[ORDER_LIMIT_CHECK] Verificando limite para ${symbol} (máx: ${maxOpenOrders})`);

      // 1. Busca ordens abertas na exchange via API
      const { default: Order } = await import('../Backpack/Authenticated/Order.js');
      const orderInstance = new Order();

      // Busca ordens regulares e condicionais
      const regularOrders = await orderInstance.getOpenOrders(
        symbol,
        'PERP',
        config.apiKey,
        config.apiSecret
      );
      const triggerOrders = await orderInstance.getOpenTriggerOrders(
        symbol,
        'PERP',
        config.apiKey,
        config.apiSecret
      );

      // Unifica todas as ordens da exchange
      const allExchangeOrders = [...(regularOrders || []), ...(triggerOrders || [])];

      // 🚨 VALIDAÇÃO CRÍTICA: Verifica se allExchangeOrders é um array válido
      if (!Array.isArray(allExchangeOrders)) {
        Logger.error(
          `❌ [ORDER_LIMIT_CHECK] ${symbol}: allExchangeOrders não é um array válido - type: ${typeof allExchangeOrders}`
        );
        return false; // Permite criar ordem se não conseguir verificar limite
      }

      // Filtra ordens do bot específico
      const botClientOrderId = config.botClientOrderId?.toString() || '';
      const botExchangeOrders = allExchangeOrders.filter(order => {
        const clientId = order.clientId?.toString() || '';
        return clientId.startsWith(botClientOrderId) && order.symbol === symbol;
      });

      // 2. Busca ordens no banco local que não estão em estado terminal
      const { default: OrdersService } = await import('../Services/OrdersService.js');
      const localPendingOrders = await OrdersService.dbService.getAll(
        `SELECT * FROM bot_orders
         WHERE botId = ? AND symbol = ?
         AND status NOT IN ('CLOSED', 'CANCELLED', 'FILLED')
         AND externalOrderId IS NOT NULL`,
        [config.botId, symbol]
      );

      // 🚨 VALIDAÇÃO CRÍTICA: Verifica se localPendingOrders é um array válido
      if (!Array.isArray(localPendingOrders)) {
        Logger.error(
          `❌ [ORDER_LIMIT_CHECK] ${symbol}: localPendingOrders não é um array válido - type: ${typeof localPendingOrders}`
        );
        return false; // Permite criar ordem se não conseguir verificar limite
      }

      // 3. Soma contagem total
      const exchangeOrdersCount = botExchangeOrders.length;
      const localPendingCount = localPendingOrders.length;
      const totalOpenAndPendingOrders = exchangeOrdersCount + localPendingCount;

      Logger.debug(
        `[ORDER_LIMIT_CHECK] ${symbol}: Exchange=${exchangeOrdersCount}, Local=${localPendingCount}, Total=${totalOpenAndPendingOrders}, Limite=${maxOpenOrders}`
      );

      // 4. Verifica se excede o limite
      const limitExceeded = totalOpenAndPendingOrders >= maxOpenOrders;

      if (limitExceeded) {
        Logger.warn(
          `⚠️ [ORDER_LIMIT_CHECK] ${symbol}: Limite atingido! ${totalOpenAndPendingOrders}/${maxOpenOrders} ordens`
        );
      }

      return limitExceeded;
    } catch (error) {
      Logger.error(
        `❌ [ORDER_LIMIT_CHECK] Erro ao verificar limite para ${symbol}:`,
        error.message
      );
      // Em caso de erro, permite a criação da ordem (fail-safe)
      return false;
    }
  }
}

export default OrderController;
