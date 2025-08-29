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

  static async get(config = null) {
    // SEMPRE usa credenciais do config - lança exceção se não disponível
    if (!config?.apiKey || !config?.apiSecret) {
      throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
    }
    const apiKey = config.apiKey;
    const apiSecret = config.apiSecret;
    const strategy = config?.strategy;
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
      // ✅ NOVA RODADA: Busca dados da exchange quando inicia nova rodada (55+ segundos)
      Logger.info(
        `🔄 [ACCOUNT_FRESH] ${strategy}: Nova rodada iniciada (${Math.round(cacheAge / 1000)}s) - Buscando dados para TODOS os tokens...`
      );

      const Accounts = await Account.getAccount(strategy, apiKey, apiSecret);
      const Collateral = await Capital.getCollateral(strategy, apiKey, apiSecret);

      // ✅ FALHA SEGURA: Se não conseguir dados da conta, PARA a operação
      if (!Accounts || !Collateral) {
        const errorMsg = '❌ DADOS DE CONTA INDISPONÍVEIS - Operação BLOQUEADA para evitar perdas';
        Logger.error(errorMsg);
        throw new Error(
          'Dados críticos da conta não disponíveis - operação abortada por segurança'
        );
      }

      const marketsInstance = new Markets();
      let markets = await marketsInstance.getMarkets();
      if (!markets) {
        Logger.error(
          '❌ AccountController.get - Markets.getMarkets() retornou null. API pode estar offline.'
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
      AccountController.accountCacheByBot.set(botKey, obj);
      AccountController.lastCacheTimeByBot.set(botKey, now);

      Logger.info(
        `✅ [ACCOUNT_CACHED] RODADA: Capital real: $${realCapital.toFixed(2)}, Capital p/ posição: $${capitalAvailable.toFixed(2)} (${leverage}x) - Cache para próximos 55s`
      );

      return obj;
    } catch (error) {
      Logger.error('❌ AccountController.get - Error:', error.message);

      // 🛡️ FALLBACK: Se deu erro (possivelmente rate limit) e temos cache antigo, usa ele
      if (error.message.includes('rate limit') || error.message.includes('TOO_MANY_REQUESTS')) {
        const cachedData = AccountController.accountCacheByBot.get(botKey);
        if (cachedData) {
          Logger.warn(
            `⚠️ [RATE_LIMIT_FALLBACK] ${strategy}: Usando cache da rodada anterior devido ao rate limit`
          );
          return { ...cachedData }; // Retorna dados da corretora sem modificações
        }
      }

      return null;
    }
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
    Logger.info(
      `🔄 [ACCOUNT] Cache limpo para todos os bots - próxima chamada buscará dados frescos`
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
