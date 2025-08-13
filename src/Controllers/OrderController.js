import Order from '../Backpack/Authenticated/Order.js';
import Futures from '../Backpack/Authenticated/Futures.js';
import AccountController from './AccountController.js';
import Utils from '../Utils/Utils.js';
import { validateLeverageForSymbol } from '../Utils/Utils.js';
import Markets from '../Backpack/Public/Markets.js';
import TrailingStop from '../TrailingStop/TrailingStop.js';
import ConfigManager from '../Config/ConfigManager.js';
import ConfigManagerSQLite from '../Config/ConfigManagerSQLite.js';
import BotOrdersManager, { initializeBotOrdersManager } from '../Config/BotOrdersManager.js';
import Logger from '../Utils/Logger.js';
import { calculateIndicators } from '../Decision/Indicators.js';
import { ProMaxStrategy } from '../Decision/Strategies/ProMaxStrategy.js';
import OrdersService from '../Services/OrdersService.js';

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
        Logger.warn(`⚠️ [PRICE_ADJUST] Preço ${price} não é múltiplo de ${tickSize}, ajustado para ${adjustedPrice}`);
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
        Logger.debug(`🆔 [ORDER_ID] Gerado ID único usando config: ${orderId} (Bot ID: ${config.id}, botClientOrderId: ${config.botClientOrderId})`);
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
        Logger.debug(`🆔 [ORDER_ID] Gerado ID único por nome: ${orderId} (Bot ID: ${botConfig.id})`);
        const orderIdStr = String(orderId);
        const numericId = parseInt(orderIdStr.replace(/_/g, ''));
        Logger.debug(`🆔 [ORDER_ID] ID convertido para número: ${numericId}`);
        return numericId;
        }
      }

      // Se não conseguiu gerar ID único, ERRO - não deve gerar aleatório
      throw new Error(`Não foi possível gerar ID único. Config ou botClientOrderId não encontrado.`);
    } catch (error) {
      Logger.error(`❌ [ORDER_ID] Erro ao gerar ID único:`, error.message);
      // Em vez de parar o bot, gera um ID de emergência baseado no timestamp
      const emergencyId = Math.floor(Date.now() / 1000) % 1000000;
      console.warn(`⚠️ [ORDER_ID] Usando ID de emergência: ${emergencyId}`);
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
      console.error(`❌ [ORDER_ID] Erro ao gerar ID para take profit:`, error.message);
      // Em vez de parar o bot, gera um ID de emergência
      const emergencyId = Math.floor(Date.now() / 1000) % 1000000 + (targetIndex + 1);
      console.warn(`⚠️ [ORDER_ID] Usando ID de emergência para take profit: ${emergencyId}`);
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
      console.error(`❌ [ORDER_ID] Erro ao gerar ID para stop loss:`, error.message);
      const emergencyId = Math.floor(Date.now() / 1000) % 1000000 + 999;
      console.warn(`⚠️ [ORDER_ID] Usando ID de emergência para stop loss: ${emergencyId}`);
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
      console.error(`❌ [ORDER_ID] Erro ao gerar ID para failsafe:`, error.message);
      // Em vez de parar o bot, gera um ID de emergência
      const emergencyId = Math.floor(Date.now() / 1000) % 1000000 + (type === 'stop' ? 1001 : 1002);
      console.warn(`⚠️ [ORDER_ID] Usando ID de emergência para failsafe: ${emergencyId}`);
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
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }

      // Obtém todas as ordens da exchange
      Logger.debug(`🔍 [BOT_ORDERS] Buscando todas as ordens da conta para filtrar por bot ID: ${botId}`);
      const allOrders = await Order.getOpenOrders(null, "PERP", config.apiKey, config.apiSecret);

      if (!allOrders || allOrders.length === 0) {
        Logger.debug(`📋 [BOT_ORDERS] Nenhuma ordem encontrada na conta`);
        return [];
      }

              Logger.debug(`📋 [BOT_ORDERS] Total de ordens na conta: ${allOrders.length}`);

      // Obtém configuração do bot por ID
      const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
      if (!botConfig || !botConfig.botClientOrderId) {
        console.warn(`⚠️ [BOT_ORDERS] Bot ID ${botId} não encontrado ou sem botClientOrderId`);
        return [];
      }

              Logger.debug(`🔍 [BOT_ORDERS] Filtrando ordens para bot: ${botConfig.botName} (botClientOrderId: ${botConfig.botClientOrderId})`);

      // Filtra ordens do bot específico usando botClientOrderId e validação de tempo
      const botOrders = allOrders.filter(order => {
        // Usa a validação centralizada
        return OrderController.validateOrderForImport(order, botConfig);
      });

              Logger.debug(`📋 [BOT_ORDERS] Encontradas ${botOrders.length} ordens para bot ID ${botId} (${botConfig.botName})`);

      // Log detalhado das ordens encontradas
      botOrders.forEach(order => {
                  Logger.debug(`   📄 [BOT_ORDERS] ${order.symbol}: ${order.orderType} ${order.side} @ ${order.price} (ID: ${order.clientId})`);
      });

      return botOrders;
    } catch (error) {
      console.error(`❌ [BOT_ORDERS] Erro ao recuperar ordens do bot ID ${botId}:`, error.message);
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
        console.warn(`⚠️ [BOT_ORDERS] Bot ${botName} não encontrado`);
        return [];
      }

      // Usa o método por ID
      return await OrderController.getBotOrdersById(botConfig.id, config);
    } catch (error) {
      console.error(`❌ [BOT_ORDERS] Erro ao recuperar ordens de ${botName}:`, error.message);
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
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }

      // Obtém todas as ordens da exchange
      const allOrders = await Order.getOpenOrders(null, "PERP", config.apiKey, config.apiSecret);
      if (!allOrders || allOrders.length === 0) {
        Logger.debug(`📋 [ALL_BOTS_ORDERS] Nenhuma ordem encontrada`);
        return {};
      }

      // Obtém todos os bots configurados
      const allBots = await ConfigManagerSQLite.loadConfigs();
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
            orders: botOrders
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
      console.error(`❌ [ALL_BOTS_ORDERS] Erro ao recuperar ordens de todos os bots:`, error.message);
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
      Logger.debug(`   ⚠️ [ORDER_VALIDATION] Ordem ${order.symbol} ignorada - não pertence ao bot (clientId: ${clientIdStr}, botClientOrderId: ${botClientOrderIdStr})`);
      return false;
    }

    // VALIDAÇÃO DE TEMPO: Verifica se a ordem foi criada após a criação do bot
    if (botConfig.createdAt && order.createdAt) {
      const botCreatedAt = new Date(botConfig.createdAt).getTime();
      const orderTime = new Date(order.createdAt).getTime();

      if (orderTime < botCreatedAt) {
        Logger.debug(`   ⏰ [ORDER_VALIDATION] Ordem antiga ignorada: ${order.symbol} (ID: ${order.clientId}) - Ordem: ${new Date(orderTime).toISOString()}, Bot criado: ${new Date(botCreatedAt).toISOString()}`);
        return false;
      }

      Logger.debug(`   ✅ [ORDER_VALIDATION] Ordem válida: ${order.symbol} (ID: ${order.clientId}) - Tempo: ${new Date(orderTime).toISOString()}`);
    } else {
      Logger.debug(`   ✅ [ORDER_VALIDATION] Ordem do bot encontrada (sem validação de tempo): ${order.symbol} (ID: ${order.clientId})`);
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
      createdAt: Date.now()
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
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
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
        positions = await Futures.getOpenPositions(apiKey, apiSecret) || [];

        if (positions.length > 0) {
          // Verifica se há posições que não estão sendo monitoradas
          const monitoredMarkets = Object.keys(accountOrders || {});
          const unmonitoredPositions = positions.filter(pos => !monitoredMarkets.includes(pos.symbol));

          if (unmonitoredPositions.length > 0) {
            // Força criação de alvos para posições não monitoradas
            for (const position of unmonitoredPositions) {
              await OrderController.validateAndCreateTakeProfit(position, botName, config);
            }
          }
        }
      } catch (error) {
        console.warn(`⚠️ [MONITOR-${botName}] Falha ao obter posições, continuando monitoramento...`);
        console.error(`❌ [MONITOR-${botName}] Erro detalhado:`, error.message);
        positions = [];
      }

      for (const market of markets) {
        const orderData = accountOrders[market];
        const position = positions.find(p => p.symbol === market && Math.abs(Number(p.netQuantity)) > 0);

        if (position) {
          // Log detalhado de taxa total e PnL atual
          const Account = await AccountController.get({
            apiKey,
            apiSecret,
            strategy: config?.strategyName || 'DEFAULT'
          });
          const marketInfo = Account.markets.find(m => m.symbol === market);

          // Verifica se marketInfo existe antes de acessar a propriedade fee
          if (!marketInfo) {
            console.warn(`⚠️ [MONITOR-${botName}] Market info não encontrada para ${market}, usando fee padrão`);
            return; // Retorna se não encontrar as informações do mercado
          }

          const fee = marketInfo.fee || config?.fee || 0.0004;
          const entryPrice = parseFloat(position.avgEntryPrice || position.entryPrice || position.markPrice);
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
          OrderController.debug(`📋 [MANUAL_POSITION] ${position.symbol} | Volume: $${orderValue.toFixed(2)} | Taxa estimada: $${totalFee.toFixed(6)} (≈ ${percentFee.toFixed(2)}%) | PnL: $${pnl.toFixed(6)} (${pnlPct.toFixed(3)}%) | ⚠️ Par não configurado`);
          continue; // Pula criação de ordens para pares não autorizados
        }

        const fee = marketInfo.fee || config?.fee || 0.0004;
        const entryPrice = parseFloat(position.avgEntryPrice || position.entryPrice || position.markPrice);
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
        OrderController.debug(`[MONITOR][ALL] ${position.symbol} | Volume: $${orderValue.toFixed(2)} | Taxa total estimada (entrada+saída): $${totalFee.toFixed(6)} (≈ ${percentFee.toFixed(2)}%) | PnL atual: $${pnl.toFixed(6)} | PnL%: ${pnlPct.toFixed(3)}%`);
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
            strategy: config?.strategyName
          });
          const marketInfo = Account.markets.find(m => m.symbol === position.symbol);

          if (!marketInfo) {
            OrderController.debug(`ℹ️ [MANUAL_POSITION] ${position.symbol}: Par não autorizado - pulando criação de ordens automáticas`);
            continue; // Pula posições em pares não autorizados
          }

          // SEMPRE valida e cria stop loss para todas as posições AUTORIZADAS
          await OrderController.validateAndCreateStopLoss(position, botName, config);

          // Log de debug para monitoramento
          OrderController.debug(`🛡️ [MONITOR] ${position.symbol}: Stop loss validado/criado`);

          // Verifica se já existem ordens de take profit para esta posição
          const existingOrders = await Order.getOpenOrders(position.symbol);
          const hasTakeProfitOrders = existingOrders && existingOrders.some(order =>
            order.takeProfitTriggerPrice || order.takeProfitLimitPrice
          );

          if (!hasTakeProfitOrders) {
            // Cria take profit orders apenas se não existirem
            await OrderController.validateAndCreateTakeProfit(position, botName, config);
            OrderController.debug(`💰 [MONITOR] ${position.symbol}: Take profit orders criados`);
          } else {
            OrderController.debug(`💰 [MONITOR] ${position.symbol}: Take profit orders já existem`);
          }
        }
      }

    } catch (error) {
      console.warn(`⚠️ [MONITOR-${botName}] Falha ao verificar posições não monitoradas:`, error.message);
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
        strategy: config?.strategyName || 'DEFAULT'
      });
      const marketInfo = Account.markets.find(m => m.symbol === market);
      if (!marketInfo) {
        console.error(`❌ [PRO_MAX] Market info não encontrada para ${market}`);
        return;
      }
      const decimal_quantity = marketInfo.decimal_quantity;
      const decimal_price = marketInfo.decimal_price;
      const stepSize_quantity = marketInfo.stepSize_quantity;
      const tickSize = marketInfo.tickSize;

      // Preço real de entrada
      const entryPrice = parseFloat(position.avgEntryPrice || position.entryPrice || position.markPrice);
      const isLong = parseFloat(position.netQuantity) > 0;

      // Recalcula os targets usando a estratégia PRO_MAX
      // Importa a estratégia para usar o cálculo
      const strategy = new ProMaxStrategy();
      // Para o cálculo, precisamos de dados de mercado (ATR, etc). Usamos o último candle disponível.
      // Usa o timeframe da ordem ou fallback para configuração
      const timeframe = orderData?.time || config?.time || '5m';
      const markets = new Markets();
      const candles = await markets.getKLines(market, timeframe, 30);
      const indicators = await calculateIndicators(candles, timeframe, market);
      const data = { ...indicators, market: marketInfo, marketPrice: entryPrice };
      const action = isLong ? 'long' : 'short';
      const stopAndTargets = strategy.calculateStopAndMultipleTargets(data, entryPrice, action);
      if (!stopAndTargets) {
        console.error(`❌ [PRO_MAX] Não foi possível calcular targets para ${market}`);
        return;
      }
      const { stop, targets } = stopAndTargets;
      if (!targets || targets.length === 0) {
        console.error(`❌ [PRO_MAX] Nenhum target calculado para ${market}`);
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
        console.error(`❌ [PRO_MAX] Posição muito pequena para criar qualquer TP válido para ${market}`);
        return;
      }

      // Log explicativo quando são criadas menos ordens do que o esperado
      if (finalTPs < targets.length) {
              Logger.debug(`📊 [PRO_MAX] ${market}: Ajuste de quantidade de TPs:`);
      Logger.debug(`   • Targets calculados: ${targets.length}`);
      Logger.debug(`   • Tamanho da posição: ${totalQuantity}`);
      Logger.debug(`   • Step size mínimo: ${stepSize_quantity}`);
      Logger.debug(`   • Máximo de TPs possíveis: ${maxTPs} (${totalQuantity} ÷ ${stepSize_quantity})`);
      Logger.debug(`   • Limite configurado: ${maxTakeProfitOrders} (MAX_TAKE_PROFIT_ORDERS)`);
      Logger.debug(`   • TPs que serão criados: ${finalTPs}`);
        if (finalTPs < nTPs) {
          console.log(`   • Motivo: Limitado pela configuração MAX_TAKE_PROFIT_ORDERS=${maxTakeProfitOrders}`);
        } else {
          console.log(`   • Motivo: Posição pequena não permite dividir em ${targets.length} ordens de ${stepSize_quantity} cada`);
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
          qty = Math.floor((totalQuantity / actualTargets) / stepSize_quantity) * stepSize_quantity;
          if (qty < stepSize_quantity) {
            qty = stepSize_quantity;
            // Log quando a quantidade calculada é menor que o step size
            if (actualTargets < targets.length) {
              console.log(`   • TP ${i + 1}: Quantidade calculada (${(totalQuantity / actualTargets).toFixed(6)}) < step size (${stepSize_quantity}), ajustado para ${stepSize_quantity}`);
            }
          }
          if (qty > remaining) qty = remaining;
        }
        quantities.push(qty);
        remaining -= qty;
      }

      // Ajusta targets para o número real de TPs
      const usedTargets = targets.slice(0, actualTargets);
      const formatPrice = (value) => parseFloat(value).toFixed(decimal_price).toString();
      const formatQuantity = (value) => {
        if (value <= 0) {
          throw new Error(`Quantidade deve ser positiva: ${value}`);
        }
        let formatted = parseFloat(value).toFixed(decimal_quantity);
        if (parseFloat(formatted) === 0 && stepSize_quantity > 0) {
          return stepSize_quantity.toString();
        }
        return formatted.toString();
      };
      Logger.info(`🎯 [PRO_MAX] ${market}: Criando ${actualTargets} take profits. Quantidades: [${quantities.join(', ')}] (total: ${totalQuantity})`);
      // Cria ordens de take profit
      for (let i = 0; i < actualTargets; i++) {
        const targetPrice = parseFloat(usedTargets[i]);
        const takeProfitTriggerPrice = targetPrice;
        const qty = quantities[i];
        const orderBody = {
          symbol: market,
          side: isLong ? 'Ask' : 'Bid',
          orderType: 'Limit',
          postOnly: true,
          reduceOnly: true,
          quantity: formatQuantity(qty),
          price: formatPrice(targetPrice),
          takeProfitTriggerBy: 'LastPrice',
          takeProfitTriggerPrice: formatPrice(takeProfitTriggerPrice),
          takeProfitLimitPrice: formatPrice(targetPrice),
          timeInForce: 'GTC',
          selfTradePrevention: 'RejectTaker',
          clientId: await OrderController.generateUniqueOrderId(config)
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
            reduceOnly: orderBody.reduceOnly
          }
        });
        if (result && !result.error) {
          Logger.info(`✅ [PRO_MAX] ${market}: Take Profit ${i + 1}/${actualTargets} criado - Preço: ${targetPrice.toFixed(6)}, Quantidade: ${qty}, OrderID: ${result.id || 'N/A'}`);
        } else {
          Logger.error(`❌ [PRO_MAX] ${market}: Take Profit ${i + 1}/${actualTargets} FALHOU - Preço: ${targetPrice.toFixed(6)}, Quantidade: ${qty}, Motivo: ${result?.error || 'desconhecido'}`);
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
          clientId: await OrderController.generateUniqueOrderId(config)
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
            reduceOnly: stopBody.reduceOnly
          }
        });

        if (stopResult && !stopResult.error) {
          Logger.info(`🛡️ [PRO_MAX] ${market}: Stop loss criado - Preço: ${stop.toFixed(6)}, Quantidade: ${totalQuantity}`);
        } else {
          Logger.warn(`⚠️ [PRO_MAX] ${market}: Não foi possível criar stop loss. Motivo: ${stopResult && stopResult.error ? stopResult.error : 'desconhecido'}`);
        }
      }

      // Valida se existe stop loss e cria se necessário
      await OrderController.validateAndCreateStopLoss(position, botName, config);
    } catch (error) {
      console.error(`❌ [PRO_MAX] Erro ao processar posição aberta para ${market}:`, error.message);
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
        console.error(`❌ [PRO_MAX] Credenciais de API não fornecidas para ${position.symbol}`);
        return;
      }

      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: config?.strategyName || 'DEFAULT'
      });
      const marketInfo = Account.markets.find(m => m.symbol === position.symbol);
      if (!marketInfo) {
        console.error(`❌ [PRO_MAX] Market info não encontrada para ${position.symbol}`);
        return;
      }

      const decimal_quantity = marketInfo.decimal_quantity;
      const decimal_price = marketInfo.decimal_price;
      const stepSize_quantity = marketInfo.stepSize_quantity;

      // Preço real de entrada
      const entryPrice = parseFloat(position.avgEntryPrice || position.entryPrice || position.markPrice);
      const isLong = parseFloat(position.netQuantity) > 0;

      // Recalcula os targets usando a estratégia PRO_MAX
      const { ProMaxStrategy } = await import('../Decision/Strategies/ProMaxStrategy.js');
      const strategy = new ProMaxStrategy();

      // Usa timeframe da configuração
      const timeframe = config?.time || '5m';
      const markets = new Markets();
      const candles = await markets.getKLines(position.symbol, timeframe, 30);
      const indicators = await calculateIndicators(candles, timeframe, position.symbol);
      const data = { ...indicators, market: marketInfo, marketPrice: entryPrice };
      const action = isLong ? 'long' : 'short';

      const stopAndTargets = strategy.calculateStopAndMultipleTargets(data, entryPrice, action);
      if (!stopAndTargets) {
        console.error(`❌ [PRO_MAX] Não foi possível calcular targets para ${position.symbol}`);
        return;
      }

      const { stop, targets } = stopAndTargets;
      if (!targets || targets.length === 0) {
        console.error(`❌ [PRO_MAX] Nenhum target calculado para ${position.symbol}`);
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
        console.error(`❌ [PRO_MAX] Posição muito pequena para criar qualquer TP válido para ${position.symbol}`);
        return;
      }

      // Log explicativo quando são criadas menos ordens do que o esperado
      if (finalTPs < targets.length) {
        console.log(`📊 [PRO_MAX] ${position.symbol}: Ajuste de quantidade de TPs:`);
        console.log(`   • Targets calculados: ${targets.length}`);
        console.log(`   • Tamanho da posição: ${totalQuantity}`);
        console.log(`   • Step size mínimo: ${stepSize_quantity}`);
        console.log(`   • Máximo de TPs possíveis: ${maxTPs} (${totalQuantity} ÷ ${stepSize_quantity})`);
        console.log(`   • Limite configurado: ${maxTakeProfitOrders} (MAX_TAKE_PROFIT_ORDERS)`);
        console.log(`   • TPs que serão criados: ${finalTPs}`);
        if (finalTPs < nTPs) {
          console.log(`   • Motivo: Limitado pela configuração MAX_TAKE_PROFIT_ORDERS=${maxTakeProfitOrders}`);
        } else {
          console.log(`   • Motivo: Posição pequena não permite dividir em ${targets.length} ordens de ${stepSize_quantity} cada`);
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
          qty = Math.floor((totalQuantity / actualTargets) / stepSize_quantity) * stepSize_quantity;
          if (qty < stepSize_quantity) {
            qty = stepSize_quantity;
            // Log quando a quantidade calculada é menor que o step size
            if (actualTargets < targets.length) {
              console.log(`   • TP ${i + 1}: Quantidade calculada (${(totalQuantity / actualTargets).toFixed(6)}) < step size (${stepSize_quantity}), ajustado para ${stepSize_quantity}`);
            }
          }
          if (qty > remaining) qty = remaining;
        }
        quantities.push(qty);
        remaining -= qty;
      }

      // Ajusta targets para o número real de TPs
      const usedTargets = targets.slice(0, actualTargets);
      const formatPrice = (value) => parseFloat(value).toFixed(decimal_price).toString();
      const formatQuantity = (value) => {
        if (value <= 0) {
          throw new Error(`Quantidade deve ser positiva: ${value}`);
        }
        let formatted = parseFloat(value).toFixed(decimal_quantity);
        if (parseFloat(formatted) === 0 && stepSize_quantity > 0) {
          return stepSize_quantity.toString();
        }
        return formatted.toString();
      };

      console.log(`\n🎯 [PRO_MAX] ${position.symbol}: Criando ${actualTargets} take profits. Quantidades: [${quantities.join(', ')}] (total: ${totalQuantity})`);

      // Cria ordens de take profit
      for (let i = 0; i < actualTargets; i++) {
        const targetPrice = parseFloat(usedTargets[i]);
        const takeProfitTriggerPrice = targetPrice;
        const qty = quantities[i];
        const orderBody = {
          symbol: position.symbol,
          side: isLong ? 'Ask' : 'Bid',
          orderType: 'Limit',
          postOnly: true,
          reduceOnly: true,
          quantity: formatQuantity(qty),
          price: formatPrice(targetPrice),
          takeProfitTriggerBy: 'LastPrice',
          takeProfitTriggerPrice: formatPrice(takeProfitTriggerPrice),
          takeProfitLimitPrice: formatPrice(targetPrice),
          timeInForce: 'GTC',
          selfTradePrevention: 'RejectTaker',
          clientId: await OrderController.generateUniqueOrderId(config)
        };
        const result = await Order.executeOrder(orderBody, config?.apiKey, config?.apiSecret);
        if (result && !result.error) {
          console.log(`✅ [PRO_MAX] ${position.symbol}: Take Profit ${i + 1}/${actualTargets} criado - Preço: ${targetPrice.toFixed(6)}, Quantidade: ${qty}, OrderID: ${result.id || 'N/A'}`);
        } else {
          console.log(`❌ [PRO_MAX] ${position.symbol}: Take Profit ${i + 1}/${actualTargets} FALHOU - Preço: ${targetPrice.toFixed(6)}, Quantidade: ${qty}, Motivo: ${result?.error || 'desconhecido'}`);
        }
      }

      // Cria ordem de stop loss se necessário
      if (stop !== undefined && !isNaN(parseFloat(stop))) {
        const stopLossTriggerPrice = Number(stop);
        const stopBody = {
          symbol: position.symbol,
          side: isLong ? 'Ask' : 'Bid',
          orderType: 'Limit',
          postOnly: true,
          reduceOnly: true,
          quantity: formatQuantity(totalQuantity),
          price: formatPrice(stop),
          stopLossTriggerBy: 'LastPrice',
          stopLossTriggerPrice: formatPrice(stopLossTriggerPrice),
          stopLossLimitPrice: formatPrice(stop),
          timeInForce: 'GTC',
          selfTradePrevention: 'RejectTaker',
          clientId: await OrderController.generateUniqueOrderId(config)
        };
        const stopResult = await Order.executeOrder(stopBody, config?.apiKey, config?.apiSecret);
        if (stopResult) {
          console.log(`🛡️ [PRO_MAX] ${position.symbol}: Stop loss criado - Preço: ${stop.toFixed(6)}`);
        }
      }

      // Valida se existe stop loss e cria se necessário
      await OrderController.validateAndCreateStopLoss(position, botName, config);
    } catch (error) {
      console.error(`❌ [PRO_MAX] Erro ao forçar criação de alvos para ${position.symbol}:`, error.message);
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
      const positions = await Futures.getOpenPositions(apiKey, apiSecret);
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
          message: `Necessário: $${requiredMargin.toFixed(2)}, Disponível: $${remainingMargin.toFixed(2)}, Em uso: $${usedMargin.toFixed(2)}`
        };
      }

      return {
        isValid: true,
        message: `Margem OK - Disponível: $${remainingMargin.toFixed(2)}, Necessário: $${requiredMargin.toFixed(2)}`
      };

    } catch (error) {
      console.error('❌ Erro na validação de margem:', error.message);
      return {
        isValid: false,
        message: `Erro ao validar margem: ${error.message}`
      };
    }
  }

  static async cancelPendingOrders(symbol, config = null) {
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Obtém ordens abertas para o símbolo
      const openOrders = await Order.getOpenOrders(symbol, "PERP", apiKey, apiSecret);

      if (!openOrders || openOrders.length === 0) {
        return true;
      }

      // Filtra apenas ordens de entrada pendentes (não ordens de stop loss ou take profit)
      const pendingEntryOrders = openOrders.filter(order => {
        // Verifica se é uma ordem pendente
        const isPending = order.status === 'Pending' ||
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
        console.log(`ℹ️ ${symbol}: Nenhuma ordem de entrada pendente encontrada para cancelar`);
        return true;
      }

      // Log detalhado das ordens que serão canceladas
      console.log(`🔍 ${symbol}: Encontradas ${pendingEntryOrders.length} ordens de entrada pendentes para cancelar:`);
      pendingEntryOrders.forEach((order, index) => {
        console.log(`   ${index + 1}. ID: ${order.id}, Status: ${order.status}, ReduceOnly: ${order.reduceOnly}, StopLoss: ${!!order.stopLossTriggerPrice}, TakeProfit: ${!!order.takeProfitTriggerPrice}`);
      });

      // Cancela apenas as ordens de entrada pendentes específicas
      const cancelPromises = pendingEntryOrders.map(order =>
                  Order.cancelOpenOrder(symbol, order.id, order.clientId, apiKey, apiSecret)
      );

      const cancelResults = await Promise.all(cancelPromises);
      const successfulCancels = cancelResults.filter(result => result !== null).length;

      if (successfulCancels > 0) {
        console.log(`🗑️ ${symbol}: ${successfulCancels} ordens de entrada pendentes canceladas com sucesso`);
        return true;
      } else {
        console.error(`❌ ${symbol}: Falha ao cancelar ordens de entrada pendentes`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Erro ao cancelar ordens de entrada pendentes para ${symbol}:`, error.message);
      return false;
    }
  }

  static async forceClose(position, account = null, config = null) {
    // Se account não foi fornecido, obtém da API
    const AccountController = await import('../Controllers/AccountController.js');
    const Account = account || await AccountController.get(config);

    // Log detalhado para debug
    console.log(`🔍 [FORCE_CLOSE] Procurando market para ${position.symbol}`);
    console.log(`🔍 [FORCE_CLOSE] Total de markets disponíveis: ${Account.markets?.length || 0}`);
    console.log(`🔍 [FORCE_CLOSE] Markets: ${Account.markets?.map(m => m.symbol).join(', ') || 'nenhum'}`);

    let market = Account.markets.find((el) => {
        return el.symbol === position.symbol
    })

    // Se não encontrou, tenta uma busca case-insensitive
    if (!market) {
      const marketCaseInsensitive = Account.markets.find((el) => {
          return el.symbol.toLowerCase() === position.symbol.toLowerCase()
      })
      if (marketCaseInsensitive) {
        console.log(`⚠️ [FORCE_CLOSE] Market encontrado com case diferente para ${position.symbol}: ${marketCaseInsensitive.symbol}`);
        market = marketCaseInsensitive;
      }
    }

    // Verifica se o market foi encontrado
    if (!market) {
      console.error(`❌ [FORCE_CLOSE] Market não encontrado para ${position.symbol}. Markets disponíveis: ${Account.markets?.map(m => m.symbol).join(', ') || 'nenhum'}`);
      throw new Error(`Market não encontrado para ${position.symbol}`);
    }

    console.log(`✅ [FORCE_CLOSE] Market encontrado para ${position.symbol}: decimal_quantity=${market.decimal_quantity}`);

    const isLong = parseFloat(position.netQuantity) > 0;
    const quantity = Math.abs(parseFloat(position.netQuantity));
    const decimal = market.decimal_quantity

    const body = {
        symbol: position.symbol,
        orderType: 'Market',
        side: isLong ? 'Ask' : 'Bid', // Ask if LONG , Bid if SHORT
        reduceOnly: true,
        clientId: await OrderController.generateUniqueOrderId(config),
        quantity:String(quantity.toFixed(decimal))
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
        reduceOnly: body.reduceOnly
      }
    });
    // Log detalhado da taxa de fechamento
    const fee = market.fee || config?.fee || 0.0004;
    // Tente obter o preço de execução real
    let closePrice = closeResult?.price || position.markPrice || position.entryPrice;
    const exitValue = parseFloat(body.quantity) * parseFloat(closePrice);
    const exitFee = exitValue * fee;
    console.log(`[LOG][FEE] Fechamento: ${position.symbol} | Valor: $${exitValue.toFixed(2)} | Fee saída: $${exitFee.toFixed(6)} (${(fee * 100).toFixed(4)}%)`);
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
            console.error(`[FORCE_CLOSE] Erro ao limpar trailing state para ${position.symbol}:`, error.message);
          }

          // Limpeza automática de ordens órfãs para este símbolo
          try {
            console.log(`🧹 [FORCE_CLOSE] ${position.symbol}: Verificando ordens órfãs após fechamento...`);
            const orphanResult = await OrderController.monitorAndCleanupOrphanedStopLoss('DEFAULT', config);
            if (orphanResult.orphaned > 0) {
              console.log(`🧹 [FORCE_CLOSE] ${position.symbol}: ${orphanResult.orphaned} ordens órfãs limpas após fechamento`);
            }
          } catch (error) {
            console.error(`[FORCE_CLOSE] Erro ao limpar ordens órfãs para ${position.symbol}:`, error.message);
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
      const Account = account || await AccountController.get(config);
      const market = Account.markets.find((el) => {
          return el.symbol === position.symbol
      })

      // Verifica se o market foi encontrado
      if (!market) {
        console.error(`❌ [TAKE_PARTIAL] Market não encontrado para ${position.symbol}. Markets disponíveis: ${Account.markets?.map(m => m.symbol).join(', ') || 'nenhum'}`);
        throw new Error(`Market não encontrado para ${position.symbol}`);
      }

      // Usa porcentagem da configuração se não fornecida
      const partialPercentageToUse = partialPercentage || config?.partialTakeProfitPercentage || 50;

      const isLong = parseFloat(position.netQuantity) > 0;
      const totalQuantity = Math.abs(parseFloat(position.netQuantity));
      const partialQuantity = (totalQuantity * partialPercentageToUse) / 100;
      const decimal = market.decimal_quantity

      const body = {
          symbol: position.symbol,
          orderType: 'Market',
          side: isLong ? 'Ask' : 'Bid', // Ask if LONG , Bid if SHORT
          reduceOnly: true,
          clientId: await OrderController.generateUniqueOrderId(config),
          quantity: String(partialQuantity.toFixed(decimal))
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
          reduceOnly: body.reduceOnly
        }
      });

      if (partialResult) {
        // Se o take profit parcial fechou toda a posição, limpa o trailing state
        const remainingQuantity = totalQuantity - partialQuantity;
        if (remainingQuantity <= 0) {
          try {
            const TrailingStop = (await import('../TrailingStop/TrailingStop.js')).default;
            TrailingStop.clearTrailingState(position.symbol);
          } catch (error) {
            console.error(`[TAKE_PARTIAL] Erro ao limpar trailing state para ${position.symbol}:`, error.message);
          }
        }
        return true;
      } else {
        return false;
      }

    } catch (error) {
      console.error(`❌ Erro ao realizar take profit parcial para ${position.symbol}:`, error.message);
      return false;
    }
  }

  /**
   * Verifica se existe ordem LIMIT de take profit parcial
   * @param {string} symbol - Símbolo da posição
   * @param {object} position - Dados da posição
   * @param {object} account - Dados da conta (opcional)
   * @returns {Promise<boolean>} - True se ordem existe, false caso contrário
   */
  static async hasPartialTakeProfitOrder(symbol, position, account = null, config = null) {
    try {
      const Account = account || await AccountController.get(config);
      const isLong = parseFloat(position.netQuantity) > 0;
      const totalQuantity = Math.abs(parseFloat(position.netQuantity));
      const partialPercentage = Number(config?.partialTakeProfitPercentage || 50);
      const quantityToClose = (totalQuantity * partialPercentage) / 100;

      // Busca ordens abertas para o símbolo
      const OrderModule = await import('../Backpack/Authenticated/Order.js');
      const openOrders = await OrderModule.default.getOpenOrders(symbol, "PERP", config?.apiKey, config?.apiSecret);

      if (!openOrders || openOrders.length === 0) {
        return false;
      }

      // Procura por ordem LIMIT reduce-only com a quantidade parcial
      const partialOrder = openOrders.find(order => {
        const isReduceOnly = order.reduceOnly === true;
        const isLimitOrder = order.orderType === 'Limit';
        const isCorrectSide = isLong ? order.side === 'Ask' : order.side === 'Bid';
        const isCorrectQuantity = Math.abs(parseFloat(order.quantity) - quantityToClose) < 0.01; // 1% tolerância
        const hasValidQuantity = parseFloat(order.quantity) > 0; // Quantidade deve ser maior que zero

        return isReduceOnly && isLimitOrder && isCorrectSide && isCorrectQuantity && hasValidQuantity;
      });

      return !!partialOrder;

    } catch (error) {
      console.error(`❌ [TP_CHECK] Erro ao verificar ordem de take profit parcial para ${symbol}:`, error.message);
      return false;
    }
  }

  /**
   * Cria ordem LIMIT de take profit parcial na corretora
   * @param {object} position - Dados da posição
   * @param {number} takeProfitPrice - Preço do take profit
   * @param {number} percentageToClose - Porcentagem da posição para fechar (ex: 50 = 50%)
   * @param {object} account - Dados da conta (opcional)
   * @returns {object|null} - Resultado da operação ou null se falhar
   */
  static async createPartialTakeProfitOrder(position, takeProfitPrice, percentageToClose = 50, account = null, config = null) {
    try {
      // Se account não foi fornecido, obtém da API
      const Account = account || await AccountController.get(config);

      let market = Account.markets.find((el) => {
          return el.symbol === position.symbol
      })

      // Se não encontrou, tenta uma busca case-insensitive
      if (!market) {
        const marketCaseInsensitive = Account.markets.find((el) => {
            return el.symbol.toLowerCase() === position.symbol.toLowerCase()
        })
        if (marketCaseInsensitive) {
          console.log(`⚠️ [TP_LIMIT] Market encontrado com case diferente para ${position.symbol}: ${marketCaseInsensitive.symbol}`);
          market = marketCaseInsensitive;
        }
      }

      // Verifica se o market foi encontrado
      if (!market) {
        console.error(`❌ [TP_LIMIT] Market não encontrado para ${position.symbol}. Markets disponíveis: ${Account.markets?.map(m => m.symbol).join(', ') || 'nenhum'}`);
        throw new Error(`Market não encontrado para ${position.symbol}`);
      }

      const isLong = parseFloat(position.netQuantity) > 0;
      const totalQuantity = Math.abs(parseFloat(position.netQuantity));
      const quantityToClose = (totalQuantity * percentageToClose) / 100;
      const decimal_quantity = market.decimal_quantity;
      const decimal_price = market.decimal_price;

      console.log(`🎯 [TP_LIMIT] ${position.symbol}: Criando ordem LIMIT de take profit parcial`);
      console.log(`📊 [TP_LIMIT] ${position.symbol}: Preço: $${takeProfitPrice.toFixed(decimal_price)}, Quantidade: ${quantityToClose.toFixed(decimal_quantity)} (${percentageToClose}%)`);

      const formatPrice = (value) => parseFloat(value).toFixed(decimal_price).toString();
      const formatQuantity = (value) => {
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
        clientId: await OrderController.generateUniqueOrderId(config)
      };

      console.log(`🔄 [TP_LIMIT] ${position.symbol}: Enviando ordem LIMIT para corretora...`);

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
          reduceOnly: orderBody.reduceOnly
        }
      });

      if (result && !result.error) {
        console.log(`✅ [TP_LIMIT] ${position.symbol}: Ordem LIMIT de take profit parcial criada com sucesso!`);
        console.log(`   • Order ID: ${result.id || 'N/A'}`);
        console.log(`   • Preço: $${takeProfitPrice.toFixed(decimal_price)}`);
        console.log(`   • Quantidade: ${quantityToClose.toFixed(decimal_quantity)}`);
        console.log(`   • Tipo: ${isLong ? 'LONG' : 'SHORT'}`);
        console.log(`   • ReduceOnly: true`);
        console.log(`   • OrderType: Limit`);
        return result;
      } else {
        const errorMsg = result && result.error ? result.error : 'desconhecido';
        console.error(`❌ [TP_LIMIT] ${position.symbol}: Falha ao criar ordem LIMIT - Erro: ${errorMsg}`);
        return null;
      }

    } catch (error) {
      console.error(`❌ [TP_LIMIT] Erro ao criar ordem LIMIT de take profit parcial para ${position.symbol}:`, error.message);
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
      const Account = account || await AccountController.get(config);

      // Log detalhado para debug
      console.log(`🔍 [CLOSE_PARTIAL] Procurando market para ${position.symbol}`);
      console.log(`🔍 [CLOSE_PARTIAL] Total de markets disponíveis: ${Account.markets?.length || 0}`);

      let market = Account.markets.find((el) => {
          return el.symbol === position.symbol
      })

      // Se não encontrou, tenta uma busca case-insensitive
      if (!market) {
        const marketCaseInsensitive = Account.markets.find((el) => {
            return el.symbol.toLowerCase() === position.symbol.toLowerCase()
        })
        if (marketCaseInsensitive) {
          console.log(`⚠️ [CLOSE_PARTIAL] Market encontrado com case diferente para ${position.symbol}: ${marketCaseInsensitive.symbol}`);
          market = marketCaseInsensitive;
        }
      }

      // Verifica se o market foi encontrado
      if (!market) {
        console.error(`❌ [CLOSE_PARTIAL] Market não encontrado para ${position.symbol}. Markets disponíveis: ${Account.markets?.map(m => m.symbol).join(', ') || 'nenhum'}`);
        throw new Error(`Market não encontrado para ${position.symbol}`);
      }

      console.log(`✅ [CLOSE_PARTIAL] Market encontrado para ${position.symbol}: decimal_quantity=${market.decimal_quantity}`);

      const isLong = parseFloat(position.netQuantity) > 0;
      const totalQuantity = Math.abs(parseFloat(position.netQuantity));
      const quantityToClose = (totalQuantity * percentageToClose) / 100;
      const decimal = market.decimal_quantity;

      console.log(`📊 [CLOSE_PARTIAL] ${position.symbol}: Fechando ${percentageToClose}% da posição`);
      console.log(`📊 [CLOSE_PARTIAL] ${position.symbol}: Quantidade total: ${totalQuantity}, Quantidade a fechar: ${quantityToClose.toFixed(decimal)}`);

      const body = {
          symbol: position.symbol,
          orderType: 'Market',
          side: isLong ? 'Ask' : 'Bid', // Ask if LONG , Bid if SHORT
          reduceOnly: true,
          clientId: await OrderController.generateUniqueOrderId(config),
          quantity: String(quantityToClose.toFixed(decimal))
      };

      // Fecha parcialmente a posição
      const closeResult = await Order.executeOrder(body, config?.apiKey, config?.apiSecret);

      if (closeResult) {
        // Log detalhado da taxa de fechamento parcial
        const fee = market.fee || 0.0004;
        let closePrice = closeResult?.price || position.markPrice || position.entryPrice;
        const exitValue = parseFloat(body.quantity) * parseFloat(closePrice);
        const exitFee = exitValue * fee;

        console.log(`💰 [CLOSE_PARTIAL] ${position.symbol}: Fechamento parcial realizado com sucesso!`);
        console.log(`💰 [CLOSE_PARTIAL] ${position.symbol}: Valor fechado: $${exitValue.toFixed(2)} | Fee: $${exitFee.toFixed(6)} (${(fee * 100).toFixed(4)}%)`);
        console.log(`💰 [CLOSE_PARTIAL] ${position.symbol}: Quantidade restante: ${(totalQuantity - quantityToClose).toFixed(decimal)}`);

        return closeResult;
      } else {
        console.error(`❌ [CLOSE_PARTIAL] ${position.symbol}: Falha ao executar ordem de fechamento parcial`);
        return null;
      }

    } catch (error) {
      console.error(`❌ [CLOSE_PARTIAL] Erro ao fechar parcialmente ${position.symbol}:`, error.message);
      return null;
    }
  }

  // Estatísticas globais de fallback
  static fallbackCount = 0;
  static totalHybridOrders = 0;

  // Função auxiliar para calcular slippage percentual
  static calcSlippagePct(priceLimit, priceCurrent) {
    return Math.abs(priceCurrent - priceLimit) / priceLimit * 100;
  }

  // Função auxiliar para revalidar sinal
  static async revalidateSignal({ market, botName, originalSignalData, config = null }) {
    try {
      // Se não temos dados originais do sinal, assume válido
      if (!originalSignalData) {
        console.log(`ℹ️ [${botName}] ${market}: Sem dados originais para revalidação. Assumindo sinal válido.`);
        return true;
      }

      console.log(`🔍 [${botName}] ${market}: Dados originais do sinal:`, {
        action: originalSignalData.action,
        config: originalSignalData.config,
        timestamp: originalSignalData.timestamp
      });

      // Usa a estratégia passada como parâmetro
      const strategyNameToUse = botName || config?.strategyName || 'DEFAULT';

      // Importa a estratégia apropriada
      const { StrategyFactory } = await import('../Decision/Strategies/StrategyFactory.js');
      const strategy = StrategyFactory.createStrategy(strategyNameToUse);

      console.log(`🔍 [${botName}] ${market}: Usando estratégia: ${strategyNameToUse} (${strategy?.constructor?.name || 'NÃO ENCONTRADA'})`);

      if (!strategy) {
        console.warn(`⚠️ [${botName}] ${market}: Estratégia ${strategyNameToUse} não encontrada. Assumindo sinal válido.`);
        return true;
      }

      // Obtém dados de mercado atualizados
      const timeframe = originalSignalData.config?.time || config?.time || '5m';
      const markets = new Markets();
      const candles = await markets.getKLines(market, timeframe, 30);

      if (!candles || candles.length < 20) {
        console.warn(`⚠️ [${botName}] ${market}: Dados insuficientes para revalidação. Assumindo sinal válido.`);
        return true;
      }

      // Calcula indicadores atualizados
      const { calculateIndicators } = await import('../Decision/Indicators.js');
      const indicators = await calculateIndicators(candles, timeframe, market);

      // Obtém informações do mercado
      const Account = await AccountController.get(config);
      const marketInfo = Account.markets.find(m => m.symbol === market);
      const currentPrice = parseFloat(candles[candles.length - 1].close);

      // Cria dados para análise
      const data = {
        ...indicators,
        market: marketInfo,
        marketPrice: currentPrice
      };

      // Reanalisa o trade com dados atualizados
      const fee = marketInfo.fee || config?.fee || 0.0004;
      const investmentUSD = config?.investmentUSD || 5;
      const media_rsi = config?.mediaRsi || 50;

      console.log(`🔍 [${botName}] ${market}: Revalidando com dados atualizados - Preço atual: $${currentPrice.toFixed(6)}, Fee: ${fee}, Investment: $${investmentUSD}`);

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
        console.log(`🔍 [${botName}] ${market}: Estratégia retornou null - não há sinal válido atualmente`);
        return false;
      }

      // Se não há ação atual, significa que não há sinal válido
      if (!currentAction) {
        console.log(`🔍 [${botName}] ${market}: Estratégia não retornou ação - não há sinal válido atualmente`);
        return false;
      }

      const isStillValid = normalizedCurrentAction === normalizedOriginalAction;

      if (isStillValid) {
        console.log(`✅ [${botName}] ${market}: Sinal revalidado com sucesso.`);
      } else {
        console.log(`❌ [${botName}] ${market}: Sinal não é mais válido. Condições de mercado mudaram.`);
        console.log(`🔍 [${botName}] ${market}: Ação original: ${originalAction} (normalizada: ${normalizedOriginalAction}), Ação atual: ${currentAction || 'NENHUMA'} (normalizada: ${normalizedCurrentAction || 'NENHUMA'})`);
        console.log(`🔍 [${botName}] ${market}: Decision completo:`, decision);
      }

      return isStillValid;

    } catch (error) {
              console.warn(`⚠️ [${botName}] ${market}: Erro na revalidação do sinal: ${error.message}. Assumindo válido.`);
      return true; // Em caso de erro, assume válido para não perder oportunidades
    }
  }

  // Função principal de execução híbrida
  static async openHybridOrder({ entry, stop, target, action, market, volume, decimal_quantity, decimal_price, stepSize_quantity, botName = 'DEFAULT', originalSignalData, config = null }) {
    try {
      const formatPrice = (value) => parseFloat(value).toFixed(decimal_price).toString();
      const formatQuantity = (value) => {
        if (value <= 0) {
          throw new Error(`Quantidade deve ser positiva: ${value}`);
        }
        let formatted = parseFloat(value).toFixed(decimal_quantity);
        if (parseFloat(formatted) === 0 && stepSize_quantity > 0) {
          return stepSize_quantity.toString();
        }
        return formatted.toString();
      };

      // Validações básicas
      if (!entry || !stop || !target || !action || !market || !volume) {
        return { error: 'Parâmetros obrigatórios ausentes' };
      }

      const entryPrice = parseFloat(entry);
      const quantity = formatQuantity(volume / entryPrice);
      const orderValue = entryPrice * (volume / entryPrice);
      const side = action === 'long' ? 'Bid' : 'Ask';
      const finalPrice = formatPrice(entryPrice);

      // Debug dos valores calculados
      console.log(`🔍 [DEBUG] ${market}: Valores calculados:`);
      console.log(`   • Entry: ${entry} -> entryPrice: ${entryPrice}`);
      console.log(`   • Volume: ${volume} -> quantity: ${quantity}`);
      console.log(`   • OrderValue: ${orderValue}`);
      console.log(`   • Side: ${side} (action: ${action})`);
      console.log(`   • FinalPrice: ${finalPrice}`);
      console.log(`   • Decimal_quantity: ${decimal_quantity}, Decimal_price: ${decimal_price}`);

      // Validação de quantidade
      if (parseFloat(quantity) <= 0) {
        return { error: `Quantidade inválida: ${quantity}` };
      }

      // Log inicial da execução híbrida
      const strategyNameToUse = config?.strategyName || botName;
      Logger.info(`\n🚀 [${strategyNameToUse}] ${market}: Iniciando execução híbrida`);
      Logger.info(`📊 [${strategyNameToUse}] ${market}: Preço de entrada: $${entryPrice.toFixed(6)} | Quantidade: ${quantity} | Valor: $${orderValue.toFixed(2)}`);

      // Calcula preços de stop loss e take profit (com ajuste por alavancagem)
      const stopPrice = parseFloat(stop);
      const targetPrice = parseFloat(target);

      // Ajusta Stop Loss pelo leverage do bot/símbolo
      let leverageAdjustedStopPrice = stopPrice;
      try {
        const Account = await AccountController.get({
          apiKey: config?.apiKey,
          apiSecret: config?.apiSecret,
          strategy: config?.strategyName || 'DEFAULT'
        });
        if (Account && Account.leverage) {
          const rawLeverage = Number(Account.leverage);
          const leverage = validateLeverageForSymbol(market, rawLeverage);
          const baseStopLossPct = Math.abs(Number(config?.maxNegativePnlStopPct ?? 10));
          const actualStopLossPct = baseStopLossPct / leverage;
          const isLong = action === 'long';
          const computedLeverageStop = isLong
            ? entryPrice * (1 - actualStopLossPct / 100)
            : entryPrice * (1 + actualStopLossPct / 100);

          // Usa o stop mais conservador (mais próximo do entry, portanto mais protetor)
          if (isFinite(computedLeverageStop)) {
            if (isLong) {
              leverageAdjustedStopPrice = Math.max(computedLeverageStop, stopPrice || 0) || computedLeverageStop;
            } else {
              leverageAdjustedStopPrice = Math.min(computedLeverageStop, stopPrice || Infinity) || computedLeverageStop;
            }
          }

          console.log(`🛡️ [STOP_LEVERAGE] ${market}: base=${baseStopLossPct}% leverage=${leverage}x → efetivo=${actualStopLossPct.toFixed(2)}% | stop(orig)=${isFinite(stopPrice)?stopPrice.toFixed(6):'NaN'} → stop(lev)=${leverageAdjustedStopPrice.toFixed(6)}`);
        } else {
          console.warn(`⚠️ [STOP_LEVERAGE] ${market}: Não foi possível obter leverage para ajuste do stop. Usando stop informado.`);
        }
      } catch (levErr) {
        console.warn(`⚠️ [STOP_LEVERAGE] ${market}: Erro ao ajustar stop por leverage: ${levErr.message}. Usando stop informado.`);
      }

      // Verifica se o Trailing Stop está habilitado para determinar se deve criar Take Profit fixo
      const enableTrailingStop = config?.enableTrailingStop === true;

      Logger.info(`🛡️ [${strategyNameToUse}] ${market}: Configurando ordens de segurança integradas`);
      Logger.info(`   • Stop Loss: $${stopPrice.toFixed(6)}`);

      if (enableTrailingStop) {
        Logger.info(`   • Take Profit: Será gerenciado dinamicamente pelo Trailing Stop`);
      } else {
        Logger.info(`   • Take Profit: $${targetPrice.toFixed(6)} (fixo na corretora)`);
      }

      const body = {
        symbol: market,
        side,
        orderType: "Limit",
        postOnly: true,
        quantity,
        price: finalPrice,
        // Parâmetros de stop loss integrados (sempre criados)
        stopLossTriggerBy: "LastPrice",
        stopLossTriggerPrice: formatPrice(leverageAdjustedStopPrice),
        stopLossLimitPrice: formatPrice(leverageAdjustedStopPrice),
        timeInForce: "GTC",
        selfTradePrevention: "RejectTaker",
        clientId: await OrderController.generateUniqueOrderId(config)
      };

      // Adiciona parâmetros de take profit APENAS se o Trailing Stop estiver desabilitado
      if (!enableTrailingStop) {
        body.takeProfitTriggerBy = "LastPrice";
        body.takeProfitTriggerPrice = formatPrice(targetPrice);
        body.takeProfitLimitPrice = formatPrice(targetPrice);
      }

      // 1. Envia ordem LIMIT (post-only)
      let limitResult;
      try {
        // SEMPRE usa credenciais do config - lança exceção se não disponível
        if (!config?.apiKey || !config?.apiSecret) {
          throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
        }

        limitResult = await Order.executeOrder(body, config.apiKey, config.apiSecret);

        if (!limitResult || limitResult.error) {
          const errorMessage = limitResult && limitResult.error ? limitResult.error.toString() : '';

          if (errorMessage.includes("Order would immediately match and take")) {
            console.log(`🟡 [INFO] ${market}: A ordem com desconto (LIMIT) não foi aceita porque o mercado se moveu muito rápido.`);
            console.log(`[AÇÃO] ${market}: Cancelando e acionando plano B com ordem a MERCADO.`);

            return await OrderController.executeMarketFallback({
              market,
              side,
              quantity,
              botName,
              originalSignalData,
              entryPrice,
              config
            });
                  } else {
          console.error(`❌ [${botName}] ${market}: Falha ao enviar ordem LIMIT: ${limitResult && limitResult.error}`);
          return { error: limitResult && limitResult.error };
        }
      }

      console.log(`✅ [${strategyNameToUse}] ${market}: Ordem LIMIT enviada com sucesso (ID: ${limitResult.id || 'N/A'})`);

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

      if (errorMessage.includes("Order would immediately match and take")) {
        console.log(`🟡 [INFO] ${market}: A ordem com desconto (LIMIT) não foi aceita porque o mercado se moveu muito rápido.`);
        console.log(`[AÇÃO] ${market}: Cancelando e acionando plano B com ordem a MERCADO.`);

        return await OrderController.executeMarketFallback({
          market,
          side,
          quantity,
          botName,
          originalSignalData,
          entryPrice,
          config
        });
        } else {
          console.error(`❌ [${strategyNameToUse}] ${market}: Erro ao enviar ordem LIMIT:`, error.message);
          return { error: error.message };
        }
      }

      // 2. Monitora execução por ORDER_EXECUTION_TIMEOUT_SECONDS
      const timeoutSec = Number(config?.orderExecutionTimeoutSeconds || 12);
      console.log(`⏰ [${strategyNameToUse}] ${market}: Monitorando execução por ${timeoutSec} segundos...`);

      let filled = false;
      for (let i = 0; i < timeoutSec; i++) {
        await new Promise(r => setTimeout(r, 1000));

        try {
          const openOrders = await Order.getOpenOrders(market, "PERP", config.apiKey, config.apiSecret);
          const stillOpen = openOrders && openOrders.some(o =>
            o.id === limitResult.id &&
            (o.status === 'Pending' || o.status === 'New' || o.status === 'PartiallyFilled')
          );

          if (!stillOpen) {
            filled = true;
            break;
          }

          // Log de progresso a cada 3 segundos
          if (i % 3 === 0 && i > 0) {
            console.log(`⏳ [${strategyNameToUse}] ${market}: Aguardando execução... ${i}/${timeoutSec}s`);
          }

        } catch (monitorError) {
          console.warn(`⚠️ [${botName}] ${market}: Erro ao monitorar ordem: ${monitorError.message}`);
        }
      }

      if (filled) {
        console.log(`✅ [SUCESSO] ${market}: Ordem LIMIT executada normalmente em ${timeoutSec} segundos.`);
        console.log(`🛡️ [SUCESSO] ${market}: Ordens de segurança (SL/TP) já configuradas na ordem principal!`);

        return { success: true, type: 'LIMIT', limitResult };
      }

      // 3. Timeout: cancela ordem LIMIT
      console.log(`⏰ [${strategyNameToUse}] ${market}: Ordem LIMIT não executada em ${timeoutSec} segundos. Cancelando...`);

      try {
        await Order.cancelOpenOrder(market, limitResult.id, null, config?.apiKey, config?.apiSecret);
        Logger.info(`✅ [${botName}] ${market}: Ordem LIMIT cancelada com sucesso.`);

        // IMPORTANTE: Atualizar status da ordem no banco para CANCELLED
        try {
          const { default: OrdersService } = await import('../Services/OrdersService.js');
          await OrdersService.updateOrderStatus(limitResult.id, 'CANCELLED', 'LIMIT_TIMEOUT');
          Logger.debug(`✅ [${botName}] ${market}: Status da ordem atualizado para CANCELLED no banco`);
        } catch (updateError) {
          Logger.warn(`⚠️ [${botName}] ${market}: Erro ao atualizar status no banco: ${updateError.message}`);
        }
      } catch (cancelError) {
        Logger.warn(`⚠️ [${botName}] ${market}: Erro ao cancelar ordem LIMIT: ${cancelError.message}`);
      }

      // 4. Revalida sinal e slippage
      console.log(`🔍 [${strategyNameToUse}] ${market}: Revalidando sinal e verificando slippage...`);

              const signalValid = await OrderController.revalidateSignal({ market, botName: strategyNameToUse, originalSignalData, config });
              const markets = new Markets();
        const markPrices2 = await markets.getAllMarkPrices(market);
      const priceCurrent = parseFloat(markPrices2[0]?.markPrice || entryPrice);
      const slippage = OrderController.calcSlippagePct(entryPrice, priceCurrent);

              console.log(`📊 [${strategyNameToUse}] ${market}: Revalidação - Sinal: ${signalValid ? '✅ VÁLIDO' : '❌ INVÁLIDO'} | Slippage: ${slippage.toFixed(3)}%`);

      if (!signalValid) {
        console.log(`🚫 [${strategyNameToUse}] ${market}: Sinal não é mais válido. Abortando entrada.`);
        return { aborted: true, reason: 'signal' };
      }

      const maxSlippage = parseFloat(config?.maxSlippagePct || 0.2);
      if (slippage > maxSlippage) {
        console.log(`🚫 [${strategyNameToUse}] ${market}: Slippage de ${slippage.toFixed(3)}% excede o máximo permitido (${maxSlippage}%). Abortando entrada.`);
        return { aborted: true, reason: 'slippage' };
      }

      // 5. Fallback: envia ordem a mercado
      console.log(`[AÇÃO] ${market}: Acionando plano B com ordem a MERCADO para garantir entrada.`);

              return await OrderController.executeMarketFallback({
          market,
          side,
          quantity,
          botName,
          originalSignalData,
          entryPrice,
          config
        });

    } catch (error) {
      console.error(`❌ [${strategyNameToUse}] ${market}: Erro no fluxo híbrido:`, error.message);
      return { error: error.message };
    }
  }

  /**
   * NOVO: Método auxiliar para executar fallback a mercado
   * @param {object} params - Parâmetros para execução do fallback
   * @returns {object} - Resultado da execução
   */
  static async executeMarketFallback({ market, side, quantity, botName, originalSignalData, entryPrice, config = null }) {
    try {
      console.log(`⚡ [${botName}] ${market}: Executando fallback a MERCADO para garantir entrada...`);

      const marketBody = {
        symbol: market,
        side,
        orderType: "Market",
        quantity,
        timeInForce: "IOC",
        selfTradePrevention: "RejectTaker",
        clientId: await OrderController.generateUniqueOrderId(config)
      };

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }

      const marketResult = await Order.executeOrder(marketBody, config.apiKey, config.apiSecret);
      if (marketResult && !marketResult.error) {
        OrderController.fallbackCount++;

        // Calcula slippage real
        const executionPrice = parseFloat(marketResult.price || marketResult.avgPrice || entryPrice);
        const slippage = OrderController.calcSlippagePct(entryPrice, executionPrice);

        console.log(`✅ [SUCESSO] ${market}: Operação aberta com sucesso via fallback a MERCADO!`);
        console.log(`📊 [${botName}] ${market}: Preço de execução: $${executionPrice.toFixed(6)} | Slippage: ${slippage.toFixed(3)}%`);

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
        console.log(`🛡️ [FAILSAFE] ${market}: Detectando posição aberta e criando TP/SL...`);
        setTimeout(async () => {
          try {
            await OrderController.detectPositionOpenedAndCreateFailsafe(market, botName, {
              ...marketResult,
              botName,
              executionPrice
            }, config); // 🔧 CORREÇÃO: Passa config com credenciais
          } catch (error) {
            console.error(`❌ [FAILSAFE] ${market}: Erro ao criar TP/SL automático:`, error.message);
          }
        }, 2000); // Aguarda 2 segundos para posição ser registrada

        // Estatística de fallback
        if (OrderController.totalHybridOrders % 50 === 0) {
          const fallbackPct = (OrderController.fallbackCount / OrderController.totalHybridOrders) * 100;
          console.log(`\n📈 [EXECUTION_STATS] Taxa de fallback: ${fallbackPct.toFixed(1)}% (${OrderController.fallbackCount}/${OrderController.totalHybridOrders} ordens)`);
          if (fallbackPct > 30) {
            console.log('⚠️ Taxa de fallback alta! Considere ajustar ORDER_EXECUTION_TIMEOUT_SECONDS ou o preço da LIMIT.');
          } else {
            console.log('✅ Taxa de fallback dentro do esperado.');
          }
        }

        return { success: true, type: 'MARKET', marketResult, executionPrice, slippage };
      } else {
        console.log(`❌ [${botName}] ${market}: Fallback - Falha ao executar ordem a mercado: ${marketResult && marketResult.error}`);
        return { error: marketResult && marketResult.error };
      }
    } catch (error) {
      console.error(`❌ [${botName}] ${market}: Erro no fluxo híbrido:`, error.message);
      return { error: error.message };
    }
  };

  /**
   * Método openOrder - wrapper para openHybridOrder
   * @param {object} orderData - Dados da ordem
   * @returns {object} - Resultado da execução da ordem
   */
  static async openOrder(orderData, config = null) {
    try {
      // Valida se os parâmetros obrigatórios estão presentes
      const requiredParams = ['entry', 'action', 'market', 'decimal_quantity', 'decimal_price', 'stepSize_quantity'];

      // Para Alpha Flow, valida 'quantity' em vez de 'volume'
      if (orderData.orderNumber) {
        requiredParams.push('quantity');
      } else {
        requiredParams.push('volume');
      }

      for (const param of requiredParams) {
        if (orderData[param] === undefined || orderData[param] === null) {
          console.error(`❌ [openOrder] Parâmetro obrigatório ausente: ${param}`);
          return { error: `Parâmetro obrigatório ausente: ${param}` };
        }
      }

      // Verifica se é uma ordem da Alpha Flow Strategy (com orderNumber)
      if (orderData.orderNumber) {
        console.log(`🔄 [openOrder] Ordem Alpha Flow detectada: ${orderData.market} (Ordem ${orderData.orderNumber})`);

        // Debug: Verifica os valores antes do cálculo
        console.log(`🔍 [DEBUG] Valores para cálculo de quantidade:`);
        console.log(`   • Quantity: ${orderData.quantity}`);
        console.log(`   • Entry: ${orderData.entry}`);
        console.log(`   • Volume calculado: ${orderData.quantity * orderData.entry}`);

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
          botName: orderData.botName || 'DEFAULT',
          config: config
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
          botName: orderData.botName || 'DEFAULT',
          originalSignalData: orderData.originalSignalData,
          config: config
        });

        return result;
      }
    } catch (error) {
      console.error(`❌ [openOrder] Erro ao executar ordem:`, error.message);
      // Retorna erro mas NÃO para o bot - apenas registra o erro
      return { error: error.message };
    }
  }

  static async getRecentOpenOrders(market, config = null) {
    // SEMPRE usa credenciais do config - lança exceção se não disponível
    if (!config?.apiKey || !config?.apiSecret) {
      throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
    }

    const orders = await Order.getOpenOrders(market, "PERP", config.apiKey, config.apiSecret)

    if (!orders || orders.length === 0) {
      return [];
    }

    // Filtra apenas ordens de entrada Limit (não stop loss/take profit)
    const entryOrders = orders.filter(order => {
      // Verifica se é uma ordem pendente
      const isPending = order.status === 'Pending' ||
                       order.status === 'New' ||
                       order.status === 'PartiallyFilled';

      // Verifica se é uma ordem Limit (ordens de entrada)
      const isLimitOrder = order.orderType === 'Limit';

      // Verifica se NÃO é uma ordem de stop loss ou take profit
      const isNotStopLoss = !order.stopLossTriggerPrice && !order.stopLossLimitPrice;
      const isNotTakeProfit = !order.takeProfitTriggerPrice && !order.takeProfitLimitPrice;

      // Verifica se NÃO é uma ordem reduceOnly (que são ordens de saída)
      const isNotReduceOnly = !order.reduceOnly;

      const isEntryOrder = isPending && isLimitOrder && isNotStopLoss && isNotTakeProfit && isNotReduceOnly;

      // Log detalhado para debug
      if (isPending) {
        console.log(`   📋 ${market}: ID=${order.id}, Type=${order.orderType}, Status=${order.status}, ReduceOnly=${order.reduceOnly}, StopLoss=${!!order.stopLossTriggerPrice}, TakeProfit=${!!order.takeProfitTriggerPrice} → ${isEntryOrder ? 'ENTRADA' : 'OUTRO'}`);
      }

      return isEntryOrder;
    });

    const orderShorted = entryOrders.sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    return orderShorted;
  }

  /**
   * Obtém apenas ordens de entrada recentes (não stop loss/take profit)
   * @param {string} market - Símbolo do mercado
   * @returns {Array} - Lista de ordens de entrada
   */
  async getRecentEntryOrders(market) {
    const orders = await Order.getOpenOrders(market)

    if (!orders || orders.length === 0) {
      return [];
    }

    // Filtra apenas ordens de entrada Limit (não stop loss/take profit)
    const entryOrders = orders.filter(order => {
      // Verifica se é uma ordem pendente
      const isPending = order.status === 'Pending' ||
                       order.status === 'New' ||
                       order.status === 'PartiallyFilled';

      // Verifica se é uma ordem Limit (ordens de entrada)
      const isLimitOrder = order.orderType === 'Limit';

      // Verifica se NÃO é uma ordem de stop loss ou take profit
      const isNotStopLoss = !order.stopLossTriggerPrice && !order.stopLossLimitPrice;
      const isNotTakeProfit = !order.takeProfitTriggerPrice && !order.takeProfitLimitPrice;

      // Verifica se NÃO é uma ordem reduceOnly (que são ordens de saída)
      const isNotReduceOnly = !order.reduceOnly;

      const isEntryOrder = isPending && isLimitOrder && isNotStopLoss && isNotTakeProfit && isNotReduceOnly;

      // Log detalhado para debug
      if (isPending) {
        console.log(`   📋 ${market}: ID=${order.id}, Type=${order.orderType}, Status=${order.status}, ReduceOnly=${order.reduceOnly}, StopLoss=${!!order.stopLossTriggerPrice}, TakeProfit=${!!order.takeProfitTriggerPrice} → ${isEntryOrder ? 'ENTRADA' : 'OUTRO'}`);
      }

      return isEntryOrder;
    });

    const orderShorted = entryOrders.sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const result = orderShorted.map((el) => {
        const minutes = Utils.minutesAgo(el.createdAt);
        console.log(`   ⏰ ${market}: Ordem ${el.id} criada há ${minutes} minutos`);
        return {
            id: el.id,
            minutes: minutes,
            triggerPrice: parseFloat(el.triggerPrice),
            price: parseFloat(el.price)
        }
    });

    return result;
  }

  async getAllOrdersSchedule(markets_open) {
    const orders = await Order.getOpenOrders()
    const orderShorted = orders.sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    const list = orderShorted.map((el) => {
        return {
            id: el.id,
            minutes: Utils.minutesAgo(el.createdAt),
            triggerPrice: parseFloat(el.triggerPrice),
            symbol: el.symbol
        }
    })

    return list.filter((el) => !markets_open.includes(el.symbol))
  }

  async createStopTS({ symbol, price, isLong, quantity, config = null }) {

  // SEMPRE usa credenciais do config - lança exceção se não disponível
  if (!config?.apiKey || !config?.apiSecret) {
    throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
  }

  const Account = await AccountController.get({
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    strategy: config?.strategyName || 'DEFAULT'
  });
  const find = Account.markets.find(el => el.symbol === symbol);

  if (!find) throw new Error(`Symbol ${symbol} not found in account data`);

  const decimal_quantity = find.decimal_quantity;
  const decimal_price = find.decimal_price;
  const tickSize = find.tickSize * 10

  if (price <= 0) throw new Error("Invalid price: must be > 0");

  price = Math.abs(price);

  const triggerPrice = isLong ? price - tickSize : price + tickSize
  const formatPrice = (value) => parseFloat(value).toFixed(decimal_price).toString();
  const formatQuantity = (value) => {
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
    selfTradePrevention: "RejectTaker",
    price: formatPrice(price),
    triggerBy: 'LastPrice',
    triggerPrice: formatPrice(triggerPrice),
    triggerQuantity: formatQuantity(quantity),
    clientId: await OrderController.generateUniqueOrderId(config)
  };

    return await Order.executeOrder(body, config?.apiKey, config?.apiSecret);
  }

  /**
   * Valida se existe stop loss para uma posição e cria se não existir
   * @param {object} position - Dados da posição
   * @param {string} botName - Nome único do bot
   * @returns {boolean} - True se stop loss foi criado ou já existia
   */
  static async validateAndCreateStopLoss(position, botName, config = null) {
    const symbol = position.symbol;

      // 1. VERIFICA O LOCK
      if (OrderController.stopLossCreationInProgress.has(symbol)) {
        console.log(`🔒 [${botName}] ${symbol}: Lock ativo, pulando criação de stop loss`);
        return false;
      }

    try {
      // 2. ADQUIRE O LOCK
      OrderController.stopLossCreationInProgress.add(symbol);
      console.log(`🔒 [${botName}] ${symbol}: Lock adquirido para criação de stop loss`);

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Verifica se o par está autorizado antes de tentar criar stop loss
      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: config?.strategyName || 'DEFAULT'
      });
      const marketInfo = Account.markets.find(m => m.symbol === position.symbol);
      if (!marketInfo) {
        // Par não autorizado - retorna silenciosamente sem tentar criar stop loss
        OrderController.debug(`ℹ️ [${botName}] ${position.symbol}: Par não autorizado - pulando criação de stop loss`);
        return false;
      }

      // Verifica se já existe uma ordem de stop loss para esta posição
      console.log(`🔍 [${botName}] ${position.symbol}: Verificando se já existe stop loss...`);
      const hasStopLossOrders = await OrderController.hasExistingStopLoss(position.symbol, position, config);

      if (hasStopLossOrders) {
        console.log(`✅ [${botName}] ${position.symbol}: Stop loss já existe, não criando novo`);
        return true;
      }

      console.log(`❌ [${botName}] ${position.symbol}: Stop loss não encontrado, criando novo...`);

      // Verifica se a posição tem quantidade suficiente
      const totalQuantity = Math.abs(parseFloat(position.netQuantity));
      if (totalQuantity <= 0) {
        console.log(`⚠️ [${botName}] ${position.symbol}: Quantidade inválida para stop loss: ${totalQuantity}`);
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
        console.error(`❌ [STOP_LOSS_ERROR] ${position.symbol}: Alavancagem não encontrada na Account`);
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

      console.log(`🛡️ [${botName}] ${position.symbol}: FAILSAFE DE SEGURANÇA - ${baseStopLossPct}% -> ${actualStopLossPct.toFixed(2)}% (leverage ${leverage}x), Preço: $${failsafeStopLossPrice.toFixed(6)}`);

      // 🎯 CAMADA 2: STOP LOSS TÁTICO (se estratégia híbrida ativada)
      let tacticalStopLossPrice = null;
      const enableHybridStrategy = config?.enableHybridStopStrategy === true;

      if (enableHybridStrategy) {
        // Usa ATR para calcular o stop loss tático (mais apertado)
        const markets = new Markets();
        const atrValue = await OrderController.calculateATR(await markets.getKLines(position.symbol, config?.time || '30m', 30), 14);

        if (atrValue && atrValue > 0) {
          const atrMultiplier = Number(config?.initialStopAtrMultiplier || 2.0);
          const atrDistance = atrValue * atrMultiplier;

          tacticalStopLossPrice = isLong
            ? currentPrice - atrDistance
            : currentPrice + atrDistance;

          console.log(`🎯 [${botName}] ${position.symbol}: STOP TÁTICO ATR - ATR: ${atrValue.toFixed(6)}, Multiplicador: ${atrMultiplier}, Distância: ${atrDistance.toFixed(6)}, Preço: $${tacticalStopLossPrice.toFixed(6)}`);
        } else {
          console.log(`⚠️ [${botName}] ${position.symbol}: ATR não disponível para stop tático`);
        }
      }

      // Usa o stop loss mais apertado entre failsafe e tático
      const stopLossPrice = tacticalStopLossPrice &&
        ((isLong && tacticalStopLossPrice > failsafeStopLossPrice) ||
         (!isLong && tacticalStopLossPrice < failsafeStopLossPrice))
        ? tacticalStopLossPrice
        : failsafeStopLossPrice;

      console.log(`✅ [${botName}] ${position.symbol}: Stop Loss Final - $${stopLossPrice.toFixed(6)} (${tacticalStopLossPrice ? 'Tático ATR' : 'Failsafe Tradicional'})`);

      // 🛡️ LOG DE ALTA VISIBILIDADE - ORDEM DE SEGURANÇA MÁXIMA
      console.log(`🛡️ [FAILSAFE] ${position.symbol}: Ordem de segurança máxima (${baseStopLossPct}% PnL) enviada para a corretora com gatilho em $${failsafeStopLossPrice.toFixed(4)}.`);

      try {
        const formatPrice = (value) => parseFloat(value).toFixed(decimal_price).toString();
        const formatQuantity = (value) => {
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
          clientId: await OrderController.generateUniqueOrderId(config)
        };

        console.log(`🔄 [${botName}] ${position.symbol}: Criando stop loss - Trigger Price: $${stopLossPrice.toFixed(6)}`);

        const stopResult = await Order.executeOrder(stopBody, config?.apiKey, config?.apiSecret);

        if (stopResult && !stopResult.error) {
                  console.log(`✅ [${botName}] ${position.symbol}: Stop loss criado com sucesso! - Trigger: $${stopLossPrice.toFixed(6)}, Quantidade: ${totalQuantity}`);
        const positionKey = `${botName}_${position.symbol}`;
          OrderController.validatedStopLossPositions.add(positionKey);
          OrderController.clearStopLossCheckCache(position.symbol);
          console.log(`🧹 [${botName}] ${position.symbol}: Cache de stop loss limpo após criação`);
          return true;
        } else {
          const errorMsg = stopResult && stopResult.error ? stopResult.error : 'desconhecido';
          console.log(`❌ [${botName}] ${position.symbol}: Falha ao criar stop loss - Erro: ${errorMsg}`);
          return false;
        }
      } catch (error) {
        console.log(`❌ [${botName}] ${position.symbol}: Erro ao criar stop loss: ${error.message}`);
        return false;
      }

    } catch (error) {
      console.error(`❌ [${botName}] Erro ao validar/criar stop loss para ${position.symbol}:`, error.message);
      return false;
    } finally {
      OrderController.stopLossCreationInProgress.delete(symbol);
      console.log(`🔓 [${botName}] ${symbol}: Lock liberado após criação de stop loss`);
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
      console.log(`🔒 [${botName}] ${symbol}: Lock ativo, pulando criação de take profit`);
      return false;
    }

    try {
      // 2. ADQUIRE O LOCK
      OrderController.takeProfitCreationInProgress.add(symbol);
      console.log(`🔒 [${botName}] ${symbol}: Lock adquirido para criação de take profit`);

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Verifica se o par está autorizado antes de tentar criar take profit
      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: config?.strategyName || 'DEFAULT'
      });
      const marketInfo = Account.markets.find(m => m.symbol === position.symbol);
      if (!marketInfo) {
        // Par não autorizado - retorna silenciosamente sem tentar criar take profit
        OrderController.debug(`ℹ️ [${botName}] ${position.symbol}: Par não autorizado - pulando criação de take profit`);
        return false;
      }

      // Verifica se já existe uma ordem de take profit para esta posição
      console.log(`🔍 [${botName}] ${position.symbol}: Verificando se já existe take profit...`);
      const hasTakeProfitOrders = await OrderController.hasTakeProfitOrder(position.symbol, position, config);

      if (hasTakeProfitOrders) {
        console.log(`✅ [${botName}] ${position.symbol}: Take profit já existe, não criando novo`);
        return true;
      }

      console.log(`❌ [${botName}] ${position.symbol}: Take profit não encontrado, criando novo...`);

      // Verifica se a posição tem quantidade suficiente
      const totalQuantity = Math.abs(parseFloat(position.netQuantity));
      if (totalQuantity <= 0) {
        console.log(`⚠️ [${botName}] ${position.symbol}: Quantidade inválida para take profit: ${totalQuantity}`);
        return false;
      }

      // Cria take profit usando o método existente
      const takeProfitResult = await OrderController.createTakeProfitForPosition(position, config);

      if (takeProfitResult && !takeProfitResult.error) {
        console.log(`✅ [${botName}] ${position.symbol}: Take profit criado com sucesso!`);

        // Atualiza o cache para refletir que agora EXISTE take profit
        const cacheKey = `${position.symbol}_TP_${position.netQuantity > 0 ? 'LONG' : 'SHORT'}`;
        OrderController.takeProfitCheckCache.set(cacheKey, {
          lastCheck: Date.now(),
          hasTakeProfit: true
        });

        console.log(`🧹 [${botName}] ${position.symbol}: Cache de take profit atualizado para TRUE após criação`);
        return true;
      } else {
        const errorMsg = takeProfitResult && takeProfitResult.error ? takeProfitResult.error : 'desconhecido';
        console.log(`❌ [${botName}] ${position.symbol}: Falha ao criar take profit - Erro: ${errorMsg}`);
        return false;
      }

    } catch (error) {
      console.error(`❌ [${botName}] Erro ao validar/criar take profit para ${position.symbol}:`, error.message);
      return false;
    } finally {
      OrderController.takeProfitCreationInProgress.delete(symbol);
      console.log(`🔓 [${botName}] ${symbol}: Lock liberado após criação de take profit`);
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
        console.warn(`⚠️ ATR: Dados insuficientes. Necessário: ${period + 1}, Disponível: ${candles?.length || 0}`);
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
      console.error('❌ Erro ao calcular ATR:', error.message);
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
  static async validateMaxOpenTrades(botName = 'DEFAULT', apiKey = null, apiSecret = null, config = null) {
    try {
      const positions = await Futures.getOpenPositions(apiKey, apiSecret);
      const maxOpenTrades = Number(config?.maxOpenOrders || 5);
      const currentOpenPositions = positions.filter(p => Math.abs(Number(p.netQuantity)) > 0).length;

      if (currentOpenPositions >= maxOpenTrades) {
        return {
          isValid: false,
          message: `🚫 Máximo de ordens atingido: ${currentOpenPositions}/${maxOpenTrades} posições abertas`,
          currentCount: currentOpenPositions,
          maxCount: maxOpenTrades
        };
      }

      return {
        isValid: true,
        message: `✅ Posições abertas: ${currentOpenPositions}/${maxOpenTrades}`,
        currentCount: currentOpenPositions,
        maxCount: maxOpenTrades
      };
    } catch (error) {
      console.error(`❌ [${botName}] Erro ao validar máximo de ordens:`, error.message);
      return {
        isValid: false,
        message: `Erro ao validar máximo de ordens: ${error.message}`,
        currentCount: 0,
        maxCount: 0
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
        console.error(`❌ [FAILSAFE] Credenciais de API não fornecidas para ${position.symbol}`);
        return { error: 'Credenciais de API não fornecidas' };
      }

      // Busca informações do mercado
      const AccountController = await import('../Controllers/AccountController.js');
      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: config?.strategyName || 'DEFAULT'
      });
      const marketInfo = Account.markets.find(m => m.symbol === position.symbol);
      if (!marketInfo) {
        console.error(`❌ [FAILSAFE] Market info não encontrada para ${position.symbol}`);
        return { error: 'Market info não encontrada' };
      }

      // VERIFICAÇÃO ADICIONAL: Verifica se já existe stop loss antes de criar
      const hasStopLossOrders = await OrderController.hasExistingStopLoss(position.symbol, position, config);

      if (hasStopLossOrders) {
        console.log(`✅ [FAILSAFE] ${position.symbol}: Stop loss já existe, pulando criação de failsafe orders`);
        return { success: true, message: 'Stop loss já existe' };
      }

      const decimal_quantity = marketInfo.decimal_quantity;
      const decimal_price = marketInfo.decimal_price;

      // 1. Obter os dados necessários da posição e da configuração
      const entryPrice = parseFloat(position.avgEntryPrice || position.entryPrice || position.markPrice);
      const leverage = parseFloat(position.leverage || Account.leverage || 20); // Fallback para 20x se não disponível
      const targetProfitPct = parseFloat(config?.minProfitPercentage || 0.5); // ex: 0.5
      const stopLossPct = Math.abs(parseFloat(config?.maxNegativePnlStopPct || 4.0)); // ex: 4.0 (usa valor absoluto)
      const isLong = parseFloat(position.netQuantity) > 0;
      const totalQuantity = Math.abs(Number(position.netQuantity));

      // Debug das variáveis de configuração
      console.log(`🔍 [FAILSAFE_VARS] ${position.symbol}: Variáveis de configuração`);
      console.log(`   • MIN_PROFIT_PERCENTAGE: ${config?.minProfitPercentage || 'não definido'} -> ${targetProfitPct}%`);
      console.log(`   • MAX_NEGATIVE_PNL_STOP_PCT: ${config?.maxNegativePnlStopPct || 'não definido'} -> ${stopLossPct}%`);
      console.log(`   • Leverage: ${leverage}x`);

      // 2. Calcular os preços de gatilho considerando alavancagem
      let takeProfitPrice;
      let stopLossPrice;

      if (isLong) { // Se a posição for de COMPRA (LONG)
        // O lucro acontece quando o preço sobe
        takeProfitPrice = entryPrice * (1 + (targetProfitPct / 100) / leverage);
        // A perda acontece quando o preço cai
        stopLossPrice = entryPrice * (1 - (stopLossPct / 100) / leverage);
      } else { // Se a posição for de VENDA (SHORT)
        // O lucro acontece quando o preço cai (take profit abaixo do preço de entrada)
        takeProfitPrice = entryPrice * (1 - (targetProfitPct / 100) / leverage);
        // A perda acontece quando o preço sobe (stop loss acima do preço de entrada)
        stopLossPrice = entryPrice * (1 + (stopLossPct / 100) / leverage);
      }

      // Log adicional para debug da lógica
      console.log(`🔍 [FAILSAFE_LOGIC] ${position.symbol}: Lógica de cálculo`);
      console.log(`   • Posição: ${isLong ? 'LONG' : 'SHORT'} (quantidade: ${position.netQuantity})`);
      console.log(`   • Para ${isLong ? 'LONG' : 'SHORT'}: TP ${isLong ? 'acima' : 'abaixo'} do preço, SL ${isLong ? 'abaixo' : 'acima'} do preço`);

      // 3. Logar os preços calculados para verificação
      console.log(`🛡️ [FAILSAFE_CALC] ${position.symbol}: Entry=${entryPrice.toFixed(6)}, Leverage=${leverage}x`);
      console.log(`  -> TP Target: ${targetProfitPct}% -> Preço Alvo: $${takeProfitPrice.toFixed(6)}`);
      console.log(`  -> SL Target: ${stopLossPct}% -> Preço Alvo: $${stopLossPrice.toFixed(6)}`);

      // 🛡️ LOG DE ALTA VISIBILIDADE - ORDEM DE SEGURANÇA MÁXIMA
      console.log(`🛡️ [FAILSAFE] ${position.symbol}: Ordem de segurança máxima (${stopLossPct}% PnL) enviada para a corretora com gatilho em $${stopLossPrice.toFixed(4)}.`);

      // Valida se os preços são válidos
      if (stopLossPrice <= 0 || takeProfitPrice <= 0) {
        console.error(`❌ [FAILSAFE] ${position.symbol}: Preços calculados inválidos - SL: ${stopLossPrice}, TP: ${takeProfitPrice}`);
        return { error: 'Preços calculados inválidos' };
      }

      // Valida distância mínima dos preços (0.1% do preço de entrada)
      const minDistance = entryPrice * 0.001; // 0.1%
      const currentPrice = parseFloat(position.markPrice || entryPrice);

      console.log(`🔍 [FAILSAFE_DEBUG] ${position.symbol}: Validando distâncias mínimas`);
      console.log(`   • Preço atual: $${currentPrice.toFixed(6)}`);
      console.log(`   • Distância mínima: $${minDistance.toFixed(6)}`);

      const slDistance = Math.abs(stopLossPrice - currentPrice);
      const tpDistance = Math.abs(takeProfitPrice - currentPrice);

      console.log(`   • Distância SL: $${slDistance.toFixed(6)} (${slDistance < minDistance ? 'MUITO PRÓXIMO' : 'OK'})`);
      console.log(`   • Distância TP: $${tpDistance.toFixed(6)} (${tpDistance < minDistance ? 'MUITO PRÓXIMO' : 'OK'})`);

      if (slDistance < minDistance) {
        console.warn(`⚠️ [FAILSAFE] ${position.symbol}: Stop Loss muito próximo do preço atual (${slDistance.toFixed(6)} < ${minDistance.toFixed(6)})`);
        const newStopLossPrice = currentPrice + (isLong ? -minDistance : minDistance);
        console.warn(`   • Ajustando Stop Loss de ${stopLossPrice.toFixed(6)} para ${newStopLossPrice.toFixed(6)}`);
        stopLossPrice = newStopLossPrice;
      }

      if (tpDistance < minDistance) {
        console.warn(`⚠️ [FAILSAFE] ${position.symbol}: Take Profit muito próximo do preço atual (${tpDistance.toFixed(6)} < ${minDistance.toFixed(6)})`);
        const newTakeProfitPrice = currentPrice + (isLong ? minDistance : -minDistance);
        console.warn(`   • Ajustando Take Profit de ${takeProfitPrice.toFixed(6)} para ${newTakeProfitPrice.toFixed(6)}`);
        takeProfitPrice = newTakeProfitPrice;
      }

      // Funções de formatação
      const formatPrice = (value) => parseFloat(value).toFixed(decimal_price).toString();
      const formatQuantity = (value) => {
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

      console.log(`🛡️ [FAILSAFE] ${position.symbol}: Criando ordens de segurança`);
      console.log(`   • Preço de entrada: $${entryPrice.toFixed(6)}`);
      console.log(`   • Stop Loss: $${stopLossPrice.toFixed(6)} (${stopLossPct}% com ${leverage}x leverage)`);

      if (enableTrailingStop) {
        console.log(`   • Take Profit: Será gerenciado dinamicamente pelo Trailing Stop`);
      } else {
        console.log(`   • Take Profit: $${takeProfitPrice.toFixed(6)} (${targetProfitPct}% com ${leverage}x leverage)`);
      }
      console.log(`   • Quantidade: ${totalQuantity}`);

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
        clientId: await OrderController.generateFailsafeOrderId(config, 'stop')
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
        clientId: await OrderController.generateUniqueOrderId(config)
        };
      }

      // 6. Envia ordens para a corretora
      const stopLossResult = await Order.executeOrder(stopLossBody, config?.apiKey, config?.apiSecret);
      let takeProfitResult = null;

      if (takeProfitBody) {
        takeProfitResult = await Order.executeOrder(takeProfitBody, config?.apiKey, config?.apiSecret);
      }

      // 7. Verifica resultados
      let successCount = 0;
      let errorMessages = [];

      if (stopLossResult && !stopLossResult.error) {
        console.log(`✅ [FAILSAFE] ${position.symbol}: Stop Loss criado - OrderID: ${stopLossResult.id || 'N/A'}`);
        successCount++;
      } else {
        const error = stopLossResult?.error || 'desconhecido';
        console.log(`❌ [FAILSAFE] ${position.symbol}: Stop Loss FALHOU - Motivo: ${error}`);
        errorMessages.push(`Stop Loss: ${error}`);
      }

      if (enableTrailingStop) {
        // Se o Trailing Stop está ativo, não criamos Take Profit fixo
        console.log(`ℹ️ [FAILSAFE] ${position.symbol}: Take Profit será gerenciado dinamicamente pelo Trailing Stop`);
      } else if (takeProfitResult && !takeProfitResult.error) {
        console.log(`✅ [FAILSAFE] ${position.symbol}: Take Profit criado - OrderID: ${takeProfitResult.id || 'N/A'}`);
        successCount++;
      } else if (takeProfitResult && takeProfitResult.error) {
        const error = takeProfitResult.error || 'desconhecido';
        console.log(`❌ [FAILSAFE] ${position.symbol}: Take Profit FALHOU - Motivo: ${error}`);
        errorMessages.push(`Take Profit: ${error}`);
      }

      // 8. Log final
      if (enableTrailingStop) {
        // Quando Trailing Stop está ativo, só precisamos do Stop Loss
        if (successCount === 1) {
          console.log(`🛡️ [FAILSAFE] ${position.symbol}: Ordem de segurança criada com sucesso!`);
          console.log(`   • Stop Loss em $${stopLossPrice.toFixed(6)}`);
          console.log(`   • Take Profit será gerenciado dinamicamente pelo Trailing Stop`);
          return { success: true, stopLossResult, takeProfitResult: null };
        } else {
          console.log(`❌ [FAILSAFE] ${position.symbol}: Falha ao criar Stop Loss`);
          return { error: errorMessages.join(', ') };
        }
      } else {
        // Quando Trailing Stop está desabilitado, precisamos de ambas as ordens
        if (successCount === 2) {
          console.log(`🛡️ [FAILSAFE] ${position.symbol}: Ordens de segurança criadas com sucesso!`);
          console.log(`   • Stop Loss em $${stopLossPrice.toFixed(6)}`);
          console.log(`   • Take Profit em $${takeProfitPrice.toFixed(6)}`);
          return { success: true, stopLossResult, takeProfitResult };
        } else if (successCount === 1) {
          console.log(`⚠️ [FAILSAFE] ${position.symbol}: Apenas uma ordem de segurança foi criada`);
          return { partial: true, stopLossResult, takeProfitResult, errors: errorMessages };
        } else {
          console.log(`❌ [FAILSAFE] ${position.symbol}: Falha ao criar ordens de segurança`);
          return { error: errorMessages.join(', ') };
        }
      }

    } catch (error) {
      console.error(`❌ [FAILSAFE] Erro ao criar ordens de segurança para ${position.symbol}:`, error.message);
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
      const positions = await Futures.getOpenPositions(config?.apiKey, config?.apiSecret);
      const position = positions?.find(p => p.symbol === market && Math.abs(Number(p.netQuantity)) > 0);

      if (!position) {
        console.log(`⚠️ [FAILSAFE] ${market}: Posição não encontrada após abertura`);
        return { error: 'Posição não encontrada' };
      }

      console.log(`🎯 [FAILSAFE] ${market}: Posição detectada, criando ordens de segurança...`);

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
              console.log(`📋 [STRATEGY_TAG] ${market}: Bot marcado como "${orderResult.botName}" com alvo $${orderResult.target}`);
            } else {
              console.log(`📋 [STRATEGY_TAG] ${market}: Bot marcado como "${orderResult.botName}"`);
            }

            await TrailingStop.saveStateToDB(market, trailingState, config?.id);
          }
        } catch (trailingError) {
          console.warn(`⚠️ [FAILSAFE] ${market}: Erro ao atualizar estado do trailing stop:`, trailingError.message);
        }
      }

      // Cria ordens de segurança
      const failsafeResult = await OrderController.createFailsafeOrders(position, botName, config);

      if (failsafeResult.success) {
        console.log(`🛡️ [FAILSAFE] ${market}: Rede de segurança ativada com sucesso!`);
      } else if (failsafeResult.partial) {
        console.log(`⚠️ [FAILSAFE] ${market}: Rede de segurança parcialmente ativada`);
      } else {
        console.log(`❌ [FAILSAFE] ${market}: Falha ao ativar rede de segurança`);
      }

      return failsafeResult;

    } catch (error) {
      console.error(`❌ [FAILSAFE] Erro ao detectar posição aberta para ${market}:`, error.message);
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
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Busca ordens abertas para o símbolo
      const openOrders = await Order.getOpenOrders(symbol, "PERP", apiKey, apiSecret);

      if (!openOrders || openOrders.length === 0) {
        return true;
      }

      // Filtra apenas ordens de segurança (stop loss e take profit com reduceOnly)
      const failsafeOrders = openOrders.filter(order => {
        const isReduceOnly = order.reduceOnly;
        const hasStopLoss = order.stopLossTriggerPrice || order.stopLossLimitPrice;
        const hasTakeProfit = order.takeProfitTriggerPrice || order.takeProfitLimitPrice;
        const isPending = order.status === 'Pending' || order.status === 'New' || order.status === 'PartiallyFilled' || order.status === 'TriggerPending';

        return isReduceOnly && (hasStopLoss || hasTakeProfit) && isPending;
      });

      if (failsafeOrders.length === 0) {
        console.log(`ℹ️ [FAILSAFE] ${symbol}: Nenhuma ordem de segurança encontrada para cancelar`);
        return true;
      }

      console.log(`🛡️ [FAILSAFE] ${symbol}: Cancelando ${failsafeOrders.length} ordem(ns) de segurança...`);

      // Cancela todas as ordens de segurança
      const cancelPromises = failsafeOrders.map(order =>
        Order.cancelOpenOrder(symbol, order.id, order.clientId, config?.apiKey, config?.apiSecret)
      );

      const cancelResults = await Promise.all(cancelPromises);
      const successfulCancels = cancelResults.filter(result => result !== null).length;

      if (successfulCancels > 0) {
        console.log(`✅ [FAILSAFE] ${symbol}: ${successfulCancels} ordem(ns) de segurança cancelada(s) com sucesso`);
        return true;
      } else {
        console.log(`❌ [FAILSAFE] ${symbol}: Falha ao cancelar ordens de segurança`);
        return false;
      }

    } catch (error) {
      console.error(`❌ [FAILSAFE] Erro ao cancelar ordens de segurança para ${symbol}:`, error.message);
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
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Busca ordens abertas para o símbolo
      const openOrders = await Order.getOpenOrders(symbol, "PERP", apiKey, apiSecret);

      if (!openOrders || openOrders.length === 0) {
        return { hasStopLoss: false, hasTakeProfit: false, orders: [] };
      }

      // Filtra ordens de segurança
      const failsafeOrders = openOrders.filter(order => {
        const isReduceOnly = order.reduceOnly;
        const hasStopLoss = order.stopLossTriggerPrice || order.stopLossLimitPrice;
        const hasTakeProfit = order.takeProfitTriggerPrice || order.takeProfitLimitPrice;
        const isPending = order.status === 'Pending' || order.status === 'New' || order.status === 'PartiallyFilled' || order.status === 'TriggerPending';

        return isReduceOnly && (hasStopLoss || hasTakeProfit) && isPending;
      });

      const hasStopLoss = failsafeOrders.some(order => order.stopLossTriggerPrice || order.stopLossLimitPrice);
      const hasTakeProfit = failsafeOrders.some(order => order.takeProfitTriggerPrice || order.takeProfitLimitPrice);

      return { hasStopLoss, hasTakeProfit, orders: failsafeOrders };

    } catch (error) {
      console.error(`❌ [FAILSAFE] Erro ao verificar ordens de segurança para ${symbol}:`, error.message);
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
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Busca posições abertas
      const positions = await Futures.getOpenPositions(apiKey, apiSecret);

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
        const hasStopLossOrders = await OrderController.hasExistingStopLoss(symbol, position, config);

        if (hasStopLossOrders && failsafeStatus.hasStopLoss) {
          console.log(`✅ [FAILSAFE] ${symbol}: Stop loss já existe, não recriando`);
          continue;
        }

        if (!failsafeStatus.hasStopLoss || !failsafeStatus.hasTakeProfit) {
          console.log(`⚠️ [FAILSAFE] ${symbol}: Ordens de segurança incompletas detectadas`);
          console.log(`   • Stop Loss: ${failsafeStatus.hasStopLoss ? '✅' : '❌'}`);
          console.log(`   • Take Profit: ${failsafeStatus.hasTakeProfit ? '✅' : '❌'}`);

          // Recria ordens de segurança
          const recreateResult = await OrderController.createFailsafeOrders(position, botName, config);

          if (recreateResult.success) {
            console.log(`✅ [FAILSAFE] ${symbol}: Ordens de segurança recriadas com sucesso`);
            recreated++;
          } else {
            console.log(`❌ [FAILSAFE] ${symbol}: Falha ao recriar ordens de segurança`);
          }
        }
      }

      if (checked > 0) {
        console.log(`🛡️ [FAILSAFE] Monitoramento concluído: ${checked} posições verificadas, ${recreated} redes de segurança recriadas`);
      }

      return { checked, recreated };

    } catch (error) {
      console.error(`❌ [FAILSAFE] Erro no monitoramento de ordens de segurança:`, error.message);
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
      console.log(message);
    }
  }

  /**
   * Verifica se há posições abertas que não estão sendo monitoradas
   */
  static async checkForUnmonitoredPositions(botName, config = null) {
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Cache para evitar verificações excessivas
      const cacheKey = `unmonitored_${botName}`;
      const cached = OrderController.stopLossCheckCache.get(cacheKey);
      const now = Date.now();

      if (cached && (now - cached.lastCheck) < 10000) { // 10 segundos de cache para verificações de posições
        return; // Pula verificação se feita recentemente
      }

      // Busca posições abertas
      const positions = await Futures.getOpenPositions(apiKey, apiSecret) || [];

      if (positions.length === 0) {
        return;
      }

      // Atualiza cache de verificação
      OrderController.stopLossCheckCache.set(cacheKey, {
        lastCheck: now,
        hasStopLoss: false
      });

      // Logar todas as posições abertas (monitoradas ou não)
      for (const position of positions) {
        const Account = await AccountController.get({
          apiKey,
          apiSecret,
          strategy: config?.strategyName || 'DEFAULT'
        });
        const marketInfo = Account.markets.find(m => m.symbol === position.symbol);

        // Verifica se marketInfo existe antes de acessar a propriedade fee
        if (!marketInfo) {
          // Posição manual em par não autorizado - usa configurações padrão
          const defaultFee = parseFloat(config?.fee || 0.0004);
          const entryPrice = parseFloat(position.avgEntryPrice || position.entryPrice || position.markPrice);
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
          OrderController.debug(`📋 [MANUAL_POSITION] ${position.symbol} | Volume: $${orderValue.toFixed(2)} | Taxa estimada: $${totalFee.toFixed(6)} (≈ ${percentFee.toFixed(2)}%) | PnL: $${pnl.toFixed(6)} (${pnlPct.toFixed(3)}%) | ⚠️ Par não configurado`);
          continue; // Pula criação de ordens para pares não autorizados
        }

        const fee = marketInfo.fee || config?.fee || 0.0004;
        const entryPrice = parseFloat(position.avgEntryPrice || position.entryPrice || position.markPrice);
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
        OrderController.debug(`[MONITOR][ALL] ${position.symbol} | Volume: $${orderValue.toFixed(2)} | Taxa total estimada (entrada+saída): $${totalFee.toFixed(6)} (≈ ${percentFee.toFixed(2)}%) | PnL atual: $${pnl.toFixed(6)} | PnL%: ${pnlPct.toFixed(3)}%`);
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
            strategy: config?.strategyName || 'DEFAULT'
          });
          const marketInfo = Account.markets.find(m => m.symbol === position.symbol);

          if (!marketInfo) {
            OrderController.debug(`ℹ️ [MANUAL_POSITION] ${position.symbol}: Par não autorizado - pulando criação de ordens automáticas`);
            continue; // Pula posições em pares não autorizados
          }

          // SEMPRE valida e cria stop loss para todas as posições AUTORIZADAS
          await OrderController.validateAndCreateStopLoss(position, botName, config);

          // Log de debug para monitoramento
          OrderController.debug(`🛡️ [MONITOR] ${position.symbol}: Stop loss validado/criado`);

          // Verifica se já existem ordens de take profit para esta posição
          const existingOrders = await Order.getOpenOrders(position.symbol, "PERP", config?.apiKey, config?.apiSecret);
          const hasTakeProfitOrders = existingOrders && existingOrders.some(order =>
            order.takeProfitTriggerPrice || order.takeProfitLimitPrice
          );

          if (!hasTakeProfitOrders) {
            // Cria take profit orders apenas se não existirem
            await OrderController.validateAndCreateTakeProfit(position, botName, config);
            OrderController.debug(`💰 [MONITOR] ${position.symbol}: Take profit orders criados`);
          } else {
            OrderController.debug(`💰 [MONITOR] ${position.symbol}: Take profit orders já existem`);
          }
        }
      }

    } catch (error) {
      console.warn(`⚠️ [MONITOR-${botName}] Falha ao verificar posições não monitoradas:`, error.message);
    }
  }

  /**
   * Verifica se já existe uma ordem de stop loss para uma posição
   * @param {string} symbol - Símbolo do mercado
   * @param {object} position - Dados da posição
   * @returns {boolean} - True se já existe stop loss
   */
  static async hasExistingStopLoss(symbol, position, config = null) {
    try {
      // Verifica cache primeiro
      const cacheKey = `${symbol}_${position.netQuantity > 0 ? 'LONG' : 'SHORT'}`;
      const cached = OrderController.stopLossCheckCache.get(cacheKey);
      const now = Date.now();

      if (cached && (now - cached.lastCheck) < OrderController.stopLossCheckCacheTimeout) {
        // Usa resultado do cache se ainda é válido
        return cached.hasStopLoss;
      }

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      const existingOrders = await Order.getOpenOrders(symbol, "PERP", apiKey, apiSecret);

      console.log(`🔍 [STOP_LOSS_CHECK] ${symbol}: Encontradas ${existingOrders?.length || 0} ordens abertas`);

      if (!existingOrders || existingOrders.length === 0) {
        // Atualiza cache
        OrderController.stopLossCheckCache.set(cacheKey, {
          lastCheck: now,
          hasStopLoss: false
        });
        console.log(`🔍 [STOP_LOSS_CHECK] ${symbol}: Nenhuma ordem encontrada - retornando false`);
        return false;
      }

      // Obter preço de entrada da posição
      const entryPrice = parseFloat(position.entryPrice || position.avgEntryPrice || 0);
      const isLong = parseFloat(position.netQuantity) > 0;

      console.log(`🔍 [STOP_LOSS_CHECK] ${symbol}: Verificando ordens - EntryPrice: ${entryPrice}, IsLong: ${isLong}, NetQuantity: ${position.netQuantity}`);

      const hasStopLossOrders = existingOrders.some(order => {
        const isReduceOnly = order.reduceOnly;
        const correctSide = order.side === (isLong ? 'Ask' : 'Bid');
        const isPending = order.status === 'Pending' || order.status === 'New' || order.status === 'PartiallyFilled' || order.status === 'TriggerPending';

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

        // CORREÇÃO: Para ordens condicionais (TriggerPending), considera como stop loss se for reduceOnly e lado correto
        const isConditionalStopLoss = isReduceOnly && correctSide && (order.status === 'TriggerPending' || order.status === 'Pending');

        const isStopLossOrder = hasStopLossTrigger || isCorrectlyPositioned || isConditionalStopLoss;

        // Log detalhado para debug
        if (isPending) {
          const orderPrice = order.limitPrice ? parseFloat(order.limitPrice) : 'N/A';
          const positionType = isLong ? 'LONG' : 'SHORT';
          const expectedPosition = isLong ? 'ABAIXO' : 'ACIMA';
          const isCorrectlyPositioned = order.limitPrice ?
            (isLong ? orderPrice < entryPrice : orderPrice > entryPrice) : 'N/A';

          console.log(`🔍 [STOP_LOSS_CHECK] ${symbol}: Ordem ${order.id} - Status: ${order.status}, ReduceOnly: ${isReduceOnly}, Side: ${order.side}, Preço: ${orderPrice}, Tipo: ${positionType}, Entrada: ${entryPrice}, Posicionamento: ${isCorrectlyPositioned} (esperado: ${expectedPosition}), HasTrigger: ${hasStopLossTrigger}, IsStopLoss: ${isStopLossOrder}`);
        }

        // Log para TODAS as ordens (não apenas pending)
                  console.log(`🔍 [STOP_LOSS_CHECK] ${symbol}: Ordem ${order.id} - Status: ${order.status}, ReduceOnly: ${isReduceOnly}, Side: ${order.side}, HasTrigger: ${hasStopLossTrigger}, IsPending: ${isPending}, IsConditionalStopLoss: ${isConditionalStopLoss}, IsStopLoss: ${isStopLossOrder}`);

        return (isPending || order.status === 'TriggerPending') && isStopLossOrder;
      });

      // Atualiza cache
      OrderController.stopLossCheckCache.set(cacheKey, {
        lastCheck: now,
        hasStopLoss: hasStopLossOrders
      });

      console.log(`🔍 [STOP_LOSS_CHECK] ${symbol}: Resultado final - HasStopLoss: ${hasStopLossOrders}, Cache atualizado`);

      return hasStopLossOrders;
    } catch (error) {
      console.error(`❌ [STOP_LOSS_CHECK] Erro ao verificar stop loss existente para ${symbol}:`, error.message);
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
      console.log(`🧹 [CACHE] Cache de stop loss limpo para ${symbol} (${keysToDelete.length} entradas)`);
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
      console.log(`🧹 [CACHE] Cache de take profit limpo para ${symbol} (${keysToDelete.length} entradas)`);
    }
  }

  /**
   * 🧹 ÚNICO MÉTODO para monitorar e limpar ordens órfãs
   * 
   * Detecta e cancela ordens de stop loss/take profit que ficaram órfãs
   * após posições serem fechadas. Consolidado em um único método para
   * evitar duplicação de lógica entre sistemas single-bot e multi-bot.
   * 
   * @param {string} botName - Nome do bot para monitorar
   * @param {object} config - Configurações específicas do bot (apiKey, apiSecret, etc.)
   * @returns {object} Resultado da operação: { orphaned, cancelled, errors }
   */
  static async monitorAndCleanupOrphanedStopLoss(botName, config = null) {
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      const positions = await Futures.getOpenPositions(apiKey, apiSecret) || [];

      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: config?.strategyName || 'DEFAULT'
      });
      const configuredSymbols = Account.markets.map(m => m.symbol);

      let totalOrphanedOrders = 0;
      let totalCancelledOrders = 0;
      const errors = [];

      for (const symbol of configuredSymbols) {
        try {
          const openOrders = await Order.getOpenOrders(symbol, "PERP", apiKey, apiSecret);

          if (!openOrders || openOrders.length === 0) {
            continue; // Pula símbolos sem ordens
          }

          const stopLossOrders = openOrders.filter(order => {
            // Verifica se é uma ordem de stop loss
            const isReduceOnly = order.reduceOnly;
            const hasStopLossTrigger = order.stopLossTriggerPrice || order.stopLossLimitPrice;

            // Se tem trigger de stop loss, é uma ordem de stop loss
            if (hasStopLossTrigger) {
              return true;
            }

            // Se não tem trigger, verifica se está posicionada corretamente
            if (isReduceOnly && order.limitPrice) {
              // Busca a posição correspondente para validar
              const position = positions.find(p => p.symbol === symbol);
              if (position && Math.abs(Number(position.netQuantity)) > 0) {
                return OrderController.isOrderCorrectlyPositionedAsStopLoss(order, position);
              }
            }

            return false;
          });

          if (stopLossOrders.length === 0) {
            continue; // Pula se não há ordens de stop loss
          }

          const position = positions.find(p => p.symbol === symbol);

          if (!position || Math.abs(Number(position.netQuantity)) === 0) {
            console.log(`🧹 [${config.botName}][ORPHAN_MONITOR] ${symbol}: POSIÇÃO FECHADA - ${stopLossOrders.length} ordens de stop loss órfãs detectadas`);

            totalOrphanedOrders += stopLossOrders.length;

            for (const order of stopLossOrders) {
              const orderId = order.id;

              try {
                const cancelResult = await Order.cancelOpenOrder(symbol, orderId, null, apiKey, apiSecret);

                if (cancelResult && !cancelResult.error) {
                  totalCancelledOrders++;

                  OrderController.clearStopLossCheckCache(symbol);
                } else {
                  const errorMsg = cancelResult?.error || 'desconhecido';
                  console.log(`❌ [${config.botName}][ORPHAN_MONITOR] ${symbol}: Falha ao cancelar ordem órfã - OrderID: ${orderId}, Erro: ${errorMsg}`);
                  errors.push(`${symbol} (${orderId}): ${errorMsg}`);
                }
              } catch (error) {
                console.error(`❌ [${config.botName}][ORPHAN_MONITOR] Erro ao cancelar ordem ${orderId} para ${symbol}:`, error.message);
                errors.push(`${symbol} (${orderId}): ${error.message}`);
              }
            }
          }
        } catch (error) {
          console.error(`❌ [${config.botName}][ORPHAN_MONITOR] Erro ao verificar ordens para ${symbol}:`, error.message);
          errors.push(`${symbol}: ${error.message}`);
        }
      }

      if (totalOrphanedOrders > 0) {
        console.log(`🧹 [${config.botName}][ORPHAN_MONITOR] Monitoramento concluído:`);
        console.log(`   • Ordens órfãs detectadas: ${totalOrphanedOrders}`);
        console.log(`   • Ordens canceladas: ${totalCancelledOrders}`);
        console.log(`   • Erros: ${errors.length}`);

        if (errors.length > 0) {
          console.log(`   • Detalhes dos erros: ${errors.join(', ')}`);
        }
      } else {
        console.log(`🧹 [${config.botName}][ORPHAN_MONITOR] Nenhuma ordem órfã encontrada`);
      }

      return {
        orphaned: totalOrphanedOrders,
        cancelled: totalCancelledOrders,
        errors
      };

    } catch (error) {
      console.error(`❌ [${config.botName}][ORPHAN_MONITOR] Erro no monitoramento de ordens órfãs:`, error.message);
      return { orphaned: 0, cancelled: 0, errors: [error.message] };
    }
  }

  // Alias removido - use monitorAndCleanupOrphanedStopLoss() diretamente

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
        config = null
      } = orderData;

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }

      // Valida se os dados de decimal estão disponíveis
      if (decimal_quantity === undefined || decimal_quantity === null ||
          decimal_price === undefined || decimal_price === null ||
          stepSize_quantity === undefined || stepSize_quantity === null) {
        throw new Error(`Dados de decimal ausentes para ${market}. decimal_quantity: ${decimal_quantity}, decimal_price: ${decimal_price}, stepSize_quantity: ${stepSize_quantity}`);
      }

      const formatPrice = (value) => parseFloat(value).toFixed(decimal_price).toString();
      const formatQuantity = (value) => {
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
      console.log(`🔍 [DEBUG] Valores na createLimitOrderWithTriggers:`);
      console.log(`   • Quantity (raw): ${quantity}`);
      console.log(`   • Quantity (formatted): ${formatQuantity(quantity)}`);
      console.log(`   • Entry (raw): ${entry}`);
      console.log(`   • Entry (formatted): ${formatPrice(entry)}`);
      console.log(`   • Market decimals: quantity=${decimal_quantity}, price=${decimal_price}`);

      // Valida se a quantidade é positiva
      if (quantity <= 0) {
        throw new Error(`Quantidade inválida: ${quantity}. Quantity: ${orderData.quantity}, Entry: ${entry}`);
      }

      // Valida se a quantidade é menor que o mínimo permitido
      if (orderData.min_quantity && quantity < orderData.min_quantity) {
        throw new Error(`Quantidade abaixo do mínimo: ${quantity} < ${orderData.min_quantity}`);
      }

      // Calcula o valor da ordem para verificar margem
      const orderValue = quantity * entry;
      console.log(`   💰 [DEBUG] Valor da ordem: $${orderValue.toFixed(2)}`);

      // Verifica se o preço está muito próximo do preço atual (pode causar "Order would immediately match")
      const currentPrice = await this.getCurrentPrice(market);
      if (currentPrice) {
        const priceDiff = Math.abs(entry - currentPrice) / currentPrice;
        const minSpreadPercent = 0.001; // 0.1% de spread mínimo (reduzido para compatibilidade)

        if (priceDiff < minSpreadPercent) {
          console.log(`   ⚠️  ${market}: Preço muito próximo do atual (${priceDiff.toFixed(4)}), ajustando...`);
          // Ajusta o preço para ter pelo menos 0.1% de spread
          const minSpread = currentPrice * minSpreadPercent;
          if (action === 'long') {
            entry = currentPrice - minSpread;
          } else {
            entry = currentPrice + minSpread;
          }
          console.log(`   ✅ ${market}: Preço ajustado para ${formatPrice(entry)} (spread: ${(minSpreadPercent * 100).toFixed(1)}%)`);
        }
      }

      // Prepara o corpo da requisição para a ordem LIMIT com stop loss e take profit integrados
      const orderBody = {
        symbol: market,
        side: action === 'long' ? 'Bid' : 'Ask',
        orderType: 'Limit',
        postOnly: true,
        quantity: formatQuantity(quantity),
        price: formatPrice(entry),
        timeInForce: 'GTC',
        selfTradePrevention: 'RejectTaker',
        clientId: await OrderController.generateUniqueOrderId(config)
      };

      // Adiciona parâmetros de stop loss se fornecido
      if (stop) {
        orderBody.stopLossTriggerBy = 'LastPrice';
        orderBody.stopLossTriggerPrice = formatPrice(stop);
        orderBody.stopLossLimitPrice = formatPrice(stop);
        console.log(`🛑 Stop Loss configurado: ${market} @ ${formatPrice(stop)}`);
      }

      // Adiciona parâmetros de take profit se fornecido
      if (target) {
        orderBody.takeProfitTriggerBy = 'LastPrice';
        orderBody.takeProfitTriggerPrice = formatPrice(target);
        orderBody.takeProfitLimitPrice = formatPrice(target);
        console.log(`🎯 Take Profit configurado: ${market} @ ${formatPrice(target)}`);
      }

      console.log(`🚀 [${botName}] Criando ordem LIMIT: ${market} ${action.toUpperCase()} @ $${formatPrice(entry)}`);
      console.log(`   📋 Detalhes da ordem:`, {
        symbol: market,
        side: orderBody.side,
        quantity: formatQuantity(quantity),
        price: formatPrice(entry),
        stopLoss: stop ? formatPrice(stop) : 'N/A',
        takeProfit: target ? formatPrice(target) : 'N/A',
        orderValue: (quantity * entry).toFixed(2)
      });

      try {
        const response = await Order.executeOrder(orderBody, config.apiKey, config.apiSecret);

        if (response && (response.orderId || response.id)) {
          const orderId = response.orderId || response.id;
          console.log(`✅ [${botName}] Ordem criada com sucesso: ${market} (ID: ${orderId})`);

          // Registra a ordem para monitoramento (apenas para estratégia PRO_MAX)
          if (botName === 'PRO_MAX') {
            OrderController.addPendingEntryOrder(market, {
              stop: stop,
              isLong: action === 'long',
              orderId: orderId
            }, botName);
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
            botName: orderData.botName || 'DEFAULT'
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
          stop: stop,
          target: target,
          decimal_quantity: decimal_quantity,
          decimal_price: decimal_price,
          stepSize_quantity: stepSize_quantity,
          orderValue: (quantity * entry).toFixed(2),
          formattedQuantity: formatQuantity(quantity),
          formattedEntry: formatPrice(entry)
        };

        console.error(`❌ [ORDER_FAIL] Falha ao criar ordem para ${market}. Detalhes: ${JSON.stringify(errorDetails)}. Erro: ${error.message}`);

        return {
          success: false,
          error: error.message,
          details: errorDetails
        };
      }

    } catch (error) {
      console.error(`❌ Erro ao criar ordem LIMIT com triggers: ${error.message}`);
      return {
        success: false,
        error: error.message
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

      if (ticker && ticker.last) {
        return parseFloat(ticker.last);
      }

      return null;
    } catch (error) {
      console.warn(`⚠️  [PRICE] Erro ao obter preço atual para ${market}:`, error.message);
      return null;
    }
  }

  /**
   * Verifica se uma ordem está posicionada corretamente como stop loss
   * @param {object} order - Dados da ordem
   * @param {object} position - Dados da posição
   * @returns {boolean} - True se está posicionada corretamente
   */
  static isOrderCorrectlyPositionedAsStopLoss(order, position) {
    const entryPrice = parseFloat(position.entryPrice || position.avgEntryPrice || 0);
    const isLong = parseFloat(position.netQuantity) > 0;

    if (!order.limitPrice) return false;

    const orderPrice = parseFloat(order.limitPrice);

    if (isLong) {
      // Para LONG: stop loss deve estar ABAIXO do preço de entrada
      return orderPrice < entryPrice;
    } else {
      // Para SHORT: stop loss deve estar ACIMA do preço de entrada
      return orderPrice > entryPrice;
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
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      // Busca ordens abertas para o símbolo
      const openOrders = await Order.getOpenOrders(symbol, "PERP", apiKey, apiSecret);

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
      console.error(`❌ [STOP_LOSS_CHECK] Erro ao verificar stop loss para ${symbol}:`, error.message);
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

      const positions = await Futures.getOpenPositions(config.apiKey, config.apiSecret);
      if (!positions || positions.length === 0) {
        return;
      }

      Logger.debug(`🔍 [TP_MONITOR] Verificando ${positions.length} posições para Take Profit...`);

      for (const position of positions) {
        try {
          // 🔧 NOVO: Valida se a posição foi criada pelo bot
          const isBotPosition = await OrderController.isPositionCreatedByBot(position, config);
          if (!isBotPosition) {
            Logger.debug(`⏭️ [TP_MONITOR] ${position.symbol}: Posição não criada pelo bot - pulando`);
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
   * @returns {Promise<void>}
   */
  static async createTakeProfitForPosition(position, config) {
    try {
      const symbol = position.symbol;
      const netQuantity = parseFloat(position.netQuantity || 0);

      if (Math.abs(netQuantity) === 0) {
        return { success: false, message: 'Posição fechada' }; // Posição fechada
      }

      const enableTrailingStop = config?.enableTrailingStop === true;
      if (enableTrailingStop) {
        Logger.debug(`⏭️ [TP_CREATE] ${symbol}: Trailing Stop ativo - NÃO criando Take Profit fixo`);
        Logger.debug(`ℹ️ [TP_CREATE] ${symbol}: Take Profit será gerenciado dinamicamente pelo Trailing Stop`);
        return { success: false, message: 'Trailing Stop ativo' }; // Não cria TP fixo quando trailing stop está ativo
      }

      // Verifica se já existe ordem de Take Profit
      const hasTakeProfit = await OrderController.hasTakeProfitOrder(symbol, position, config);
      if (hasTakeProfit) {
        Logger.debug(`ℹ️ [TP_CREATE] ${symbol}: Take Profit já existe, pulando criação`);
        return { success: false, message: 'Take Profit já existe' }; // Já existe TP
      }

      Logger.info(`🎯 [TP_CREATE] ${symbol}: Criando Take Profit...`);

      // Obtém informações do mercado para formatação correta
      let Account;
      try {
        Account = await AccountController.get({
          apiKey: config.apiKey,
          apiSecret: config.apiSecret,
          strategy: config?.strategyName || 'DEFAULT'
        });
      } catch (error) {
        Logger.error(`❌ [TP_CREATE] ${symbol}: Erro ao obter Account:`, error.message);
        return { error: `Erro ao obter Account: ${error.message}` };
      }

      if (!Account || !Account.markets) {
        Logger.error(`❌ [TP_CREATE] ${symbol}: Account inválido ou sem markets:`, Account);
        return { error: 'Account inválido ou sem markets' };
      }

      const marketInfo = Account.markets.find(m => m.symbol === symbol);
      if (!marketInfo) {
        Logger.error(`❌ [TP_CREATE] ${symbol}: Market info não encontrada`);
        return { error: 'Market info não encontrada' };
      }

      const decimal_quantity = marketInfo.decimal_quantity || 6;
      const stepSize_quantity = marketInfo.stepSize_quantity || 0.000001;
      const decimal_price = marketInfo.decimal_price || 2;
      const tickSize = marketInfo.tickSize || null;

      // Obtém posições atuais da Backpack PRIMEIRO
      let currentPositions;
      try {
        currentPositions = await Futures.getOpenPositions(config.apiKey, config.apiSecret);
      } catch (error) {
        console.error(`❌ [TP_CREATE] ${symbol}: Erro ao obter posições:`, error.message);
        return;
      }

      if (!currentPositions || !Array.isArray(currentPositions)) {
        console.error(`❌ [TP_CREATE] ${symbol}: Posições inválidas:`, currentPositions);
        return;
      }

      const currentPosition = currentPositions.find(p => p.symbol === symbol);
      if (!currentPosition || Math.abs(parseFloat(currentPosition.netQuantity || 0)) === 0) {
        console.warn(`⚠️ [TP_CREATE] ${symbol}: Posição não encontrada ou já fechada`);
        return;
      }

      console.log(`📊 [TP_CREATE] ${symbol}: Dados da posição:`, {
        symbol: currentPosition.symbol,
        netQuantity: currentPosition.netQuantity,
        entryPrice: currentPosition.entryPrice,
        markPrice: currentPosition.markPrice,
        unrealizedPnl: currentPosition.unrealizedPnl
      });

      const currentNetQuantity = parseFloat(currentPosition.netQuantity || 0);
      const currentIsLong = currentNetQuantity > 0;
      const entryPrice = parseFloat(currentPosition.entryPrice || 0);

      let enableHybridStopStrategy = config?.enableHybridStopStrategy || false;
      let takeProfitPrice = null;
      let takeProfitQuantity = Math.abs(currentNetQuantity); // Será ajustado baseado na estratégia

      if (enableHybridStopStrategy) {
        // Modo Híbrido: Usa ATR para calcular TP parcial
        const partialTakeProfitPercentage = Number(config?.partialTakeProfitPercentage || 50);
        const atrValue = await OrderController.getAtrValue(symbol);

        if (atrValue && atrValue > 0) {
          const atrMultiplier = Number(config?.takeProfitPartialAtrMultiplier || 1.5);
          takeProfitPrice = OrderController.calculateAtrTakeProfitPrice(currentPosition, atrValue, atrMultiplier);
          takeProfitQuantity = (Math.abs(currentNetQuantity) * partialTakeProfitPercentage) / 100;

          console.log(`📊 [TP_HYBRID] ${symbol}: TP Parcial ${partialTakeProfitPercentage}% - Preço: $${takeProfitPrice?.toFixed(4)}, Qty: ${takeProfitQuantity.toFixed(6)}`);
        } else {
          console.log(`⚠️ [TP_HYBRID] ${symbol}: ATR não disponível ou inválido (${atrValue}), usando TP total`);
          enableHybridStopStrategy = false; // Fallback para TP total
          takeProfitQuantity = Math.abs(currentNetQuantity); // Quantidade total para fallback
        }
      }

      if (!enableHybridStopStrategy) {
        // Modo Tradicional: TP total baseado em minProfitPercentage
        const minProfitPercentage = Number(config?.minProfitPercentage || 10);

        // 🔧 CORREÇÃO CRÍTICA: Obtém a alavancagem da conta para calcular o TP correto
        let leverage = 1; // Default
        try {
          const Account = await AccountController.get({
            apiKey: config.apiKey,
            apiSecret: config.apiSecret,
            strategy: config?.strategyName || 'DEFAULT'
          });
          if (Account && Account.leverage) {
            const rawLeverage = parseFloat(Account.leverage);
            // Aplica validação de alavancagem por símbolo (50x para BTC/ETH/SOL, 10x para outros)
            leverage = validateLeverageForSymbol(symbol, rawLeverage);
            console.log(`🔧 [TP_TRADITIONAL] ${symbol}: Alavancagem ${leverage}x (validada, original: ${rawLeverage}x)`);
          }
        } catch (error) {
          console.warn(`⚠️ [TP_TRADITIONAL] ${symbol}: Erro ao obter alavancagem, usando 1x: ${error.message}`);
        }

        // 🔧 CORREÇÃO CRÍTICA: Calcula o TP real considerando a alavancagem
        const actualProfitPct = minProfitPercentage / leverage;

        console.log(`🔧 [TP_TRADITIONAL] ${symbol}: TP - Bruto: ${minProfitPercentage}%, Real: ${actualProfitPct.toFixed(2)}% (leverage ${leverage}x)`);

        // Calcula o preço de TP considerando a alavancagem
        if (currentIsLong) {
          // Para LONG: TP acima do preço de entrada
          takeProfitPrice = entryPrice * (1 + (actualProfitPct / 100));
        } else {
          // Para SHORT: TP abaixo do preço de entrada
          takeProfitPrice = entryPrice * (1 - (actualProfitPct / 100));
        }

        // 🔧 CORREÇÃO: Garante que a quantidade seja total quando não é híbrido
        takeProfitQuantity = Math.abs(currentNetQuantity);

        console.log(`📊 [TP_TRADITIONAL] ${symbol}: TP Total ${minProfitPercentage}% (efetivo ${actualProfitPct.toFixed(2)}%) - Preço: $${takeProfitPrice?.toFixed(4)}, Qty: ${takeProfitQuantity.toFixed(6)}`);
      }

      if (!takeProfitPrice || takeProfitPrice <= 0 || isNaN(takeProfitPrice)) {
        console.error(`❌ [TP_CREATE] ${symbol}: Preço de TP inválido: ${takeProfitPrice} (entryPrice=${entryPrice}, isLong=${isLong})`);
        return;
      }

      // Função para formatar quantidade corretamente
      const formatQuantity = (value) => {
        if (value <= 0) {
          throw new Error(`Quantidade deve ser positiva: ${value}`);
        }
        let formatted = parseFloat(value).toFixed(decimal_quantity);
        if (parseFloat(formatted) === 0 && stepSize_quantity > 0) {
          return stepSize_quantity.toString();
        }
        return formatted.toString();
      };

      // Verificar ordens abertas para evitar duplicidade de TPs (parciais ou totais)
      try {
        const OrderModule = await import('../Backpack/Authenticated/Order.js');
        const openOrders = await OrderModule.default.getOpenOrders(symbol, 'PERP', config.apiKey, config.apiSecret);
        if (Array.isArray(openOrders)) {
          const closeSide = currentIsLong ? 'Ask' : 'Bid';
          const existingReduceOnly = openOrders.filter(o =>
            o.symbol === symbol &&
            o.orderType === 'Limit' &&
            o.reduceOnly === true &&
            o.side === closeSide
          );

          console.log(`🔍 [TP_CREATE] ${symbol}: Ordens reduceOnly encontradas: ${existingReduceOnly.length}`);
          existingReduceOnly.forEach((order, index) => {
            console.log(`🔍 [TP_CREATE] ${symbol}: Ordem ${index + 1} - ID: ${order.id}, Side: ${order.side}, Qty: ${order.quantity}, Price: ${order.price}`);
          });

          const existingQty = existingReduceOnly.reduce((sum, o) => sum + Math.abs(parseFloat(o.quantity || 0)), 0);

          // Se já existe qualquer TP parcial aberto, não criar outro (evita duplicados)
          if (existingQty > 0) {
            console.log(`🔍 [TP_CREATE] ${symbol}: Verificando TPs existentes - Qty existente: ${existingQty}, enableHybrid: ${enableHybridStopStrategy}`);

            if (enableHybridStopStrategy) {
              const partialPercentage = Number(config?.partialTakeProfitPercentage || 50);
              const desiredPartial = Math.abs(currentNetQuantity) * (partialPercentage / 100);
              const tolerance = desiredPartial * 0.95;

              console.log(`🔍 [TP_CREATE] ${symbol}: TP Parcial - Posição: ${currentNetQuantity}, %: ${partialPercentage}%, Desejado: ${desiredPartial}, Tolerância: ${tolerance}`);

              // Verifica se as ordens existentes são realmente TPs parciais (não totais)
              const isPartialTP = existingReduceOnly.some(order => {
                const orderQty = Math.abs(parseFloat(order.quantity || 0));
                const positionQty = Math.abs(currentNetQuantity);
                const isPartial = orderQty < positionQty * 0.99; // 99% da posição = parcial

                console.log(`🔍 [TP_CREATE] ${symbol}: Ordem ${order.id} - Qty: ${orderQty}, Posição: ${positionQty}, É parcial: ${isPartial}`);
                return isPartial;
              });

              if (existingQty >= tolerance && isPartialTP) {
                console.log(`ℹ️ [TP_CREATE] ${symbol}: TP parcial já existe cobrindo ${existingQty} >= desejado ${desiredPartial}. Ignorando.`);
                console.log(`✅ [TP_CREATE] ${symbol}: Saindo da função - TP parcial já existe.`);
                return;
              } else if (existingQty >= tolerance && !isPartialTP) {
                console.log(`⚠️ [TP_CREATE] ${symbol}: TP total existe (${existingQty}) mas queremos parcial. Continuando criação.`);
              } else {
                console.log(`ℹ️ [TP_CREATE] ${symbol}: TP existente insuficiente (${existingQty} < ${tolerance}). Continuando criação.`);
              }
            } else {
              // 🔧 CORREÇÃO: Verifica se o TP existente é realmente total (não parcial)
              const isTotalTP = existingReduceOnly.some(order => {
                const orderQty = Math.abs(parseFloat(order.quantity || 0));
                const positionQty = Math.abs(currentNetQuantity);
                const isTotal = orderQty >= positionQty * 0.99; // 99% da posição = total

                console.log(`🔍 [TP_CREATE] ${symbol}: Ordem ${order.id} - Qty: ${orderQty}, Posição: ${positionQty}, É total: ${isTotal}`);
                return isTotal;
              });

              if (isTotalTP) {
                console.log(`ℹ️ [TP_CREATE] ${symbol}: Já existe TP total aberto (${existingQty}). Ignorando para evitar duplicidade.`);
                console.log(`✅ [TP_CREATE] ${symbol}: Saindo da função - TP total já existe.`);
                return;
              } else {
                console.log(`⚠️ [TP_CREATE] ${symbol}: TP existente é parcial (${existingQty}) mas queremos total. Continuando criação.`);
              }
            }
          }
        }
      } catch (dupErr) {
        console.warn(`⚠️ [TP_CREATE] ${symbol}: Falha ao verificar TPs existentes: ${dupErr.message}`);
      }

      console.log(`📊 [TP_CREATE] ${symbol}: Posição atual: ${currentNetQuantity}, TP Qty: ${takeProfitQuantity}`);

      // Verifica se a quantidade é válida
      if (takeProfitQuantity <= 0) {
        console.error(`❌ [TP_CREATE] ${symbol}: Quantidade de TP inválida: ${takeProfitQuantity}`);
        return;
      }

      // Verifica se a quantidade não excede a posição atual
      const maxQuantity = Math.abs(currentNetQuantity);
      if (takeProfitQuantity > maxQuantity) {
        console.error(`❌ [TP_CREATE] ${symbol}: Quantidade de TP (${takeProfitQuantity}) excede posição atual (${maxQuantity})`);
        return;
      }

      // Verifica se o preço é válido
      if (!takeProfitPrice || takeProfitPrice <= 0) {
        console.error(`❌ [TP_CREATE] ${symbol}: Preço de TP inválido: ${takeProfitPrice}`);
        return;
      }

      // Cria a ordem de Take Profit como ordem de Take Profit com gatilho (compatível com PRO_MAX)
      const formattedLimitPrice = OrderController.formatPriceSafely(takeProfitPrice, decimal_price, tickSize);
      const takeProfitOrder = {
        symbol: symbol,
        side: currentIsLong ? 'Ask' : 'Bid',
        orderType: 'Limit',
        postOnly: true,
        reduceOnly: true,
        quantity: formatQuantity(takeProfitQuantity),
        price: formattedLimitPrice,
        takeProfitTriggerBy: 'LastPrice',
        takeProfitTriggerPrice: formattedLimitPrice,
        takeProfitLimitPrice: formattedLimitPrice,
        timeInForce: 'GTC',
        selfTradePrevention: 'RejectTaker',
        clientId: await OrderController.generateUniqueOrderId(config)
      };

      console.log(`📊 [TP_CREATE] ${symbol}: Enviando ordem TP - Side: ${takeProfitOrder.side}, Qty: ${takeProfitOrder.quantity}, Price: ${takeProfitOrder.price}, Current Position: ${currentNetQuantity}`);

      const OrderModule = await import('../Backpack/Authenticated/Order.js');
      const result = await OrderModule.default.executeOrder(
        takeProfitOrder,
        config.apiKey,
        config.apiSecret
      );

      if (result && result.id) {
        console.log(`✅ [TP_CREATE] ${symbol}: Take Profit criado com sucesso - ID: ${result.id}`);

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
        return { success: true, orderId: result.id };
      } else {
        console.error(`❌ [TP_CREATE] ${symbol}: Falha ao criar Take Profit - Result:`, result);
        return { error: result?.error || 'Resposta inválida da API', result };
      }

    } catch (error) {
      console.error(`❌ [TP_CREATE] Erro ao criar Take Profit para ${position.symbol}:`, error.message);
      return { error: error.message };
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

      if (cached && (now - cached.lastCheck) < OrderController.takeProfitCheckCacheTimeout) {
        Logger.debug(`🔍 [TP_CHECK] ${symbol}: Cache hit - HasTakeProfit: ${cached.hasTakeProfit}`);
        return cached.hasTakeProfit;
      }

      const OrderModule = await import('../Backpack/Authenticated/Order.js');
      const orders = await OrderModule.default.getOpenOrders(symbol, "PERP", config.apiKey, config.apiSecret);
      const netQuantity = parseFloat(position.netQuantity || 0);
      const isLong = netQuantity > 0;

      Logger.debug(`🔍 [TP_CHECK] ${symbol}: Verificando TP existente - Posição: ${netQuantity} (${isLong ? 'LONG' : 'SHORT'})`);
      Logger.debug(`🔍 [TP_CHECK] ${symbol}: Ordens encontradas: ${orders?.length || 0}`);

      let hasTakeProfit = false;

      if (orders && orders.length > 0) {
        const relevantOrders = orders.filter(order =>
          order.symbol === symbol &&
          order.orderType === 'Limit' &&
          order.reduceOnly === true &&
          (order.status === 'Pending' || order.status === 'New' || order.status === 'TriggerPending')
        );

        Logger.debug(`🔍 [TP_CHECK] ${symbol}: Ordens relevantes (Limit + reduceOnly + ativas): ${relevantOrders.length}`);

        for (const order of relevantOrders) {
          const orderSide = order.side;
          const expectedSide = isLong ? 'Ask' : 'Bid';
          const orderQty = parseFloat(order.quantity || 0);
          const positionQty = Math.abs(netQuantity);

          // Aceita qualquer ordem reduce-only no lado correto (seja TP parcial ou total)
          const isCorrectSide = orderSide === expectedSide;
          const hasValidQuantity = orderQty > 0 && orderQty <= positionQty * 1.01; // 1% tolerância

          Logger.debug(`🔍 [TP_CHECK] ${symbol}: Ordem ${order.id} - Side: ${orderSide} (esperado: ${expectedSide}), Qty: ${orderQty} (posição: ${positionQty}), Válida: ${isCorrectSide && hasValidQuantity}`);

          if (isCorrectSide && hasValidQuantity) {
            Logger.debug(`✅ [TP_CHECK] ${symbol}: TP encontrado - Ordem ${order.id}`);
            hasTakeProfit = true;
            break;
          }
        }
      }

      // Atualiza cache
      OrderController.takeProfitCheckCache.set(cacheKey, {
        lastCheck: now,
        hasTakeProfit: hasTakeProfit
      });

      Logger.debug(`${hasTakeProfit ? '✅' : '❌'} [TP_CHECK] ${symbol}: ${hasTakeProfit ? 'TP encontrado' : 'Nenhum TP encontrado'}, cache atualizado`);
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
      const entryPrice = parseFloat(position.entryPrice || 0);
      const netQuantity = parseFloat(position.netQuantity || 0);
      const isLong = netQuantity > 0;

      if (!entryPrice || entryPrice <= 0 || !atrValue || atrValue <= 0 || isNaN(atrValue)) {
        console.warn(`⚠️ [TP_ATR] Valores inválidos para cálculo: entryPrice=${entryPrice}, atrValue=${atrValue}`);
        return null;
      }

      const atrDistance = atrValue * multiplier;

      if (isNaN(atrDistance)) {
        console.warn(`⚠️ [TP_ATR] ATR distance é NaN: atrValue=${atrValue}, multiplier=${multiplier}`);
        return null;
      }

      const takeProfitPrice = isLong
        ? entryPrice + atrDistance
        : entryPrice - atrDistance;

      if (isNaN(takeProfitPrice) || takeProfitPrice <= 0) {
        console.warn(`⚠️ [TP_ATR] Preço de TP calculado é inválido: ${takeProfitPrice} (entryPrice=${entryPrice}, atrDistance=${atrDistance})`);
        return null;
      }

      return takeProfitPrice;
    } catch (error) {
      console.error(`❌ [TP_ATR] Erro ao calcular TP ATR:`, error.message);
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
      const fills = await History.getFillHistory(symbol, null, null, null, 100, 0, null, "PERP", null, config.apiKey, config.apiSecret);

      if (!fills || fills.length === 0) {
        console.log(`position: ${JSON.stringify(position)} | fills: ${JSON.stringify(fills)}`);
        console.log(`⚠️ [BOT_VALIDATION] ${symbol}: Nenhum fill encontrado`);
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
        Logger.debug(`✅ [BOT_VALIDATION] ${symbol}: Posição criada pelo bot - ClientId: ${botFill.clientId}`);
        return true;
      } else {
        Logger.debug(`❌ [BOT_VALIDATION] ${symbol}: Posição não criada pelo bot - ClientIds encontrados: ${fills.map(f => f.clientId).join(', ')}`);
        return false;
      }

    } catch (error) {
      Logger.error(`❌ [BOT_VALIDATION] Erro ao validar posição ${position.symbol}:`, error.message);
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
        console.warn(`⚠️ [TP_ATR] ${symbol}: Candles insuficientes (${candles?.length || 0} < 14)`);
        return null;
      }

      const { calculateIndicators } = await import('../Decision/Indicators.js');
      const indicators = await calculateIndicators(candles, timeframe, symbol);

      const atrValue = indicators.atr?.atr || indicators.atr?.value || null;

      if (!atrValue || atrValue <= 0 || isNaN(atrValue)) {
        console.warn(`⚠️ [TP_ATR] ${symbol}: ATR inválido: ${atrValue}`);
        return null;
      }

      console.log(`📊 [TP_ATR] ${symbol}: ATR válido: ${atrValue}`);
      return atrValue;
    } catch (error) {
      console.error(`❌ [TP_ATR] Erro ao obter ATR para ${symbol}:`, error.message);
      return null;
    }
  }

}

export default OrderController;