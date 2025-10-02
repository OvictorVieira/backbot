// 🔧 MIGRAÇÃO PARA EXCHANGE FACTORY
import ExchangeManager from '../Exchange/ExchangeManager.js';
import Futures from '../Backpack/Authenticated/Futures.js';
import Order from '../Backpack/Authenticated/Order.js';
import OrderController from '../Controllers/OrderController.js';
import AccountController from '../Controllers/AccountController.js';
import Account from '../Backpack/Authenticated/Account.js';
import Markets from '../Backpack/Public/Markets.js';
import { calculateIndicators } from './Indicators.js';
import { StrategyFactory } from './Strategies/StrategyFactory.js';
import Logger from '../Utils/Logger.js';
import RiskManager from '../Risk/RiskManager.js';
import PositionMonitorService from '../Services/PositionMonitorService.js';
import TrailingStop from '../TrailingStop/TrailingStop.js';

class Decision {
  constructor(strategyType = null) {
    if (!strategyType) {
      throw new Error(
        '❌ Estratégia deve ser definida via parâmetro. Use o terminal para selecionar a estratégia.'
      );
    }

    Logger.debug(`🔍 Decision: Estratégia definida via terminal: "${strategyType}"`);

    this.strategy = StrategyFactory.createStrategy(strategyType);

    Logger.info(`🤖 Estratégia carregada: ${strategyType.toUpperCase()}`);

    // Cache simples para dados de mercado
    this.marketCache = new Map();
    this.cacheTimeout = 10000; // 10 segundos - garante que dados sejam atualizados a cada análise

    // 🔧 MIGRAÇÃO: Cache para ExchangeManager instances
    this.exchangeManagerCache = new Map();
  }

  /**
   * 🔧 MIGRAÇÃO: Helper method para obter ExchangeManager com cache
   * Similar ao padrão usado no OrderController
   */
  getExchangeManager(config) {
    const exchangeName = config?.exchangeName || config?.exchange || 'backpack';
    const cacheKey = `${exchangeName}_${config?.apiKey || 'default'}`;

    if (!this.exchangeManagerCache.has(cacheKey)) {
      const exchangeManager = ExchangeManager.createFromConfig(config);
      this.exchangeManagerCache.set(cacheKey, exchangeManager);
      Logger.debug(`✅ [Decision] ExchangeManager criado para ${exchangeName}`);
    }

    return this.exchangeManagerCache.get(cacheKey);
  }

  async getDataset(Account, closed_markets, timeframe = null, logger = null, config = null) {
    const dataset = [];

    // Usa o timeframe passado como parâmetro ou fallback para configuração da conta
    let currentTimeframe = timeframe;

    if (!currentTimeframe) {
      // Determina a estratégia atual para usar a configuração correta
      const strategyName = this.strategy.constructor.name;

      if (strategyName === 'ProMaxStrategy') {
        // Estratégia PRO_MAX usa configuração específica
        currentTimeframe = config?.time || '5m';
      } else {
        // Estratégia DEFAULT usa configuração padrão
        currentTimeframe = config?.time || '5m';
      }
    }

    // Usa 1000 candles para garantir dados suficientes para Heikin Ashi Money Flow (SMA cascateadas)
    const candleCount = 1000;

    // Filtra mercados baseado em tokens autorizados do config
    // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
    const exchangeManager = this.getExchangeManager(config || {});
    const allMarkets = await exchangeManager.getMarkets();
    let markets = allMarkets.filter(el => {
      return !closed_markets.includes(el.symbol);
    });

    // Se config tem authorizedTokens, filtra apenas esses tokens
    if (config?.authorizedTokens && config.authorizedTokens.length > 0) {
      let authorizedTokens = [...config.authorizedTokens]; // Cópia para não modificar o original

      // 🚨 VALIDAÇÃO: Limite máximo de tokens por bot
      const maxTokensPerBot = parseInt(process.env.MAX_TOKENS_PER_BOT) || 12; // Default: 12 tokens
      if (authorizedTokens.length > maxTokensPerBot) {
        Logger.warn(
          `⚠️ [DECISION] Bot tem ${authorizedTokens.length} tokens configurados, mas o limite é ${maxTokensPerBot}`
        );
        Logger.warn(
          `🔧 [DECISION] Processando apenas os primeiros ${maxTokensPerBot} tokens para evitar timing conflicts`
        );
        authorizedTokens = authorizedTokens.slice(0, maxTokensPerBot); // Limita aos primeiros N tokens
      }

      markets = markets.filter(el => authorizedTokens.includes(el.symbol));
    }

    try {
      // Busca TODOS os preços de uma vez só (otimização)
      const marketsPrices = new Markets();
      const now = Date.now();
      let allMarkPrices = null;

      // Verifica cache global de preços
      const pricesCacheKey = 'all_mark_prices';
      const cachedPrices = this.marketCache.get(pricesCacheKey);

      if (cachedPrices && now - cachedPrices.timestamp < this.cacheTimeout) {
        allMarkPrices = cachedPrices.prices;
        Logger.debug(`📦 Cache hit para todos os preços`);
      } else {
        // Busca todos os preços de uma vez (SEM parâmetro symbol)
        const rawPrices = await marketsPrices.getAllMarkPrices();

        // 🔒 VALIDAÇÃO CRÍTICA: API pode retornar objeto ou array dependendo do endpoint
        if (Array.isArray(rawPrices)) {
          allMarkPrices = rawPrices;
        } else if (rawPrices && typeof rawPrices === 'object') {
          // Se a API retornar um objeto, converte para array
          allMarkPrices = Object.values(rawPrices);
          Logger.warn(`⚠️ API retornou objeto ao invés de array, convertido automaticamente`);
        } else {
          Logger.error(`❌ Formato inesperado da API getAllMarkPrices: ${typeof rawPrices}`);
          throw new Error(`Invalid response format from getAllMarkPrices: ${typeof rawPrices}`);
        }

        // Cache global dos preços
        this.marketCache.set(pricesCacheKey, {
          prices: allMarkPrices,
          timestamp: now,
        });
        Logger.debug(
          `🔄 Preços atualizados para todos os símbolos (${allMarkPrices.length} itens)`
        );
      }

      // Paraleliza a coleta de dados de todos os mercados
      const dataPromises = markets.map(async market => {
        try {
          const cacheKey = `${market.symbol}_${currentTimeframe}`;
          const cached = this.marketCache.get(cacheKey);

          let candles;

          // Verifica se há cache válido para candles
          if (cached && now - cached.timestamp < this.cacheTimeout) {
            candles = cached.candles;
            Logger.debug(`📦 Cache hit para candles ${market.symbol}`);
          } else {
            // Busca apenas os candles (preços já temos)
            const markets = new Markets();
            candles = await markets.getKLines(market.symbol, currentTimeframe, candleCount);

            // Salva no cache
            this.marketCache.set(cacheKey, {
              candles: candles,
              timestamp: now,
            });
          }

          const analyze = await calculateIndicators(candles, currentTimeframe, market.symbol);

          // Find the correct price for this symbol from the global prices array
          let marketPrice;
          if (Array.isArray(allMarkPrices)) {
            const symbolPriceData = allMarkPrices.find(item => item.symbol === market.symbol);
            if (!symbolPriceData) {
              Logger.warn(
                `⚠️ [PRICE_FALLBACK] ${market.symbol} não encontrado na lista global de preços - tentando busca individual`
              );
              // 🔄 FALLBACK: Tenta buscar preço individual para este token
              try {
                const individualPriceData = await marketsPrices.getAllMarkPrices(market.symbol);
                if (
                  individualPriceData &&
                  (individualPriceData.markPrice || individualPriceData[0]?.markPrice)
                ) {
                  marketPrice = individualPriceData.markPrice || individualPriceData[0]?.markPrice;
                  Logger.info(
                    `✅ [PRICE_FALLBACK] ${market.symbol}: Preço obtido individualmente: ${marketPrice}`
                  );
                } else {
                  throw new Error(`No individual price data found for ${market.symbol}`);
                }
              } catch (fallbackError) {
                throw new Error(
                  `No price data found for ${market.symbol} in global array nor individual lookup: ${fallbackError.message}`
                );
              }
            } else {
              marketPrice = symbolPriceData.markPrice;
            }
          } else {
            throw new Error(`Expected allMarkPrices to be an array, got: ${typeof allMarkPrices}`);
          }

          if (!marketPrice) {
            throw new Error(`No market price found for ${market.symbol}`);
          }

          Logger.info(`🔍 Analisando ${String(market.symbol).replace('_USDC_PERP', '')}`);

          return {
            candles,
            market,
            marketPrice,
            symbol: market.symbol, // Adiciona o símbolo diretamente
            ...analyze,
          };
        } catch (error) {
          Logger.error(`❌ Erro ao processar ${market.symbol}: ${error.message}`);
          return null;
        }
      });

      // Aguarda todas as operações em paralelo
      const results = await Promise.all(dataPromises);

      // Filtra resultados nulos (erros)
      results.forEach(result => {
        if (result) {
          dataset.push(result);
        }
      });
    } catch (error) {
      Logger.error('❌ getDataset - Error:');
    }

    return dataset;
  }

  async analyzeTrades(
    fee,
    datasets,
    investmentUSD,
    media_rsi,
    config = null,
    btcTrend = 'NEUTRAL'
  ) {
    // Paraleliza a análise de todos os datasets
    const analysisPromises = datasets.map(async data => {
      try {
        // Obtém os dados de mercado para o símbolo atual
        const marketInfo = await this.getMarketInfo(data.symbol, config);

        if (!marketInfo) {
          Logger.error(
            `❌ [${config?.strategyName || 'DEFAULT'}] Market não encontrado para ${data.symbol}`
          );
          return null;
        }

        // Valida se os dados de decimal estão disponíveis
        if (
          marketInfo.decimal_quantity === undefined ||
          marketInfo.decimal_quantity === null ||
          marketInfo.decimal_price === undefined ||
          marketInfo.decimal_price === null ||
          marketInfo.stepSize_quantity === undefined ||
          marketInfo.stepSize_quantity === null
        ) {
          Logger.error(
            `❌ [${config?.strategyName || 'DEFAULT'}] Dados de decimal ausentes para ${data.symbol}`
          );
          return null;
        }

        // Adiciona os dados de mercado ao objeto data
        const dataWithMarket = {
          ...data,
          market: marketInfo,
        };

        return await this.strategy.analyzeTrade(
          fee,
          dataWithMarket,
          investmentUSD,
          media_rsi,
          config,
          btcTrend
        );
      } catch (error) {
        Logger.error(`❌ Erro na análise de ${data.symbol}: ${error.message}`);
        return null;
      }
    });

    // Executa todas as análises em paralelo
    const analysisResults = await Promise.all(analysisPromises);

    // Filtra resultados nulos e ordena por PnL
    return analysisResults.filter(result => result !== null).sort((a, b) => b.pnl - a.pnl);
  }

  /**
   * Obtém informações de mercado para um símbolo específico
   * @param {string} symbol - Símbolo do mercado
   * @param {object} config - Configuração da conta
   * @returns {object|null} - Dados de mercado ou null se não encontrado
   */
  async getMarketInfo(symbol, config = null) {
    try {
      // Adiciona symbol ao config para cálculo correto da alavancagem
      const configWithSymbol = {
        ...config,
        symbol,
        strategy: config?.strategyName || this.strategy.constructor.name || 'DEFAULT',
      };

      // Obtém os dados da conta
      const Account = await AccountController.get(configWithSymbol);

      if (!Account) {
        Logger.error(`❌ [${config?.strategyName || 'DEFAULT'}] Dados da conta não disponíveis`);
        return null;
      }

      // Encontra o market correspondente ao símbolo
      // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
      const exchangeManager = this.getExchangeManager(config || {});
      const allMarkets = await exchangeManager.getMarkets();
      const marketInfo = allMarkets.find(el => el.symbol === symbol);

      if (!marketInfo) {
        Logger.error(
          `❌ [${config?.strategyName || 'DEFAULT'}] Market não encontrado para ${symbol}`
        );
        return null;
      }

      return marketInfo;
    } catch (error) {
      Logger.error(`❌ Erro ao obter dados de mercado para ${symbol}: ${error.message}`);
      return null;
    }
  }

  /**
   * Subscribe WebSocket para posições existentes quando bot reinicia
   * @param {Array} positions - Array de posições abertas
   * @param {Object} config - Configuração do bot
   */
  async subscribeExistingPositions(positions, config) {
    if (!positions || positions.length === 0) {
      return;
    }

    try {
      // Inicializa WebSocket se não estiver inicializado
      await TrailingStop.initializeReactiveSystem();

      if (!TrailingStop.backpackWS || !TrailingStop.backpackWS.connected) {
        Logger.warn(`📡 [WS_SUBSCRIBE] WebSocket não conectado - posições não serão monitoradas`);
        return;
      }

      const Account = await AccountController.get({
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        strategy: config.strategyName || 'DEFAULT',
      });

      for (const position of positions) {
        // Verifica se já está subscrito
        if (TrailingStop.backpackWS.subscribedSymbols.has(position.symbol)) {
          Logger.debug(`📡 [WS_SUBSCRIBE] ${position.symbol}: Já subscrito`);
          continue;
        }

        // Subscribe para monitoramento
        const subscribed = await TrailingStop.subscribePositionReactive(
          position,
          Account,
          config,
          this
        );

        if (subscribed) {
          Logger.info(`📡 [WS_SUBSCRIBE] ${position.symbol}: WebSocket subscrito com sucesso`);
        } else {
          Logger.warn(`⚠️ [WS_SUBSCRIBE] ${position.symbol}: Falha ao subscrever WebSocket`);
        }
      }
    } catch (error) {
      Logger.error(`❌ [WS_SUBSCRIBE] Erro ao subscrever posições:`, error.message);
    }
  }

  async analyze(timeframe = null, logger = null, config = null) {
    try {
      // 🚫 VERIFICAÇÃO: Bloqueia análises durante manutenção para evitar rate limit
      const DepressurizationManager = await import('../Utils/DepressurizationManager.js');
      if (DepressurizationManager.default.isSystemInMaintenance()) {
        DepressurizationManager.default.logBlockedOperation('Trading Analysis', 'Decision');
        return;
      }

      // VERIFICAÇÃO CRÍTICA: Se o bot foi pausado, interrompe imediatamente
      if (config?.botId) {
        try {
          const { default: ConfigManagerSQLite } = await import('../Config/ConfigManagerSQLite.js');
          const botStatus = await ConfigManagerSQLite.getBotStatusById(config.botId);
          if (botStatus === 'stopped') {
            Logger.info(`🛑 [${config?.botName || 'BOT'}] Bot pausado - interrompendo análise`);
            return;
          }
        } catch (statusError) {
          Logger.debug(`⚠️ Erro ao verificar status do bot: ${statusError.message}`);
        }
      }

      // 🔄 VERIFICAÇÃO DE DESPRESSURIZAÇÃO: Interrompe se sistema em manutenção
      if (global.depressurizationManager && global.depressurizationManager.isActive()) {
        Logger.info(
          `🔄 [DEPRESSURIZATION] Sistema em manutenção - análise interrompida temporariamente`
        );
        return;
      }

      // Usa o timeframe passado como parâmetro ou fallback para configuração da conta
      let currentTimeframe = timeframe;

      if (!currentTimeframe) {
        // Determina a estratégia atual para usar a configuração correta
        const strategyName = this.strategy.constructor.name;

        if (strategyName === 'ProMaxStrategy') {
          // Estratégia PRO_MAX usa configuração específica
          currentTimeframe = config?.time || '5m';
        } else {
          // Estratégia DEFAULT usa configuração padrão
          currentTimeframe = config?.time || '5m';
        }
      }

      const configWithStrategy = {
        ...config,
        strategy: config?.strategyName || this.strategy.constructor.name || 'DEFAULT',
      };

      const accountData = await AccountController.get(configWithStrategy);

      // Verifica se os dados da conta foram carregados com sucesso
      if (!accountData) {
        Logger.error('❌ Falha ao carregar dados da conta. Verifique suas credenciais de API.');
        return;
      }

      // 🔒 CORREÇÃO CRÍTICA: Atualiza Account global com dados atuais
      Object.assign(Account, accountData);

      if (Account.leverage > 10 && currentTimeframe !== '1m') {
        Logger.warn(
          `Leverage ${Account.leverage}x com timeframe ${currentTimeframe} - ALTO RISCO DE LIQUIDAÇÃO`
        );
      }

      // Usa credenciais do config se disponível
      const apiKey = config?.apiKey;
      const apiSecret = config?.apiSecret;

      // VALIDAÇÃO: Posições abertas - SEMPRE carrega diretamente da corretora para garantir dados atuais
      Logger.debug(
        `🔄 [${config?.botName || 'DEFAULT'}] Carregando posições abertas da corretora...`
      );
      // 🔧 MIGRAÇÃO: Usa ExchangeManager - TODO: Implementar getOpenPositionsForceRefresh
      const exchangeManager = this.getExchangeManager({ apiKey, apiSecret });
      const exchangePositions = await exchangeManager.getFuturesPositionsForceRefresh(
        apiKey,
        apiSecret
      );

      // Filtra apenas posições que realmente têm quantidade (evita posições "fantasma")
      const activePositions = exchangePositions.filter(
        pos => pos.netQuantity && Math.abs(Number(pos.netQuantity)) > 0
      );

      Logger.info(
        `🔒 [${config?.botName || 'DEFAULT'}] Posições ativas encontradas: ${activePositions.length}/${exchangePositions.length}`
      );

      // Log das posições ativas para debugging
      if (activePositions.length > 0) {
        activePositions.forEach(pos => {
          const quantity = Number(pos.netQuantity);
          const side = quantity > 0 ? 'LONG' : 'SHORT';
          const entryPrice = Number(pos.avgEntryPrice || pos.entryPrice || 0);
          Logger.info(
            `   📍 ${pos.symbol}: ${side} ${Math.abs(quantity)} @ $${entryPrice.toFixed(4)}`
          );

          PositionMonitorService.updatePositionCache(pos.symbol, pos, {
            leverage: Account?.leverage,
            maxNegativePnlStopPct: config.maxNegativePnlStopPct,
            minProfitPercentage: config.minProfitPercentage,
            botName: config.botName,
            apiKey: config.apiKey,
            apiSecret: config.apiSecret, // 🔑 Corrigido: era secretKey, deve ser apiSecret
            id: config.id, // 🔑 Adicionado: ID do bot para geração de ID único
            botClientOrderId: config.botClientOrderId, // 🔑 Adicionado: botClientOrderId para geração de ID único
          });
        });

        // 📡 CRITICAL: Subscribe WebSocket para monitorar posições existentes
        // Quando bot reinicia, precisa subscrever as posições que já estão abertas
        await this.subscribeExistingPositions(activePositions, config);
      } else {
        Logger.info(
          `   ✅ Nenhuma posição ativa encontrada - todos os tokens disponíveis para análise`
        );
      }

      const closed_markets = activePositions.map(el => el.symbol);

      // VALIDAÇÃO: Máximo de ordens - Controla quantidade máxima de posições abertas
      const maxTradesValidation = await OrderController.validateMaxOpenTrades(
        config?.botName || 'DEFAULT',
        apiKey,
        apiSecret,
        config,
        false // Não força refresh pois já carregamos acima
      );
      if (!maxTradesValidation.isValid) {
        Logger.warn(maxTradesValidation.message);
        return;
      } else {
        // Log informativo do status das posições abertas
        Logger.debug(maxTradesValidation.message);
      }

      // Verificação adicional: também verifica ordens abertas para evitar duplicatas
      // 🔧 MIGRAÇÃO: Reutiliza ExchangeManager já criado acima
      const openOrders = await exchangeManager.getOpenOrdersForSymbol(null, apiKey, apiSecret);
      const marketsWithOpenOrders = openOrders ? openOrders.map(order => order.symbol) : [];
      const allClosedMarkets = [...new Set([...closed_markets, ...marketsWithOpenOrders])];

      // Log informativo sobre mercados bloqueados
      Logger.info(
        `🔒 [${config?.botName || 'DEFAULT'}] Mercados bloqueados: ${closed_markets.length} posições + ${marketsWithOpenOrders.length} ordens = ${allClosedMarkets.length} total`
      );

      if (allClosedMarkets.length > 0) {
        Logger.debug(`   🚫 Símbolos bloqueados: ${allClosedMarkets.join(', ')}`);
      }

      // ANÁLISE DO BTC PRIMEIRO (antes das altcoins)
      let btcTrend = 'NEUTRAL';
      const isAlphaFlow = this.strategy.constructor.name === 'AlphaFlowStrategy';

      // Para AlphaFlow, só analisa BTC se Heikin Ashi estiver habilitado
      const shouldAnalyzeBTC =
        !isAlphaFlow || config?.enableHeikinAshi === true || config?.enableHeikinAshi === 'true';

      if (shouldAnalyzeBTC) {
        Logger.debug(`\n📊 ANÁLISE DO BTC (${currentTimeframe}):`);
        try {
          // Usa 1000 candles para garantir que todos os indicadores tenham dados suficientes
          const markets = new Markets();
          const btcCandles = await markets.getKLines('BTC_USDC_PERP', currentTimeframe, 1000);
          if (btcCandles && btcCandles.length > 0) {
            const btcIndicators = await calculateIndicators(
              btcCandles,
              currentTimeframe,
              'BTC_USDC_PERP'
            );

            // Validação adicional dos indicadores do BTC
            if (
              !btcIndicators ||
              !btcIndicators.rsi ||
              !btcIndicators.stoch ||
              !btcIndicators.macd ||
              !btcIndicators.adx
            ) {
              Logger.debug(`   ⚠️ BTC: Dados de indicadores insuficientes`);
            } else {
              // Para AlphaFlow com Heikin Ashi, usa direção da tendência confirmada
              if (isAlphaFlow && btcIndicators.heikinAshi) {
                const btcHeikinAshi = btcIndicators.heikinAshi;
                const confirmedTrend = btcHeikinAshi.trendChange?.confirmedTrend || 'NEUTRAL';

                if (confirmedTrend === 'UP') {
                  btcTrend = 'UP';
                  Logger.debug(`   🟢 BTC Heikin Ashi: ALTA (${confirmedTrend})`);
                } else if (confirmedTrend === 'DOWN') {
                  btcTrend = 'DOWN';
                  Logger.debug(`   🔴 BTC Heikin Ashi: BAIXA (${confirmedTrend})`);
                } else {
                  btcTrend = 'NEUTRAL';
                  Logger.debug(`   ⚪ BTC Heikin Ashi: NEUTRO (${confirmedTrend})`);
                }
              } else {
                // Lógica tradicional para outras estratégias
                const btcAnalysis = this.strategy.analyzeSignals(btcIndicators, {
                  isBTCAnalysis: true,
                  config,
                });

                if (btcAnalysis && btcAnalysis.hasSignal) {
                  Logger.debug(`   🟢 BTC: ${btcAnalysis.signalType}`);
                  // Define tendência do BTC baseada no sinal
                  btcTrend = btcAnalysis.isLong ? 'BULLISH' : 'BEARISH';
                } else {
                  Logger.debug(`⚪ BTC: Sem sinais (NEUTRO)`);
                  btcTrend = 'NEUTRAL';
                }
              }
            }
          } else {
            Logger.debug(`   ⚠️ BTC: Dados de candles insuficientes`);
          }
        } catch (error) {
          Logger.error(`   ❌ BTC: Erro na análise - ${error.message}`);
          console.log(`      Detalhes: ${error.stack?.split('\n')[1] || 'Erro desconhecido'}`);
        }
      } else {
        Logger.debug(
          `\n🧠 ALPHAFLOW: Análise BTC desabilitada (cada moeda tem suas particularidades)`
        );
      }

      const dataset = await this.getDataset(
        accountData,
        allClosedMarkets,
        currentTimeframe,
        logger,
        config
      );

      // Otimiza o cálculo da média RSI
      const media_rsi = dataset.reduce((sum, row) => sum + row.rsi.value, 0) / dataset.length;

      // Log de resumo das validações implementadas (personalizado por estratégia)
      let validationSummary;
      if (this.strategy.constructor.name === 'AlphaFlowStrategy') {
        validationSummary = `\n🧠 ALPHAFLOW - RESUMO DAS VALIDAÇÕES:
• 📊 Momentum: Análise de momentum avançado (RSI + tendência)
• 💰 Money Flow: Filtro de fluxo de dinheiro (MFI)
• 🏛️  Macro Money Flow: Viés macro do mercado
• 📊 CVD Divergence: Detecção de divergência CVD
• 📈 VWAP: Filtro de tendência intradiária
• 📊 ATR: Cálculo de spread para ordens escalonadas
• 🎯 Sinais BRONZE/SILVER/GOLD: Níveis de convicção escalonados
• 📋 Ordens Escalonadas: 3 ordens com pirâmide invertida (50%/30%/20%)`;
      } else {
        validationSummary = `\n🔍 RESUMO DAS VALIDAÇÕES IMPLEMENTADAS:
• 📊 Momentum (RSI Avançado): Primeira prioridade - Cruzamentos GREEN/RED + Sobrevenda/Sobrecompra
• 🎯 Stochastic: Segunda prioridade - Cruzamentos K/D em zonas extremas
• 📈 MACD: Terceira prioridade - Momentum e tendência (histograma + cruzamentos)
• 📊 ADX: Quarta prioridade - Força e direção da tendência
• 💰 Money Flow: Filtro de confirmação - Direção da tendência do fluxo de dinheiro (LONG: positivo crescendo / SHORT: negativo decrescendo)
• 📊 VWAP: Filtro de tendência intradiária - Preço > VWAP (LONG) / < VWAP (SHORT)
• 🏛️ BTC Trend: Filtro macro - Correlação com tendência do Bitcoin
• 🎯 Stop/Target: Cálculo baseado em VWAP + StdDev`;
      }

      if (logger) {
        logger.debug(validationSummary);
      } else {
        // console.log(validationSummary); // Removido para evitar spam
      }

      // Log personalizado por estratégia
      if (this.strategy.constructor.name === 'AlphaFlowStrategy') {
        // AlphaFlow não usa média RSI, mostra configurações específicas
        const alphaFlowMsg = `🧠 ALPHAFLOW CONFIGURAÇÕES:
• Capital Base: ${config?.capitalPercentage !== null && config?.capitalPercentage !== undefined ? config.capitalPercentage : 'padrão'}%
• Ordem 1: ${config?.order1WeightPct || 50}% | Ordem 2: ${config?.order2WeightPct || 30}% | Ordem 3: ${config?.order3WeightPct || 20}%`;
        if (logger) {
          logger.info(alphaFlowMsg);
        } else {
          console.log(alphaFlowMsg);
        }
      } else if (this.strategy.constructor.name !== 'ProMaxStrategy') {
        // Outras estratégias mostram média RSI
        const rsiMsg = `📊 Média do RSI: ${media_rsi.toFixed(2)}`;
        if (logger) {
          logger.debug(rsiMsg);
        } else {
          // console.log(rsiMsg); // Removido para evitar spam
        }
      }

      const investmentUSD = RiskManager.calculateInvestmentAmount(Account.capitalAvailable, config);

      // Verificação adicional: se investmentUSD é 0, significa que há problema com os dados
      if (investmentUSD <= 0) {
        Logger.warn(
          `⚠️ Investment calculado como zero ou inválido: $${investmentUSD} - operação será ignorada`
        );
        return;
      }

      Logger.debug(
        `💰 Capital: ${config?.capitalPercentage || 'padrão'}%, Valor calculado: $${investmentUSD.toFixed(2)}`
      );

      // Log resumido do capital (apenas uma vez)
      if (!this.operationSummaryLogged) {
        Logger.debug(
          `💰 Capital: $${Account.capitalAvailable.toFixed(2)}, Leverage: ${Account.leverage}x, Volume/op: $${investmentUSD.toFixed(2)}`
        );
        this.operationSummaryLogged = true;
      }

      const fee = Account.fee;

      // Verificação de margem antes de iniciar análise
      if (Account.capitalAvailable <= 0) {
        Logger.warn(`⚠️ Margem insuficiente: $${Account.capitalAvailable.toFixed(2)}`);
        return;
      }

      Logger.debug(`💰 Investment USD: $${investmentUSD.toFixed(2)}`);
      const rows = await this.analyzeTrades(
        fee,
        dataset,
        investmentUSD,
        media_rsi,
        config,
        btcTrend
      );

      // Validação de resultados antes de executar ordens
      if (!rows || rows.length === 0) {
        Logger.info(`📊 Nenhuma oportunidade de trading encontrada nesta análise`);
        return;
      }

      // VERIFICAÇÃO CRÍTICA: Antes de executar qualquer ordem, verifica se bot foi pausado
      if (config?.botId) {
        try {
          const { default: ConfigManagerSQLite } = await import('../Config/ConfigManagerSQLite.js');
          const botStatus = await ConfigManagerSQLite.getBotStatusById(config.botId);
          if (botStatus === 'stopped') {
            Logger.info(
              `🛑 [${config?.botName || 'BOT'}] Bot pausado - cancelando execução de ${rows.length} ordens`
            );
            return;
          }
        } catch (statusError) {
          Logger.debug(
            `⚠️ Erro ao verificar status do bot antes da execução: ${statusError.message}`
          );
        }
      }

      // ✅ CORREÇÃO: Executa ordens SEQUENCIALMENTE para respeitar maxOpenOrders
      Logger.debug(`🔄 Processando ${rows.length} ordens sequencialmente (1 por vez)...`);

      const orderResults = [];

      // Processa cada ordem individualmente de forma sequencial
      for (let index = 0; index < rows.length; index++) {
        let marketSymbol;

        // VERIFICAÇÃO: A cada iteração, verifica se o bot foi pausado
        if (config?.botId) {
          try {
            const { default: ConfigManagerSQLite } = await import(
              '../Config/ConfigManagerSQLite.js'
            );
            const botStatus = await ConfigManagerSQLite.getBotStatusById(config.botId);
            if (botStatus === 'stopped') {
              Logger.info(
                `🛑 [${config?.botName || 'BOT'}] Bot pausado durante execução - interrompendo na ordem ${index + 1}/${rows.length}`
              );
              break;
            }
          } catch (statusError) {
            Logger.debug(`⚠️ Erro ao verificar status durante execução: ${statusError.message}`);
          }
        }

        const row = rows[index];
        try {
          // Determina o market baseado na estrutura do objeto
          if (row.orders && Array.isArray(row.orders) && row.orders.length > 0) {
            // Alpha Flow Strategy: market está dentro de orders[0]
            marketSymbol = row.orders[0].market;
          } else {
            // Estratégias tradicionais: market está no nível raiz
            marketSymbol = row.market || row.symbol;
          }

          // Validação de símbolo antes de processar
          if (!row) {
            Logger.error(`❌ [${config?.botName || 'DEFAULT'}] Decisão inválida`);
            orderResults.push({ index, market: 'UNKNOWN', result: { error: 'Decisão inválida' } });
            continue;
          }

          if (!marketSymbol) {
            Logger.error(`❌ [${config?.botName || 'DEFAULT'}] Decisão sem símbolo válido`);
            orderResults.push({
              index,
              market: 'UNKNOWN',
              result: { error: 'Decisão sem símbolo válido' },
            });
            continue;
          }

          // 🚨 CORREÇÃO CRÍTICA: Obter Account específico para este marketSymbol para evitar conflito de cache entre bots
          const marketSpecificConfig = {
            ...config,
            symbol: marketSymbol,
            strategy: config?.strategyName || this.strategy.constructor.name || 'DEFAULT',
          };

          const MarketAccount = await AccountController.get(marketSpecificConfig);

          // ✅ DEFENSIVE CHECK: Se MarketAccount ou markets não disponíveis
          if (!MarketAccount) {
            Logger.debug(
              `⚠️ [${config?.botName || 'DEFAULT'}] Dados da conta não disponíveis para ${marketSymbol}`
            );
            orderResults.push({
              index,
              market: marketSymbol,
              result: { error: 'Dados da conta não disponíveis' },
            });
            continue;
          }

          // 🔧 MIGRAÇÃO: Usa ExchangeManager para obter markets em vez de Account.markets direto
          const exchangeManager = this.getExchangeManager(config || {});
          const allMarkets = await exchangeManager.getMarkets();
          const marketInfo = allMarkets.find(el => el.symbol === marketSymbol);

          // Verifica se o market foi encontrado
          if (!marketInfo) {
            Logger.error(
              `❌ [${config?.botName || 'DEFAULT'}] Market não encontrado para ${marketSymbol}. Markets disponíveis: ${allMarkets?.map(m => m.symbol).join(', ') || 'nenhum'}`
            );
            orderResults.push({
              index,
              market: marketSymbol,
              result: { error: `Market não encontrado para ${marketSymbol}` },
            });
            continue;
          }

          // Valida se os dados de decimal estão disponíveis (aceita 0 como valor válido)
          if (
            marketInfo.decimal_quantity === undefined ||
            marketInfo.decimal_quantity === null ||
            marketInfo.decimal_price === undefined ||
            marketInfo.decimal_price === null ||
            marketInfo.stepSize_quantity === undefined ||
            marketInfo.stepSize_quantity === null
          ) {
            Logger.error(
              `❌ [${config?.botName || 'DEFAULT'}] Dados de decimal ausentes para ${marketSymbol}. Dados disponíveis:`,
              {
                decimal_quantity: marketInfo.decimal_quantity,
                decimal_price: marketInfo.decimal_price,
                stepSize_quantity: marketInfo.stepSize_quantity,
              }
            );
            orderResults.push({
              index,
              market: marketSymbol,
              result: { error: `Dados de decimal ausentes para ${marketSymbol}` },
            });
            continue;
          }

          // Verifica se é uma estratégia Alpha Flow com múltiplas ordens
          if (row.orders && Array.isArray(row.orders) && row.orders.length > 0) {
            Logger.debug(
              `   🔄 ${marketSymbol}: Processando ${row.orders.length} ordens escalonadas (${row.conviction})`
            );

            // VALIDAÇÃO CRÍTICA: Re-verifica maxOpenTrades antes de executar cada ordem
            // Força refresh para garantir dados atualizados antes de nova execução
            const maxTradesRecheck = await OrderController.validateMaxOpenTrades(
              config?.botName || 'DEFAULT',
              apiKey,
              apiSecret,
              config,
              true // Sempre força refresh em re-validações durante execução
            );
            if (!maxTradesRecheck.isValid) {
              Logger.warn(`   🚫 ${marketSymbol}: ${maxTradesRecheck.message} - Pulando ordem`);
              orderResults.push({
                index,
                market: marketSymbol,
                result: { error: maxTradesRecheck.message },
              });
              continue;
            }

            // Verifica se já há muitas ordens abertas (limite de 5 por token)
            const existingOrders = await OrderController.getRecentOpenOrders(marketSymbol, config);
            if (existingOrders.length >= 5) {
              Logger.info(
                `   ⚠️  ${marketSymbol}: Muitas ordens abertas (${existingOrders.length}), pulando...`
              );
              orderResults.push({
                index,
                market: marketSymbol,
                result: { error: `Muitas ordens abertas: ${existingOrders.length}` },
              });
              continue;
            }

            // Processa múltiplas ordens para Alpha Flow Strategy
            const alphaFlowOrderResults = [];
            for (let i = 0; i < row.orders.length; i++) {
              const order = row.orders[i];

              // Prepara dados da ordem
              const orderData = {
                market: marketSymbol, // Adiciona o market explicitamente
                action: order.action, // Usa o action da ordem individual
                quantity: order.quantity, // Quantidade diretamente da ordem
                entry: order.entryPrice,
                stop: order.stopLoss,
                target: order.takeProfit,
                decimal_quantity: marketInfo.decimal_quantity,
                decimal_price: marketInfo.decimal_price,
                stepSize_quantity: marketInfo.stepSize_quantity,
                minQuantity: marketInfo.minQuantity,
                orderNumber: order.orderNumber,
                weight: order.weight,
                // Mantém dados da estratégia para compatibilidade
                conviction: row.conviction,
                reason: row.reason,
                signals: row.signals,
                // Adiciona o nome da estratégia para o TrailingStop
                strategyName: this.strategy.constructor.name,
              };

              // Verifica se já existe uma posição ativa para este mercado
              // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Futures direto
              const exchangeManager = this.getExchangeManager({ apiKey, apiSecret });
              const positions = await exchangeManager.getFuturesPositions(apiKey, apiSecret);
              const existingPosition = positions.find(
                p => p.symbol === marketSymbol && Math.abs(Number(p.netQuantity)) > 0
              );

              if (existingPosition) {
                Logger.info(
                  `   ⏸️ ${marketSymbol} (Ordem ${order.orderNumber}): Posição ativa existe, pulando...`
                );
                alphaFlowOrderResults.push({ orderNumber: order.orderNumber, result: null });
                continue;
              }

              // Verifica se já existe uma ordem pendente
              const orders = await OrderController.getRecentOpenOrders(marketSymbol, config);

              // Calcula o valor da ordem para log
              const orderValue = orderData.quantity * orderData.entry;
              Logger.debug(
                `   💰 [DEBUG] ${marketSymbol} (Ordem ${order.orderNumber}): Valor = $${orderValue.toFixed(2)}`
              );

              // Cancela ordens antigas (mais de 5 minutos) antes de criar novas
              if (orders.length > 0) {
                const oldestOrder = orders[0];
                const orderAge =
                  (Date.now() - new Date(oldestOrder.createdAt).getTime()) / (1000 * 60); // em minutos

                if (orderAge > 5) {
                  Logger.info(
                    `   🗑️  ${marketSymbol}: Cancelando ordens antigas (${orderAge.toFixed(1)} min)`
                  );
                  // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
                  const exchangeManager = this.getExchangeManager({ apiKey, apiSecret });
                  await exchangeManager.cancelOpenOrders(marketSymbol, null, apiKey, apiSecret);
                }
              }

              // Verifica se já há muitas ordens abertas (limite de 3 por token)
              const existingOrdersCount = orders.length;
              if (existingOrdersCount >= 3) {
                Logger.info(
                  `   ⚠️  ${marketSymbol} (Ordem ${order.orderNumber}): Muitas ordens abertas (${existingOrdersCount}), pulando...`
                );
                alphaFlowOrderResults.push({
                  orderNumber: order.orderNumber,
                  result: { error: `Muitas ordens abertas: ${existingOrdersCount}` },
                });
                continue;
              }

              if (orders.length > 0 && orders[0].minutes <= 3) {
                alphaFlowOrderResults.push({ orderNumber: order.orderNumber, result: null });
              } else {
                const result = await OrderController.openOrder(
                  { ...orderData, strategyName: config?.strategyName || 'DEFAULT' },
                  config
                );
                alphaFlowOrderResults.push({ orderNumber: order.orderNumber, result });
              }
            }

            orderResults.push({
              index,
              market: marketSymbol,
              result: { orders: alphaFlowOrderResults, conviction: row.conviction },
            });
          } else {
            // Processa ordem única (estratégias tradicionais)
            // VALIDAÇÃO CRÍTICA: Re-verifica maxOpenTrades antes de executar ordem tradicional
            // Força refresh para garantir dados atualizados antes de nova execução
            const maxTradesRecheck = await OrderController.validateMaxOpenTrades(
              config?.botName || 'DEFAULT',
              apiKey,
              apiSecret,
              config,
              true // Sempre força refresh em re-validações durante execução
            );
            if (!maxTradesRecheck.isValid) {
              Logger.warn(`   🚫 ${marketSymbol}: ${maxTradesRecheck.message} - Pulando ordem`);
              orderResults.push({
                index,
                market: marketSymbol,
                result: { error: maxTradesRecheck.message },
              });
              continue;
            }

            // ✅ CORREÇÃO: Usa os dados fornecidos pela estratégia (que já considera capitalPercentage)
            // Não sobrescrever volume se já foi definido pela strategy
            if (!row.volume) {
              row.volume = investmentUSD;
            }
            row.decimal_quantity = row.decimal_quantity || marketInfo.decimal_quantity;
            row.decimal_price = row.decimal_price || marketInfo.decimal_price;
            row.stepSize_quantity = row.stepSize_quantity || marketInfo.stepSize_quantity;

            // Verifica se já existe uma posição ativa para este mercado
            // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Futures direto
            const exchangeManager = this.getExchangeManager({ apiKey, apiSecret });
            const positions = await exchangeManager.getFuturesPositions(apiKey, apiSecret);
            const existingPosition = positions.find(
              p => p.symbol === marketSymbol && Math.abs(Number(p.netQuantity)) > 0
            );

            if (existingPosition) {
              // Já existe posição ativa, não criar nova ordem
              Logger.info(
                `   ⏸️ ${marketSymbol}: Posição ativa existe (${existingPosition.netQuantity}), pulando...`
              );
              orderResults.push({ index, market: marketSymbol, result: null });
              continue;
            }

            // 🔒 VERIFICA COOLDOWN: Se ordem foi cancelada recentemente, aguarda
            const LimitOrderValidator = (await import('../Utils/LimitOrderValidator.js')).default;
            if (LimitOrderValidator.isSymbolInCooldown(marketSymbol)) {
              Logger.info(
                `   ⏸️ ${marketSymbol}: Cooldown ativo (ordem cancelada recentemente) - aguardando antes de criar nova ordem`
              );
              orderResults.push({ index, market: marketSymbol, result: null });
              continue;
            }

            // Verifica se já existe uma ordem pendente
            const orders = await OrderController.getRecentOpenOrders(marketSymbol, config);

            if (orders.length > 0) {
              if (orders[0].minutes > 3) {
                // 🔧 MIGRAÇÃO: Usa ExchangeManager em vez de Order direto
                const exchangeManager = this.getExchangeManager({ apiKey, apiSecret });
                await exchangeManager.cancelOpenOrders(marketSymbol, null, apiKey, apiSecret);
                const result = await OrderController.openOrder(
                  { ...row, strategyName: config?.strategyName || 'DEFAULT' },
                  config
                );
                orderResults.push({ index, market: marketSymbol, result });
              } else {
                orderResults.push({ index, market: marketSymbol, result: null });
              }
            } else {
              const result = await OrderController.openOrder(
                { ...row, strategyName: config?.strategyName || 'DEFAULT' },
                config
              );
              orderResults.push({ index, market: marketSymbol, result });
            }
          }
        } catch (error) {
          const errorMsg = `❌ Erro ao executar ordem para ${marketSymbol}: ${error.message}`;
          if (logger) {
            logger.error(errorMsg);
          } else {
            Logger.error(errorMsg);
          }
          orderResults.push({ index, market: marketSymbol, result: { error: error.message } });
        }
      }

      // ✅ CORREÇÃO: Processamento sequencial concluído

      // Ordena os resultados pelo índice original e mostra logs
      orderResults.sort((a, b) => a.index - b.index);

      orderResults.forEach(({ market, result }) => {
        // Verifica se é resultado de múltiplas ordens (Alpha Flow)
        if (result && result.orders && Array.isArray(result.orders)) {
          Logger.debug(
            `   🔄 ${market} (${result.conviction}): ${result.orders.length} ordens escalonadas`
          );

          result.orders.forEach((orderResult, orderIndex) => {
            const orderNumber = orderResult.orderNumber || orderIndex + 1;
            if (orderResult.result && orderResult.result.success) {
              Logger.info(`      ✅ Ordem ${orderNumber}: Executada`);
            } else if (orderResult.result && orderResult.result.error) {
              Logger.error(`      ❌ Ordem ${orderNumber}: Falhou - ${orderResult.result.error}`);
            } else {
              Logger.info(`      ⏸️ Ordem ${orderNumber}: Pulada`);
            }
          });
        } else {
          // Resultado de ordem única (estratégias tradicionais)
          if (result && result.success) {
            Logger.info(`   ✅ ${market}: Executada`);
          } else if (result && result.error) {
            Logger.error(`   ❌ ${market}: Falhou - ${result.error}`);
          } else {
            Logger.info(`   ⏸️ ${market}: Pulado (ordem recente)`);
          }
        }
      });

      // Log dos resultados
      const successfulOrders = orderResults.filter(({ result }) => {
        if (result && result.orders && Array.isArray(result.orders)) {
          // Para Alpha Flow, conta ordens individuais
          return result.orders.some(
            orderResult => orderResult.result && orderResult.result.success
          );
        } else {
          // Para estratégias tradicionais
          return result && result.success;
        }
      });

      const failedOrders = orderResults.filter(({ result }) => {
        if (result && result.orders && Array.isArray(result.orders)) {
          // Para Alpha Flow, conta ordens individuais
          return result.orders.every(
            orderResult => !orderResult.result || orderResult.result.error
          );
        } else {
          // Para estratégias tradicionais
          return !result || result.error;
        }
      });

      // Log detalhado das ordens
      const detailsMsg = `📊 Detalhes das ordens:`;
      if (logger) {
        logger.order(detailsMsg);
      } else {
        console.log(detailsMsg);
      }

      // Log resumo da análise quando há operações
      Logger.info(`\n📈 RESUMO DA ANÁLISE:`);
      Logger.info(`   • Mercados analisados: ${dataset.length}`);
      Logger.info(`   • Sinais encontrados: ${rows.length}`);
      Logger.info(`   • Operações executadas: ${successfulOrders.length}`);
      Logger.info(`   • Operações falharam: ${failedOrders.length}`);

      orderResults.forEach(({ market, result }) => {
        // Para Alpha Flow Strategy com múltiplas ordens
        if (result && result.orders && Array.isArray(result.orders)) {
          const successfulCount = result.orders.filter(
            orderResult => orderResult.result && orderResult.result.success
          ).length;
          const totalCount = result.orders.length;
          const status = successfulCount > 0 ? '✅' : '❌';
          const orderMsg = `${status} ${market} (${result.conviction}): ${successfulCount}/${totalCount} ordens executadas`;

          if (logger) {
            logger.order(orderMsg);
          } else {
            Logger.info(orderMsg);
          }
        } else {
          // Para estratégias tradicionais
          const status = result && result.success ? '✅' : '❌';
          const errorMsg = result?.error ? ` - ${result.error}` : '';

          // Para estratégia PRO_MAX, inclui o nível do sinal
          let orderMsg;
          const row = rows.find(r => r.market === market);
          if (this.strategy.constructor.name === 'ProMaxStrategy' && row?.signalLevel) {
            orderMsg = `${status} ${market} (${row.signalLevel}): ${result && result.success ? 'Executada' : 'Falhou' + errorMsg}`;
          } else {
            orderMsg = `${status} ${market}: ${result && result.success ? 'Executada' : 'Falhou' + errorMsg}`;
          }

          if (logger) {
            logger.order(orderMsg);
          } else {
            Logger.info(orderMsg);
          }
        }
      });

      if (successfulOrders.length > 0) {
        const successMsg = `✅ ${successfulOrders.length} ordens executadas com sucesso`;
        if (logger) {
          logger.success(successMsg);
        } else {
          Logger.info(successMsg);
        }
      }
      if (failedOrders.length > 0) {
        const failedMsg = `❌ ${failedOrders.length} ordens falharam`;
        if (logger) {
          Logger.error(failedMsg);
        } else {
          Logger.info(failedMsg);
        }
      }

      // Log informativo quando não há operações
      if (rows.length === 0) {
        const noOpsMsg = `⏰ Nenhuma operação encontrada.`;
        if (logger) {
          logger.info(noOpsMsg);
        } else {
          Logger.info(noOpsMsg);
        }

        // Log resumo da análise quando não há operações
        Logger.info(`\n📈 RESUMO DA ANÁLISE:`);
        Logger.info(`   • Mercados analisados: ${dataset.length}`);
        Logger.info(`   • Sinais encontrados: 0`);
        Logger.info(`   • Operações executadas: 0`);
      }

      // Monitoramento de ordens pendentes agora é feito a cada 5 segundos em app.js
      // para resposta mais rápida na criação de take profits

      // Após toda a análise, logar monitoramento de todas as posições abertas
      // Skip monitoring for HFT bots as they use their own management system
      if (config?.strategyName !== 'HFT' && config?.enableOrphanOrderMonitor !== false) {
        await OrderController.checkForUnmonitoredPositions(config?.botName, config);
      }
    } catch (error) {
      const errorMsg = `❌ Erro na análise: ${error.message}`;
      if (logger) {
        logger.error(errorMsg);
      } else {
        Logger.error(errorMsg);
      }
    }
  }
}

export default Decision;
