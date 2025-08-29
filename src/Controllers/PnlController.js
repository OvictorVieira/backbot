import History from '../Backpack/Authenticated/History.js';
import Logger from '../Utils/Logger.js';
import PositionTrackingService from '../Services/PositionTrackingService.js';
import DatabaseService from '../Services/DatabaseService.js';

class PnlController {
  constructor() {
    this.dbService = null;
    this.positionTracker = null;
  }

  /**
   * Inicializa o controller com as dependências necessárias
   */
  async initialize() {
    if (!this.dbService) {
      this.dbService = new DatabaseService();
      if (!this.dbService.isInitialized()) {
        await this.dbService.init();
      }
      this.positionTracker = new PositionTrackingService(this.dbService);
    }
  }

  /**
   * Calcula estatísticas de P&L usando o novo sistema baseado em posições
   * @param {number} hour - Não usado mais, mantido para compatibilidade
   * @param {Object} config - Configuração do bot
   * @param {number} botId - ID do bot
   * @returns {Promise<Object>} Estatísticas de P&L
   */
  async run(hour = 24, config = null, botId = null) {
    try {
      await this.initialize();

      // Agora SEMPRE usa o novo sistema baseado no banco de dados
      if (botId) {
        Logger.info(`📊 [PNL] Calculando estatísticas do bot ${botId} usando sistema de posições`);
        return await this.calculateBotStatistics(botId);
      }

      Logger.warn(`⚠️ [PNL] BotId não fornecido - retornando estatísticas vazias`);
      return this.getEmptyStats();
    } catch (error) {
      Logger.error('❌ [PNL] Erro ao calcular estatísticas:', error.message);
      return this.getEmptyStats();
    }
  }

  /**
   * Calcula estatísticas de um bot baseado nas posições do banco de dados
   * @param {number} botId - ID do bot
   * @returns {Promise<Object>} Estatísticas calculadas
   */
  async calculateBotStatistics(botId) {
    try {
      // Obtém estatísticas diretamente do PositionTrackingService
      const stats = await this.positionTracker.getBotPnLStats(botId);

      // Enriquece com dados adicionais
      const enrichedStats = {
        ...stats,
        // Calcula métricas derivadas
        profitFactor: this.calculateProfitFactor(stats),
        successRate: stats.winRate,
        averageWin: stats.winTrades > 0 ? stats.maxWin / stats.winTrades : 0,
        averageLoss: stats.lossTrades > 0 ? Math.abs(stats.maxLoss) / stats.lossTrades : 0,
        // Métricas de volume
        totalVolume: await this.calculateTotalVolume(botId),
        // Timestamp da análise
        calculatedAt: new Date().toISOString(),
        botId: botId,
      };

      this.logStatistics(enrichedStats);
      return enrichedStats;
    } catch (error) {
      Logger.error(`❌ [PNL] Erro ao calcular estatísticas do bot ${botId}:`, error.message);
      return this.getEmptyStats();
    }
  }

  /**
   * Calcula profit factor baseado nos wins e losses
   * @param {Object} stats - Estatísticas básicas
   * @returns {number} Profit factor
   */
  calculateProfitFactor(stats) {
    if (!stats.lossTrades || stats.lossTrades === 0) {
      return stats.winTrades > 0 ? 999 : 0; // Infinito se só há wins
    }

    const grossProfit = stats.winTrades * (stats.maxWin / Math.max(stats.winTrades, 1));
    const grossLoss = Math.abs(stats.lossTrades * (stats.maxLoss / Math.max(stats.lossTrades, 1)));

    return grossLoss > 0 ? grossProfit / grossLoss : 0;
  }

  /**
   * Calcula volume total das posições de um bot
   * @param {number} botId - ID do bot
   * @returns {Promise<number>} Volume total
   */
  async calculateTotalVolume(botId) {
    try {
      const result = await this.dbService.get(
        `SELECT SUM(initialQuantity * entryPrice) as totalVolume 
         FROM positions 
         WHERE botId = ? AND status = 'CLOSED'`,
        [botId]
      );

      return result?.totalVolume || 0;
    } catch (error) {
      Logger.error(`❌ [PNL] Erro ao calcular volume total:`, error.message);
      return 0;
    }
  }

  /**
   * Loga as estatísticas calculadas
   * @param {Object} stats - Estatísticas para exibir
   */
  logStatistics(stats) {
    Logger.info(`📊 [PNL] Estatísticas calculadas para bot ${stats.botId}:`);
    Logger.info(`   • Total de trades: ${stats.totalTrades}`);
    Logger.info(`   • Trades fechados: ${stats.closedTrades}`);
    Logger.info(`   • Trades vencedores: ${stats.winTrades}`);
    Logger.info(`   • Trades perdedores: ${stats.lossTrades}`);
    Logger.info(`   • Win Rate: ${stats.winRate.toFixed(2)}%`);
    Logger.info(`   • Profit Factor: ${stats.profitFactor.toFixed(2)}`);
    Logger.info(`   • PnL Total: $${stats.totalPnl.toFixed(2)}`);
    Logger.info(`   • PnL Médio: $${stats.avgPnl.toFixed(2)}`);
    Logger.info(`   • Maior ganho: $${stats.maxWin.toFixed(2)}`);
    Logger.info(`   • Maior perda: $${stats.maxLoss.toFixed(2)}`);
    Logger.info(`   • Volume total: $${stats.totalVolume.toFixed(2)}`);
  }

  /**
   * Retorna estatísticas vazias para casos de erro
   * @returns {Object} Objeto com estatísticas zeradas
   */
  getEmptyStats() {
    return {
      totalTrades: 0,
      closedTrades: 0,
      winTrades: 0,
      lossTrades: 0,
      totalPnl: 0,
      avgPnl: 0,
      maxWin: 0,
      maxLoss: 0,
      winRate: 0,
      profitFactor: 0,
      successRate: 0,
      averageWin: 0,
      averageLoss: 0,
      totalVolume: 0,
      calculatedAt: new Date().toISOString(),
      botId: null,
    };
  }

  summarizeTrades(trades) {
    try {
      // Verifica se trades é válido
      if (!trades || !Array.isArray(trades) || trades.length === 0) {
        Logger.info('📊 Nenhum trade encontrado para análise');
        return { totalFee: 0, totalVolume: 0, volumeBylFee: 0 };
      }

      const bySymbol = trades.reduce((acc, { symbol, price, quantity, fee, side }) => {
        const p = parseFloat(price);
        const q = parseFloat(quantity);
        const f = parseFloat(fee);
        const volume = p * q;
        const pnl = side === 'Ask' ? volume : -volume;

        if (!acc[symbol]) {
          acc[symbol] = { totalFee: 0, totalVolume: 0, totalPnl: 0 };
        }

        acc[symbol].totalFee += f;
        acc[symbol].totalVolume += volume;
        acc[symbol].totalPnl += pnl;
        return acc;
      }, {});

      const overall = Object.values(bySymbol).reduce(
        (tot, curr) => ({
          totalFee: tot.totalFee + curr.totalFee,
          totalVolume: tot.totalVolume + curr.totalVolume,
        }),
        { totalFee: 0, totalVolume: 0 }
      );

      const volumeBylFee = overall.totalFee > 0 ? overall.totalVolume / overall.totalFee : 0;

      return {
        totalFee: overall.totalFee,
        totalVolume: overall.totalVolume,
        volumeBylFee: volumeBylFee,
      };
    } catch (error) {
      Logger.error('❌ PnlController.summarizeTrades - Error:', error.message);
      return { totalFee: 0, totalVolume: 0, volumeBylFee: 0 };
    }
  }
}
export default new PnlController();
