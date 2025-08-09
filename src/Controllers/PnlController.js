import History from '../Backpack/Authenticated/History.js';
import Logger from '../Utils/Logger.js';
import PositionTrackingService from '../Services/PositionTrackingService.js';

class PnlController {
  async run(hour = 24, config = null, botId = null) {
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      
      // NOVO SISTEMA: Se botId for fornecido, usa o novo sistema de rastreamento
      if (botId) {
        Logger.info(`🔄 [PNL] Usando novo sistema de rastreamento para bot ${botId}`);
        
        const trackingResult = await PositionTrackingService.trackBotPositions(botId, config);
        const { performanceMetrics, reconstructedPositions } = trackingResult;
        
        Logger.info(`📊 [PNL] Resultados do novo sistema para bot ${botId}:`);
        Logger.info(`   • Total de posições: ${performanceMetrics.totalPositions}`);
        Logger.info(`   • Posições fechadas: ${performanceMetrics.closedPositions}`);
        Logger.info(`   • Win Rate: ${performanceMetrics.winRate.toFixed(2)}%`);
        Logger.info(`   • Profit Factor: ${performanceMetrics.profitFactor.toFixed(2)}`);
        Logger.info(`   • PnL Total: $${performanceMetrics.totalPnl.toFixed(2)}`);
        Logger.info(`   • PnL Médio: $${performanceMetrics.avgPnl.toFixed(2)}`);
        
        return performanceMetrics;
      }
      
      // SISTEMA LEGADO: Para compatibilidade, mantém o comportamento anterior
      Logger.info(`🔄 [PNL] Usando sistema legado de cálculo de PnL`);
      
      const now = Date.now();                                  // timestamp atual em ms
      const oneDayAgo = now - hour * 60 * 60 * 1000;            // 24h atrás em ms

      // opcional: especifique um símbolo, ou passe null para todos
      const symbol = null;
      const orderId = null;

      // limite de registros por página (máx 1000), offset inicial e direção de ordenação
      const limit = 1000;
      const offset = 0;
      const fillType = null;      // ou 'Trade', 'Liquidation' etc.
      const marketType = null;    // array de tipos se precisar filtrar (SPOT, PERP)
      const sortDirection = null;

      const fills = await History.getFillHistory(
        symbol,
        orderId,
        oneDayAgo,
        now,
        limit,
        offset,
        fillType,
        marketType,
        sortDirection,
        config.apiKey,
        config.apiSecret
      );
      const result = this.summarizeTrades(fills)
      Logger.info(`last ${hour}h:`, result);
      
      return result;

    } catch (error) {
      Logger.error('❌ PnlController.run - Error:', error.message)
      return null;
    }
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
          totalVolume: tot.totalVolume + curr.totalVolume
        }),
        { totalFee: 0, totalVolume: 0 }
      );

      const volumeBylFee = overall.totalFee > 0 ? (overall.totalVolume / overall.totalFee) : 0;

      return { totalFee: overall.totalFee, totalVolume: overall.totalVolume, volumeBylFee: volumeBylFee };

    } catch (error) {
      Logger.error('❌ PnlController.summarizeTrades - Error:', error.message);
      return { totalFee: 0, totalVolume: 0, volumeBylFee: 0 };
    }
  }

}
export default new PnlController();