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

    // ⚠️ CACHE REMOVIDO: Dados de conta devem SEMPRE ser atualizados da exchange
    // Cache pode causar cálculos incorretos de position size e perdas financeiras

    try {
      // ✅ SEMPRE busca dados FRESCOS da exchange - CRÍTICO para position sizing correto
      Logger.info(`🔄 [ACCOUNT_FRESH] ${strategy}: Buscando dados atualizados da exchange...`);

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
      const apiLeverage = parseInt(Accounts.leverageLimit); // Alavancagem vinda da API (sempre 25x)
      const netEquityAvailable = parseFloat(Collateral.netEquityAvailable);

      // 🎯 CORREÇÃO CRÍTICA: Usa alavancagem da corretora com regras específicas
      // BTC, SOL, ETH: Usa alavancagem definida pela corretora
      // Outros tokens: Usa alavancagem da corretora, mas limita a máximo 10x
      const highLeverageTokens = ['BTC', 'SOL', 'ETH', 'BTCUSDC', 'SOLUSDC', 'ETHUSDC'];
      const isHighLeverageToken = highLeverageTokens.some(token => symbol.includes(token));

      let actualLeverage;
      if (isHighLeverageToken) {
        // Para BTC/SOL/ETH: usa alavancagem da corretora (normalmente 25x)
        actualLeverage = apiLeverage;
      } else {
        // Para outros tokens: usa alavancagem da corretora, mas limita a 10x máximo
        actualLeverage = Math.min(apiLeverage, 10);
      }

      const marginSafety = 0.95; // 95% como margem de segurança
      const realCapital = netEquityAvailable * marginSafety; // Capital real para controle de risco
      const capitalAvailable = realCapital * actualLeverage; // Capital para cálculo de posição (alavancagem CORRETA do token)

      // 🔍 LOG DETALHADO DO CÁLCULO
      Logger.debug(`📊 [ACCOUNT_CALC] ${symbol}: Cálculo de capital:`);
      Logger.debug(`   • netEquityAvailable (API): $${netEquityAvailable.toFixed(2)}`);
      Logger.debug(`   • marginSafety: ${marginSafety}`);
      Logger.debug(`   • apiLeverage (da corretora): ${apiLeverage}x`);
      Logger.debug(`   • isHighLeverageToken: ${isHighLeverageToken}`);
      Logger.debug(`   • actualLeverage (aplicada): ${actualLeverage}x`);
      Logger.debug(
        `   • realCapital = $${netEquityAvailable.toFixed(2)} × ${marginSafety} = $${realCapital.toFixed(2)}`
      );
      Logger.debug(
        `   • capitalAvailable = $${realCapital.toFixed(2)} × ${actualLeverage}x = $${capitalAvailable.toFixed(2)}`
      );

      // Log explicativo do cálculo do capital (apenas na primeira vez para este bot)
      if (!AccountController.capitalLoggedByBot.get(botKey)) {
        Logger.info(`\n📊 [${strategy}] CÁLCULO DO CAPITAL (${symbol}):
   • Patrimônio Líquido Disponível: $${netEquityAvailable.toFixed(2)}
   • Margem de segurança: ${(marginSafety * 100).toFixed(0)}%
   • Capital real (controle de risco): $${realCapital.toFixed(2)}
   • Alavancagem da corretora: ${apiLeverage}x
   • Alavancagem aplicada: ${actualLeverage}x ${isHighLeverageToken ? '(sem limite)' : '(máx. 10x)'}
   • Capital para cálculo de posição: $${realCapital.toFixed(2)} × ${actualLeverage}x = $${capitalAvailable.toFixed(2)}`);
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
        leverage: actualLeverage, // Alavancagem específica do token
        capitalAvailable, // Capital para cálculo de posição (com alavancagem correta)
        realCapital, // Capital real para controle de risco (sem alavancagem)
        markets,
      };

      // ✅ NÃO SALVA CACHE - Dados de conta devem sempre ser frescos
      Logger.debug(
        `✅ [ACCOUNT_FRESH] ${symbol}: Capital real: $${realCapital.toFixed(2)}, Capital p/ posição: $${capitalAvailable.toFixed(2)} (${actualLeverage}x)`
      );

      return obj;
    } catch (error) {
      Logger.error('❌ AccountController.get - Error:', error.message);
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
