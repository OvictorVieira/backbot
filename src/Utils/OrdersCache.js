/**
 * Cache inteligente para ordens da exchange
 * Reduz chamadas getOpenOrders() para evitar rate limiting
 */

import Logger from './Logger.js';

class OrdersCache {
  constructor() {
    this.cache = new Map(); // { apiKey: { data: [], timestamp: number, symbols: Set } }
    this.cacheTimeout = 45000; // 45 segundos - balance entre fresh data e rate limit
    this.maxCacheEntries = 10; // Máximo 10 contas em cache
  }

  /**
   * Gera chave de cache baseada nas credenciais
   * @param {string} apiKey - Chave da API
   * @param {string} apiSecret - Secret da API
   * @returns {string} Chave única para cache
   */
  getCacheKey(apiKey, apiSecret) {
    // Usa apenas primeiros 8 chars do apiKey para identificar conta
    const keyPrefix = apiKey ? apiKey.substring(0, 8) : 'unknown';
    const secretHash = apiSecret ? apiSecret.substring(0, 4) : 'none';
    return `${keyPrefix}_${secretHash}`;
  }

  /**
   * Verifica se cache está válido
   * @param {string} cacheKey - Chave do cache
   * @returns {boolean} True se cache está válido
   */
  isCacheValid(cacheKey) {
    const cached = this.cache.get(cacheKey);
    if (!cached) return false;

    const now = Date.now();
    const isValid = now - cached.timestamp < this.cacheTimeout;

    if (!isValid) {
      Logger.debug(
        `🧹 [ORDERS_CACHE] Cache expirado para ${cacheKey} (${Math.floor((now - cached.timestamp) / 1000)}s)`
      );
    }

    return isValid;
  }

  /**
   * Armazena ordens no cache
   * @param {string} cacheKey - Chave do cache
   * @param {Array} orders - Lista de ordens
   * @param {string} symbol - Símbolo específico (opcional)
   */
  setCache(cacheKey, orders, symbol = null) {
    // Limpa cache antigo se atingir limite
    if (this.cache.size >= this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      Logger.debug(`🧹 [ORDERS_CACHE] Cache limite atingido, removido ${oldestKey}`);
    }

    const now = Date.now();
    let cached = this.cache.get(cacheKey);

    if (!cached) {
      cached = {
        data: [],
        timestamp: now,
        symbols: new Set(),
      };
    }

    if (symbol) {
      // Cache para símbolo específico - merge com dados existentes
      const symbolOrders = orders || [];
      // Remove ordens antigas deste símbolo
      cached.data = cached.data.filter(order => order.symbol !== symbol);
      // Adiciona ordens novas deste símbolo
      cached.data.push(...symbolOrders);
      cached.symbols.add(symbol);

      Logger.debug(
        `📥 [ORDERS_CACHE] Cache atualizado para ${cacheKey} símbolo ${symbol}: ${symbolOrders.length} ordens`
      );
    } else {
      // Cache para todas as ordens - substitui tudo
      cached.data = orders || [];
      cached.timestamp = now;
      cached.symbols.clear();

      Logger.debug(
        `📥 [ORDERS_CACHE] Cache completo atualizado para ${cacheKey}: ${cached.data.length} ordens`
      );
    }

    this.cache.set(cacheKey, cached);
  }

  /**
   * Recupera ordens do cache
   * @param {string} cacheKey - Chave do cache
   * @param {string} symbol - Símbolo específico (opcional)
   * @param {boolean} bypassCache - Se true, sempre retorna null para forçar nova consulta
   * @returns {Array|null} Lista de ordens ou null se não cached
   */
  getCache(cacheKey, symbol = null, bypassCache = false) {
    if (bypassCache) {
      Logger.debug(
        `⚡ [ORDERS_CACHE] Cache bypass solicitado para ${cacheKey}${symbol ? ` símbolo ${symbol}` : ''}`
      );
      return null;
    }

    if (!this.isCacheValid(cacheKey)) {
      return null;
    }

    const cached = this.cache.get(cacheKey);
    if (!cached || !cached.data) {
      return null;
    }

    if (symbol) {
      // Filtra ordens por símbolo
      const symbolOrders = cached.data.filter(order => order.symbol === symbol);
      Logger.debug(
        `📤 [ORDERS_CACHE] Cache hit para ${cacheKey} símbolo ${symbol}: ${symbolOrders.length} ordens`
      );
      return symbolOrders;
    } else {
      // Retorna todas as ordens
      Logger.debug(
        `📤 [ORDERS_CACHE] Cache hit completo para ${cacheKey}: ${cached.data.length} ordens`
      );
      return cached.data;
    }
  }

  /**
   * Invalida cache para uma conta específica
   * @param {string} cacheKey - Chave do cache
   * @param {string} reason - Motivo da invalidação (para logs)
   */
  invalidateCache(cacheKey, reason = 'manual') {
    if (this.cache.has(cacheKey)) {
      this.cache.delete(cacheKey);
      Logger.debug(`🗑️ [ORDERS_CACHE] Cache invalidado para ${cacheKey}: ${reason}`);
    }
  }

  /**
   * Invalida todo o cache
   * @param {string} reason - Motivo da invalidação
   */
  invalidateAll(reason = 'manual') {
    const count = this.cache.size;
    this.cache.clear();
    Logger.debug(`🗑️ [ORDERS_CACHE] Todo cache invalidado (${count} entradas): ${reason}`);
  }

  /**
   * Obtém estatísticas do cache
   * @returns {object} Estatísticas do cache
   */
  getStats() {
    const stats = {
      totalEntries: this.cache.size,
      cacheTimeout: this.cacheTimeout,
      maxEntries: this.maxCacheEntries,
      entries: [],
    };

    // 🔒 VALIDAÇÃO DE ITERATOR: Garante que cache.entries é iterável
    if (
      !this.cache ||
      !this.cache.entries ||
      !this.cache.entries()[Symbol.iterator] ||
      typeof this.cache.entries()[Symbol.iterator] !== 'function'
    ) {
      Logger.error(`❌ [ORDERS_CACHE] cache.entries não tem iterator válido`);
      return stats;
    }

    for (const [key, cached] of this.cache.entries()) {
      const age = Date.now() - cached.timestamp;
      const isValid = age < this.cacheTimeout;

      stats.entries.push({
        key,
        ordersCount: cached.data.length,
        symbols: Array.from(cached.symbols),
        ageSeconds: Math.floor(age / 1000),
        isValid,
      });
    }

    return stats;
  }

  /**
   * Limpa cache expirado
   */
  cleanup() {
    let cleaned = 0;

    // 🔒 VALIDAÇÃO DE ITERATOR: Garante que cache.entries é iterável
    if (
      !this.cache ||
      !this.cache.entries ||
      !this.cache.entries()[Symbol.iterator] ||
      typeof this.cache.entries()[Symbol.iterator] !== 'function'
    ) {
      Logger.error(`❌ [ORDERS_CACHE] cleanup: cache.entries não tem iterator válido`);
      return cleaned;
    }

    for (const [key, cached] of this.cache.entries()) {
      const age = Date.now() - cached.timestamp;
      if (age >= this.cacheTimeout) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      Logger.debug(`🧹 [ORDERS_CACHE] Limpeza automática: ${cleaned} caches expirados removidos`);
    }
  }
}

// Instância singleton
const ordersCache = new OrdersCache();

// Limpeza automática a cada 2 minutos
setInterval(() => {
  ordersCache.cleanup();
}, 120000);

export default ordersCache;
