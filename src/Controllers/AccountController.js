import Markets from '../Backpack/Public/Markets.js';
import Account from '../Backpack/Authenticated/Account.js';
import Capital from '../Backpack/Authenticated/Capital.js';
import Logger from '../Utils/Logger.js';

class AccountController {
  // Cache por bot (chave: strategyName + apiKey)
  static accountCacheByBot = new Map();
  static lastCacheTimeByBot = new Map();
  static cacheDuration = 10000; // 10 segundos em milissegundos
  static capitalLoggedByBot = new Map(); // Log por bot

  // 🚨 ANTI-RATE-LIMIT: Sistema de debounce global para evitar múltiplas chamadas simultâneas
  static pendingRequests = new Map(); // Requisições em andamento por botKey
  static lastDebounceLog = 0; // Para reduzir spam de logs de debounce
  static lastErrorLog = 0; // Para reduzir spam de logs de erro
  static globalRateLimit = {
    lastApiCall: 0,
    minInterval: 2000, // Mínimo 2 segundos entre chamadas da API por qualquer bot
  };

  static async get(config = null) {
    // SEMPRE usa credenciais do config - lança exceção se não disponível
    if (!config?.apiKey || !config?.apiSecret) {
      throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
    }
    const apiKey = config.apiKey;
    const apiSecret = config.apiSecret;
    const strategy = config?.strategy || config?.strategyName || 'DEFAULT';
    const botKey = `${strategy}_${apiKey}`;
    const symbol = config?.symbol || 'UNKNOWN'; // Para determinar alavancagem específica do token

    // 🎯 CACHE POR RODADA: 1 chamada por minuto para todos os tokens
    // Valida tokens a cada ~1min, todos tokens da mesma rodada usam os mesmos dados

    const now = Date.now();
    const lastCacheTime = AccountController.lastCacheTimeByBot.get(botKey) || 0;
    const cacheAge = now - lastCacheTime;
    const roundCacheDuration = 55000; // 55 segundos - válido para toda rodada de validação

    // Verifica se cache ainda é válido (menos de 55 segundos = mesma rodada)
    if (cacheAge < roundCacheDuration && AccountController.accountCacheByBot.has(botKey)) {
      Logger.debug(
        `⚡ [ACCOUNT_CACHE] ${strategy}: Usando cache da rodada (idade: ${Math.round(cacheAge / 1000)}s)`
      );
      const cachedData = AccountController.accountCacheByBot.get(botKey);

      // Retorna dados da corretora SEM modificar alavancagem - usuário define na corretora
      const cachedDataForToken = { ...cachedData };

      Logger.debug(
        `🔄 [CACHE_REUSE] ${symbol}: Reutilizando dados da rodada (alavancagem: ${cachedData.leverage}x)`
      );
      return cachedDataForToken;
    }

    try {
      // 🚨 ANTI-RATE-LIMIT: Se já existe uma requisição em andamento para este bot, aguarda
      if (AccountController.pendingRequests.has(botKey)) {
        // Reduz spam de logs - só exibe a primeira vez e depois a cada 10 segundos
        const lastDebounceLog = AccountController.lastDebounceLog || 0;
        const now = Date.now();
        if (now - lastDebounceLog > 20000) {
          // 20 segundos para reduzir ainda mais o spam
          const symbolInfo = symbol && symbol !== 'UNKNOWN' ? symbol : 'MÚLTIPLOS_TOKENS';
          Logger.debug(
            `⚡ [CACHE_WAIT] ${strategy}: Reutilizando dados da conta em cache (sistema otimizado)`
          );
          AccountController.lastDebounceLog = now;
        }
        const pendingPromise = AccountController.pendingRequests.get(botKey);
        return await pendingPromise;
      }

      // 🚨 RATE-LIMIT GLOBAL: Garante mínimo 2s entre chamadas de API de qualquer bot
      const now = Date.now();
      const timeSinceLastGlobalCall = now - AccountController.globalRateLimit.lastApiCall;
      if (timeSinceLastGlobalCall < AccountController.globalRateLimit.minInterval) {
        const waitTime = AccountController.globalRateLimit.minInterval - timeSinceLastGlobalCall;
        Logger.warn(
          `⏱️ [GLOBAL_RATE_LIMIT] ${strategy}: Aguardando ${Math.round(waitTime / 1000)}s para evitar rate limit...`
        );
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // ✅ NOVA RODADA: Busca dados da exchange quando inicia nova rodada (55+ segundos)
      const refreshPromise = AccountController._performAccountRefresh(
        config,
        botKey,
        strategy,
        cacheAge
      );
      AccountController.pendingRequests.set(botKey, refreshPromise);

      try {
        const result = await refreshPromise;
        return result;
      } finally {
        AccountController.pendingRequests.delete(botKey);
      }
    } catch (error) {
      // Reduz spam de logs de erro - só exibe a cada 30 segundos
      const now = Date.now();
      const timeSinceLastError = now - AccountController.lastErrorLog;
      if (timeSinceLastError > 30000) {
        // 30 segundos
        if (error.message.includes('rate limit') || error.message.includes('TOO_MANY_REQUESTS')) {
          Logger.warn(
            `⏱️ [API_RATE_LIMIT] ${strategy}: Rate limit temporário - usando cache quando disponível`
          );
        } else if (error.message.includes('expired')) {
          Logger.warn(
            `⏰ [API_TIMEOUT] ${strategy}: Request expirado - reconectando automaticamente`
          );
        } else {
          Logger.warn(`⚠️ [API_ERROR] ${strategy}: Erro temporário na API - tentando novamente`);
        }
        AccountController.lastErrorLog = now;
      }

      // 🛡️ FALLBACK: Se deu erro, tenta usar cache antigo (até 5 minutos)
      if (
        error.message.includes('rate limit') ||
        error.message.includes('TOO_MANY_REQUESTS') ||
        error.message.includes('expired') ||
        error.message.includes('timeout')
      ) {
        const cachedData = AccountController.accountCacheByBot.get(botKey);
        const lastCacheTime = AccountController.lastCacheTimeByBot.get(botKey) || 0;
        const cacheAge = Date.now() - lastCacheTime;
        const extendedCacheLimit = 300000; // 5 minutos para emergências

        if (cachedData && cacheAge < extendedCacheLimit) {
          Logger.debug(
            `⚡ [EMERGENCY_CACHE] ${strategy}: Usando cache antigo (${Math.round(cacheAge / 1000)}s) durante erro da API`
          );
          return { ...cachedData };
        }
      }

      return null;
    }
  }

  /**
   * 🚨 ANTI-RATE-LIMIT: Função privada que faz o refresh real da conta
   * Inclui rate limiting global e logs detalhados
   */
  static async _performAccountRefresh(config, botKey, strategy, cacheAge) {
    const { apiKey, apiSecret } = config;

    Logger.info(
      `🔄 [ACCOUNT_FRESH] ${strategy}: Nova rodada iniciada (${Math.round(cacheAge / 1000)}s) - Buscando dados para TODOS os tokens...`
    );

    // 🚨 ATUALIZA TIMESTAMP GLOBAL para rate limiting
    AccountController.globalRateLimit.lastApiCall = Date.now();

    const Accounts = await Account.getAccount(strategy, apiKey, apiSecret);
    const Collateral = await Capital.getCollateral(strategy, apiKey, apiSecret);

    // ✅ FALHA SEGURA: Se não conseguir dados da conta, PARA a operação
    if (!Accounts || !Collateral) {
      Logger.warn(
        '⚠️ [ACCOUNT_API] Dados da conta temporariamente indisponíveis - aguardando próxima tentativa'
      );
      throw new Error('Dados da conta temporariamente indisponíveis - tentando novamente em breve');
    }

    const marketsInstance = new Markets();
    let markets = await marketsInstance.getMarkets();
    if (!markets) {
      Logger.error(
        '❌ AccountController._performAccountRefresh - Markets.getMarkets() retornou null. API pode estar offline.'
      );
      return null;
    }

    // Usa authorizedTokens do config se disponível, senão usa variável de ambiente
    const authorizedTokens = config?.authorizedTokens || [];

    markets = markets
      .filter(
        el =>
          el.marketType === 'PERP' &&
          el.orderBookState === 'Open' &&
          (authorizedTokens.length === 0 || authorizedTokens.includes(el.symbol))
      )
      .map(el => {
        const decimal_quantity = String(el.filters.quantity.stepSize).includes('.')
          ? String(el.filters.quantity.stepSize.split('.')[1]).length
          : 0;

        // Calcula decimal_price baseado no tickSize, mas limita a um máximo de 6 casas decimais
        let decimal_price = String(el.filters.price.tickSize).includes('.')
          ? String(el.filters.price.tickSize.split('.')[1]).length
          : 0;

        // Limita o decimal_price para evitar erro "Price decimal too long"
        if (decimal_price > 6) {
          Logger.warn(
            `⚠️ [ACCOUNT] ${el.symbol}: decimal_price muito alto (${decimal_price}), limitando a 6 casas decimais`
          );
          decimal_price = 6;
        }

        return {
          symbol: el.symbol,
          decimal_quantity: decimal_quantity,
          decimal_price: decimal_price,
          stepSize_quantity: Number(el.filters.quantity.stepSize),
          tickSize: Number(el.filters.price.tickSize),
        };
      });

    const makerFee = parseFloat(Accounts.futuresMakerFee) / 10000;
    const leverage = parseInt(Accounts.leverageLimit); // Alavancagem definida pelo usuário na corretora
    const netEquityAvailable = parseFloat(Collateral.netEquityAvailable);

    // 💡 USANDO ALAVANCAGEM DA CORRETORA: Usuário define a alavancagem que quer usar
    // Respeitamos a configuração do usuário sem impor limites arbitrários
    const marginSafety = 0.95; // 95% como margem de segurança
    const realCapital = netEquityAvailable * marginSafety; // Capital real para controle de risco
    const capitalAvailable = realCapital * leverage; // Capital para cálculo usando alavancagem do usuário

    // 🔍 LOG DETALHADO DO CÁLCULO
    Logger.debug(`📊 [ACCOUNT_CALC] Dados da rodada para TODOS os tokens:`);
    Logger.debug(`   • netEquityAvailable (API): $${netEquityAvailable.toFixed(2)}`);
    Logger.debug(`   • marginSafety: ${marginSafety}`);
    Logger.debug(`   • leverage (definida pelo usuário): ${leverage}x`);
    Logger.debug(
      `   • realCapital = $${netEquityAvailable.toFixed(2)} × ${marginSafety} = $${realCapital.toFixed(2)}`
    );
    Logger.debug(
      `   • capitalAvailable = $${realCapital.toFixed(2)} × ${leverage}x = $${capitalAvailable.toFixed(2)}`
    );

    // Log explicativo do cálculo do capital (apenas na primeira vez para este bot)
    if (!AccountController.capitalLoggedByBot.get(botKey)) {
      Logger.info(`\n📊 [${strategy}] NOVA RODADA - DADOS PARA TODOS OS TOKENS:
   • Patrimônio Líquido Disponível: $${netEquityAvailable.toFixed(2)}
   • Margem de segurança: ${(marginSafety * 100).toFixed(0)}%
   • Capital real (controle de risco): $${realCapital.toFixed(2)}
   • Alavancagem (definida pelo usuário): ${leverage}x
   • Capital para cálculo de posição: $${realCapital.toFixed(2)} × ${leverage}x = $${capitalAvailable.toFixed(2)}`);
      Logger.info(`   💡 Estes dados serão reutilizados por TODOS os tokens desta rodada (55s)`);
      Logger.info(
        `   💡 Initial Margin será deduzido do capital real ($${realCapital.toFixed(2)})`
      );
      AccountController.capitalLoggedByBot.set(botKey, true);
    }

    // Usa configuração passada como parâmetro (prioridade) ou fallback para variável de ambiente
    const maxOpenOrders = config?.maxOpenOrders || 5;
    const minVolumeDollar = capitalAvailable / maxOpenOrders;

    const obj = {
      maxOpenOrders,
      minVolumeDollar,
      fee: makerFee,
      leverage, // Alavancagem definida pelo usuário na corretora
      capitalAvailable, // Capital para cálculo de posição
      realCapital, // Capital real para controle de risco
      markets,
    };

    // 💾 SALVA CACHE por 55 segundos - 1 chamada por rodada para TODOS os tokens
    const now = Date.now();
    AccountController.accountCacheByBot.set(botKey, obj);
    AccountController.lastCacheTimeByBot.set(botKey, now);

    Logger.info(
      `✅ [ACCOUNT_CACHED] RODADA: Capital real: $${realCapital.toFixed(2)}, Capital p/ posição: $${capitalAvailable.toFixed(2)} (${leverage}x) - Cache para próximos 55s`
    );

    return obj;
  }

  static async getallMarkets(ignore) {
    const marketsInstance = new Markets();
    let markets = await marketsInstance.getMarkets((ignore = []));

    markets = markets
      .filter(
        el =>
          el.marketType === 'PERP' &&
          el.orderBookState === 'Open' &&
          (ignore.length === 0 || !ignore.includes(el.symbol))
      )
      .map(el => {
        const decimal_quantity = String(el.filters.quantity.stepSize).includes('.')
          ? String(el.filters.quantity.stepSize.split('.')[1]).length
          : 0;

        // Calcula decimal_price baseado no tickSize, mas limita a um máximo de 6 casas decimais
        let decimal_price = String(el.filters.price.tickSize).includes('.')
          ? String(el.filters.price.tickSize.split('.')[1]).length
          : 0;

        // Limita o decimal_price para evitar erro "Price decimal too long"
        if (decimal_price > 6) {
          Logger.warn(
            `⚠️ [ACCOUNT] ${el.symbol}: decimal_price muito alto (${decimal_price}), limitando a 6 casas decimais`
          );
          decimal_price = 6;
        }

        return {
          symbol: el.symbol,
          decimal_quantity: decimal_quantity,
          decimal_price: decimal_price,
          stepSize_quantity: Number(el.filters.quantity.stepSize),
          tickSize: Number(el.filters.price.tickSize),
        };
      });

    return markets;
  }

  /**
   * Reseta os logs para permitir nova exibição
   */
  static resetLogs() {
    AccountController.capitalLoggedByBot.clear();
  }

  /**
   * Limpa o cache forçando uma nova busca de dados
   */
  static clearCache() {
    AccountController.accountCacheByBot.clear();
    AccountController.lastCacheTimeByBot.clear();
    AccountController.pendingRequests.clear();
    AccountController.globalRateLimit.lastApiCall = 0;
    Logger.info(
      `🔄 [ACCOUNT] Cache e rate limit limpos para todos os bots - próxima chamada buscará dados frescos`
    );
  }

  /**
   * Força atualização imediata dos dados da conta (ignora cache)
   * Usar apenas em casos críticos como após execução de ordens
   */
  static async getForceRefresh(config = null) {
    // Limpa cache específico do bot
    const strategy = config?.strategy;
    const apiKey = config?.apiKey;
    if (strategy && apiKey) {
      const botKey = `${strategy}_${apiKey}`;
      AccountController.accountCacheByBot.delete(botKey);
      AccountController.lastCacheTimeByBot.delete(botKey);
      Logger.debug(`🔄 [ACCOUNT_FORCE] Forçando atualização para ${strategy}`);
    }

    // Chama método normal que agora buscará dados frescos
    return await AccountController.get(config);
  }

  /**
   * Limpa o cache de um bot específico
   */
  static clearCacheForBot(strategyName, apiKey) {
    const botKey = `${strategyName}_${apiKey}`;
    AccountController.accountCacheByBot.delete(botKey);
    AccountController.lastCacheTimeByBot.delete(botKey);
    AccountController.capitalLoggedByBot.delete(botKey);
    AccountController.pendingRequests.delete(botKey);
    Logger.info(
      `🔄 [ACCOUNT] Cache limpo para bot ${strategyName} - próxima chamada buscará dados frescos`
    );
  }

  /**
   * Obtém informações sobre o estado do cache
   */
  static getCacheInfo() {
    const now = Date.now();
    const cacheInfo = {
      totalBots: AccountController.accountCacheByBot.size,
      bots: [],
    };

    for (const [botKey, cachedData] of AccountController.accountCacheByBot.entries()) {
      const lastCacheTime = AccountController.lastCacheTimeByBot.get(botKey) || 0;
      const timeSinceLastCache = now - lastCacheTime;
      const isCacheValid = timeSinceLastCache < AccountController.cacheDuration;

      cacheInfo.bots.push({
        botKey,
        hasCache: !!cachedData,
        isCacheValid: isCacheValid,
        timeSinceLastCache: timeSinceLastCache,
        cacheDuration: AccountController.cacheDuration,
        remainingTime: Math.max(0, AccountController.cacheDuration - timeSinceLastCache),
      });
    }

    return cacheInfo;
  }
}

export default AccountController;
