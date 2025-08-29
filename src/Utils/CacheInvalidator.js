/**
 * Invalidador inteligente de cache para ordens
 * Invalida cache quando ordens são criadas, canceladas ou modificadas
 */

import Logger from './Logger.js';
import OrdersCache from './OrdersCache.js';

class CacheInvalidator {
  /**
   * Invalida cache quando uma nova ordem é criada
   * @param {string} apiKey - Chave da API
   * @param {string} apiSecret - Secret da API
   * @param {string} symbol - Símbolo da ordem criada
   */
  static onOrderCreated(apiKey, apiSecret, symbol) {
    const cacheKey = OrdersCache.getCacheKey(apiKey, apiSecret);
    OrdersCache.invalidateCache(cacheKey, `nova ordem criada ${symbol}`);
    Logger.debug(`🗑️ [CACHE_INVALIDATOR] Cache invalidado após criação de ordem ${symbol}`);
  }

  /**
   * Invalida cache quando uma ordem é cancelada
   * @param {string} apiKey - Chave da API
   * @param {string} apiSecret - Secret da API
   * @param {string} symbol - Símbolo da ordem cancelada
   */
  static onOrderCancelled(apiKey, apiSecret, symbol) {
    const cacheKey = OrdersCache.getCacheKey(apiKey, apiSecret);
    OrdersCache.invalidateCache(cacheKey, `ordem cancelada ${symbol}`);
    Logger.debug(`🗑️ [CACHE_INVALIDATOR] Cache invalidado após cancelamento de ordem ${symbol}`);
  }

  /**
   * Invalida cache quando uma ordem é executada/filled
   * @param {string} apiKey - Chave da API
   * @param {string} apiSecret - Secret da API
   * @param {string} symbol - Símbolo da ordem executada
   */
  static onOrderFilled(apiKey, apiSecret, symbol) {
    const cacheKey = OrdersCache.getCacheKey(apiKey, apiSecret);
    OrdersCache.invalidateCache(cacheKey, `ordem executada ${symbol}`);
    Logger.debug(`🗑️ [CACHE_INVALIDATOR] Cache invalidado após execução de ordem ${symbol}`);
  }

  /**
   * Invalida cache em casos de erro de rate limit
   * Garante que próxima tentativa usará dados frescos da API
   * @param {string} apiKey - Chave da API
   * @param {string} apiSecret - Secret da API
   */
  static onRateLimitError(apiKey, apiSecret) {
    const cacheKey = OrdersCache.getCacheKey(apiKey, apiSecret);
    OrdersCache.invalidateCache(cacheKey, 'erro de rate limit');
    Logger.debug(`🗑️ [CACHE_INVALIDATOR] Cache invalidado devido a rate limit error`);
  }

  /**
   * Invalida cache quando posições são fechadas
   * @param {string} apiKey - Chave da API
   * @param {string} apiSecret - Secret da API
   * @param {string} symbol - Símbolo da posição fechada
   */
  static onPositionClosed(apiKey, apiSecret, symbol) {
    const cacheKey = OrdersCache.getCacheKey(apiKey, apiSecret);
    OrdersCache.invalidateCache(cacheKey, `posição fechada ${symbol}`);
    Logger.debug(`🗑️ [CACHE_INVALIDATOR] Cache invalidado após fechamento de posição ${symbol}`);
  }

  /**
   * Invalida todo o cache para uma conta (casos extremos)
   * @param {string} apiKey - Chave da API
   * @param {string} apiSecret - Secret da API
   * @param {string} reason - Motivo da invalidação
   */
  static invalidateAllForAccount(apiKey, apiSecret, reason = 'invalidação manual') {
    const cacheKey = OrdersCache.getCacheKey(apiKey, apiSecret);
    OrdersCache.invalidateCache(cacheKey, reason);
    Logger.info(`🗑️ [CACHE_INVALIDATOR] Todo cache invalidado para conta: ${reason}`);
  }

  /**
   * Invalida cache global (emergência)
   * @param {string} reason - Motivo da invalidação
   */
  static invalidateGlobal(reason = 'invalidação global manual') {
    OrdersCache.invalidateAll(reason);
    Logger.warn(`🚨 [CACHE_INVALIDATOR] Cache global invalidado: ${reason}`);
  }
}

export default CacheInvalidator;
