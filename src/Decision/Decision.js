import Futures from '../Backpack/Authenticated/Futures.js';
import Order from '../Backpack/Authenticated/Order.js';
import OrderController from '../Controllers/OrderController.js';
import AccountController from '../Controllers/AccountController.js';
import Markets from '../Backpack/Public/Markets.js';
import { calculateIndicators } from './Indicators.js';
import { StrategyFactory } from './Strategies/StrategyFactory.js';
import Logger from '../Utils/Logger.js';
import RiskManager from '../Risk/RiskManager.js';

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
    let markets = Account.markets.filter(el => {
      return !closed_markets.includes(el.symbol);
    });

    // Se config tem authorizedTokens, filtra apenas esses tokens
    if (config?.authorizedTokens && config.authorizedTokens.length > 0) {
      markets = markets.filter(el => config.authorizedTokens.includes(el.symbol));
    }

    try {
      // Paraleliza a coleta de dados de todos os mercados com cache
      const dataPromises = markets.map(async market => {
        try {
          const cacheKey = `${market.symbol}_${currentTimeframe}`;
          const now = Date.now();
          const cached = this.marketCache.get(cacheKey);

          let getAllMarkPrices, candles;

          // Verifica se há cache válido
          if (cached && now - cached.timestamp < this.cacheTimeout) {
            getAllMarkPrices = cached.markPrices;
            candles = cached.candles;
            Logger.debug(`📦 Cache hit para ${market.symbol}`);
          } else {
            // Busca dados novos
            const markets = new Markets();
            [getAllMarkPrices, candles] = await Promise.all([
              markets.getAllMarkPrices(market.symbol),
              markets.getKLines(market.symbol, currentTimeframe, candleCount),
            ]);

            // Salva no cache
            this.marketCache.set(cacheKey, {
              markPrices: getAllMarkPrices,
              candles: candles,
              timestamp: now,
            });
          }

          const analyze = await calculateIndicators(candles, currentTimeframe, market.symbol);

          // Find the correct price for this symbol
          let marketPrice;
          if (Array.isArray(getAllMarkPrices)) {
            const symbolPriceData = getAllMarkPrices.find(item => item.symbol === market.symbol);
            marketPrice = symbolPriceData
              ? symbolPriceData.markPrice
              : getAllMarkPrices[0]?.markPrice;
          } else {
            marketPrice = getAllMarkPrices?.markPrice || getAllMarkPrices;
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

      if (!Account || !Account.markets) {
        Logger.error(`❌ [${config?.strategyName || 'DEFAULT'}] Dados da conta não disponíveis`);
        return null;
      }

      // Encontra o market correspondente ao símbolo
      const marketInfo = Account.markets.find(el => el.symbol === symbol);

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

  async analyze(timeframe = null, logger = null, config = null) {
    try {
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

      const Account = await AccountController.get(configWithStrategy);

      // Verifica se os dados da conta foram carregados com sucesso
      if (!Account) {
        Logger.error('❌ Falha ao carregar dados da conta. Verifique suas credenciais de API.');
        return;
      }

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
      const exchangePositions = await Futures.getOpenPositionsForceRefresh(apiKey, apiSecret);

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
        });
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
      const openOrders = await Order.getOpenOrders(null, 'PERP', apiKey, apiSecret);
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
                const btcAnalysis = this.strategy.analyzeSignals(btcIndicators, true, config);

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
        Account,
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
        logger.info(validationSummary);
      } else {
        console.log(validationSummary);
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
          logger.info(rsiMsg);
        } else {
          console.log(rsiMsg);
        }
      }

      const investmentUSD = RiskManager.calculateInvestmentAmount(Account.capitalAvailable, config);

      // Verificação adicional: se investmentUSD é 0, significa que há problema com os dados
      if (investmentUSD <= 0) {
        Logger.warn(`⚠️ Investment calculado como zero ou inválido: $${investmentUSD} - operação será ignorada`);
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
          let marketSymbol;
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

          // ✅ DEFENSIVE CHECK: Se Account ou markets não disponíveis
          if (!Account || !Account.markets) {
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

          const marketInfo = Account.markets.find(el => el.symbol === marketSymbol);

          // Verifica se o market foi encontrado
          if (!marketInfo) {
            Logger.error(
              `❌ [${config?.botName || 'DEFAULT'}] Market não encontrado para ${marketSymbol}. Markets disponíveis: ${Account.markets?.map(m => m.symbol).join(', ') || 'nenhum'}`
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
              const positions = await Futures.getOpenPositions(apiKey, apiSecret);
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
                  await Order.cancelOpenOrders(marketSymbol, null, apiKey, apiSecret);
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
            const positions = await Futures.getOpenPositions(apiKey, apiSecret);
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

            // Verifica se já existe uma ordem pendente
            const orders = await OrderController.getRecentOpenOrders(marketSymbol, config);

            if (orders.length > 0) {
              if (orders[0].minutes > 3) {
                await Order.cancelOpenOrders(marketSymbol, null, apiKey, apiSecret);
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
