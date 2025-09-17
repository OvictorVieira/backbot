import HFTStrategy from '../Decision/Strategies/HFTStrategy.js';
import Logger from '../Utils/Logger.js';

/**
 * Controller para gerenciar o ciclo de vida da estratégia HFT
 *
 * Responsabilidades:
 * - Iniciar/parar estratégias HFT
 * - Monitorar execução e métricas
 * - Gerenciar múltiplos símbolos
 * - Interface com o sistema principal
 */
class HFTController {
  constructor() {
    this.strategies = new Map(); // botId -> HFTStrategy
    this.isEnabled = false;
    this.metrics = {
      totalVolume: 0,
      totalTrades: 0,
      activeStrategies: 0,
      startTime: null,
    };
  }

  /**
   * Inicia estratégia HFT para um bot
   */
  async startHFTBot(botConfig) {
    try {
      Logger.info(`🚀 [HFT_CONTROLLER] Iniciando bot HFT: ${botConfig.botName}`);

      // Valida configuração
      this.validateHFTConfig(botConfig);

      // Cria nova instância da estratégia
      const strategy = new HFTStrategy();
      strategy.config = botConfig;

      // Calcula quantidade baseada no capital
      const quantity = this.calculateTradeQuantity(botConfig);

      // Inicia estratégia para cada símbolo configurado
      const symbols = this.getActiveSymbols(botConfig);
      const results = [];

      for (const symbol of symbols) {
        try {
          Logger.info(`📈 [HFT_CONTROLLER] Iniciando HFT para ${symbol}`);

          const result = await strategy.executeHFTStrategy(symbol, quantity, botConfig);
          results.push({ symbol, success: true, result });

          Logger.info(`✅ [HFT_CONTROLLER] HFT iniciado para ${symbol}`);
        } catch (error) {
          Logger.error(`❌ [HFT_CONTROLLER] Erro ao iniciar HFT para ${symbol}:`, error.message);
          results.push({ symbol, success: false, error: error.message });
        }
      }

      // Armazena estratégia
      this.strategies.set(botConfig.id, strategy);

      // Atualiza métricas
      this.updateMetrics();

      Logger.info(`✅ [HFT_CONTROLLER] Bot HFT iniciado: ${botConfig.botName}`);

      return {
        success: true,
        botId: botConfig.id,
        results,
        symbolsStarted: results.filter(r => r.success).length,
        symbolsTotal: symbols.length,
      };
    } catch (error) {
      Logger.error(`❌ [HFT_CONTROLLER] Erro ao iniciar bot HFT:`, error.message);
      throw error;
    }
  }

  /**
   * Para estratégia HFT para um bot
   */
  async stopHFTBot(botId) {
    try {
      Logger.info(`🛑 [HFT_CONTROLLER] Parando bot HFT: ${botId}`);

      const strategy = this.strategies.get(botId);
      if (!strategy) {
        throw new Error(`Estratégia HFT não encontrada para bot ${botId}`);
      }

      // Para a estratégia
      await strategy.stopHFTMode();

      // Remove da lista
      this.strategies.delete(botId);

      // Atualiza métricas
      this.updateMetrics();

      Logger.info(`✅ [HFT_CONTROLLER] Bot HFT parado: ${botId}`);

      return { success: true, botId };
    } catch (error) {
      Logger.error(`❌ [HFT_CONTROLLER] Erro ao parar bot HFT:`, error.message);
      throw error;
    }
  }

  /**
   * Para todos os bots HFT
   */
  async stopAllHFTBots() {
    try {
      Logger.info(`🛑 [HFT_CONTROLLER] Parando todos os bots HFT`);

      const botIds = Array.from(this.strategies.keys());
      const results = [];

      for (const botId of botIds) {
        try {
          await this.stopHFTBot(botId);
          results.push({ botId, success: true });
        } catch (error) {
          results.push({ botId, success: false, error: error.message });
        }
      }

      Logger.info(`✅ [HFT_CONTROLLER] Todos os bots HFT parados`);

      return {
        success: true,
        results,
        stoppedCount: results.filter(r => r.success).length,
        totalCount: botIds.length,
      };
    } catch (error) {
      Logger.error(`❌ [HFT_CONTROLLER] Erro ao parar todos os bots HFT:`, error.message);
      throw error;
    }
  }

  /**
   * Obtém status de um bot HFT
   */
  getHFTBotStatus(botId) {
    const strategy = this.strategies.get(botId);
    if (!strategy) {
      return { found: false };
    }

    const metrics = strategy.getHFTMetrics();

    return {
      found: true,
      isRunning: strategy.isRunning,
      activeGrids: metrics.activeGrids,
      totalVolume: metrics.totalVolume,
      totalTrades: metrics.totalTrades,
      netPosition: metrics.netPosition,
      uptime: metrics.uptime,
      symbols: Array.from(strategy.activeGrids.keys()),
    };
  }

  /**
   * Obtém status de todos os bots HFT
   */
  getAllHFTStatus() {
    const status = {
      isEnabled: this.isEnabled,
      activeBots: this.strategies.size,
      totalVolume: 0,
      totalTrades: 0,
      totalGrids: 0,
      bots: [],
    };

    for (const [botId, strategy] of this.strategies) {
      const botStatus = this.getHFTBotStatus(botId);
      if (botStatus.found) {
        status.bots.push({
          botId,
          ...botStatus,
        });

        status.totalVolume += botStatus.totalVolume;
        status.totalTrades += botStatus.totalTrades;
        status.totalGrids += botStatus.activeGrids;
      }
    }

    return status;
  }

  /**
   * Atualiza configuração de um bot HFT em execução
   */
  async updateHFTBotConfig(botId, newConfig) {
    try {
      Logger.info(`🔧 [HFT_CONTROLLER] Atualizando configuração do bot HFT: ${botId}`);

      const strategy = this.strategies.get(botId);
      if (!strategy) {
        throw new Error(`Bot HFT não encontrado: ${botId}`);
      }

      // Para estratégia atual
      await strategy.stopHFTMode();

      // Atualiza configuração
      strategy.config = { ...strategy.config, ...newConfig };

      // Reinicia com nova configuração
      const quantity = this.calculateTradeQuantity(strategy.config);
      const symbols = this.getActiveSymbols(strategy.config);

      for (const symbol of symbols) {
        await strategy.executeHFTStrategy(symbol, quantity, strategy.config);
      }

      Logger.info(`✅ [HFT_CONTROLLER] Configuração atualizada para bot HFT: ${botId}`);

      return { success: true, botId };
    } catch (error) {
      Logger.error(`❌ [HFT_CONTROLLER] Erro ao atualizar configuração:`, error.message);
      throw error;
    }
  }

  /**
   * Calcula quantidade de trade baseada no capital
   */
  calculateTradeQuantity(config) {
    try {
      const capitalPercentage = config.capitalPercentage || 1; // 1% default
      const capitalAmount = config.capitalAmount || 100; // $100 default
      const leverage = config.leverage || 1;

      // Quantidade em USD
      const tradeAmount = ((capitalAmount * capitalPercentage) / 100) * leverage;

      // Para HFT, usar quantidades menores para mais trades
      const hftMultiplier = config.hftQuantityMultiplier || 0.1; // 10% da quantidade normal

      return tradeAmount * hftMultiplier;
    } catch (error) {
      Logger.error(`❌ [HFT_CONTROLLER] Erro ao calcular quantidade:`, error.message);
      return 10; // Fallback para $10
    }
  }

  /**
   * Obtém símbolos ativos para HFT
   */
  getActiveSymbols(config) {
    // Se símbolos específicos foram configurados para HFT
    if (config.hftSymbols && Array.isArray(config.hftSymbols)) {
      return config.hftSymbols;
    }

    // Fallback para símbolos padrão com foco em baixas taxas maker
    return ['SOL_USDC_PERP', 'BTC_USDC_PERP', 'ETH_USDC_PERP'];
  }

  /**
   * Valida configuração HFT
   */
  validateHFTConfig(config) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error('Credenciais de API são obrigatórias para modo HFT');
    }

    if (!config.botName) {
      throw new Error('Nome do bot é obrigatório');
    }

    if (!config.id) {
      throw new Error('ID do bot é obrigatório');
    }

    // Validações específicas do HFT
    if (config.hftSpread && (config.hftSpread <= 0 || config.hftSpread > 0.05)) {
      throw new Error('HFT Spread deve estar entre 0% e 5%');
    }

    if (config.hftDailyVolumeGoal && config.hftDailyVolumeGoal <= 0) {
      throw new Error('Meta de volume diário deve ser maior que 0');
    }

    // Avisos
    if (!config.hftSpread) {
      Logger.warn(`⚠️ [HFT_CONTROLLER] Spread não configurado, usando padrão 0.01%`);
    }

    if (config.capitalPercentage && config.capitalPercentage > 10) {
      Logger.warn(
        `⚠️ [HFT_CONTROLLER] Capital percentage alto para HFT: ${config.capitalPercentage}%`
      );
    }
  }

  /**
   * Atualiza métricas globais
   */
  updateMetrics() {
    this.metrics.activeStrategies = this.strategies.size;

    if (this.metrics.activeStrategies > 0 && !this.metrics.startTime) {
      this.metrics.startTime = new Date();
    }

    if (this.metrics.activeStrategies === 0) {
      this.metrics.startTime = null;
    }
  }

  /**
   * Obtém relatório de performance
   */
  getPerformanceReport() {
    const report = {
      summary: {
        activeBots: this.strategies.size,
        totalUptime: this.metrics.startTime ? Date.now() - this.metrics.startTime.getTime() : 0,
        globalMetrics: this.getAllHFTStatus(),
      },
      bots: [],
    };

    for (const [botId, strategy] of this.strategies) {
      const botMetrics = strategy.getHFTMetrics();
      const botReport = {
        botId,
        config: {
          spread: strategy.config.hftSpread,
          symbols: this.getActiveSymbols(strategy.config),
          dailyGoal: strategy.config.hftDailyVolumeGoal,
        },
        performance: {
          totalVolume: botMetrics.totalVolume,
          totalTrades: botMetrics.totalTrades,
          averageTradeSize:
            botMetrics.totalTrades > 0 ? botMetrics.totalVolume / botMetrics.totalTrades : 0,
          netPosition: botMetrics.netPosition,
          uptime: botMetrics.uptime,
        },
        grids: [],
      };

      // Adiciona detalhes de cada grid
      for (const [symbol, gridState] of strategy.activeGrids) {
        botReport.grids.push({
          symbol,
          marketPrice: gridState.marketPrice,
          buyPrice: gridState.buyPrice,
          sellPrice: gridState.sellPrice,
          activeBuyOrder: !!gridState.activeBuyOrder,
          activeSellOrder: !!gridState.activeSellOrder,
          executedTrades: gridState.executedTrades.length,
          totalVolume: gridState.totalVolume,
          netPosition: gridState.netPosition,
        });
      }

      report.bots.push(botReport);
    }

    return report;
  }

  /**
   * Habilita/desabilita sistema HFT globalmente
   */
  setHFTEnabled(enabled) {
    this.isEnabled = enabled;
    Logger.info(`🔧 [HFT_CONTROLLER] Sistema HFT ${enabled ? 'habilitado' : 'desabilitado'}`);
  }

  /**
   * Verifica se sistema HFT está habilitado
   */
  isHFTEnabled() {
    return this.isEnabled;
  }
}

// Instância singleton
const hftController = new HFTController();

export default hftController;
