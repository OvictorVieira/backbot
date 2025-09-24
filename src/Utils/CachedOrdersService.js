/**
 * Serviço centralizado para operações com ordens que usa cache inteligente
 * Substitui chamadas diretas ao Order.js nos Controllers
 */

import Order from '../Backpack/Authenticated/Order.js';
import OrdersCache from './OrdersCache.js';
import CacheInvalidator from './CacheInvalidator.js';
import Logger from './Logger.js';

class CachedOrdersService {
  /**
   * Busca ordens abertas com cache inteligente
   * @param {string} symbol - Símbolo (null para todas)
   * @param {string} marketType - Tipo do mercado
   * @param {string} apiKey - Chave da API
   * @param {string} apiSecret - Secret da API
   * @param {boolean} bypassCache - Se true, força nova consulta ignorando cache
   * @returns {Promise<Array>} Lista de ordens
   */
  static async getOpenOrders(
    symbol = null,
    marketType = 'PERP',
    apiKey,
    apiSecret,
    bypassCache = false
  ) {
    try {
      const orders = await Order.getOpenOrders(symbol, marketType, apiKey, apiSecret, bypassCache);

      // 🔒 VALIDAÇÃO CRÍTICA: Garante que o retorno é sempre um array iterável
      if (!orders || !Array.isArray(orders)) {
        Logger.warn(
          `⚠️ [CACHED_ORDERS_SERVICE] Order.getOpenOrders retornou dados inválidos: ${typeof orders}, convertendo para array vazio`
        );
        return [];
      }

      return orders;
    } catch (error) {
      Logger.error(`❌ [CACHED_ORDERS_SERVICE] Erro ao buscar ordens abertas:`, error.message);
      // Em caso de rate limit, invalida cache para próxima tentativa
      if (error.message.includes('rate limit') || error.message.includes('429')) {
        CacheInvalidator.onRateLimitError(apiKey, apiSecret);
      }
      throw error;
    }
  }

  /**
   * Busca ordens abertas para múltiplos símbolos de forma otimizada
   * Faz uma única chamada para TODAS as ordens e filtra localmente
   * @param {Array} symbols - Lista de símbolos
   * @param {string} marketType - Tipo do mercado
   * @param {string} apiKey - Chave da API
   * @param {string} apiSecret - Secret da API
   * @returns {Promise<Object>} Mapa { symbol: orders[] }
   */
  static async getOpenOrdersForSymbols(symbols, marketType = 'PERP', apiKey, apiSecret) {
    try {
      // Busca TODAS as ordens de uma vez (mais eficiente que múltiplas chamadas)
      const allOrders = await this.getOpenOrders(null, marketType, apiKey, apiSecret);

      // 🔒 VALIDAÇÃO CRÍTICA: Garante que allOrders é um array iterável
      if (!allOrders || !Array.isArray(allOrders)) {
        Logger.warn(
          `⚠️ [CACHED_ORDERS_SERVICE] allOrders não é um array válido: ${typeof allOrders}, retornando arrays vazios`
        );
        const emptyResult = {};
        symbols.forEach(symbol => {
          emptyResult[symbol] = [];
        });
        return emptyResult;
      }

      // Filtra ordens por símbolo localmente
      const ordersBySymbol = {};

      symbols.forEach(symbol => {
        ordersBySymbol[symbol] = allOrders.filter(order => order.symbol === symbol);
      });

      Logger.debug(
        `🎯 [CACHED_ORDERS_SERVICE] Ordens filtradas para ${symbols.length} símbolos: ${allOrders.length} ordens totais`
      );

      return ordersBySymbol;
    } catch (error) {
      Logger.error(
        `❌ [CACHED_ORDERS_SERVICE] Erro ao buscar ordens para múltiplos símbolos:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Cria uma nova ordem e invalida cache
   * @param {object} orderData - Dados da ordem
   * @param {string} apiKey - Chave da API
   * @param {string} apiSecret - Secret da API
   * @returns {Promise<object>} Resultado da criação
   */
  static async createOrder(orderData, apiKey, apiSecret) {
    try {
      const result = await Order.executeOrder(orderData, apiKey, apiSecret);

      // Cache já é invalidado automaticamente no executeOrder()
      Logger.debug(`✅ [CACHED_ORDERS_SERVICE] Ordem criada para ${orderData.symbol}`);

      return result;
    } catch (error) {
      Logger.error(`❌ [CACHED_ORDERS_SERVICE] Erro ao criar ordem:`, error.message);
      throw error;
    }
  }

  /**
   * Cancela uma ordem e invalida cache
   * @param {string} symbol - Símbolo da ordem
   * @param {string} orderId - ID da ordem
   * @param {string} clientId - Client ID (opcional)
   * @param {string} apiKey - Chave da API
   * @param {string} apiSecret - Secret da API
   * @returns {Promise<object>} Resultado do cancelamento
   */
  static async cancelOrder(symbol, orderId, clientId, apiKey, apiSecret) {
    try {
      const result = await Order.cancelOpenOrder(symbol, orderId, clientId, apiKey, apiSecret);

      // Cache já é invalidado automaticamente no cancelOpenOrder()
      Logger.debug(`✅ [CACHED_ORDERS_SERVICE] Ordem cancelada ${orderId} para ${symbol}`);

      return result;
    } catch (error) {
      Logger.error(`❌ [CACHED_ORDERS_SERVICE] Erro ao cancelar ordem:`, error.message);
      throw error;
    }
  }

  /**
   * Obtém estatísticas do cache
   * @returns {object} Estatísticas do cache
   */
  static getCacheStats() {
    return OrdersCache.getStats();
  }

  /**
   * Invalida cache manualmente para uma conta
   * @param {string} apiKey - Chave da API
   * @param {string} apiSecret - Secret da API
   * @param {string} reason - Motivo da invalidação
   */
  static invalidateCache(apiKey, apiSecret, reason = 'manual') {
    CacheInvalidator.invalidateAllForAccount(apiKey, apiSecret, reason);
  }

  /**
   * Limpa todo o cache (emergência)
   * @param {string} reason - Motivo da limpeza
   */
  static clearAllCache(reason = 'manual cleanup') {
    CacheInvalidator.invalidateGlobal(reason);
  }
}

export default CachedOrdersService;
