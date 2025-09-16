import Logger from '../../Utils/Logger.js';
import requestManager from '../../Utils/RequestManager.js';

class Futures {
  constructor() {
    // Cache para posições por bot (chave: apiKey)
    this.positionsCache = new Map();
    this.lastCacheTime = new Map();
    this.cacheDuration = 10000; // 10 segundos - posições não mudam tão rápido
  }
  async getOpenPositions(apiKey = null, apiSecret = null) {
    // OBRIGATÓRIO: Usa credenciais fornecidas
    if (!apiKey || !apiSecret) {
      throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
    }

    const now = Date.now();
    const cacheKey = apiKey; // Cache por apiKey (bot)
    const lastCacheTime = this.lastCacheTime.get(cacheKey) || 0;
    const cacheAge = now - lastCacheTime;

    // Verifica se cache ainda é válido (menos de 10 segundos)
    if (cacheAge < this.cacheDuration && this.positionsCache.has(cacheKey)) {
      Logger.debug(`⚡ [POSITIONS_CACHE] Usando cache (idade: ${Math.round(cacheAge / 1000)}s)`);
      return this.positionsCache.get(cacheKey);
    }

    Logger.debug(
      `🔄 [POSITIONS_FRESH] Cache expirado (${Math.round(cacheAge / 1000)}s) - Buscando posições da API...`
    );

    try {
      // ✅ FIX: Using authenticated request with fresh timestamp generated in RequestManager
      const response = await requestManager.authenticatedGet(
        `${process.env.API_URL}/api/v1/position`,
        { timeout: 15000 },
        {
          instruction: 'positionQuery',
          apiKey: apiKey,
          apiSecret: apiSecret,
        },
        'Get Open Positions',
        'CRITICAL'
      );

      // Salva no cache por 10 segundos
      this.positionsCache.set(cacheKey, response.data);
      this.lastCacheTime.set(cacheKey, now);

      Logger.debug(`💾 [POSITIONS_CACHED] Posições salvas no cache por 10s`);
      return response.data;
    } catch (error) {
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        Logger.warn('⚠️ getOpenPositions - Timeout, tentando novamente em 2s...');
        // Retry após 2 segundos
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          // ✅ FIX: Using authenticated request for retry with fresh timestamp
          const retryResponse = await requestManager.authenticatedGet(
            `${process.env.API_URL}/api/v1/position`,
            { timeout: 20000 }, // Timeout maior na segunda tentativa
            {
              instruction: 'positionQuery',
              apiKey: apiKey,
              apiSecret: apiSecret,
            },
            'Get Open Positions Retry',
            'CRITICAL'
          );

          // Salva no cache por 10 segundos
          this.positionsCache.set(cacheKey, retryResponse.data);
          this.lastCacheTime.set(cacheKey, now);

          Logger.info('✅ getOpenPositions - Retry bem-sucedido e salvo no cache');
          return retryResponse.data;
        } catch (retryError) {
          Logger.error(
            '❌ getOpenPositions - Retry falhou:',
            retryError.response?.data || retryError.message
          );

          // Tenta usar cache antigo como último recurso
          const cachedData = this.positionsCache.get(cacheKey);
          if (cachedData) {
            Logger.warn(`⚠️ [POSITIONS_FALLBACK] Usando cache antigo devido ao timeout`);
            return cachedData;
          }
          return null;
        }
      } else {
        Logger.error('❌ getOpenPositions - ERROR!', error.response?.data || error.message);

        // 🛡️ FALLBACK: Se deu rate limit e temos cache antigo, usa ele
        if (
          error.response?.data?.code === 'TOO_MANY_REQUESTS' ||
          error.message.includes('rate limit')
        ) {
          const cachedData = this.positionsCache.get(cacheKey);
          if (cachedData) {
            Logger.warn(
              `⚠️ [POSITIONS_RATE_LIMIT_FALLBACK] Usando cache antigo devido ao rate limit`
            );
            return cachedData;
          }
        }

        return null;
      }
    }
  }

  /**
   * Limpa o cache de posições (útil após execução de ordens)
   * @param {string} apiKey - API key específica ou null para limpar tudo
   */
  clearPositionsCache(apiKey = null) {
    if (apiKey) {
      this.positionsCache.delete(apiKey);
      this.lastCacheTime.delete(apiKey);
      Logger.debug(`🔄 [POSITIONS_CACHE] Cache limpo para bot específico`);
    } else {
      this.positionsCache.clear();
      this.lastCacheTime.clear();
      Logger.debug(`🔄 [POSITIONS_CACHE] Cache limpo para todos os bots`);
    }
  }

  /**
   * Força atualização das posições (ignora cache)
   */
  async getOpenPositionsForceRefresh(apiKey, apiSecret) {
    this.clearPositionsCache(apiKey);
    return await this.getOpenPositions(apiKey, apiSecret);
  }

  /**
   * Obtém informações sobre o estado do cache de posições
   */
  getPositionsCacheInfo() {
    const now = Date.now();
    const cacheInfo = {
      totalBots: this.positionsCache.size,
      bots: [],
    };

    for (const [apiKey, cachedData] of this.positionsCache.entries()) {
      const lastCacheTime = this.lastCacheTime.get(apiKey) || 0;
      const timeSinceLastCache = now - lastCacheTime;
      const isCacheValid = timeSinceLastCache < this.cacheDuration;

      cacheInfo.bots.push({
        apiKey: apiKey.substring(0, 8) + '...', // Mascarar por segurança
        hasCache: !!cachedData,
        isCacheValid: isCacheValid,
        timeSinceLastCache: timeSinceLastCache,
        cacheDuration: this.cacheDuration,
        remainingTime: Math.max(0, this.cacheDuration - timeSinceLastCache),
        positionsCount: cachedData ? cachedData.length : 0,
      });
    }

    return cacheInfo;
  }
}

export default new Futures();
