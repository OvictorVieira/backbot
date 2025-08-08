import Futures from '../Backpack/Authenticated/Futures.js';
import Order from '../Backpack/Authenticated/Order.js';
import OrderController from '../Controllers/OrderController.js';
import AccountController from '../Controllers/AccountController.js';
import Markets from '../Backpack/Public/Markets.js';
import { calculateIndicators } from './Indicators.js';
import { StrategyFactory } from './Strategies/StrategyFactory.js';

const STRATEGY_DEFAULT = 'DEFAULT';

class Decision {
  constructor(strategyType = null) {
    // A estratégia deve ser sempre definida via parâmetro (terminal)
    // Não usa mais variável de ambiente como fallback
    if (!strategyType) {
      throw new Error('❌ Estratégia deve ser definida via parâmetro. Use o terminal para selecionar a estratégia.');
    }
    
    console.log(`🔍 Decision: Estratégia definida via terminal: "${strategyType}"`);
    
    this.strategy = StrategyFactory.createStrategy(strategyType);
    
    console.log(`🤖 Estratégia carregada: ${strategyType.toUpperCase()}`);
    
    // Cache simples para dados de mercado
    this.marketCache = new Map();
    this.cacheTimeout = 30000; // 30 segundos
  }

  /**
   * Re-inicializa a estratégia (útil para mudanças dinâmicas)
   * @param {string} strategyType - Tipo da estratégia
   */
  reinitializeStrategy(strategyType) {
    console.log(`🔄 Re-inicializando estratégia: ${strategyType.toUpperCase()}`);
    this.strategy = StrategyFactory.createStrategy(strategyType);
    console.log(`✅ Estratégia re-inicializada: ${strategyType.toUpperCase()}`);
  }

  /**
   * Mostra uma barra de progresso animada até a próxima execução
   * @param {number} durationMs - Duração total em milissegundos
   * @param {string} nextTime - Horário da próxima execução
   */
  showLoadingProgress(durationMs, nextTime) {
    const interval = 200; // Atualiza a cada 200ms para ser mais suave
    const steps = Math.floor(durationMs / interval);
    let currentStep = 0;
    let isActive = true;
    let timeoutId = null;
    
    // Função para limpar a linha do progresso
    const clearProgressLine = () => {
      process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
    };
    
    // Função para mostrar o progresso no rodapé
    const showProgress = (progress, bar, percentage) => {
      // Move o cursor para o final da tela
      process.stdout.write('\x1b[9999;0H');
      // Limpa a linha atual
      clearProgressLine();
      // Mostra o progresso
      process.stdout.write(`⏳ Aguardando próxima análise... [${bar}] ${percentage}% | Próxima: ${nextTime}`);
    };
    
    // Intercepta console.log para manter o progresso no rodapé
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    
    console.log = (...args) => {
      if (isActive) {
        // Limpa a linha do progresso antes de mostrar o log
        clearProgressLine();
        // Mostra o log
        originalLog.apply(console, args);
        // Restaura o progresso no rodapé
        const progress = Math.min((currentStep / steps) * 100, 100);
        const filledBlocks = Math.floor(progress / 2);
        const emptyBlocks = 50 - filledBlocks;
        const bar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
        const percentage = Math.floor(progress);
        showProgress(progress, bar, percentage);
      } else {
        originalLog.apply(console, args);
        }
    };

    // Intercepta console.error
    console.error = (...args) => {
      if (isActive) {
        clearProgressLine();
        originalError.apply(console, args);
        const progress = Math.min((currentStep / steps) * 100, 100);
        const filledBlocks = Math.floor(progress / 2);
        const emptyBlocks = 50 - filledBlocks;
        const bar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
        const percentage = Math.floor(progress);
        showProgress(progress, bar, percentage);
      } else {
        originalError.apply(console, args);
      }
    };

    // Intercepta console.warn
    console.warn = (...args) => {
      if (isActive) {
        clearProgressLine();
        originalWarn.apply(console, args);
        const progress = Math.min((currentStep / steps) * 100, 100);
        const filledBlocks = Math.floor(progress / 2);
        const emptyBlocks = 50 - filledBlocks;
        const bar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
        const percentage = Math.floor(progress);
        showProgress(progress, bar, percentage);
      } else {
        originalWarn.apply(console, args);
      }
    };
    
    const progressBar = () => {
      if (!isActive) {
        // Restaura console.log original
        console.log = originalLog;
        console.error = originalError;
        console.warn = originalWarn;
        return;
      }
      
      const progress = Math.min((currentStep / steps) * 100, 100);
      const filledBlocks = Math.floor(progress / 2);
      const emptyBlocks = 50 - filledBlocks;
      
      const bar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
      const percentage = Math.floor(progress);
      
      // Mostra o progresso no rodapé
      showProgress(progress, bar, percentage);
      
      currentStep++;
      
      if (currentStep <= steps && isActive) {
        timeoutId = setTimeout(progressBar, interval);
      } else {
        // Limpa a linha quando termina e restaura console.log
        clearProgressLine();
        console.log = originalLog;
        console.error = originalError;
        console.warn = originalWarn;
      }
    };
    
    // Pequeno delay para não interferir com logs anteriores
    setTimeout(progressBar, 500);
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
    
    // Usa 100 candles para garantir que todos os indicadores tenham dados suficientes
    const candleCount = 100;

    const markets = Account.markets.filter((el) => {
      return !closed_markets.includes(el.symbol) 
    })

    try {
      // Paraleliza a coleta de dados de todos os mercados com cache
      const dataPromises = markets.map(async (market) => {
        try {
          const cacheKey = `${market.symbol}_${currentTimeframe}`;
          const now = Date.now();
          const cached = this.marketCache.get(cacheKey);
          
          let getAllMarkPrices, candles;
          
          // Verifica se há cache válido
          if (cached && (now - cached.timestamp) < this.cacheTimeout) {
            getAllMarkPrices = cached.markPrices;
            candles = cached.candles;
            const cacheMsg = `📦 Cache hit para ${market.symbol}`;
            if (logger) {
              logger.info(cacheMsg);
            } else {
              console.log(cacheMsg);
            }
          } else {
            // Busca dados novos
            const markets = new Markets();
            [getAllMarkPrices, candles] = await Promise.all([
              markets.getAllMarkPrices(market.symbol),
              markets.getKLines(market.symbol, currentTimeframe, candleCount)
            ]);
            
            // Salva no cache
            this.marketCache.set(cacheKey, {
              markPrices: getAllMarkPrices,
              candles: candles,
              timestamp: now
            });
          }
          
          const analyze = await calculateIndicators(candles, currentTimeframe, market.symbol);
          const marketPrice = getAllMarkPrices[0].markPrice;

          // const analyzeMsg = `🔍 Analyzing ${String(market.symbol).replace("_USDC_PERP", "")}`;
          // if (logger) {
          //   logger.info(analyzeMsg);
          // } else {
          //   console.log(analyzeMsg);
          // }

          return {
            candles,
            market,
            marketPrice,
            symbol: market.symbol, // Adiciona o símbolo diretamente
            ...analyze
          };
        } catch (error) {
          const errorMsg = `❌ Erro ao processar ${market.symbol}: ${error.message}`;
          if (logger) {
            logger.error(errorMsg);
          } else {
            console.error(errorMsg);
          }
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
      const errorMsg = '❌ getDataset - Error:';
      if (logger) {
        logger.error(errorMsg);
      } else {
        console.error(errorMsg);
      }
    }

    return dataset;
  }


  async analyzeTrades(fee, datasets, investmentUSD, media_rsi, config = null, btcTrend = 'NEUTRAL') {
    // Paraleliza a análise de todos os datasets
    const analysisPromises = datasets.map(async (data) => {
      try {
        // Obtém os dados de mercado para o símbolo atual
        const marketInfo = await this.getMarketInfo(data.symbol, config);
        

        
        if (!marketInfo) {
          console.error(`❌ [${config?.strategyName || 'DEFAULT'}] Market não encontrado para ${data.symbol}`);
          return null;
        }

        // Valida se os dados de decimal estão disponíveis
        if (marketInfo.decimal_quantity === undefined || marketInfo.decimal_quantity === null || 
            marketInfo.decimal_price === undefined || marketInfo.decimal_price === null || 
            marketInfo.stepSize_quantity === undefined || marketInfo.stepSize_quantity === null) {
          console.error(`❌ [${config?.strategyName || 'DEFAULT'}] Dados de decimal ausentes para ${data.symbol}. Dados disponíveis:`, {
            decimal_quantity: marketInfo.decimal_quantity,
            decimal_price: marketInfo.decimal_price,
            stepSize_quantity: marketInfo.stepSize_quantity
          });
          return null;
        }

        // Adiciona os dados de mercado ao objeto data
        const dataWithMarket = {
          ...data,
          market: marketInfo
        };

        return await this.strategy.analyzeTrade(fee, dataWithMarket, investmentUSD, media_rsi, config, btcTrend);
      } catch (error) {
        const errorMsg = `❌ Erro na análise de ${data.symbol}: ${error.message}`;
        console.error(errorMsg);
        return null;
      }
    });

    // Executa todas as análises em paralelo
    const analysisResults = await Promise.all(analysisPromises);
    
    // Filtra resultados nulos e ordena por PnL
    return analysisResults
      .filter(result => result !== null)
      .sort((a, b) => b.pnl - a.pnl);
  }

  /**
   * Obtém informações de mercado para um símbolo específico
   * @param {string} symbol - Símbolo do mercado
   * @param {object} config - Configuração da conta
   * @returns {object|null} - Dados de mercado ou null se não encontrado
   */
  async getMarketInfo(symbol, config = null) {
    try {
      // Obtém os dados da conta
      const Account = await AccountController.get(config);
      
      if (!Account || !Account.markets) {
        console.error(`❌ [${config?.strategyName || 'DEFAULT'}] Dados da conta não disponíveis`);
        return null;
      }

      // Encontra o market correspondente ao símbolo
      const marketInfo = Account.markets.find((el) => el.symbol === symbol);
      
      if (!marketInfo) {
        console.error(`❌ [${config?.strategyName || 'DEFAULT'}] Market não encontrado para ${symbol}. Markets disponíveis: ${Account.markets?.map(m => m.symbol).join(', ') || 'nenhum'}`);
        return null;
      }

      return marketInfo;
    } catch (error) {
      console.error(`❌ Erro ao obter dados de mercado para ${symbol}: ${error.message}`);
      return null;
    }
  }

  analyzeMarket(candles, marketPrice, market) {
  const parsed = candles.map(c => ({
    open: parseFloat(c.open),
    close: parseFloat(c.close),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    volume: parseFloat(c.volume),
    quoteVolume: parseFloat(c.quoteVolume),
    trades: parseInt(c.trades),
    start: c.start,
    end: c.end
  }));

  const valid = parsed.filter(c => c.volume > 0);
  const volume = valid.reduce((acc, c) => acc + c.volume, 0);

  const last = valid[valid.length - 1] || parsed[parsed.length - 1];

  const entry = last.close;

  const action = marketPrice >= entry ?  'LONG' : 'SHORT'  ;

  return {
    action: action,
    entry: entry,
    marketPrice: marketPrice,
    volume: volume,
    market: market.symbol
  };
  }

  analyzeMAEMACross(candles, marketPrice, period = 25) {

  const closes = candles.map(c => parseFloat(c.close));
  const ma = [];
  const ema = [];
  const k = 2 / (period + 1);

  // Cálculo da MA
  for (let i = 0; i < closes.length; i++) {
    if (i + 1 >= period) {
      const sum = closes.slice(i + 1 - period, i + 1).reduce((a, b) => a + b, 0);
      ma.push(sum / period);
    } else {
      ma.push(null);
    }
  }

  // Cálculo da EMA
  for (let i = 0; i < closes.length; i++) {
    if (i === period - 1) {
      ema.push(ma[i]);
    } else if (i >= period) {
      ema.push(closes[i] * k + ema[i - 1] * (1 - k));
    } else {
      ema.push(null);
    }
  }

  const i = closes.length - 1;
  const iPrev = i - 1;
  const parsedMarketPrice = parseFloat(marketPrice);

  let action = 'NEUTRAL';
  let entry = null;

  if (ma[iPrev] !== null && ema[iPrev] !== null && ma[i] !== null && ema[i] !== null) {
    const prevDiff = ma[iPrev] - ema[iPrev];
    const currDiff = ma[i] - ema[i];

    // MA cruzou EMA de baixo para cima → LONG
    if (prevDiff <= 0 && currDiff > 0) {
      action = 'LONG';
      entry = parseFloat((parsedMarketPrice).toFixed(6));
    }

    // MA cruzou EMA de cima para baixo → SHORT
    else if (prevDiff >= 0 && currDiff < 0) {
      action = 'SHORT';
      entry = parseFloat((parsedMarketPrice).toFixed(6));
    }
  }

  return {
    action,
    entry,
    marketPrice: parsedMarketPrice,
  };
  }

  async analyze(timeframe = null, logger = null, config = null) {

    try {
      
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

    const Account = await AccountController.get(config)

    // Verifica se os dados da conta foram carregados com sucesso
    if (!Account) {
      const errorMsg = '❌ Falha ao carregar dados da conta. Verifique suas credenciais de API.';
      if (logger) {
        logger.error(errorMsg);
      } else {
        console.error(errorMsg);
      }
      return;
    }

    if(Account.leverage > 10 && currentTimeframe !== "1m"){
      const warningMsg = `\nLeverage ${Account.leverage}x and time candle high (${currentTimeframe}) HIGH RISK LIQUIDATION`;
      if (logger) {
        logger.warn(warningMsg);
      } else {
        console.log(warningMsg);
      }
    }
   
    // Usa credenciais do config se disponível
    const apiKey = config?.apiKey;
    const apiSecret = config?.apiSecret;
    
    const positions = await Futures.getOpenPositions(apiKey, apiSecret)
    const closed_markets = positions.map((el) => el.symbol)

    // VALIDAÇÃO: Máximo de ordens - Controla quantidade máxima de posições abertas
    const maxTradesValidation = await OrderController.validateMaxOpenTrades(config?.botName || 'DEFAULT', apiKey, apiSecret, config);
    if (!maxTradesValidation.isValid) {
      const maxTradesMsg = maxTradesValidation.message;
      if (logger) {
        logger.warn(maxTradesMsg);
      } else {
        console.log(maxTradesMsg);
      }
      return;
    } else {
      // Log informativo do status das posições abertas
      const statusMsg = maxTradesValidation.message;
      if (logger) {
        logger.info(statusMsg);
      } else {
        console.log(statusMsg);
      }
    }

    if(positions.length >= Number(Account.maxOpenOrders)){
      const maxOrdersMsg = `Maximum number of orders reached ${positions.length}`;
      if (logger) {
        logger.warn(maxOrdersMsg);
      } else {
        console.log(maxOrdersMsg);
      }
      return
    }

    // Verificação adicional: também verifica ordens abertas para evitar duplicatas
    const openOrders = await Order.getOpenOrders(null, "PERP", apiKey, apiSecret)
    const marketsWithOpenOrders = openOrders ? openOrders.map(order => order.symbol) : []
    const allClosedMarkets = [...new Set([...closed_markets, ...marketsWithOpenOrders])]
    
    // Log de debug para verificar mercados fechados
    if (logger) {
      logger.info(`🔒 Mercados com posições: ${closed_markets.length}, Mercados com ordens: ${marketsWithOpenOrders.length}, Total fechados: ${allClosedMarkets.length}`);
    }

    // ANÁLISE DO BTC PRIMEIRO (antes das altcoins)
    // Pula análise do BTC para AlphaFlow (cada moeda tem suas particularidades)
    let btcTrend = 'NEUTRAL';
    if (this.strategy.constructor.name !== 'AlphaFlowStrategy') {
      console.log(`\n📊 ANÁLISE DO BTC (${currentTimeframe}):`);
      try {
        // Usa 100 candles para garantir que todos os indicadores tenham dados suficientes
        const markets = new Markets();
      const btcCandles = await markets.getKLines('BTC_USDC_PERP', currentTimeframe, 100);
        if (btcCandles && btcCandles.length > 0) {
          const btcIndicators = await calculateIndicators(btcCandles, currentTimeframe, 'BTC_USDC_PERP');
          
          // Validação adicional dos indicadores do BTC
          if (!btcIndicators || !btcIndicators.rsi || !btcIndicators.stoch || !btcIndicators.macd || !btcIndicators.adx) {
            console.log(`   ⚠️ BTC: Dados de indicadores insuficientes`);
          } else {
            const btcAnalysis = this.strategy.analyzeSignals(btcIndicators, true, config);
            
            if (btcAnalysis && btcAnalysis.hasSignal) {
              console.log(`   🟢 BTC: ${btcAnalysis.signalType}`);
              if (btcAnalysis.analysisDetails && btcAnalysis.analysisDetails.length > 0) {
                btcAnalysis.analysisDetails.forEach(detail => {
                  console.log(`      • ${detail}`);
                });
              }
              // Define tendência do BTC baseada no sinal
              btcTrend = btcAnalysis.isLong ? 'BULLISH' : 'BEARISH';
            } else {
              console.log(`\n⚪ BTC: Sem sinais (NEUTRO - não permite operações em altcoins)`);
              if (btcAnalysis && btcAnalysis.analysisDetails && btcAnalysis.analysisDetails.length > 0) {
                btcAnalysis.analysisDetails.forEach(detail => {
                  console.log(`      • ${detail}`);
                });
              }
              btcTrend = 'NEUTRAL';
            }
          }
        } else {
          console.log(`   ⚠️ BTC: Dados de candles insuficientes`);
        }
      } catch (error) {
        console.log(`   ❌ BTC: Erro na análise - ${error.message}`);
        console.log(`      Detalhes: ${error.stack?.split('\n')[1] || 'Erro desconhecido'}`);
      }
    } else {
      console.log(`\n🧠 ALPHAFLOW: Análise BTC desabilitada (cada moeda tem suas particularidades)`);
    }

    const dataset = await this.getDataset(Account, allClosedMarkets, currentTimeframe, logger, config)

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
   • 💰 Money Flow: Filtro de confirmação - MFI > 50 (LONG) / < 50 (SHORT) + mfiValue
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
   • Capital BRONZE: ${config?.capitalPercentage || 50}%
   • Capital SILVER: ${config?.capitalPercentage || 75}%
   • Capital GOLD: ${config?.capitalPercentage || 100}%
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

    // Usa configuração passada como parâmetro ou valor padrão
    const CAPITAL_PERCENTAGE = config?.capitalPercentage || 20
    
    let investmentUSD;
    
    // Usa porcentagem do capital disponível
    if (CAPITAL_PERCENTAGE > 0) {
      investmentUSD = (Account.capitalAvailable * CAPITAL_PERCENTAGE) / 100;
      const capitalMsg = `💰 CONFIGURAÇÃO: ${CAPITAL_PERCENTAGE}% do capital disponível`;
      if (logger) {
        logger.capital(capitalMsg);
      } else {
        console.log(capitalMsg);
      }
    } else {
      // Fallback para valor padrão
      investmentUSD = 100;
      const fixedMsg = `💰 CONFIGURAÇÃO: Valor padrão de $${investmentUSD.toFixed(2)}`;
      if (logger) {
        logger.capital(fixedMsg);
      } else {
        console.log(fixedMsg);
      }
    }

    // Log explicativo do capital e volume (apenas uma vez por análise)
    if (!this.operationSummaryLogged) {
      const equityAvailable = Account.capitalAvailable / Account.leverage;
      const availableToTrade = Account.capitalAvailable;
      const maxOpenTrades = Number(config?.maxOpenOrders || 5);
      
      const capitalExplanation = `\n💰 RESUMO DA OPERAÇÃO:
   • Capital Disponível: $${equityAvailable.toFixed(2)}
   • Alavancagem: ${Account.leverage}x
   • Disponível para Negociação: $${availableToTrade.toFixed(2)}
   • Volume por operação: $${investmentUSD.toFixed(2)}
   • Máximo de ordens: ${Account.maxOpenOrders} (LIMIT_ORDER)
   • Máximo de posições abertas: ${maxOpenTrades} (MAX_OPEN_ORDERS)`;
      
      if (logger) {
        logger.capital(capitalExplanation);
      } else {
        console.log(capitalExplanation);
      }
      
      this.operationSummaryLogged = true;
    }

    const fee = Account.fee

    // Verificação de margem antes de iniciar análise
    if (Account.capitalAvailable <= 0) {
      const marginMsg = `⚠️ [CAPITAL] Margem insuficiente para iniciar nova análise. Capital disponível: $${Account.capitalAvailable.toFixed(2)}`;
      if (logger) {
        logger.warn(marginMsg);
      } else {
        console.log(marginMsg);
      }
      return;
    }

    console.log(`🔍 [DEBUG] Investment USD sendo usado: $${investmentUSD.toFixed(2)}`);
    const rows = await this.analyzeTrades(fee, dataset, investmentUSD, media_rsi, config, btcTrend)

    // Validação de resultados antes de executar ordens
    if (!rows || rows.length === 0) {
      console.log(`📊 Nenhuma oportunidade de trading encontrada nesta análise`);
      return;
    }

    // Executa ordens em paralelo usando Promise.all
    console.log(`\n🚀 Executando ordens em paralelo...`);
    
    // Prepara todas as ordens
    const orderPromises = rows.map(async (row, index) => {
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
          console.error(`❌ [${config?.botName || 'DEFAULT'}] Decisão inválida (null/undefined):`, row);
          return { index, market: 'UNKNOWN', result: { error: 'Decisão inválida' } };
        }
        
        if (!marketSymbol) {
          console.error(`❌ [${config?.botName || 'DEFAULT'}] Decisão sem símbolo válido:`, {
            hasOrders: !!row.orders,
            ordersLength: row.orders?.length,
            firstOrderMarket: row.orders?.[0]?.market,
            rowMarket: row.market,
            rowSymbol: row.symbol
          });
          return { index, market: 'UNKNOWN', result: { error: 'Decisão sem símbolo válido' } };
        }
        
        const marketInfo = Account.markets.find((el) => el.symbol === marketSymbol);

        // Verifica se o market foi encontrado
        if (!marketInfo) {
          console.error(`❌ [${config?.botName || 'DEFAULT'}] Market não encontrado para ${marketSymbol}. Markets disponíveis: ${Account.markets?.map(m => m.symbol).join(', ') || 'nenhum'}`);
          return { index, market: marketSymbol, result: { error: `Market não encontrado para ${marketSymbol}` } };
        }

        // Valida se os dados de decimal estão disponíveis (aceita 0 como valor válido)
        if (marketInfo.decimal_quantity === undefined || marketInfo.decimal_quantity === null || 
            marketInfo.decimal_price === undefined || marketInfo.decimal_price === null || 
            marketInfo.stepSize_quantity === undefined || marketInfo.stepSize_quantity === null) {
          console.error(`❌ [${config?.botName || 'DEFAULT'}] Dados de decimal ausentes para ${marketSymbol}. Dados disponíveis:`, {
            decimal_quantity: marketInfo.decimal_quantity,
            decimal_price: marketInfo.decimal_price,
            stepSize_quantity: marketInfo.stepSize_quantity
          });
          return { index, market: marketSymbol, result: { error: `Dados de decimal ausentes para ${marketSymbol}` } };
        }

        // Verifica se é uma estratégia Alpha Flow com múltiplas ordens
        if (row.orders && Array.isArray(row.orders) && row.orders.length > 0) {
          console.log(`   🔄 ${marketSymbol}: Processando ${row.orders.length} ordens escalonadas (${row.conviction})`);
          
          // Verifica se já há muitas ordens abertas (limite de 5 por token)
          const existingOrders = await OrderController.getRecentOpenOrders(marketSymbol, config);
          if (existingOrders.length >= 5) {
            console.log(`   ⚠️  ${marketSymbol}: Muitas ordens abertas (${existingOrders.length}), pulando...`);
            return { index, market: marketSymbol, result: { error: `Muitas ordens abertas: ${existingOrders.length}` } };
          }
          
          // Processa múltiplas ordens para Alpha Flow Strategy
          const orderResults = [];
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
              orderNumber: order.orderNumber,
              weight: order.weight,
              // Mantém dados da estratégia para compatibilidade
              conviction: row.conviction,
              reason: row.reason,
              signals: row.signals,
              // Adiciona o nome da estratégia para o TrailingStop
              strategyName: this.strategy.constructor.name
            };



            // Verifica se já existe uma posição ativa para este mercado
            const positions = await Futures.getOpenPositions(apiKey, apiSecret);
            const existingPosition = positions.find(p => p.symbol === marketSymbol && Math.abs(Number(p.netQuantity)) > 0);
            
            if (existingPosition) {
              console.log(`   ⏸️ ${marketSymbol} (Ordem ${order.orderNumber}): Posição ativa existe, pulando...`);
              orderResults.push({ orderNumber: order.orderNumber, result: null });
              continue;
            }

            // Verifica se já existe uma ordem pendente
            const orders = await OrderController.getRecentOpenOrders(marketSymbol, config);

            // Calcula o valor da ordem para log
            const orderValue = orderData.quantity * orderData.entry;
            console.log(`   💰 [DEBUG] ${marketSymbol} (Ordem ${order.orderNumber}): Valor = $${orderValue.toFixed(2)}`);

            // Cancela ordens antigas (mais de 5 minutos) antes de criar novas
            if (orders.length > 0) {
              const oldestOrder = orders[0];
              const orderAge = (Date.now() - new Date(oldestOrder.createdAt).getTime()) / (1000 * 60); // em minutos
              
              if (orderAge > 5) {
                              console.log(`   🗑️  ${marketSymbol}: Cancelando ordens antigas (${orderAge.toFixed(1)} min)`);
              await Order.cancelOpenOrders(marketSymbol, null, apiKey, apiSecret);
              }
            }

            // Verifica se já há muitas ordens abertas (limite de 3 por token)
            const existingOrdersCount = orders.length;
            if (existingOrdersCount >= 3) {
              console.log(`   ⚠️  ${marketSymbol} (Ordem ${order.orderNumber}): Muitas ordens abertas (${existingOrdersCount}), pulando...`);
              orderResults.push({ orderNumber: order.orderNumber, result: { error: `Muitas ordens abertas: ${existingOrdersCount}` } });
              continue;
            }

            if (orders.length > 0 && orders[0].minutes <= 3) {
              orderResults.push({ orderNumber: order.orderNumber, result: null });
            } else {
              const result = await OrderController.openOrder({ ...orderData, strategyName: config?.strategyName || 'DEFAULT' }, config);
              orderResults.push({ orderNumber: order.orderNumber, result });
            }
          }
          
          return { index, market: marketSymbol, result: { orders: orderResults, conviction: row.conviction } };
        } else {
          // Processa ordem única (estratégias tradicionais)
          // Usa os dados fornecidos pela estratégia ou fallback para os padrões
          row.volume = row.volume || investmentUSD;
          row.decimal_quantity = row.decimal_quantity || marketInfo.decimal_quantity;
          row.decimal_price = row.decimal_price || marketInfo.decimal_price;
          row.stepSize_quantity = row.stepSize_quantity || marketInfo.stepSize_quantity;

          // Verifica se já existe uma posição ativa para este mercado
          const positions = await Futures.getOpenPositions(apiKey, apiSecret);
          const existingPosition = positions.find(p => p.symbol === marketSymbol && Math.abs(Number(p.netQuantity)) > 0);
          
          if (existingPosition) {
            // Já existe posição ativa, não criar nova ordem
            console.log(`   ⏸️ ${marketSymbol}: Posição ativa existe (${existingPosition.netQuantity}), pulando...`);
            return { index, market: marketSymbol, result: null };
          }

          // Verifica se já existe uma ordem pendente
          const orders = await OrderController.getRecentOpenOrders(marketSymbol, config);

                      if (orders.length > 0) {
              if (orders[0].minutes > 3) {
                                await Order.cancelOpenOrders(marketSymbol, null, apiKey, apiSecret);
                const result = await OrderController.openOrder({ ...row, strategyName: config?.strategyName || 'DEFAULT' }, config);
              return { index, market: marketSymbol, result };
            } else {
              return { index, market: marketSymbol, result: null };
            }
                      } else {
              const result = await OrderController.openOrder({ ...row, strategyName: config?.strategyName || 'DEFAULT' }, config);
            return { index, market: marketSymbol, result };
          }
        }
        
      } catch (error) {
        const errorMsg = `❌ Erro ao executar ordem para ${marketSymbol}: ${error.message}`;
        if (logger) {
          logger.error(errorMsg);
        } else {
          console.error(errorMsg);
        }
        return { index, market: marketSymbol, result: { error: error.message } };
      }
    });

    // Executa todas as ordens em paralelo
    const orderResults = await Promise.all(orderPromises);
    
    // Ordena os resultados pelo índice original e mostra logs
    orderResults.sort((a, b) => a.index - b.index);
    
    orderResults.forEach(({ market, result }) => {
      // Verifica se é resultado de múltiplas ordens (Alpha Flow)
      if (result && result.orders && Array.isArray(result.orders)) {
        console.log(`   🔄 ${market} (${result.conviction}): ${result.orders.length} ordens escalonadas`);
        
        result.orders.forEach((orderResult, orderIndex) => {
          const orderNumber = orderResult.orderNumber || orderIndex + 1;
          if (orderResult.result && orderResult.result.success) {
            console.log(`      ✅ Ordem ${orderNumber}: Executada`);
          } else if (orderResult.result && orderResult.result.error) {
            console.log(`      ❌ Ordem ${orderNumber}: Falhou - ${orderResult.result.error}`);
          } else {
            console.log(`      ⏸️ Ordem ${orderNumber}: Pulada`);
          }
        });
      } else {
        // Resultado de ordem única (estratégias tradicionais)
        if (result && result.success) {
          console.log(`   ✅ ${market}: Executada`);
        } else if (result && result.error) {
          console.log(`   ❌ ${market}: Falhou - ${result.error}`);
        } else {
          console.log(`   ⏸️ ${market}: Pulado (ordem recente)`);
        }
      }
    });
    
    // Log dos resultados
    const successfulOrders = orderResults.filter(({ result }) => {
      if (result && result.orders && Array.isArray(result.orders)) {
        // Para Alpha Flow, conta ordens individuais
        return result.orders.some(orderResult => orderResult.result && orderResult.result.success);
      } else {
        // Para estratégias tradicionais
        return result && result.success;
      }
    });
    
    const failedOrders = orderResults.filter(({ result }) => {
      if (result && result.orders && Array.isArray(result.orders)) {
        // Para Alpha Flow, conta ordens individuais
        return result.orders.every(orderResult => !orderResult.result || orderResult.result.error);
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
    console.log(`\n📈 RESUMO DA ANÁLISE:`);
    console.log(`   • Mercados analisados: ${dataset.length}`);
    console.log(`   • Sinais encontrados: ${rows.length}`);
    console.log(`   • Operações executadas: ${successfulOrders.length}`);
    console.log(`   • Operações falharam: ${failedOrders.length}`);
    
    orderResults.forEach(({ market, result }) => {
      // Para Alpha Flow Strategy com múltiplas ordens
      if (result && result.orders && Array.isArray(result.orders)) {
        const successfulCount = result.orders.filter(orderResult => orderResult.result && orderResult.result.success).length;
        const totalCount = result.orders.length;
        const status = successfulCount > 0 ? '✅' : '❌';
        const orderMsg = `${status} ${market} (${result.conviction}): ${successfulCount}/${totalCount} ordens executadas`;
        
        if (logger) {
          logger.order(orderMsg);
        } else {
          console.log(orderMsg);
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
          console.log(orderMsg);
        }
      }
    });
    
    if (successfulOrders.length > 0) {
      const successMsg = `✅ ${successfulOrders.length} ordens executadas com sucesso`;
      if (logger) {
        logger.success(successMsg);
      } else {
        console.log(successMsg);
      }
    }
    if (failedOrders.length > 0) {
      const failedMsg = `❌ ${failedOrders.length} ordens falharam`;
      if (logger) {
        logger.error(failedMsg);
      } else {
        console.log(failedMsg);
      }
    }
    


    // Log informativo quando não há operações
    if (rows.length === 0) {
      const noOpsMsg = `⏰ Nenhuma operação encontrada.`;
      if (logger) {
        logger.info(noOpsMsg);
      } else {
        console.log(noOpsMsg);
      }
      
      // Log resumo da análise quando não há operações
      console.log(`\n📈 RESUMO DA ANÁLISE:`);
      console.log(`   • Mercados analisados: ${dataset.length}`);
      console.log(`   • Sinais encontrados: 0`);
      console.log(`   • Operações executadas: 0`);
    }

    // Monitoramento de ordens pendentes agora é feito a cada 5 segundos em app.js
    // para resposta mais rápida na criação de take profits

    // Após toda a análise, logar monitoramento de todas as posições abertas
    await OrderController.checkForUnmonitoredPositions(config?.botName, config);

    } catch (error) {
      const errorMsg = `❌ Erro na análise: ${error.message}`;
      if (logger) {
        logger.error(errorMsg);
      } else {
        console.error(errorMsg);
      }
    }
  }
}

export default Decision;