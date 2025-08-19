import Markets from '../Backpack/Public/Markets.js'
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
    
    const now = Date.now();
    
    // SEMPRE usa credenciais do config - lança exceção se não disponível
    if (!config?.apiKey || !config?.apiSecret) {
      throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
    }
    const apiKey = config.apiKey;
    const apiSecret = config.apiSecret;
    const strategy = config?.strategy;
    const botKey = `${strategy}_${apiKey}`;
    
    // 1. VERIFICA O CACHE PARA ESTE BOT ESPECÍFICO
    const cachedData = AccountController.accountCacheByBot.get(botKey);
    const lastCacheTime = AccountController.lastCacheTimeByBot.get(botKey) || 0;
    
    if (cachedData && (now - lastCacheTime < AccountController.cacheDuration)) {
      // Retorna os dados do cache silenciosamente para este bot
      return cachedData;
    }
    
    try {
    
    // 2. LÓGICA EXISTENTE (SE O CACHE FOR INVÁLIDO)
    // Determina a estratégia baseada na configuração ou variável de ambiente
    const strategy = config?.strategy;
    
    // SEMPRE usa credenciais do config - lança exceção se não disponível
    if (!config?.apiKey || !config?.apiSecret) {
      throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
    }
    const apiKey = config.apiKey;
    const apiSecret = config.apiSecret;
    
    const Accounts = await Account.getAccount(strategy, apiKey, apiSecret)
    const Collateral = await Capital.getCollateral(strategy, apiKey, apiSecret)

    // Verifica se os dados da conta foram obtidos com sucesso
    if (!Accounts || !Collateral) {
      Logger.error('❌ Falha ao obter dados da conta. Verifique suas credenciais de API.');
      return null;
    }

    const marketsInstance = new Markets();
    let markets = await marketsInstance.getMarkets();
    if (!markets) {
      Logger.error('❌ AccountController.get - Markets.getMarkets() retornou null. API pode estar offline.');
      return null;
    }

    // Usa authorizedTokens do config se disponível, senão usa variável de ambiente
    const authorizedTokens = config?.authorizedTokens || []

    markets = markets.filter((el) => 
        el.marketType === "PERP" && 
        el.orderBookState === "Open" && 
        (authorizedTokens.length === 0 || authorizedTokens.includes(el.symbol))).map((el) => {
        
        const decimal_quantity = String(el.filters.quantity.stepSize).includes(".") ? String(el.filters.quantity.stepSize.split(".")[1]).length : 0
        
        // Calcula decimal_price baseado no tickSize, mas limita a um máximo de 6 casas decimais
        let decimal_price = String(el.filters.price.tickSize).includes(".") ? String(el.filters.price.tickSize.split(".")[1]).length : 0;
        
        // Limita o decimal_price para evitar erro "Price decimal too long"
        if (decimal_price > 6) {
          Logger.warn(`⚠️ [ACCOUNT] ${el.symbol}: decimal_price muito alto (${decimal_price}), limitando a 6 casas decimais`);
          decimal_price = 6;
        }
        
        return {
            symbol: el.symbol,
            decimal_quantity: decimal_quantity,
            decimal_price: decimal_price,
            stepSize_quantity: Number(el.filters.quantity.stepSize),
            tickSize: Number(el.filters.price.tickSize)
        }
    })

    const makerFee = parseFloat(Accounts.futuresMakerFee) / 10000
    const leverage = parseInt(Accounts.leverageLimit)
    const netEquityAvailable = parseFloat(Collateral.netEquityAvailable)
    const capitalAvailable = netEquityAvailable * leverage * 0.95
    
    // Log explicativo do cálculo do capital (apenas na primeira vez para este bot)
    if (!AccountController.capitalLoggedByBot.get(botKey)) {
      Logger.info(`\n📊 [${strategy}] CÁLCULO DO CAPITAL:
   • Patrimônio Líquido Disponível: $${netEquityAvailable.toFixed(2)}
   • Alavancagem: ${leverage}x
   • Margem de segurança: 95%
   • Capital disponível: $${netEquityAvailable.toFixed(2)} × ${leverage} × 0.95 = $${capitalAvailable.toFixed(2)}`);
      AccountController.capitalLoggedByBot.set(botKey, true);
    }
    
    // Usa configuração passada como parâmetro (prioridade) ou fallback para variável de ambiente
    const maxOpenOrders = config?.maxOpenOrders || 5
    const minVolumeDollar = capitalAvailable / maxOpenOrders

    const obj = {
        maxOpenOrders,
        minVolumeDollar,
        fee:makerFee,
        leverage:leverage,
        capitalAvailable,
        markets
    }

    // 3. SALVA NO CACHE PARA ESTE BOT ESPECÍFICO
    AccountController.accountCacheByBot.set(botKey, obj);
    AccountController.lastCacheTimeByBot.set(botKey, now);
    
    return obj

    } catch (error) {
      Logger.error('❌ AccountController.get - Error:', error.message)
      return null 
    }

  }

  static async getallMarkets(ignore) {
    const marketsInstance = new Markets();
    let markets = await marketsInstance.getMarkets(ignore = [])

      markets = markets.filter((el) => 
          el.marketType === "PERP" && 
          el.orderBookState === "Open" && 
          (ignore.length === 0 || !ignore.includes(el.symbol))).map((el) => {
          
          const decimal_quantity = String(el.filters.quantity.stepSize).includes(".") ? String(el.filters.quantity.stepSize.split(".")[1]).length : 0
          
          // Calcula decimal_price baseado no tickSize, mas limita a um máximo de 6 casas decimais
          let decimal_price = String(el.filters.price.tickSize).includes(".") ? String(el.filters.price.tickSize.split(".")[1]).length : 0;
          
          // Limita o decimal_price para evitar erro "Price decimal too long"
          if (decimal_price > 6) {
            Logger.warn(`⚠️ [ACCOUNT] ${el.symbol}: decimal_price muito alto (${decimal_price}), limitando a 6 casas decimais`);
            decimal_price = 6;
          }
          
          return {
              symbol: el.symbol,
              decimal_quantity: decimal_quantity,
              decimal_price: decimal_price,
              stepSize_quantity: Number(el.filters.quantity.stepSize),
              tickSize: Number(el.filters.price.tickSize)
          }
      })
    
    return markets
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
    Logger.info(`🔄 [ACCOUNT] Cache limpo para todos os bots - próxima chamada buscará dados frescos`);
  }

  /**
   * Limpa o cache de um bot específico
   */
  static clearCacheForBot(strategyName, apiKey) {
    const botKey = `${strategyName}_${apiKey}`;
    AccountController.accountCacheByBot.delete(botKey);
    AccountController.lastCacheTimeByBot.delete(botKey);
    AccountController.capitalLoggedByBot.delete(botKey);
    Logger.info(`🔄 [ACCOUNT] Cache limpo para bot ${strategyName} - próxima chamada buscará dados frescos`);
  }

  /**
   * Obtém informações sobre o estado do cache
   */
  static getCacheInfo() {
    const now = Date.now();
    const cacheInfo = {
      totalBots: AccountController.accountCacheByBot.size,
      bots: []
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
        remainingTime: Math.max(0, AccountController.cacheDuration - timeSinceLastCache)
      });
    }
    
    return cacheInfo;
  }

}

export default AccountController;


