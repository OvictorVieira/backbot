import Futures from '../Backpack/Authenticated/Futures.js';
import OrderController from '../Controllers/OrderController.js';
import { StopLossFactory } from '../Decision/Strategies/StopLossFactory.js';
import PnlController from '../Controllers/PnlController.js';
import Markets from '../Backpack/Public/Markets.js';
import AccountController from '../Controllers/AccountController.js';
import { validateLeverageForSymbol, clearLeverageAdjustLog } from '../Utils/Utils.js';
import ColorLogger from '../Utils/ColorLogger.js';
import Logger from '../Utils/Logger.js';
import ConfigManagerSQLite from '../Config/ConfigManagerSQLite.js';
import Order from "../Backpack/Authenticated/Order.js";

class TrailingStop {

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

  // Gerenciador de estado do trailing stop por bot (chave: botId)
  static trailingStateByBot = new Map(); // { botKey: { symbol: state } }
  static trailingModeLoggedByBot = new Map(); // Cache para logs de modo Trailing Stop por bot

  // Instância do ColorLogger para logs coloridos
  static colorLogger = new ColorLogger('TRAILING', 'STOP');

  // Database service instance
  static dbService = null;

  /**
   * Obtém a chave única do bot
   */
  getBotKey() {
    if (!this.config) {
      throw new Error('Configuração do bot é obrigatória - deve ser passada no construtor');
    }
    const botId = this.config.id;
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
   * Carrega o estado do trailing stop da base de dados
   */
  static async loadStateFromDB(dbService) {
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

          Logger.debug(`📊 [PERSISTENCE] ${botKey} - ${symbol}: Trailing Stop: $${state.trailingStopPrice?.toFixed(4) || 'N/A'}, Ativo: ${state.activated}`);
        } catch (error) {
          Logger.error(`❌ [PERSISTENCE] Error parsing state for ${row.symbol}:`, error.message);
        }
      }

      Logger.info(`📂 [PERSISTENCE] Estado do trailing stop carregado: ${totalStates} posições da base de dados`);

    } catch (error) {
      Logger.error(`❌ [PERSISTENCE] Erro ao carregar estado do trailing stop:`, error.message);
      Logger.info(`🔄 [PERSISTENCE] Iniciando com estado vazio devido ao erro`);
      TrailingStop.trailingStateByBot.clear();
    }
  }

  /**
   * Carrega o estado do trailing stop para um bot e símbolo específicos do banco de dados.
   * Este método é mais eficiente do que carregar todos os estados quando apenas um é necessário.
   * @param {object} dbService - A instância do serviço de banco de dados inicializado.
   * @param {string} botId - O ID do bot para o qual carregar o estado.
   * @param {string} symbol - O símbolo do mercado (ex: "SOL_USDC") para o qual carregar o estado.
   * @returns {Promise<object|null>} O objeto de estado carregado ou null se não for encontrado ou em caso de erro.
   */
  static async loadStateForBot(dbService, botId, symbol) {
    try {
      if (!dbService || !dbService.isInitialized()) {
        throw new Error('O serviço de banco de dados deve ser inicializado antes de carregar o estado.');
      }

      // Garante que o serviço de DB esteja disponível para outros métodos, se necessário
      TrailingStop.dbService = dbService;

      // 1. Prepara a query SQL parametrizada para segurança e eficiência
      const query = 'SELECT state, active_stop_order_id FROM trailing_state WHERE botId = ? AND symbol = ?';

      // 2. Executa a busca por um único registro
      const row = await dbService.get(query, [botId, symbol]);

      // 3. Se um registro for encontrado, processa-o
      if (row && row.state) {
        const state = JSON.parse(row.state);

        // ✅ CORREÇÃO: Adiciona o active_stop_order_id como activeStopOrderId no state
        if (row.active_stop_order_id) {
          state.activeStopOrderId = row.active_stop_order_id;
        }

        const botKey = `bot_${botId}`;

        // Garante que o Map para este bot exista na estrutura de dados em memória
        if (!TrailingStop.trailingStateByBot.has(botKey)) {
          TrailingStop.trailingStateByBot.set(botKey, new Map());
        }

        // Armazena o estado carregado no Map em memória
        const trailingStateMap = TrailingStop.trailingStateByBot.get(botKey);
        trailingStateMap.set(symbol, state);

        Logger.info(`📂 [PERSISTENCE] Estado do trailing stop carregado para ${botKey} - ${symbol}`);

        // 4. Retorna o estado para uso imediato
        return state;
      } else {
        Logger.info(`[PERSISTENCE] Nenhum estado de trailing stop salvo encontrado para botId: ${botId}, symbol: ${symbol}.`);
        return null; // Retorna null se nenhum estado for encontrado
      }

    } catch (error) {
      Logger.error(`❌ [PERSISTENCE] Erro ao carregar estado para botId: ${botId}, symbol: ${symbol}:`, error.message);
      return null; // Retorna null em caso de erro
    }
  }

  /**
   * Salva o estado do trailing stop na base de dados
   */
  static async saveStateToDB(symbol, state, botId, config) {
    try {
      if (!TrailingStop.dbService || !TrailingStop.dbService.isInitialized()) {
        Logger.error(`❌ [PERSISTENCE] Database service not initialized, cannot save state`);
        return;
      }

      let externalOrderId = null;

      // Busca as ordens abertas na corretora
      const activeOrders = await Order.getOpenOrders(symbol, "PERP", config.apiKey, config.apiSecret);

      if (activeOrders && activeOrders.length > 0) {
        // Busca tanto stop loss quanto take profit orders para trailing stop
        const stopLossOrder = activeOrders.find(order =>
            order.status === 'TriggerPending' && 
            (order.triggerPrice !== null || order.takeProfitTriggerPrice !== null || order.price !== null)
        );

        if (stopLossOrder) {
          externalOrderId = stopLossOrder.id;

          // 1. Carrega o estado ANTERIOR salvo no banco de dados
          const foundState = await TrailingStop.loadStateForBot(TrailingStop.dbService, botId, symbol);

          let trailingStopIsBetterThanSL = false;
          
          // Determina o preço atual da ordem (stop loss, take profit ou price)
          const currentOrderPrice = stopLossOrder.triggerPrice !== null ? 
            parseFloat(stopLossOrder.triggerPrice) : 
            stopLossOrder.takeProfitTriggerPrice !== null ?
            parseFloat(stopLossOrder.takeProfitTriggerPrice) :
            parseFloat(stopLossOrder.price);

          if (state.isLong) {
            // Para uma posição LONG (comprada), um stop "melhor" é um preço MAIS ALTO.
            // Ele trava mais lucro ou reduz a perda.
            trailingStopIsBetterThanSL = state.trailingStopPrice > currentOrderPrice;

          } else {
            // Para uma posição SHORT (vendida), um stop "melhor" é um preço MAIS BAIXO.
            // Ele também trava mais lucro ou reduz a perda na direção oposta.
            trailingStopIsBetterThanSL = state.trailingStopPrice < currentOrderPrice;
          }

          if(trailingStopIsBetterThanSL) {
            // 2. Compara o preço do stop ATUAL (em memória) com o preço do estado SALVO
            //    Só atualiza se o trailing stop melhorou E o preço mudou significativamente
            const priceChangedSignificantly = foundState ?
              Math.abs(state.trailingStopPrice - foundState.trailingStopPrice) > 0.0001 : true;

            if (foundState && trailingStopIsBetterThanSL && priceChangedSignificantly) {
              Logger.info(`🔄 Trailing stop price for ${symbol} has changed from ${foundState.trailingStopPrice} to ${state.trailingStopPrice}. Replacing order.`);
            } else if (foundState && trailingStopIsBetterThanSL && !priceChangedSignificantly) {
              Logger.debug(`⏭️ [TRAILING_SKIP] ${symbol}: Trailing stop melhorou mas mudança insignificante (${Math.abs(state.trailingStopPrice - foundState.trailingStopPrice).toFixed(8)}), mantendo ordem atual`);
              return; // Não atualiza ordem nem estado
            }

            if (foundState && trailingStopIsBetterThanSL && priceChangedSignificantly) {

              const apiKey = config.apiKey;
              const apiSecret = config.apiSecret;

              const Account = await AccountController.get({
                apiKey,
                apiSecret,
                strategy: config?.strategyName || 'DEFAULT'
              });
              const marketInfo = Account.markets.find(m => m.symbol === symbol);
              if (!marketInfo) {
                Logger.error(`❌ [TRAILING_STOP] Market info não encontrada para ${symbol}`);
                return;
              }

              const decimal_price = marketInfo.decimal_price;

              const formatPrice = (value) => parseFloat(value).toFixed(decimal_price).toString()

              // Determina se a ordem atual é stop loss, take profit ou price
              const isStopLossOrder = stopLossOrder.triggerPrice !== null;
              const isTakeProfitOrder = stopLossOrder.takeProfitTriggerPrice !== null;
              const isPriceOrder = stopLossOrder.price !== null && !isStopLossOrder && !isTakeProfitOrder;
              
              const bodyPayload = {
                symbol: symbol,
                side: state.isLong ? 'Ask' : 'Bid',
                orderType: 'Limit',
                quantity: stopLossOrder.triggerQuantity,
                clientId: await OrderController.generateUniqueOrderId(config),
                apiKey: apiKey,
                apiSecret: apiSecret,
              }
              
              // Define o tipo de trigger baseado na ordem existente
              if (isStopLossOrder) {
                bodyPayload.stopLossTriggerPrice = formatPrice(state.trailingStopPrice);
              } else if (isTakeProfitOrder) {
                bodyPayload.takeProfitTriggerPrice = formatPrice(state.trailingStopPrice);
              } else if (isPriceOrder) {
                bodyPayload.price = formatPrice(state.trailingStopPrice);
              }

              // 3. Cria a NOVA ordem (stop loss, take profit ou limit) com o preço atualizado
              let stopResult;
              if (isStopLossOrder) {
                stopResult = await OrderController.ordersService.createStopLossOrder(bodyPayload);
              } else if (isTakeProfitOrder) {
                stopResult = await OrderController.ordersService.createTakeProfitOrder(bodyPayload);
              } else if (isPriceOrder) {
                stopResult = await OrderController.ordersService.createOrder(bodyPayload);
              }

              // 4. Se a nova ordem foi criada, cancela a ANTIGA (apenas se existir)
              if (stopResult && stopResult.id) {
                const orderType = isStopLossOrder ? 'stop loss' : 
                  isTakeProfitOrder ? 'take profit' : 'limit';
                if (foundState.activeStopOrderId && foundState.activeStopOrderId !== 'undefined') {
                  Logger.info(`✅ New ${orderType} order ${stopResult.id} created. Cancelling old order ${foundState.activeStopOrderId}.`);
                  let cancelOrderPayload = {
                    symbol: symbol,
                    orderId: foundState.activeStopOrderId,
                    apiKey: apiKey,
                    apiSecret: apiSecret
                  };

                  await OrderController.ordersService.cancelOrder(cancelOrderPayload);
                } else {
                  Logger.info(`✅ New ${orderType} order ${stopResult.id} created. No old order to cancel.`);
                }

                externalOrderId = stopResult.id;
                state.activeStopOrderId = stopResult.id;
              } else {
                Logger.error(`Falha ao tentar mover o Stop Loss. Erro: ${stopResult.error}`)
              }
            }

            Logger.info(`Stop loss ativo encontrado para ${symbol}. Order ID: ${externalOrderId}`);
          } else {
            Logger.info(`🔄 Trailing stop price for ${symbol} is not better than stop loss price. Stop Loss Price: ${stopLossOrder.triggerPrice}, Trailing Stop Price: ${state.trailingStopPrice}. Skipping order replacement and updating the trailing stop price.`);
            state.trailingStopPrice = parseFloat(stopLossOrder.triggerPrice);
          }
        } else {
          Logger.warn(`Nenhuma ordem de stop loss ativa (TriggerPending) foi encontrada para ${symbol}.`);
        }
      } else {
        Logger.info(`Nenhuma ordem aberta encontrada para ${symbol}.`);
      }

      const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);

      if (!botConfig) {
        Logger.error(`❌ [PERSISTENCE] Bot config not found for bot ${botId}, cannot save state`);
        return;
      }

      if (botConfig.enableTrailingStop === true) {
        await TrailingStop.dbService.run(
            'INSERT OR REPLACE INTO trailing_state (botId, symbol, state, active_stop_order_id, updatedAt) VALUES (?, ?, ?, ?, ?)',
            [botId, symbol, JSON.stringify(state), externalOrderId, new Date().toISOString()]
        );

        TrailingStop.debug(`💾 [PERSISTENCE] Estado do trailing stop salvo para bot ${botId}, símbolo ${symbol}`);
      } else {
        Logger.info(`💾 [PERSISTENCE] Trailing Stop desativado para bot ${botId}, símbolo ${symbol}`);
      }

    } catch (error) {
      Logger.error(`❌ [PERSISTENCE] Erro ao salvar estado do trailing stop para ${symbol}:`, error.message);
    }
  }

  /**
   * Limpa o estado do trailing stop da base de dados
   */
  static async clearStateFromDB(symbol) {
    try {
      if (!TrailingStop.dbService || !TrailingStop.dbService.isInitialized()) {
        Logger.error(`❌ [PERSISTENCE] Database service not initialized, cannot clear state`);
        return;
      }

      await TrailingStop.dbService.run(
        'DELETE FROM trailing_state WHERE symbol = ?',
        [symbol]
      );

      TrailingStop.debug(`🗑️ [PERSISTENCE] Estado do trailing stop removido para ${symbol}`);
    } catch (error) {
      Logger.error(`❌ [PERSISTENCE] Erro ao limpar estado do trailing stop para ${symbol}:`, error.message);
    }
  }

  /**
   * Limpa estados obsoletos que não correspondem a posições abertas atuais.
   */
  static async cleanupObsoleteStates(config = null) {
    try {
      Logger.info(`🧹 [CLEANUP] Verificando estados obsoletos do Trailing Stop...`);

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = config.apiKey;
      const apiSecret = config.apiSecret;

      const positions = await Futures.getOpenPositions(apiKey, apiSecret);

      // 🔧 CORREÇÃO: Filtra apenas posições realmente abertas (netQuantity > 0)
      const activePositions = positions ? positions.filter(p => Math.abs(parseFloat(p.netQuantity || 0)) > 0) : [];
      const openSymbols = activePositions.map(p => p.symbol);

      let cleanedStates = 0;
      const statesToRemove = [];

      // Itera sobre todos os bots
      for (const [botKey, trailingStateMap] of TrailingStop.trailingStateByBot.entries()) {
        for (const [symbol, state] of trailingStateMap.entries()) {
          if (!openSymbols.includes(symbol)) {
            statesToRemove.push({ botKey, symbol });
            Logger.debug(`🗑️ [CLEANUP] ${botKey} - ${symbol}: Estado removido - posição não está mais aberta`);
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
        Logger.debug(`💾 [CLEANUP] Salvando estado limpo com ${cleanedStates} estados removidos...`);
        // Save all remaining states to database
        for (const [botKey, trailingStateMap] of TrailingStop.trailingStateByBot.entries()) {
          const botId = parseInt(botKey.replace('bot_', '')) || 1;
          for (const [symbol, state] of trailingStateMap.entries()) {
            await TrailingStop.saveStateToDB(symbol, state, botId, config);
          }
        }
        Logger.info(`✅ [CLEANUP] Limpeza concluída: ${cleanedStates} estados obsoletos removidos`);
      } else {
        Logger.info(`ℹ️ [CLEANUP] Nenhum estado obsoleto encontrado`);
      }

    } catch (error) {
      Logger.error(`❌ [CLEANUP] Erro durante limpeza:`, error.message);
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

      const initialAtrStopPrice = TrailingStop.calculateAtrStopLossPrice(position, Account, atrValue, initialStopAtrMultiplier);
      const partialTakeProfitPrice = TrailingStop.calculateAtrTakeProfitPrice(position, atrValue, takeProfitAtrMultiplier);

      Logger.info(`🎯 [PARTIAL TRAILING STOP] ${position.symbol}: Stop Loss Inteligente configurado - Volatilidade: ${atrValue.toFixed(6)}, Stop Loss: $${initialAtrStopPrice.toFixed(4)}, Take Profit Parcial: $${partialTakeProfitPrice.toFixed(4)}`);

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
        createdAt: new Date().toISOString()
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
        takeProfitPrice: null
      };
    }

    if (shouldActivate) {
      Logger.info(`✅ [TRAILING STOP] ${position.symbol}: Estado ATIVADO - PnL: ${pnlPct.toFixed(2)}%, Entry: $${entryPrice.toFixed(4)}, Atual: $${currentPrice.toFixed(4)}, Stop Inicial: $${initialState.initialStopLossPrice?.toFixed(4) || 'N/A'}, Tipo: ${isLong ? 'LONG' : 'SHORT'}`);
    } else {
      Logger.info(`✅ [TRAILING STOP] ${position.symbol}: Estado criado (aguardando lucro) - PnL: ${pnlPct.toFixed(2)}%, Entry: $${entryPrice.toFixed(4)}, Atual: $${currentPrice.toFixed(4)}, Stop Inicial: $${initialState.initialStopLossPrice?.toFixed(4) || 'N/A'}, Tipo: ${isLong ? 'LONG' : 'SHORT'}`);
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
          Logger.info(`🔄 [ATR_RECOVERY] ${botKey} - ${symbol}: Recuperando estado ATR existente - ATR: ${existingState.atrValue?.toFixed(6) || 'N/A'}, Stop: $${existingState.initialAtrStopPrice?.toFixed(4) || 'N/A'}, Fase: ${existingState.phase || 'N/A'}`);
          return existingState;
        }
      }

      const enableHybridStrategy = true; // Assume que está habilitado
      if (enableHybridStrategy) {
        const atrValue = await TrailingStop.getAtrValue(symbol);
        const initialStopAtrMultiplier = 2.0; // Valor padrão
        const takeProfitAtrMultiplier = 1.5; // Valor padrão

        const initialAtrStopPrice = TrailingStop.calculateAtrStopLossPrice(position, account, atrValue, initialStopAtrMultiplier);
        const partialTakeProfitPrice = TrailingStop.calculateAtrTakeProfitPrice(position, atrValue, takeProfitAtrMultiplier);

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
          isLong: parseFloat(position.netQuantity || 0) > 0,
          isShort: parseFloat(position.netQuantity || 0) < 0,
          highestPrice: null,
          lowestPrice: null,
          activated: true,
          initialized: true,
          createdAt: new Date().toISOString()
        };

        // Salva o estado no bot atual (assumindo que é o primeiro bot encontrado)
        const firstBotKey = Array.from(TrailingStop.trailingStateByBot.keys())[0];
        if (firstBotKey) {
          const trailingStateMap = TrailingStop.trailingStateByBot.get(firstBotKey);
          trailingStateMap.set(symbol, recoveredState);
          await TrailingStop.saveStateToDB(symbol, recoveredState, config?.id, config);
        }

        Logger.info(`🎯 [ATR_RECOVERY] ${symbol}: Stop Loss Inteligente configurado - Volatilidade: ${atrValue.toFixed(6)}, Stop Loss: $${initialAtrStopPrice.toFixed(4)}, Take Profit Parcial: $${partialTakeProfitPrice.toFixed(4)}`);
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
   * Calcula o preço de stop loss inicial baseado na configuração
   * @param {object} position - Dados da posição
   * @param {object} account - Dados da conta
   * @returns {number} - Preço de stop loss inicial
   */
  static calculateInitialStopLossPrice(position, account) {
    try {
      const currentPrice = parseFloat(position.markPrice || position.lastPrice || 0);

      if (!account?.leverage) {
        Logger.error(`❌ [STOP_LOSS_ERROR] ${position.symbol}: Alavancagem não encontrada na Account`);
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
      Logger.error(`[INITIAL_STOP] Erro ao calcular stop loss inicial para ${position.symbol}:`, error.message);
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
        TrailingStop.colorLogger.trailingCleanup(`${symbol}: Estado limpo (${reason}) - Trailing Stop: $${state?.trailingStopPrice?.toFixed(4) || 'N/A'}`);

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

      clearLeverageAdjustLog(position.symbol);
    }
  }

  /**
   * Força a limpeza completa do estado do Trailing Stop
   * Útil quando o bot é reiniciado e precisa começar do zero
   */
  static async forceCleanupAllStates() {
    try {
      Logger.info(`🧹 [FORCE_CLEANUP] Limpeza completa do estado do Trailing Stop...`);

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
          Logger.info(`🗑️ [FORCE_CLEANUP] Todos os estados removidos da base de dados`);
        } catch (error) {
          Logger.error(`❌ [FORCE_CLEANUP] Erro ao limpar base de dados:`, error.message);
        }
      }

      Logger.info(`✅ [FORCE_CLEANUP] Limpeza completa concluída: ${totalStateCount} estados removidos de todos os bots`);

    } catch (error) {
      Logger.error(`❌ [FORCE_CLEANUP] Erro durante limpeza completa:`, error.message);
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
      Logger.info(`🧹 [TRAILING_CLEANER] Iniciando limpeza de estados órfãos para bot ${botId}`);

      const botKey = `bot_${botId}`;
      const trailingStateMap = TrailingStop.trailingStateByBot.get(botKey);

      if (!trailingStateMap || trailingStateMap.size === 0) {
        Logger.debug(`[TRAILING_CLEANER] Nenhum estado de trailing stop para bot ${botId}`);
        return;
      }

      // Busca todas as posições abertas na exchange
      const openPositions = await Futures.getOpenPositions(apiKey, apiSecret);
      const openSymbols = new Set(openPositions.map(pos => pos.symbol));

      let cleanedCount = 0;
      const symbolsToClean = [];

      // Verifica cada estado de trailing stop
      for (const [symbol, state] of trailingStateMap.entries()) {
        if (!openSymbols.has(symbol)) {
          symbolsToClean.push(symbol);
        }
      }

      // Limpa os estados órfãos
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
      Logger.error(`[ATR_STOP_CALC] Erro ao calcular stop loss ATR para ${position.symbol}:`, error.message);
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
      Logger.error(`[ATR_TP_CALC] Erro ao calcular take profit ATR para ${position.symbol}:`, error.message);
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
      Logger.debug(`🚀 [TRAILING_START] ${position.symbol}: Iniciando atualização do trailing stop`);

      const enableTrailingStop = this.config?.enableTrailingStop || false;
      const enableHybridStrategy = this.config?.enableHybridStopStrategy || false;

      Logger.debug(`🔧 [TRAILING_CONFIG] ${position.symbol}: enableTrailingStop=${enableTrailingStop}, enableHybridStrategy=${enableHybridStrategy}`);

      if (!enableTrailingStop) {
        Logger.debug(`⚠️ [TRAILING_SKIP] ${position.symbol}: Trailing stop desabilitado`);
        return null;
      }

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!this.config?.apiKey || !this.config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = this.config.apiKey;
      const apiSecret = this.config.apiSecret;

      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: this.strategyType
      });

      if (!Account.leverage) {
        Logger.error(`❌ [TRAILING_ERROR] ${position.symbol}: Alavancagem não encontrada na Account`);
        return null;
      }

      const { pnl, pnlPct } = TrailingStop.calculatePnL(position, Account);
      const currentPrice = parseFloat(position.markPrice || 0);
      const entryPrice = parseFloat(position.entryPrice || 0);

      if (currentPrice <= 0 || entryPrice <= 0) {
        Logger.error(`❌ [TRAILING_ERROR] Preços inválidos para ${position.symbol}: Current: ${currentPrice}, Entry: ${entryPrice}`);
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
      Logger.debug(`🔍 [TRAILING_STRATEGY] ${position.symbol}: enableHybridStrategy=${enableHybridStrategy}, config.enableHybridStopStrategy=${this.config?.enableHybridStopStrategy}`);

      if (enableHybridStrategy) {
        Logger.debug(`🎯 [TRAILING_STRATEGY] ${position.symbol}: Usando estratégia HÍBRIDA`);
        // Se não existe estado, tenta recuperar estado ATR
        if (!trailingState) {
          trailingState = await TrailingStop.recoverAtrState(position.symbol, position, Account, this.config);
        }
        return await this.updateTrailingStopHybrid(position, trailingState, Account, pnl, pnlPct, currentPrice, entryPrice, isLong, isShort);
      }

      Logger.debug(`🎯 [TRAILING_STRATEGY] ${position.symbol}: Usando estratégia TRADICIONAL`);
      return await this.updateTrailingStopTraditional(position, trailingState, Account, pnl, pnlPct, currentPrice, entryPrice, isLong, isShort);

    } catch (error) {
      Logger.error(`[TRAILING_UPDATE] Erro ao atualizar trailing stop para ${position.symbol}:`, error.message);
      return null;
    } finally {
      if (trailingState) {
        const botId = this.config?.id;
        await TrailingStop.saveStateToDB(position.symbol, trailingState, botId, this.config);
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
  async updateTrailingStopHybrid(position, trailingState, account, pnl, pnlPct, currentPrice, entryPrice, isLong, isShort) {
    try {
      Logger.debug(`🔍 [HYBRID_DEBUG] INÍCIO updateTrailingStopHybrid para ${position.symbol}`);
      Logger.debug(`🔍 [HYBRID_DEBUG] trailingState exists: ${!!trailingState}`);
      Logger.debug(`🔍 [HYBRID_DEBUG] position: ${JSON.stringify(position)}`);
      Logger.debug(`🔍 [HYBRID_DEBUG] pnl: ${pnl}, pnlPct: ${pnlPct}, currentPrice: ${currentPrice}`);

      // === FASE 1: RISCO INICIAL ===
      if (!trailingState) {
        Logger.debug(`🔍 [HYBRID_DEBUG] FASE 1: Inicializando novo trailing state`);
        // Inicializa nova posição na fase de risco inicial
        const atrValue = await TrailingStop.getAtrValue(position.symbol);
        const initialStopAtrMultiplier = Number(this.config?.initialStopAtrMultiplier || 2.0);
        const takeProfitAtrMultiplier = Number(this.config?.partialTakeProfitAtrMultiplier || 1.5);

        // 1. CALCULAR OS DOIS STOPS
        // a) Stop Tático (ATR)
        const atrStopPrice = TrailingStop.calculateAtrStopLossPrice(position, account, atrValue, initialStopAtrMultiplier);

        // b) Stop de Segurança Máxima (PnL)
        const maxPnlStopPrice = TrailingStop.calculateInitialStopLossPrice(position, account);

        // 2. LOGAR OS CÁLCULOS PARA TRANSPARÊNCIA
        Logger.info(`🔍 [STOP_CALC] ${position.symbol}: Stop Tático (ATR) calculado em $${atrStopPrice?.toFixed(4) || 'N/A'}`);
        const maxNegativePnlStopPct = this.config?.maxNegativePnlStopPct || -10;
        Logger.info(`🔍 [STOP_CALC] ${position.symbol}: Stop de Segurança Máxima (${maxNegativePnlStopPct}%) calculado em $${maxPnlStopPrice?.toFixed(4) || 'N/A'}`);

        // 3. TOMAR E LOGAR A DECISÃO
        // Para uma COMPRA (LONG), o stop mais seguro é o mais ALTO.
        // Para uma VENDA (SHORT), o stop mais seguro é o mais BAIXO.
        const finalStopPrice = isLong
          ? Math.max(atrStopPrice || 0, maxPnlStopPrice || 0)
          : Math.min(atrStopPrice || 0, maxPnlStopPrice || 0);

        Logger.info(`✅ [STOP_DECISION] ${position.symbol}: Stop tático ATIVO definido para $${finalStopPrice.toFixed(4)} (o mais seguro dos dois).`);

        const partialTakeProfitPrice = TrailingStop.calculateAtrTakeProfitPrice(position, atrValue, takeProfitAtrMultiplier);

        // 🎯 MONITORAR ORDEM LIMIT DE TAKE PROFIT PARCIAL (não criar nova)
        const partialPercentage = Number(this.config?.partialTakeProfitPercentage || 50);
        Logger.info(`🎯 [TP_LIMIT_SETUP] ${position.symbol}: Monitorando ordem LIMIT de take profit parcial existente`);
        Logger.info(`📊 [TP_LIMIT_SETUP] ${position.symbol}: Preço esperado: $${partialTakeProfitPrice?.toFixed(4) || 'N/A'}, Quantidade: ${partialPercentage}%`);

        // NÃO cria nova ordem - apenas monitora a existente
        Logger.info(`ℹ️ [TP_LIMIT_SETUP] ${position.symbol}: Ordem de TP parcial já foi criada pelo sistema principal. Apenas monitorando.`);

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
          createdAt: new Date().toISOString()
        };

        // Salva o estado no bot atual
        const trailingStateMap = this.getTrailingState();
        trailingStateMap.set(position.symbol, newState);
        await TrailingStop.saveStateToDB(position.symbol, newState, this.config?.id, this.config);

        TrailingStop.colorLogger.trailingActivated(`${position.symbol}: 🎯 Stop Loss Inteligente ATIVADO! Fase: Proteção Inicial - PnL: ${pnlPct.toFixed(2)}%, Entrada: $${entryPrice.toFixed(4)}, Atual: $${currentPrice.toFixed(4)}, Volatilidade: ${atrValue?.toFixed(6) || 'N/A'}, Stop Loss Final: $${finalStopPrice?.toFixed(4) || 'N/A'}, Take Profit: $${partialTakeProfitPrice?.toFixed(4) || 'N/A'}`);

        return newState;
      }

      // === FASE 2: MONITORAMENTO DE ORDEM LIMIT ===
      // Verifica se a ordem LIMIT de take profit parcial existe
      Logger.debug(`🔍 [HYBRID_DEBUG] FASE 2: Verificando fase atual: ${trailingState.phase}`);
      if (trailingState.phase === 'INITIAL_RISK') {
        Logger.debug(`🔍 [HYBRID_DEBUG] FASE 2: Entrando em INITIAL_RISK`);
        const enableHybridStrategy = this.config?.enableHybridStopStrategy || false;

        Logger.debug(`🔍 [HYBRID_DEBUG] FASE 2: ${position.symbol} - enableHybridStrategy = ${enableHybridStrategy}`);
        if (enableHybridStrategy) {
          Logger.debug(`🔍 [HYBRID_DEBUG] FASE 2: ${position.symbol} - Verificando ordem de take profit parcial`);
          // Verifica se a ordem LIMIT de take profit parcial existe
          const hasPartialOrder = await OrderController.hasPartialTakeProfitOrder(position, this.config);
          Logger.debug(`🔍 [HYBRID_DEBUG] FASE 2: ${position.symbol} - hasPartialOrder = ${hasPartialOrder}`);

          if (!hasPartialOrder) {
            Logger.info(`⚠️ [TP_LIMIT_MONITOR] ${position.symbol}: Ordem de TP parcial não encontrada, criando automaticamente...`);

            try {
              // Calcula preço de TP parcial baseado em ATR
              const partialPercentage = Number(this.config?.partialTakeProfitPercentage || 50);
              const atrMultiplier = Number(this.config?.partialTakeProfitAtrMultiplier || 1.5);

              const atrValue = await TrailingStop.getAtrValue(position.symbol);

              // Calcula preço de TP usando ATR
              let takeProfitPrice;
              if (atrValue && atrValue > 0) {
                const atrDistance = atrValue * atrMultiplier;
                takeProfitPrice = trailingState.isLong
                  ? entryPrice + atrDistance
                  : entryPrice - atrDistance;

                Logger.info(`📊 [TP_LIMIT_MONITOR] ${position.symbol}: TP calculado via ATR - Preço: $${takeProfitPrice.toFixed(6)} (ATR: ${atrValue.toFixed(6)}, Multiplier: ${atrMultiplier})`);
              } else {
                // Fallback: usa porcentagem mínima de lucro ajustada por alavancagem
                const minProfitPercentage = Number(this.config?.minProfitPercentage || 10);
                const leverage = parseFloat(account?.leverage || 1);
                const actualProfitPct = minProfitPercentage / leverage;

                takeProfitPrice = trailingState.isLong
                  ? entryPrice * (1 + (actualProfitPct / 100))
                  : entryPrice * (1 - (actualProfitPct / 100));

                Logger.info(`📊 [TP_LIMIT_MONITOR] ${position.symbol}: TP calculado via % - Preço: $${takeProfitPrice.toFixed(6)} (${minProfitPercentage}% / ${leverage}x = ${actualProfitPct.toFixed(2)}%)`);
              }

              if (takeProfitPrice && takeProfitPrice > 0) {
                const result = await OrderController.createPartialTakeProfitOrder(
                  position,
                  takeProfitPrice,
                  partialPercentage,
                  account,
                  this.config
                );

                if (result) {
                  Logger.info(`✅ [TP_LIMIT_MONITOR] ${position.symbol}: Ordem de TP parcial criada automaticamente! Preço: $${takeProfitPrice.toFixed(6)} (${partialPercentage}%)`);
                } else {
                  Logger.info(`❌ [TP_LIMIT_MONITOR] ${position.symbol}: Falha ao criar ordem de TP parcial automaticamente`);
                }
              } else {
                Logger.info(`❌ [TP_LIMIT_MONITOR] ${position.symbol}: Preço de TP inválido calculado: ${takeProfitPrice}`);
              }
            } catch (error) {
              Logger.error(`❌ [TP_LIMIT_MONITOR] ${position.symbol}: Erro ao criar TP parcial:`, error.message);
            }
          } else {
            Logger.info(`✅ [TP_LIMIT_MONITOR] ${position.symbol}: Ordem de TP parcial encontrada e sendo monitorada`);
          }
        }
      }

      // === LÓGICA UNIFICADA DE TRAILING STOP ===
      // O trailing stop sempre se move baseado no melhor preço, independente da fase
      Logger.debug(`🔍 [HYBRID_DEBUG] TRAILING UNIFICADO: Aplicando lógica de trailing stop`);
      const trailingStopDistance = Number(this.config?.trailingStopDistance || 1.5);

      if (isLong) {
        Logger.debug(`🔍 [HYBRID_DEBUG] ${position.symbol}: LONG - CurrentPrice: ${currentPrice}, HighestPrice: ${trailingState.highestPrice}, TrailingStopPrice: ${trailingState.trailingStopPrice}`);

        if (currentPrice > trailingState.highestPrice || trailingState.highestPrice === null) {
          trailingState.highestPrice = currentPrice;
          Logger.debug(`✅ [HYBRID_DEBUG] ${position.symbol}: LONG - Novo preço máximo registrado: ${currentPrice}`);

          const newTrailingStopPrice = currentPrice * (1 - (trailingStopDistance / 100));
          const currentStopPrice = trailingState.trailingStopPrice;

          const finalStopPrice = Math.max(currentStopPrice, newTrailingStopPrice);

          if (finalStopPrice > currentStopPrice) {
            trailingState.trailingStopPrice = finalStopPrice;
            TrailingStop.colorLogger.trailingUpdate(`${position.symbol}: 📈 Trailing Stop ATUALIZADO! Novo Stop: $${finalStopPrice.toFixed(4)} | Preço Atual: $${currentPrice.toFixed(4)} | Máximo: $${trailingState.highestPrice.toFixed(4)}`);
            await TrailingStop.saveStateToDB(position.symbol, trailingState, this.config?.id, this.config);
          }
        }
      } else if (isShort) {
        Logger.debug(`🔍 [HYBRID_DEBUG] ${position.symbol}: SHORT - CurrentPrice: ${currentPrice}, LowestPrice: ${trailingState.lowestPrice}, TrailingStopPrice: ${trailingState.trailingStopPrice}`);

        if (currentPrice < trailingState.lowestPrice || trailingState.lowestPrice === null) {
          trailingState.lowestPrice = currentPrice;
          Logger.debug(`✅ [HYBRID_DEBUG] ${position.symbol}: SHORT - Novo preço mínimo registrado: ${currentPrice}`);

          const newTrailingStopPrice = currentPrice * (1 + (trailingStopDistance / 100));
          const currentStopPrice = trailingState.trailingStopPrice;

          const finalStopPrice = Math.min(currentStopPrice, newTrailingStopPrice);

          if (finalStopPrice < currentStopPrice) {
            trailingState.trailingStopPrice = finalStopPrice;
            TrailingStop.colorLogger.trailingUpdate(`${position.symbol}: 📉 Trailing Stop ATUALIZADO! Novo Stop: $${finalStopPrice.toFixed(4)} | Preço Atual: $${currentPrice.toFixed(4)} | Mínimo: $${trailingState.lowestPrice.toFixed(4)}`);
            await TrailingStop.saveStateToDB(position.symbol, trailingState, this.config?.id, this.config);
          }
        }
      }

      return trailingState;
    } catch (error) {
      Logger.debug(`🔍 [HYBRID_DEBUG] ERRO: Exception caught in updateTrailingStopHybrid for ${position.symbol}: ${error.message}`);
      Logger.error(`[HYBRID_TRAILING] Erro ao atualizar trailing stop híbrido para ${position.symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Atualiza trailing stop usando a estratégia tradicional
   */
  async updateTrailingStopTraditional(position, trailingState, account, pnl, pnlPct, currentPrice, entryPrice, isLong, isShort) {
    try {
      const trailingStopDistance = Number(this.config?.trailingStopDistance || 1.5);

      if (isNaN(trailingStopDistance) || trailingStopDistance <= 0) {
        Logger.error(`❌ [TRAILING_ERROR] TRAILING_STOP_DISTANCE inválido: ${this.config?.trailingStopDistance || 1.5}`);
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
          createdAt: new Date().toISOString()
        };

        const trailingStateMap = this.getTrailingState();
        trailingStateMap.set(position.symbol, newState);
        await TrailingStop.saveStateToDB(position.symbol, newState, this.config?.id, this.config);

        TrailingStop.colorLogger.trailingActivated(`${position.symbol}: Trailing Stop ATIVADO! Posição lucrativa detectada - PnL: ${pnlPct.toFixed(2)}%, Preço de Entrada: $${entryPrice.toFixed(4)}, Preço Atual: $${currentPrice.toFixed(4)}, Stop Inicial: $${initialStopLossPrice.toFixed(4)}`);

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

        await TrailingStop.saveStateToDB(position.symbol, trailingState, this.config?.id, this.config);

        TrailingStop.colorLogger.trailingActivated(`${position.symbol}: Trailing Stop REATIVADO! Estado existente ativado - PnL: ${pnlPct.toFixed(2)}%, Preço Atual: $${currentPrice.toFixed(4)}, Stop: $${trailingState.trailingStopPrice.toFixed(4)}`);

        return trailingState;
      }

      if (pnl <= 0) {
        if (trailingState && trailingState.activated) {
          TrailingStop.colorLogger.trailingHold(`${position.symbol}: Posição em prejuízo mas Trailing Stop mantido ativo para proteção - Trailing Stop: $${trailingState.trailingStopPrice?.toFixed(4) || 'N/A'}`);
          return trailingState;
        }

        TrailingStop.clearTrailingState(position.symbol);
        return null;
      }

      Logger.debug(`🔍 [TRAILING_DEBUG] ${position.symbol}: Verificando atualização - PnL: ${pnl}, PnL%: ${pnlPct.toFixed(2)}%, IsLong: ${isLong}, IsShort: ${isShort}, TrailingDistance: ${trailingStopDistance}%`);

      if (isLong) {
        Logger.debug(`🔍 [TRAILING_DEBUG] ${position.symbol}: LONG - CurrentPrice: ${currentPrice}, HighestPrice: ${trailingState.highestPrice}, TrailingStopPrice: ${trailingState.trailingStopPrice}`);

        if (currentPrice > trailingState.highestPrice || trailingState.highestPrice === null) {
          trailingState.highestPrice = currentPrice;
          Logger.debug(`✅ [TRAILING_DEBUG] ${position.symbol}: LONG - Novo preço máximo registrado: ${currentPrice}`);

          const newTrailingStopPrice = currentPrice * (1 - (trailingStopDistance / 100));
          const currentStopPrice = trailingState.trailingStopPrice;

          const finalStopPrice = Math.max(currentStopPrice, newTrailingStopPrice);

          Logger.debug(`🔍 [TRAILING_DEBUG] ${position.symbol}: LONG - NewTrailingStop: ${newTrailingStopPrice}, CurrentStop: ${currentStopPrice}, FinalStop: ${finalStopPrice}`);

          if (finalStopPrice > currentStopPrice) {
              // Se OrdersService estiver disponível, usa o sistema ativo
              if (this.ordersService) {
                const activeStopResult = await this.manageActiveStopOrder(position, finalStopPrice, this.config?.id);
                if (activeStopResult) {
                  trailingState.trailingStopPrice = finalStopPrice;
                  trailingState.activated = true;
                  TrailingStop.colorLogger.trailingUpdate(`${position.symbol}: LONG - Preço melhorou para $${currentPrice.toFixed(4)}, Stop ATIVO movido para: $${finalStopPrice.toFixed(4)}`);
                } else {
                  Logger.warn(`⚠️ [ACTIVE_STOP] ${position.symbol}: Falha ao mover stop ativo, mantendo modo passivo`);
                  trailingState.trailingStopPrice = finalStopPrice;
                  trailingState.activated = true;
                  TrailingStop.colorLogger.trailingUpdate(`${position.symbol}: LONG - Preço melhorou para $${currentPrice.toFixed(4)}, Novo Stop PASSIVO para: $${finalStopPrice.toFixed(4)}`);
                }
              } else {
                // Modo passivo tradicional
                trailingState.trailingStopPrice = finalStopPrice;
                trailingState.activated = true;
                TrailingStop.colorLogger.trailingUpdate(`${position.symbol}: LONG - Preço melhorou para $${currentPrice.toFixed(4)}, Novo Stop PASSIVO para: $${finalStopPrice.toFixed(4)}`);
              }

              // Salva o estado atualizado no banco
              await TrailingStop.saveStateToDB(position.symbol, trailingState, this.config?.id, this.config);
          }
        }
      } else if (isShort) {
        Logger.debug(`🔍 [TRAILING_DEBUG] ${position.symbol}: SHORT - CurrentPrice: ${currentPrice}, LowestPrice: ${trailingState.lowestPrice}, TrailingStopPrice: ${trailingState.trailingStopPrice}`);

        if (currentPrice < trailingState.lowestPrice || trailingState.lowestPrice === null) {
          trailingState.lowestPrice = currentPrice;
          Logger.debug(`✅ [TRAILING_DEBUG] ${position.symbol}: SHORT - Novo preço mínimo registrado: ${currentPrice}`);

          const newTrailingStopPrice = trailingState.lowestPrice * (1 + (trailingStopDistance / 100));

          const currentStopPrice = trailingState.trailingStopPrice;
          const finalStopPrice = Math.min(currentStopPrice, newTrailingStopPrice);

          Logger.debug(`🔍 [TRAILING_DEBUG] ${position.symbol}: SHORT - NewTrailingStop: ${newTrailingStopPrice}, CurrentStop: ${currentStopPrice}, FinalStop: ${finalStopPrice}`);

          if (finalStopPrice < currentStopPrice) {
            // Se OrdersService estiver disponível, usa o sistema ativo
            if (this.ordersService) {
              const activeStopResult = await this.manageActiveStopOrder(position, finalStopPrice, this.config?.id);
              if (activeStopResult) {
                trailingState.trailingStopPrice = finalStopPrice;
                trailingState.activated = true;
                TrailingStop.colorLogger.trailingUpdate(`${position.symbol}: SHORT - Preço melhorou para $${currentPrice.toFixed(4)}, Stop ATIVO movido para $${finalStopPrice.toFixed(4)}`);
              } else {
                Logger.warn(`⚠️ [ACTIVE_STOP] ${position.symbol}: Falha ao mover stop ativo, mantendo modo passivo`);
                trailingState.trailingStopPrice = finalStopPrice;
                trailingState.activated = true;
                TrailingStop.colorLogger.trailingUpdate(`${position.symbol}: SHORT - Preço melhorou para $${currentPrice.toFixed(4)}, Stop PASSIVO para $${finalStopPrice.toFixed(4)}`);
              }
            } else {
              // Modo passivo tradicional
              trailingState.trailingStopPrice = finalStopPrice;
              trailingState.activated = true;
              TrailingStop.colorLogger.trailingUpdate(`${position.symbol}: SHORT - Preço melhorou para $${currentPrice.toFixed(4)}, Stop PASSIVO para $${finalStopPrice.toFixed(4)}`);
            }

            // Salva o estado atualizado no banco
            await TrailingStop.saveStateToDB(position.symbol, trailingState, this.config?.id, this.config);
          }
        }

        if (pnl > 0 && !trailingState.activated) {
          const newTrailingStopPrice = currentPrice * (1 + (trailingStopDistance / 100));
          const finalStopPrice = Math.min(trailingState.initialStopLossPrice, newTrailingStopPrice);
          trailingState.trailingStopPrice = finalStopPrice;
          trailingState.activated = true;
          TrailingStop.colorLogger.trailingActivate(`${position.symbol}: SHORT - Ativando Trailing Stop com lucro existente! Preço: $${currentPrice.toFixed(4)}, Stop inicial: $${finalStopPrice.toFixed(4)}`);

          // Salva o estado atualizado no banco
          await TrailingStop.saveStateToDB(position.symbol, trailingState, this.config?.id, this.config);
        }
      }

      return trailingState;

    } catch (error) {
      Logger.error(`[TRADITIONAL_TRAILING] Erro ao atualizar trailing stop tradicional para ${position.symbol}:`, error.message);
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
        if ((trailingState.phase === 'TRAILING' || trailingState.phase === 'PARTIAL_PROFIT_TAKEN') && trailingState.trailingStopPrice) {
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
        TrailingStop.colorLogger.trailingTrigger(`${position.symbol}: 🚨 POSIÇÃO FECHADA!${phaseInfo} Preço atual $${currentPrice.toFixed(4)} cruzou o stop loss em $${trailingState.trailingStopPrice?.toFixed(4) || 'N/A'}.`);
        return {
          shouldClose: true,
          reason: reason,
          type: type,
          trailingStopPrice: trailingState.trailingStopPrice,
          currentPrice: currentPrice,
          phase: trailingState.phase
        };
      }

      return null;

    } catch (error) {
      Logger.error(`[TRAILING_CHECK] Erro ao verificar trailing stop para ${position.symbol}:`, error.message);
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
      entryPrice: trailingState.entryPrice
    };
  }

  /**
   * Obtém o tier de taxas baseado no volume de 30 dias
   * @returns {Promise<object>} Objeto com maker, taker e tier
   */
  async getFeeTier() {
    try {
      const now = Date.now();

      if (!this.cachedVolume || (now - this.lastVolumeCheck) > this.volumeCacheTimeout) {
        this.cachedVolume = await PnlController.get30DayVolume();
        this.lastVolumeCheck = now;
      }

      const volume30Days = this.cachedVolume || 0;

      let tier;

      if (volume30Days >= 10000000) {
        tier = { maker: 0.0001, taker: 0.0002, name: 'DIAMOND' };
      } else if (volume30Days >= 5000000) { // $5M+
        tier = { maker: 0.0002, taker: 0.0003, name: 'PLATINUM' };
      } else if (volume30Days >= 1000000) { // $1M+
        tier = { maker: 0.0003, taker: 0.0004, name: 'GOLD' };
      } else if (volume30Days >= 500000) { // $500K+
        tier = { maker: 0.0004, taker: 0.0005, name: 'SILVER' };
      } else if (volume30Days >= 100000) { // $100K+
        tier = { maker: 0.0005, taker: 0.0006, name: 'BRONZE' };
      } else { // < $100K
        tier = { maker: 0.0006, taker: 0.0007, name: 'STANDARD' };
      }

      return {
        makerFee: tier.maker,
        takerFee: tier.taker,
        totalFee: tier.maker + tier.taker,
        tier: tier
      };
    } catch (error) {
      return {
        makerFee: 0.0006,
        takerFee: 0.0007,
        totalFee: 0.0013,
        tier: { name: 'STANDARD_FALLBACK' }
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
        totalFees: totalFees
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
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = this.config.apiKey;
      const apiSecret = this.config.apiSecret;

      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: this.strategyType
      });

      if (!Account.leverage) {
        Logger.error(`❌ [STOP_LOSS_CHECK] ${position.symbol}: Alavancagem não encontrada na Account`);
        return false;
      }

      const { pnl, pnlPct } = TrailingStop.calculatePnL(position, Account);

      const MAX_NEGATIVE_PNL_STOP_PCT = this.config?.maxNegativePnlStopPct || -10;

      if (MAX_NEGATIVE_PNL_STOP_PCT !== undefined && MAX_NEGATIVE_PNL_STOP_PCT !== null && MAX_NEGATIVE_PNL_STOP_PCT !== '') {
        const maxNegativePnlStopPct = parseFloat(MAX_NEGATIVE_PNL_STOP_PCT);

        if (isNaN(maxNegativePnlStopPct) || !isFinite(maxNegativePnlStopPct)) {
          Logger.error(`❌ [STOP_LOSS_CHECK] Valor inválido para MAX_NEGATIVE_PNL_STOP_PCT: ${MAX_NEGATIVE_PNL_STOP_PCT}`);
          return false;
        }

        if (isNaN(pnlPct) || !isFinite(pnlPct)) {
          Logger.error(`❌ [STOP_LOSS_CHECK] PnL inválido para ${position.symbol}: ${pnlPct}`);
          return false;
        }

        if (pnlPct <= maxNegativePnlStopPct) {
          Logger.info(`🚨 [STOP_LOSS_CHECK] ${position.symbol}: Fechando por stop loss emergencial - PnL ${pnlPct.toFixed(3)}% <= limite ${maxNegativePnlStopPct.toFixed(3)}%`);
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
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!this.config?.apiKey || !this.config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = this.config.apiKey;
      const apiSecret = this.config.apiSecret;

      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: this.strategyType
      });

      if (!Account.leverage) {
        Logger.error(`❌ [CONFIG_PROFIT] ${position.symbol}: Alavancagem não encontrada na Account`);
        return false;
      }

      const { pnl, pnlPct } = TrailingStop.calculatePnL(position, Account);

      const MAX_NEGATIVE_PNL_STOP_PCT = this.config?.maxNegativePnlStopPct || -10;

      if (MAX_NEGATIVE_PNL_STOP_PCT !== undefined && MAX_NEGATIVE_PNL_STOP_PCT !== null && MAX_NEGATIVE_PNL_STOP_PCT !== '') {
        const maxNegativePnlStopPct = parseFloat(MAX_NEGATIVE_PNL_STOP_PCT);

        if (isNaN(maxNegativePnlStopPct) || !isFinite(maxNegativePnlStopPct)) {
          Logger.error(`❌ [CONFIG_PROFIT] Valor inválido para MAX_NEGATIVE_PNL_STOP_PCT: ${MAX_NEGATIVE_PNL_STOP_PCT}`);
          return false;
        }

        if (isNaN(pnlPct) || !isFinite(pnlPct)) {
          Logger.error(`❌ [CONFIG_PROFIT] PnL inválido para ${position.symbol}: ${pnlPct}`);
          return false;
        }

        if (pnlPct <= maxNegativePnlStopPct) {
          Logger.info(`🚨 [CONFIG_PROFIT] ${position.symbol}: Fechando por stop loss - PnL ${pnlPct.toFixed(3)}% <= limite ${maxNegativePnlStopPct.toFixed(3)}%`);
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
      Logger.debug(`📊 [CONFIG_PROFIT] ${position.symbol}: Detalhes do cálculo:`);
      Logger.debug(`   • PnL bruto: $${pnl.toFixed(4)} (${pnlPct.toFixed(3)}%)`);
      Logger.debug(`   • Taxas estimadas: $${totalFees.toFixed(4)} (${((totalFees/notional)*100).toFixed(3)}%)`);
      Logger.debug(`   • PnL líquido: $${netProfit.toFixed(4)} (${netProfitPct.toFixed(3)}%)`);
      Logger.debug(`   • Min profit configurado: ${minProfitPct.toFixed(3)}%`);
      Logger.debug(`   • Notional: $${notional.toFixed(2)}`);

      if (netProfit > 0 && netProfitPct >= minProfitPct) {
        Logger.info(`\n✅ [CONFIG_PROFIT] ${position.symbol}: Fechando por lucro ${netProfitPct.toFixed(3)}% >= mínimo ${minProfitPct.toFixed(3)}%`);
        Logger.debug(`   💰 Lucro líquido após taxas: $${netProfit.toFixed(4)}`);
        return true;
      }

      if (netProfit > 0.01) {
        if (netProfitPct < minProfitPct) {
          Logger.debug(`\n⚠️ [CONFIG_PROFIT] ${position.symbol}: Aguardando lucro mínimo - Atual: ${netProfitPct.toFixed(3)}% < Mínimo: ${minProfitPct.toFixed(3)}%`);
          Logger.debug(`   📈 Precisa de mais ${(minProfitPct - netProfitPct).toFixed(3)}% para atingir o lucro mínimo`);
        }
      } else if (netProfit <= 0) {
        Logger.debug(`\n🔴 [CONFIG_PROFIT] ${position.symbol}: Posição em prejuízo líquido: $${netProfit.toFixed(4)}`);
      }

      return false;
    } catch (error) {
      Logger.error('[CONFIG_PROFIT] Erro ao verificar profit configurado:', error.message);
      return false;
    }
  }

  async stopLoss() {
    try {
      // Verifica se a configuração está presente
      if (!this.config) {
        throw new Error('Configuração do bot é obrigatória - deve ser passada no construtor');
      }

      const enableTrailingStop = this.config.enableTrailingStop || false;

      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!this.config.apiKey || !this.config.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      const apiKey = this.config.apiKey;
      const apiSecret = this.config.apiSecret;

      const positions = await Futures.getOpenPositions(apiKey, apiSecret);

      if (!positions || positions.length === 0) {
        return;
      }

      // 🔧 CORREÇÃO: Filtra apenas posições realmente abertas (netQuantity > 0)
      const activePositions = positions.filter(position => {
        const netQuantity = parseFloat(position.netQuantity || 0);
        return Math.abs(netQuantity) > 0;
      });

      if (activePositions.length === 0) {
        TrailingStop.debug(`🔍 [TRAILING_MONITOR] Todas as ${positions.length} posições estão fechadas (netQuantity = 0) - nada para monitorar`);
        return;
      }

      TrailingStop.debug(`🔍 [TRAILING_MONITOR] Verificando ${activePositions.length} posições ativas abertas (${positions.length - activePositions.length} posições fechadas filtradas)...`);

      const Account = await AccountController.get({
        apiKey,
        apiSecret,
        strategy: this.strategyType
      });

      for (const position of activePositions) {
        const stopLossStrategy = await this.initializeStopLoss();
        const stopLossDecision = stopLossStrategy.shouldClosePosition(position, Account, null, this.config);

        if (stopLossDecision && stopLossDecision.shouldClose) {
          TrailingStop.colorLogger.positionClosed(`🛑 [STOP_LOSS] ${position.symbol}: Fechando por stop loss principal - ${stopLossDecision.reason}`);
          await OrderController.forceClose(position, Account, this.config);
          await TrailingStop.onPositionClosed(position, 'stop_loss');
          continue;
        }

        if (!enableTrailingStop && stopLossDecision && stopLossDecision.shouldTakePartialProfit) {
          TrailingStop.colorLogger.positionClosed(`💰 [PARTIAL_PROFIT] ${position.symbol}: Tomando profit parcial`);
          await OrderController.closePartialPosition(position, stopLossDecision.partialPercentage, Account, this.config);
          continue;
        }

        // --- CORREÇÃO CRÍTICA: LÓGICA DE TAKE PROFIT CONDICIONAL ---
        const trailingStateMap = this.getTrailingState();
        const positionState = trailingStateMap.get(position.symbol);
        const currentPrice = parseFloat(position.markPrice || position.lastPrice || 0);

        if (positionState && positionState.strategyName === 'AlphaFlowStrategy') {
          // Modo ALPHA FLOW: Verifica apenas o alvo de TP fixo calculado pela estratégia
          Logger.debug(`📋 [PROFIT_MODE] ${position.symbol}: Modo Alpha Flow ativo. Verificando alvo de TP fixo...`);

          // Obtenha o 'targetPrice' que foi salvo quando a ordem foi criada
          const targetPrice = positionState.takeProfitPrice; // Assumindo que salvamos o alvo no estado

          if (targetPrice) {
            const isLong = parseFloat(position.netQuantity) > 0;
            const isShort = parseFloat(position.netQuantity) < 0;

            if ((isLong && currentPrice >= targetPrice) || (isShort && currentPrice <= targetPrice)) {
              Logger.info(`🎯 [PROFIT_TARGET] ${position.symbol}: Alvo de preço da Alpha Flow atingido! Fechando posição.`);
              await OrderController.forceClose(position, Account, this.config);
              await TrailingStop.onPositionClosed(position, 'alpha_flow_target');
              continue;
            }
          } else {
            Logger.debug(`⚠️ [PROFIT_MODE] ${position.symbol}: Alvo de TP não encontrado no estado da posição`);
          }

          // Para Alpha Flow, pula as verificações de profit mínimo e configurado
          Logger.debug(`📋 [PROFIT_MODE] ${position.symbol}: Alpha Flow - aguardando alvo específico...`);

        } else {
          // Modo DEFAULT ou outros: Usa a lógica antiga de PROFIT_CHECK e Trailing Stop
          Logger.debug(`📋 [PROFIT_MODE] ${position.symbol}: Modo ${positionState?.strategyName || 'DEFAULT'} ativo.`);

          if (enableTrailingStop) {
            const trailingModeLogged = this.getTrailingModeLogged();
            if (!trailingModeLogged.has(position.symbol)) {
              Logger.info(`🎯 [TRAILING_MODE] ${position.symbol}: Modo Trailing Stop ativo`);
              trailingModeLogged.add(position.symbol);
            }

            await this.updateTrailingStopForPosition(position);

            const trailingState = trailingStateMap.get(position.symbol);

            if (trailingState && trailingState.activated) {
              // TrailingStop.colorLogger.trailingActiveCheck(`${position.symbol}: Trailing Stop ativo - verificando gatilho`);

              // const trailingDecision = this.checkTrailingStopTrigger(position, trailingState);
              //
              // if (trailingDecision && trailingDecision.shouldClose) {
              //   TrailingStop.colorLogger.positionClosed(`🚨 [TRAILING_EXECUTION] ${position.symbol}: Executando fechamento por Trailing Stop. Motivo: ${trailingDecision.reason}`);
              //   await OrderController.forceClose(position, Account, this.config);
              //   await TrailingStop.onPositionClosed(position, 'trailing_stop');
              //   continue;
              // }

              const priceType = position.markPrice ? 'Current Price' : 'Last Price';
              const distance = trailingState.isLong
                ? ((currentPrice - (trailingState.trailingStopPrice || 0)) / currentPrice * 100).toFixed(2)
                : (((trailingState.trailingStopPrice || 0) - currentPrice) / currentPrice * 100).toFixed(2);

              const direction = trailingState.isLong ? 'LONG' : 'SHORT';
              const priceRecordLabel = trailingState.isLong ? 'Preço Máximo' : 'Preço Mínimo';
              const priceRecordValue = trailingState.isLong ? trailingState.highestPrice : trailingState.lowestPrice;

              TrailingStop.colorLogger.trailingActive(
                  `${position.symbol} (${direction}): Trailing ativo - ` +
                  `${priceType}: $${currentPrice.toFixed(4)}, ` +
                  `TrailingStop: $${trailingState.trailingStopPrice?.toFixed(4) || 'N/A'}, ` +
                  `${priceRecordLabel}: $${priceRecordValue?.toFixed(4) || 'N/A'}, ` +
                  `Distância até Stop: ${distance}%\n`
              );
            } else {
              const priceType = position.markPrice ? 'Current Price' : 'Last Price';
              const pnl = TrailingStop.calculatePnL(position, Account);
              const entryPrice = parseFloat(position.entryPrice || 0);

              if (pnl.pnlPct < 0) {
                TrailingStop.colorLogger.trailingWaitingProfitable(`${position.symbol}: Trailing Stop aguardando posição ficar lucrativa - ${priceType}: $${currentPrice.toFixed(4)}, Preço de Entrada: $${entryPrice.toFixed(4)}, PnL: ${pnl.pnlPct.toFixed(2)}% (prejuízo)\n`);
              } else {
                TrailingStop.colorLogger.trailingWaitingActivation(`${position.symbol}: Trailing Stop aguardando ativação - ${priceType}: $${currentPrice.toFixed(4)}, Preço de Entrada: $${entryPrice.toFixed(4)}, PnL: ${pnl.pnlPct.toFixed(2)}%\n`);
              }
            }
          } else {
            TrailingStop.colorLogger.profitFixed(`${position.symbol}: Modo Take Profit fixo ativo`);

            if (await this.shouldCloseForConfiguredProfit(position)) {
              TrailingStop.colorLogger.positionClosed(`💰 [PROFIT_CONFIGURED] ${position.symbol}: Fechando por profit mínimo configurado`);
              await OrderController.forceClose(position, Account, this.config);
              await TrailingStop.onPositionClosed(position, 'profit_configured');
              continue;
            }

            if (await this.shouldCloseForMinimumProfit(position)) {
              TrailingStop.colorLogger.positionClosed(`🚨 [STOP_LOSS_EMERGENCY] ${position.symbol}: Fechando por stop loss emergencial`);
              await OrderController.forceClose(position, Account, this.config);
              await TrailingStop.onPositionClosed(position, 'stop_loss_emergency');
              continue;
            }

            const adxCrossoverDecision = await this.checkADXCrossover(position);
            if (adxCrossoverDecision && adxCrossoverDecision.shouldClose) {
              TrailingStop.colorLogger.positionClosed(`📈 [ADX_CROSSOVER] ${position.symbol}: ${adxCrossoverDecision.reason}`);
              await OrderController.forceClose(position, Account, this.config);
              await TrailingStop.onPositionClosed(position, 'adx_crossover');
              continue;
            }

            const priceType = position.markPrice ? 'Current Price' : 'Last Price';
            const pnl = TrailingStop.calculatePnL(position, Account);
            const entryPrice = parseFloat(position.entryPrice || 0);
            TrailingStop.colorLogger.profitMonitor(`${position.symbol}: Take Profit fixo - ${priceType}: $${currentPrice.toFixed(4)}, Preço de Entrada: $${entryPrice.toFixed(4)}, PnL: ${pnl.pnlPct.toFixed(2)}%\n`);
          }
        }

        try {
          const marketInfo = Account.markets.find(m => m.symbol === position.symbol);

          if (!marketInfo) {
            TrailingStop.debug(`ℹ️ [MANUAL_POSITION] ${position.symbol}: Par não autorizado - pulando criação de stop loss`);
          } else {
            // ✅ CORREÇÃO: Só executa failsafe se trailing stop NÃO estiver ativo
            const enableTrailingStop = this.config?.enableTrailingStop || false;
            const trailingStateMap = this.getTrailingState();
            const trailingState = trailingStateMap.get(position.symbol);
            const isTrailingActive = enableTrailingStop && trailingState && trailingState.activated;

            if (isTrailingActive) {
              TrailingStop.debug(`🎯 [FAILSAFE_SKIP] ${position.symbol}: Trailing stop ativo - pulando verificação failsafe para evitar conflito`);
            } else {
              TrailingStop.debug(`🛡️ [FAILSAFE_CHECK] ${position.symbol}: Verificando stop loss de proteção...`);
              await OrderController.validateAndCreateStopLoss(position, this.config.botName, this.config);
            }
          }
        } catch (error) {
          Logger.error(`❌ [FAILSAFE_ERROR] Erro ao validar/criar stop loss para ${position.symbol}:`, error.message);
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
      Logger.error(`[ADX_CROSSOVER] Erro ao verificar crossover para ${position.symbol}:`, error.message);
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
        TRAILING_STOP_DISTANCE: config?.trailingStopDistance || 2.0
      }
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
        Logger.warn(`⚠️ [ACTIVE_STOP] ${position.symbol}: OrdersService não disponível - usando modo passivo`);
        return null;
      }

      const symbol = position.symbol;
      const botKey = TrailingStop.getBotKey(botId);

      // Busca o estado atual do trailing stop
      const currentState = await TrailingStop.loadStateFromDB(botId, symbol);

      if (!currentState) {
        Logger.debug(`🔍 [ACTIVE_STOP] ${symbol}: Nenhum estado encontrado - criando primeira ordem stop`);
        return await this.createInitialStopOrder(position, newStopPrice, botId);
      }

      const currentStopPrice = parseFloat(currentState.stop_loss_price || 0);
      const activeOrderId = currentState.active_stop_order_id;

      // Determina se é posição LONG ou SHORT
      const netQuantity = parseFloat(position.netQuantity || 0);
      const isLong = netQuantity > 0;
      const isShort = netQuantity < 0;

      // Verifica se o novo preço é mais vantajoso
      const isNewPriceBetter = isLong ?
        (newStopPrice > currentStopPrice) : // Para LONG, stop mais alto é melhor
        (newStopPrice < currentStopPrice);  // Para SHORT, stop mais baixo é melhor

      if (!isNewPriceBetter || Math.abs(newStopPrice - currentStopPrice) < 0.0001) {
        Logger.debug(`📊 [ACTIVE_STOP] ${symbol}: Preço atual (${currentStopPrice}) já é ótimo, não atualizando`);
        return currentState;
      }

      Logger.info(`🔄 [ACTIVE_STOP] ${symbol}: Atualizando stop de ${currentStopPrice} para ${newStopPrice}`);

      // Etapa 1: Cancelar ordem antiga se existir
      if (activeOrderId) {
        try {
          await this.ordersService.cancelOrder(activeOrderId);
          Logger.debug(`✅ [ACTIVE_STOP] ${symbol}: Ordem antiga ${activeOrderId} cancelada`);
        } catch (cancelError) {
          Logger.warn(`⚠️ [ACTIVE_STOP] ${symbol}: Erro ao cancelar ordem ${activeOrderId}: ${cancelError.message}`);
          // Continua mesmo se o cancelamento falhar (ordem pode já ter sido executada)
        }
      }

      // Etapa 2: Criar nova ordem STOP_MARKET
      const newOrderResult = await this.createStopMarketOrder(position, newStopPrice);

      if (!newOrderResult || newOrderResult.error) {
        Logger.error(`❌ [ACTIVE_STOP] ${symbol}: Falha ao criar nova ordem stop: ${newOrderResult?.error || 'erro desconhecido'}`);
        return null;
      }

      // Etapa 3: Salvar novo estado no banco
      const updatedState = {
        ...currentState,
        stop_loss_price: newStopPrice,
        updatedAt: new Date().toISOString()
      };

      await TrailingStop.saveStateToDB(symbol, updatedState, botId, this.config);

      return updatedState;

    } catch (error) {
      Logger.error(`❌ [ACTIVE_STOP] Erro ao gerenciar stop ativo para ${position.symbol}: ${error.message}`);
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
        Logger.error(`❌ [ACTIVE_STOP] ${symbol}: Falha ao criar ordem stop inicial: ${orderResult?.error || 'erro desconhecido'}`);
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
        updatedAt: new Date().toISOString()
      };

      await TrailingStop.saveStateToDB(symbol, initialState, botId, this.config);

      return initialState;

    } catch (error) {
      Logger.error(`❌ [ACTIVE_STOP] Erro ao criar ordem stop inicial para ${position.symbol}: ${error.message}`);
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
        timeInForce: 'GTC'
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

trailingStopInstance.saveStateToDB = TrailingStop.saveStateToDB;
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