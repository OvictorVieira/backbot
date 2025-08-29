import Logger from './Logger.js';
import CachedOrdersService from './CachedOrdersService.js';

class PositionUtils {
  /**
   * Busca ordens filtradas por posicionamento vs preço atual
   * @param {string} symbol - Símbolo do mercado
   * @param {object} position - Dados da posição
   * @param {object} config - Configuração com credenciais API
   * @param {function} filterLogic - Função que recebe (triggerValue, currentPrice, isLong) e retorna boolean
   * @param {string} orderTypeName - Nome do tipo para logs
   * @returns {Promise<Array>} Array de ordens filtradas
   */
  static async getFilteredOrders(symbol, position, config, filterLogic, orderTypeName) {
    try {
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios');
      }

      const allOrders = await CachedOrdersService.getOpenOrders(
        symbol,
        'PERP',
        config.apiKey,
        config.apiSecret
      );

      if (!allOrders || allOrders.length === 0) {
        return [];
      }

      const filteredOrders = [];
      const currentPrice = parseFloat(position.markPrice);
      if (!currentPrice) {
        Logger.error(`❌ [ORDER_FILTER] Preço atual não encontrado para ${symbol}`);
        return [];
      }

      const isLong = parseFloat(position.netQuantity) > 0;

      for (const order of allOrders) {
        const triggerRaw =
          order.triggerPrice ??
          order.price ??
          order.stopLossTriggerPrice ??
          order.stopLossLimitPrice;
        const triggerValue = triggerRaw != null ? Number(triggerRaw) : null;

        if (triggerValue !== null && Number.isFinite(triggerValue)) {
          if (filterLogic(triggerValue, currentPrice, isLong)) {
            filteredOrders.push(order);
          }
        }
      }

      Logger.debug(
        `🔍 [ORDER_FILTER] ${symbol}: Encontradas ${filteredOrders.length} ordens de ${orderTypeName} de ${allOrders.length} ordens totais`
      );

      return filteredOrders;
    } catch (error) {
      Logger.error(
        `❌ [ORDER_FILTER] Erro ao buscar ordens ${orderTypeName} para ${symbol}:`,
        error.message
      );
      return [];
    }
  }

  /**
   * Busca ordens de Stop Loss para um símbolo
   */
  static async getStopLossOrders(symbol, position, config) {
    return await this.getFilteredOrders(
      symbol,
      position,
      config,
      (triggerValue, currentPrice, isLong) =>
        isLong ? triggerValue < currentPrice : triggerValue > currentPrice,
      'Stop Loss'
    );
  }

  /**
   * Busca ordens de Take Profit para um símbolo
   */
  static async getTakeProfitOrders(symbol, position, config) {
    return await this.getFilteredOrders(
      symbol,
      position,
      config,
      (triggerValue, currentPrice, isLong) =>
        isLong ? triggerValue > currentPrice : triggerValue < currentPrice,
      'Take Profit'
    );
  }

  /**
   * Verifica se existe pelo menos uma ordem de Stop Loss válida
   * @param {string} symbol - Símbolo do mercado
   * @param {object} position - Dados da posição
   * @param {object} config - Configuração com credenciais API
   * @returns {Promise<boolean>} True se existe Stop Loss
   */
  static async hasStopLoss(symbol, position, config) {
    try {
      const stopLossOrders = await this.getStopLossOrders(symbol, position, config);
      return stopLossOrders.length > 0;
    } catch (error) {
      Logger.error(
        `❌ [STOP_LOSS_UTILS] Erro ao verificar existência de Stop Loss para ${symbol}:`,
        error.message
      );
      return false;
    }
  }

  /**
   * Verifica se existe pelo menos uma ordem de Take Profit válida
   * @param {string} symbol - Símbolo do mercado
   * @param {object} position - Dados da posição
   * @param {object} config - Configuração com credenciais API
   * @returns {Promise<boolean>} True se existe Take Profit
   */
  static async hasTakeProfit(symbol, position, config) {
    try {
      const takeProfitOrders = await this.getTakeProfitOrders(symbol, position, config);
      return takeProfitOrders.length > 0;
    } catch (error) {
      Logger.error(
        `❌ [STOP_LOSS_UTILS] Erro ao verificar existência de Take Profit para ${symbol}:`,
        error.message
      );
      return false;
    }
  }
}

export default PositionUtils;
