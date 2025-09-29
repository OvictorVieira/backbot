import Logger from '../Utils/Logger.js';
import ConfigManagerSQLite from '../Config/ConfigManagerSQLite.js';
import HFTStrategy from '../Decision/Strategies/HFTStrategy.js';
import QuantityCalculator from '../Utils/QuantityCalculator.js';
import { ExchangeFactory } from '../Exchange/ExchangeFactory.js';
import MarketFormatter from '../Utils/MarketFormatter.js';
import OrdersService from '../Services/OrdersService.js';
import FeatureToggleService from '../Services/FeatureToggleService.js';

/**
 * HFTController - Controlador específico para bots HFT
 *
 * Gerencia o ciclo de vida dos bots HFT de forma isolada dos bots tradicionais.
 * Carrega apenas bots com bot_type = 'HFT' e executa usando a HFTStrategy.
 */
class HFTController {
  constructor() {
    this.activeHFTBots = new Map(); // botId -> HFTStrategy instance
    this.isRunning = false;
    this.monitorInterval = null;
  }

  /**
   * Inicia o controlador HFT
   */
  async start() {
    try {
      Logger.info('🚀 [HFT_CONTROLLER] Iniciando controlador HFT...');

      this.isRunning = true;
      await this.loadAndStartHFTBots();

      // Inicia monitoramento periódico
      this.startMonitoring();

      Logger.info('✅ [HFT_CONTROLLER] Controlador HFT iniciado com sucesso');
    } catch (error) {
      Logger.error('❌ [HFT_CONTROLLER] Erro ao iniciar controlador HFT:', error.message);
      throw error;
    }
  }

  /**
   * Para o controlador HFT
   */
  async stop() {
    try {
      Logger.info('🛑 [HFT_CONTROLLER] Parando controlador HFT...');

      this.isRunning = false;

      if (this.monitorInterval) {
        clearInterval(this.monitorInterval);
        this.monitorInterval = null;
      }

      // 🚨 VALIDAÇÃO CRÍTICA: Verifica se activeHFTBots é iterável
      if (
        !this.activeHFTBots ||
        !this.activeHFTBots[Symbol.iterator] ||
        typeof this.activeHFTBots[Symbol.iterator] !== 'function'
      ) {
        Logger.error(
          `❌ [HFT_CONTROLLER] activeHFTBots não é iterável em pauseAllHFTBots - type: ${typeof this.activeHFTBots}`
        );
        return;
      }

      // Para todos os bots HFT ativos
      for (const [botId, hftStrategy] of this.activeHFTBots.entries()) {
        await this.stopHFTBot(botId);
      }

      this.activeHFTBots.clear();

      // Limpa todos os trading locks ativos como medida de segurança
      try {
        const dbService = ConfigManagerSQLite.dbService;
        if (dbService) {
          const result = await dbService.run(
            'UPDATE trading_locks SET status = ?, unlockAt = datetime(?) WHERE status = ?',
            ['RELEASED', 'now', 'ACTIVE']
          );
          if (result.changes > 0) {
            Logger.info(
              `🔓 [HFT_CONTROLLER] ${result.changes} trading locks ativos foram liberados no shutdown`
            );
          }
        }
      } catch (error) {
        Logger.error(
          `❌ [HFT_CONTROLLER] Erro ao liberar trading locks no shutdown:`,
          error.message
        );
      }

      Logger.info('✅ [HFT_CONTROLLER] Controlador HFT parado com sucesso');
    } catch (error) {
      Logger.error('❌ [HFT_CONTROLLER] Erro ao parar controlador HFT:', error.message);
    }
  }

  /**
   * Carrega e inicia todos os bots HFT habilitados
   */
  async loadAndStartHFTBots() {
    try {
      // Check if HFT mode is enabled via feature toggle
      const isHFTEnabled = await FeatureToggleService.isEnabled('HFT_MODE');
      if (!isHFTEnabled) {
        Logger.warn(
          '🚫 [HFT_CONTROLLER] HFT mode is disabled via feature toggle. Skipping HFT bot initialization.'
        );
        return;
      }

      Logger.info('🎛️ [HFT_CONTROLLER] HFT mode is enabled via feature toggle');

      // Carrega apenas bots HFT
      const hftBots = await ConfigManagerSQLite.loadHFTBots();
      // 🚨 FILTRO INTELIGENTE: Só inicia bots que estão habilitados E não estão pausados
      const enabledHFTBots = hftBots.filter(bot => {
        const isEnabled = bot.enabled;
        const canRun = !bot.status || bot.status === 'idle' || bot.status === 'running';

        if (isEnabled && !canRun) {
          Logger.debug(
            `⏸️ [HFT_FILTER] Bot HFT ${bot.botName || bot.id} está pausado - mantendo pausado`
          );
        }

        return isEnabled && canRun;
      });

      Logger.debug(`📋 [HFT_CONTROLLER] Encontrados ${enabledHFTBots.length} bots HFT habilitados`);

      if (enabledHFTBots.length === 0) {
        Logger.debug('ℹ️ [HFT_CONTROLLER] Nenhum bot HFT habilitado encontrado');
        return;
      }

      // 🚨 VALIDAÇÃO CRÍTICA: Verifica se enabledHFTBots é iterável
      if (
        !Array.isArray(enabledHFTBots) ||
        !enabledHFTBots[Symbol.iterator] ||
        typeof enabledHFTBots[Symbol.iterator] !== 'function'
      ) {
        Logger.error(
          `❌ [HFT_CONTROLLER] enabledHFTBots não é iterável em loadAllHFTBots - type: ${typeof enabledHFTBots}, isArray: ${Array.isArray(enabledHFTBots)}`
        );
        return;
      }

      // Inicia cada bot HFT
      for (const botConfig of enabledHFTBots) {
        await this.startHFTBot(botConfig);
      }
    } catch (error) {
      Logger.error('❌ [HFT_CONTROLLER] Erro ao carregar bots HFT:', error.message);
    }
  }

  /**
   * Inicia um bot HFT específico
   */
  async startHFTBot(botConfig) {
    try {
      // Check if HFT mode is enabled via feature toggle
      const isHFTEnabled = await FeatureToggleService.isEnabled('HFT_MODE');
      if (!isHFTEnabled) {
        Logger.warn(
          `🚫 [HFT_CONTROLLER] HFT mode is disabled. Cannot start bot ${botConfig.botName}`
        );
        return;
      }

      Logger.info(
        `🔌 [HFT_CONTROLLER] Iniciando bot HFT: ${botConfig.botName} (ID: ${botConfig.id})`
      );

      // Verifica se já está rodando
      if (this.activeHFTBots.has(botConfig.id)) {
        Logger.warn(`⚠️ [HFT_CONTROLLER] Bot HFT ${botConfig.id} já está ativo`);
        return;
      }

      // Valida configuração HFT obrigatória
      this.validateHFTConfig(botConfig);

      // Cria instância da HFTStrategy
      const hftStrategy = new HFTStrategy();

      // Processa todos os tokens autorizados
      const authorizedTokens = botConfig.authorizedTokens || [];
      if (authorizedTokens.length === 0) {
        throw new Error('Nenhum token autorizado encontrado na configuração do bot HFT');
      }

      // 🚨 VALIDAÇÃO: Limite máximo de tokens por bot
      const maxTokensPerBot = parseInt(process.env.MAX_TOKENS_PER_BOT) || 12; // Default: 12 tokens
      if (authorizedTokens.length > maxTokensPerBot) {
        Logger.warn(
          `⚠️ [HFT_CONTROLLER] Bot ${botConfig.botName} tem ${authorizedTokens.length} tokens configurados, mas o limite é ${maxTokensPerBot}`
        );
        Logger.warn(
          `🔧 [HFT_CONTROLLER] Processando apenas os primeiros ${maxTokensPerBot} tokens para evitar timing conflicts`
        );
        authorizedTokens.splice(maxTokensPerBot); // Remove tokens excedentes
      }

      Logger.info(
        `📋 [HFT_CONTROLLER] Bot ${botConfig.botName} processará ${authorizedTokens.length} tokens: ${authorizedTokens.join(', ')}`
      );

      // Cria uma estratégia para cada token
      const strategies = new Map();

      // 🚨 VALIDAÇÃO CRÍTICA: Verifica se authorizedTokens é iterável
      if (
        !Array.isArray(authorizedTokens) ||
        !authorizedTokens[Symbol.iterator] ||
        typeof authorizedTokens[Symbol.iterator] !== 'function'
      ) {
        Logger.error(
          `❌ [HFT_CONTROLLER] authorizedTokens não é iterável em startHFTBot - type: ${typeof authorizedTokens}, isArray: ${Array.isArray(authorizedTokens)}`
        );
        return;
      }

      for (const symbol of authorizedTokens) {
        try {
          Logger.debug(`🧮 [HFT_CONTROLLER] Calculando amount para ${symbol}...`);
          const amount = await this.calculateOptimalAmountFromConfig(botConfig, symbol);
          Logger.debug(`💰 [HFT_CONTROLLER] Amount calculado para ${symbol}: ${amount}`);

          // Cria instância separada da HFTStrategy para este token
          const tokenStrategy = new HFTStrategy();

          // Executa estratégia HFT para este token
          await tokenStrategy.executeHFTStrategy(symbol, amount, botConfig);

          // Armazena estratégia para este token
          strategies.set(symbol, tokenStrategy);

          Logger.info(`✅ [HFT_CONTROLLER] Estratégia iniciada para ${symbol}`);
        } catch (error) {
          Logger.error(`❌ [HFT_CONTROLLER] Erro ao iniciar ${symbol}:`, error.message);
          // Continue com outros tokens mesmo se um falhar
        }
      }

      // Armazena todas as estratégias ativas para este bot
      this.activeHFTBots.set(botConfig.id, strategies);

      // Atualiza status no banco
      await ConfigManagerSQLite.updateBotStatusById(botConfig.id, 'running');

      Logger.info(`✅ [HFT_CONTROLLER] Bot HFT ${botConfig.botName} iniciado com sucesso`);
    } catch (error) {
      Logger.error(
        `❌ [HFT_CONTROLLER] Erro ao iniciar bot HFT ${botConfig.botName}:`,
        error.message
      );

      // Atualiza status de erro
      await ConfigManagerSQLite.updateBotStatusById(botConfig.id, 'error');
      throw error;
    }
  }

  /**
   * Atualiza status das ordens no banco quando bot é pausado
   */
  async updateOrdersStatusOnPause(botId, symbol) {
    try {
      // Busca ordens pendentes do bot para o símbolo
      const orders = await OrdersService.getOrdersByBotId(botId);
      const pendingOrders = orders.filter(
        order => order.symbol === symbol && order.status === 'PENDING'
      );

      // Atualiza status para CANCELED_BY_PAUSE
      for (const order of pendingOrders) {
        await OrdersService.updateOrderStatus(order.externalOrderId, 'CANCELED_BY_PAUSE');
      }

      if (pendingOrders.length > 0) {
        Logger.info(
          `💾 [HFT_CONTROLLER] ${pendingOrders.length} ordens marcadas como canceladas no banco para ${symbol}`
        );
      }
    } catch (error) {
      Logger.error(
        `❌ [HFT_CONTROLLER] Erro ao atualizar status das ordens no banco:`,
        error.message
      );
    }
  }

  /**
   * Para um bot HFT específico
   */
  async stopHFTBot(botId) {
    try {
      Logger.info(`🛑 [HFT_CONTROLLER] Parando bot HFT ID: ${botId}`);

      const strategies = this.activeHFTBots.get(botId);

      // Busca configuração do bot para cancelar ordens (sempre, mesmo se não ativo)
      const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
      if (botConfig && botConfig.apiKey && botConfig.apiSecret) {
        // Cancela todas as ordens ativas do bot
        const exchange = ExchangeFactory.createExchange('backpack');
        for (const symbol of botConfig.authorizedTokens || []) {
          try {
            await exchange.cancelAllOpenOrders(symbol, botConfig.apiKey, botConfig.apiSecret);
            Logger.info(`🗑️ [HFT_CONTROLLER] Ordens canceladas para ${symbol} do bot ${botId}`);

            // Atualiza status das ordens no banco como canceladas
            await this.updateOrdersStatusOnPause(botId, symbol);
          } catch (error) {
            Logger.error(
              `❌ [HFT_CONTROLLER] Erro ao cancelar ordens para ${symbol}:`,
              error.message
            );
          }
        }

        // Limpa trading locks órfãos para este bot
        try {
          const dbService = ConfigManagerSQLite.dbService;
          if (dbService) {
            // Remove todos os trading locks ativos para este bot
            await dbService.run(
              'UPDATE trading_locks SET status = ?, unlockAt = datetime(?) WHERE botId = ? AND status = ?',
              ['RELEASED', 'now', botId, 'ACTIVE']
            );
            Logger.info(`🔓 [HFT_CONTROLLER] Trading locks liberados para bot ${botId}`);
          }
        } catch (error) {
          Logger.error(
            `❌ [HFT_CONTROLLER] Erro ao liberar trading locks para bot ${botId}:`,
            error.message
          );
        }
      }

      // Se o bot estava ativo, para todas as estratégias HFT
      if (strategies && strategies instanceof Map) {
        for (const [symbol, strategy] of strategies) {
          try {
            await strategy.stopHFTMode();
            Logger.info(`🔄 [HFT_CONTROLLER] Estratégia HFT parada para ${symbol} do bot ${botId}`);
          } catch (error) {
            Logger.error(
              `❌ [HFT_CONTROLLER] Erro ao parar estratégia para ${symbol}:`,
              error.message
            );
          }
        }
        this.activeHFTBots.delete(botId);
        Logger.info(`🔄 [HFT_CONTROLLER] Todas as estratégias HFT paradas para bot ${botId}`);
      } else {
        Logger.warn(
          `⚠️ [HFT_CONTROLLER] Bot HFT ${botId} não estava na lista ativa, mas continuando com cleanup`
        );
      }

      // SEMPRE atualiza status no banco (independente se estava ativo ou não)
      await ConfigManagerSQLite.updateBotStatusById(botId, 'stopped');

      Logger.info(`✅ [HFT_CONTROLLER] Bot HFT ${botId} parado com sucesso`);
    } catch (error) {
      Logger.error(`❌ [HFT_CONTROLLER] Erro ao parar bot HFT ${botId}:`, error.message);

      // Garante que o status seja atualizado mesmo em caso de erro
      try {
        await ConfigManagerSQLite.updateBotStatusById(botId, 'stopped');
      } catch (updateError) {
        Logger.error(
          `❌ [HFT_CONTROLLER] Erro ao atualizar status no banco para bot ${botId}:`,
          updateError.message
        );
      }
    }
  }

  /**
   * Inicia monitoramento periódico dos bots HFT
   */
  startMonitoring() {
    // Monitora a cada 30 segundos
    this.monitorInterval = setInterval(async () => {
      try {
        await this.monitorHFTBots();
      } catch (error) {
        Logger.error('❌ [HFT_CONTROLLER] Erro no monitoramento:', error.message);
      }
    }, 30000);

    Logger.info('🔍 [HFT_CONTROLLER] Monitoramento iniciado (30s interval)');
  }

  /**
   * Monitora estado dos bots HFT
   */
  async monitorHFTBots() {
    try {
      // Verifica se há novos bots HFT para iniciar
      const hftBots = await ConfigManagerSQLite.loadHFTBots();
      // 🚨 FILTRO INTELIGENTE: Só inicia bots que estão habilitados E não estão pausados
      const enabledHFTBots = hftBots.filter(bot => {
        const isEnabled = bot.enabled;
        const canRun = !bot.status || bot.status === 'idle' || bot.status === 'running';

        if (isEnabled && !canRun) {
          Logger.debug(
            `⏸️ [HFT_FILTER] Bot HFT ${bot.botName || bot.id} está pausado - mantendo pausado`
          );
        }

        return isEnabled && canRun;
      });

      for (const botConfig of enabledHFTBots) {
        if (!this.activeHFTBots.has(botConfig.id)) {
          Logger.info(
            `🔄 [HFT_CONTROLLER] Detectado novo bot HFT para iniciar: ${botConfig.botName}`
          );
          await this.startHFTBot(botConfig);
        }
      }

      // Verifica se há bots que devem ser parados
      for (const [botId, hftStrategy] of this.activeHFTBots.entries()) {
        const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
        if (!botConfig || !botConfig.enabled) {
          Logger.info(`🔄 [HFT_CONTROLLER] Bot HFT ${botId} desabilitado, parando...`);
          await this.stopHFTBot(botId);
        }
      }
    } catch (error) {
      Logger.error('❌ [HFT_CONTROLLER] Erro no monitoramento de bots HFT:', error.message);
    }
  }

  /**
   * Valida configuração HFT obrigatória
   */
  validateHFTConfig(config) {
    const requiredFields = ['hftSpread', 'hftRebalanceFrequency', 'hftDailyHours'];

    for (const field of requiredFields) {
      if (!config[field] || config[field] <= 0) {
        throw new Error(`Campo obrigatório HFT ausente ou inválido: ${field}`);
      }
    }

    if (!config.apiKey || !config.apiSecret) {
      throw new Error('API Key e Secret são obrigatórios para bots HFT');
    }

    if (!config.authorizedTokens || config.authorizedTokens.length === 0) {
      throw new Error('Lista de tokens autorizados é obrigatória para bots HFT');
    }
  }

  /**
   * Extrai símbolo da configuração do bot
   */
  getSymbolFromConfig(config) {
    // Por simplicidade, usa o primeiro token autorizado
    // Em implementação futura, pode ter lógica mais sofisticada
    if (config.authorizedTokens && config.authorizedTokens.length > 0) {
      return config.authorizedTokens[0];
    }

    throw new Error('Nenhum token/símbolo encontrado na configuração do bot HFT');
  }

  /**
   * Calcula quantidade optimal baseada no capital disponível e preço atual
   */
  async calculateOptimalAmountFromConfig(config, symbol) {
    try {
      // 1. Obter dados da conta via exchange factory
      const exchange = ExchangeFactory.createExchange('backpack');
      const accountData = await exchange.getAccountData(config.apiKey, config.apiSecret);
      if (!accountData || !accountData.capitalAvailable) {
        const error = `ERRO CRÍTICO: Capital não disponível para bot ${config.botName}. Não é possível calcular quantidade de forma segura.`;
        Logger.error(`❌ [HFT_AMOUNT] ${error}`);
        throw new Error(error);
      }

      // 2. Obter preço atual do mercado
      const currentPrice = await exchange.getMarketPrice(symbol);
      if (!currentPrice) {
        const error = `ERRO CRÍTICO: Preço não disponível para ${symbol}. Não é possível calcular quantidade de forma segura.`;
        Logger.error(`❌ [HFT_AMOUNT] ${error}`);
        throw new Error(error);
      }

      // 3. Obter informações de formatação do mercado
      const marketInfo = await exchange.getMarketInfo(symbol, config.apiKey, config.apiSecret);
      Logger.debug(`📊 [HFT_AMOUNT] Market info para ${symbol}:`, {
        stepSize: marketInfo.stepSize_quantity,
        minQuantity: marketInfo.minQuantity,
        decimals: marketInfo.decimal_quantity,
      });

      // 4. Usar capital percentual configurado (se não tiver, usar valor pequeno para HFT)
      const capitalPercentage = config.capitalPercentage || 1; // 1% padrão para HFT
      const volumeUSD = (accountData.capitalAvailable * capitalPercentage) / 100;

      // 5. Calcular quantidade baseada no volume USD e preço atual (RAW)
      const rawQuantity = volumeUSD / parseFloat(currentPrice);

      // 6. Apply minimum quantity validation first (before formatting)
      let adjustedQuantity = rawQuantity;
      if (marketInfo.minQuantity) {
        const minQty = parseFloat(marketInfo.minQuantity);

        if (rawQuantity < minQty) {
          Logger.warn(
            `⚠️ [HFT_AMOUNT] Calculated quantity ${rawQuantity} below minimum ${minQty} for ${symbol}, using minimum quantity`
          );
          adjustedQuantity = minQty;
        }
      }

      // 7. Return the adjusted quantity as NUMBER (HFTStrategy will handle formatting)
      Logger.info(
        `💰 [HFT_AMOUNT] ${symbol}: Capital($${accountData.capitalAvailable.toFixed(2)}) × ${capitalPercentage}% = $${volumeUSD.toFixed(2)}`
      );
      Logger.info(
        `📐 [HFT_AMOUNT] ${symbol}: Raw(${rawQuantity.toFixed(8)}) → Adjusted(${adjustedQuantity}) @ $${currentPrice}`
      );

      return adjustedQuantity;
    } catch (error) {
      Logger.error(
        `❌ [HFT_AMOUNT] Erro crítico ao calcular quantidade para ${symbol}:`,
        error.message
      );
      Logger.error(`🛑 [HFT_AMOUNT] Parando execução do bot ${config.botName} por segurança`);
      throw error; // Propaga o erro para parar o bot
    }
  }

  /**
   * @deprecated - Usar calculateOptimalAmountFromConfig()
   * Calcula quantidade baseada na configuração de capital
   */
  calculateAmountFromConfig(config) {
    // Usa capitalPercentage igual aos bots tradicionais
    // O bot HFT calcula o tamanho de ordem internamente baseado no capital disponível
    return config.capitalPercentage || 5;
  }

  /**
   * Obtém status de todos os bots HFT
   */
  async getHFTBotsStatus() {
    try {
      const hftBots = await ConfigManagerSQLite.loadHFTBots();

      return hftBots.map(bot => {
        const isActive = this.activeHFTBots.has(bot.id);
        const strategies = this.activeHFTBots.get(bot.id);

        // Collect metrics from all active strategies
        let allMetrics = null;
        if (strategies && strategies instanceof Map) {
          allMetrics = {};
          for (const [symbol, strategy] of strategies) {
            try {
              allMetrics[symbol] = strategy.getHFTMetrics();
            } catch (error) {
              allMetrics[symbol] = { error: error.message };
            }
          }
        }

        return {
          id: bot.id,
          botName: bot.botName,
          status: bot.status,
          enabled: bot.enabled,
          isActive,
          activeTokens: strategies ? Array.from(strategies.keys()) : [],
          metrics: allMetrics,
          config: {
            hftSpread: bot.hftSpread,
            hftRebalanceFrequency: bot.hftRebalanceFrequency,
            capitalPercentage: bot.capitalPercentage,
            hftDailyHours: bot.hftDailyHours,
            authorizedTokens: bot.authorizedTokens,
          },
        };
      });
    } catch (error) {
      Logger.error('❌ [HFT_CONTROLLER] Erro ao obter status dos bots HFT:', error.message);
      return [];
    }
  }

  /**
   * Para todos os bots HFT ativos
   */
  async stopAllHFTBots() {
    Logger.info('🛑 [HFT_CONTROLLER] Parando todos os bots HFT...');

    try {
      if (this.activeHFTBots.size === 0) {
        Logger.info('ℹ️ [HFT_CONTROLLER] Nenhum bot HFT ativo para parar');
        return { success: true, message: 'Nenhum bot HFT ativo' };
      }

      const results = [];
      for (const [botId, hftStrategy] of this.activeHFTBots.entries()) {
        try {
          await this.stopHFTBot(botId);
          results.push({ botId, success: true });
        } catch (error) {
          Logger.error(`❌ [HFT_STOP_ALL] Erro ao parar bot ${botId}:`, error.message);
          results.push({ botId, success: false, error: error.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      Logger.info(
        `✅ [HFT_CONTROLLER] ${successCount}/${results.length} bots HFT parados com sucesso`
      );

      return {
        success: true,
        message: `${successCount}/${results.length} bots parados`,
        results,
      };
    } catch (error) {
      Logger.error('❌ [HFT_STOP_ALL] Erro ao parar todos os bots HFT:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Atualiza configuração de um bot HFT sem alterar seu status
   * @param {number} botId - ID do bot
   * @param {object} newConfig - Nova configuração
   * @returns {object} - Resultado da atualização
   */
  async updateHFTBotConfig(botId, newConfig) {
    try {
      Logger.info(`🔧 [HFT_CONTROLLER] Atualizando configuração do bot HFT ${botId}`);

      // 1. Busca o status atual do bot ANTES da atualização
      const currentBot = await ConfigManagerSQLite.getBotConfigById(botId);
      if (!currentBot) {
        throw new Error(`Bot com ID ${botId} não encontrado`);
      }

      const currentStatus = currentBot.status;
      Logger.info(`🔍 [HFT_CONTROLLER] Status atual do bot ${botId}: ${currentStatus}`);

      // 2. Remove o campo 'status' da nova configuração para não sobrescrever
      const configToUpdate = { ...newConfig };
      delete configToUpdate.status;

      // 3. Atualiza a configuração no banco SEM alterar o status
      const result = await ConfigManagerSQLite.updateBotConfig(botId, configToUpdate);

      // 4. EXPLICITAMENTE preserva o status atual
      await ConfigManagerSQLite.updateBotStatusById(botId, currentStatus);
      Logger.info(`✅ [HFT_CONTROLLER] Status preservado: ${currentStatus}`);

      // 5. Se o bot está rodando, recria a instância com nova config
      if (
        this.activeHFTBots.has(botId) &&
        (currentStatus === 'running' || currentStatus === 'active')
      ) {
        Logger.info(`🔄 [HFT_CONTROLLER] Reiniciando bot ativo ${botId} com nova configuração`);

        // Para o bot atual
        await this.stopHFTBot(botId);

        // Busca a nova configuração e reinicia
        const updatedBot = await ConfigManagerSQLite.getBotConfigById(botId);
        await this.startHFTBot(updatedBot);
      }

      return {
        success: true,
        message: `Configuração do bot ${botId} atualizada com sucesso`,
        preservedStatus: currentStatus,
        data: result,
      };
    } catch (error) {
      Logger.error(
        `❌ [HFT_CONTROLLER] Erro ao atualizar configuração do bot ${botId}:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Força parada de emergência de todos os bots HFT
   */
  async emergencyStop() {
    Logger.warn('🚨 [HFT_CONTROLLER] PARADA DE EMERGÊNCIA INICIADA');

    try {
      for (const [botId, hftStrategy] of this.activeHFTBots.entries()) {
        try {
          await hftStrategy.stopHFTMode();
          await ConfigManagerSQLite.updateBotStatusById(botId, 'stopped');
        } catch (error) {
          Logger.error(`❌ [HFT_EMERGENCY] Erro ao parar bot ${botId}:`, error.message);
        }
      }

      this.activeHFTBots.clear();
      Logger.warn('🚨 [HFT_CONTROLLER] PARADA DE EMERGÊNCIA CONCLUÍDA');
    } catch (error) {
      Logger.error('❌ [HFT_EMERGENCY] Erro na parada de emergência:', error.message);
    }
  }
}

export default HFTController;
