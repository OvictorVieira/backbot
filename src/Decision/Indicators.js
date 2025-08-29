import { EMA, RSI, MACD, BollingerBands, ATR, Stochastic, ADX, MFI } from 'technicalindicators';
import axios from 'axios';
import Logger from '../Utils/Logger.js';

/**
 * Calcula o VWAP e suas bandas de desvio padrão da forma correta (cumulativo com reset diário).
 * @param {Array<Object>} candles - Array de candles, ordenados do mais antigo para o mais novo.
 * @returns {Object} - Objeto com { current, previous } contendo dados da vela atual e anterior.
 */
function calculateIntradayVWAP(candles) {
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  let currentDay = null;
  const vwapHistory = [];

  // Este array irá guardar as velas da sessão atual para calcular o desvio padrão
  let sessionCandles = [];

  for (const c of candles) {
    const high = parseFloat(c.high);
    const low = parseFloat(c.low);
    const close = parseFloat(c.close);
    const volume = parseFloat(c.volume);

    // Usa a data de início da vela para detectar a mudança de dia
    const candleDay = new Date(c.start).getUTCDate();

    // Se o dia mudou, reseta os contadores e a sessão
    if (candleDay !== currentDay) {
      currentDay = candleDay;
      cumulativeTPV = 0;
      cumulativeVolume = 0;
      sessionCandles = [];
    }

    // Validação para evitar dados inválidos
    if (isNaN(high) || isNaN(low) || isNaN(close) || isNaN(volume)) {
      vwapHistory.push(
        vwapHistory.length > 0 ? vwapHistory[vwapHistory.length - 1] : { vwap: close }
      ); // Repete o último valor válido
      continue;
    }

    // Acumula os valores da sessão atual
    const typicalPrice = (high + low + close) / 3;
    cumulativeTPV += typicalPrice * volume;
    cumulativeVolume += volume;
    sessionCandles.push({ typicalPrice, volume });

    // Calcula o VWAP para a vela atual
    const vwap = cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice;

    // --- Cálculo do Desvio Padrão para a sessão atual ---
    let sumVarV = 0;
    for (const sc of sessionCandles) {
      const diff = sc.typicalPrice - vwap;
      sumVarV += sc.volume * diff * diff;
    }

    const variance = cumulativeVolume > 0 ? sumVarV / cumulativeVolume : 0;
    const stdDev = Math.sqrt(variance);

    // Adiciona o resultado do VWAP e suas bandas para esta vela ao histórico
    vwapHistory.push({
      vwap,
      stdDev,
      upperBands: [vwap + stdDev, vwap + 2 * stdDev, vwap + 3 * stdDev],
      lowerBands: [vwap - stdDev, vwap - 2 * stdDev, vwap - 3 * stdDev],
    });
  }

  // Retorna dados atuais e anteriores para detecção de mudança de estado
  const current = vwapHistory[vwapHistory.length - 1] || {
    vwap: null,
    stdDev: null,
    upperBands: [],
    lowerBands: [],
  };
  const previous = vwapHistory[vwapHistory.length - 2] || {
    vwap: null,
    stdDev: null,
    upperBands: [],
    lowerBands: [],
  };

  return {
    current,
    previous,
  };
}

/**
 * Função WaveTrend (MOMENTUM) - Indicador de momentum avançado
 * @param {Array} candles - Array de candles
 * @param {number} channelLen - Comprimento do Canal (padrão: 9)
 * @param {number} avgLen - Comprimento da Média (padrão: 12)
 * @param {number} maLen - Comprimento da MA do Sinal (padrão: 3)
 * @returns {Object} - Dados do WaveTrend
 */
function calculateWaveTrend(candles, channelLen = 9, avgLen = 12, maLen = 3) {
  if (candles.length < Math.max(channelLen, avgLen, maLen)) {
    return {
      wt1: null,
      wt2: null,
      vwap: null,
      reversal: null,
      isBullish: false,
      isBearish: false,
    };
  }

  const hlc3 = candles.map(c => (parseFloat(c.high) + parseFloat(c.low) + parseFloat(c.close)) / 3);

  // Calcular ESA (EMA do HLC3)
  const esa = EMA.calculate({ period: channelLen, values: hlc3 });

  // Calcular DE (EMA do valor absoluto da diferença)
  const deValues = [];
  for (let i = 0; i < hlc3.length; i++) {
    if (esa[i] !== null && esa[i] !== undefined && !isNaN(esa[i])) {
      deValues.push(Math.abs(hlc3[i] - esa[i]));
    } else {
      deValues.push(0);
    }
  }
  const de = EMA.calculate({ period: channelLen, values: deValues });

  // Calcular CI (Chande Momentum Oscillator)
  const ci = [];
  for (let i = 0; i < hlc3.length; i++) {
    if (esa[i] !== null && de[i] !== null && de[i] !== 0 && !isNaN(esa[i]) && !isNaN(de[i])) {
      const ciValue = (hlc3[i] - esa[i]) / (0.015 * de[i]);
      ci.push(isNaN(ciValue) ? 0 : ciValue);
    } else {
      ci.push(0);
    }
  }

  // Calcular WT1 (EMA do CI)
  const wt1 = EMA.calculate({ period: avgLen, values: ci });

  // Calcular WT2 (SMA do WT1)
  const wt2 = [];
  for (let i = 0; i < wt1.length; i++) {
    if (i >= maLen - 1) {
      const validValues = wt1
        .slice(i - maLen + 1, i + 1)
        .filter(val => val !== null && !isNaN(val));
      if (validValues.length > 0) {
        const sum = validValues.reduce((acc, val) => acc + val, 0);
        wt2.push(sum / validValues.length);
      } else {
        wt2.push(0);
      }
    } else {
      wt2.push(null);
    }
  }

  // Calcular VWAP (WT1 - WT2)
  const vwap = [];
  for (let i = 0; i < wt1.length; i++) {
    if (wt1[i] !== null && wt2[i] !== null && !isNaN(wt1[i]) && !isNaN(wt2[i])) {
      vwap.push(wt1[i] - wt2[i]);
    } else {
      vwap.push(null);
    }
  }

  // Detectar reversão
  let reversal = null;
  if (wt1.length >= 2 && wt2.length >= 2) {
    const currentWt1 = wt1[wt1.length - 1];
    const prevWt1 = wt1[wt1.length - 2];
    const currentWt2 = wt2[wt2.length - 1];
    const prevWt2 = wt2[wt2.length - 2];

    if (
      currentWt1 !== null &&
      prevWt1 !== null &&
      currentWt2 !== null &&
      prevWt2 !== null &&
      !isNaN(currentWt1) &&
      !isNaN(prevWt1) &&
      !isNaN(currentWt2) &&
      !isNaN(prevWt2)
    ) {
      // Crossover (Golden Cross)
      if (prevWt1 <= prevWt2 && currentWt1 > currentWt2) {
        reversal = { type: 'GREEN', strength: Math.abs(currentWt1 - currentWt2) };
      }
      // Crossunder (Death Cross)
      else if (prevWt1 >= prevWt2 && currentWt1 < currentWt2) {
        reversal = { type: 'RED', strength: Math.abs(currentWt1 - currentWt2) };
      }
    }
  }

  const currentWt1 = wt1[wt1.length - 1];
  const currentWt2 = wt2[wt2.length - 1];
  const currentVwap = vwap[vwap.length - 1];

  return {
    wt1: currentWt1,
    wt2: currentWt2,
    vwap: currentVwap,
    reversal: reversal,
    isBullish:
      currentWt1 !== null &&
      currentWt2 !== null &&
      !isNaN(currentWt1) &&
      !isNaN(currentWt2) &&
      currentWt1 > currentWt2,
    isBearish:
      currentWt1 !== null &&
      currentWt2 !== null &&
      !isNaN(currentWt1) &&
      !isNaN(currentWt2) &&
      currentWt1 < currentWt2,
    history: {
      wt1: wt1,
      wt2: wt2,
      vwap: vwap,
    },
  };
}

/**
 * Calcula o Money Flow Index (MFI) e seus sinais derivados.
 * @param {Array<Object>} candles - Array de candles.
 * @param {number} mfiPeriod - Período para o cálculo do MFI (padrão: 14).
 * @param {number} signalPeriod - Período para a média móvel (SMA) do MFI (padrão: 9).
 * @returns {Object} - Um objeto contendo os dados do Money Flow.
 */
function calculateMoneyFlow(candles, mfiPeriod = 14, signalPeriod = 9) {
  // A validação de quantidade de velas está correta
  if (candles.length < mfiPeriod + 1) {
    return {
      current: {
        value: 0,
        mfi: 50,
        mfiAvg: 50,
        isBullish: false,
        isBearish: false,
        isStrong: false,
        direction: 'NEUTRAL',
      },
      previous: {
        value: 0,
        mfi: 50,
        mfiAvg: 50,
        isBullish: false,
        isBearish: false,
        isStrong: false,
        direction: 'NEUTRAL',
      },
      history: [],
    };
  }

  // --- Passo 1: Calcular o Fluxo de Dinheiro Bruto com conversão de dados ---
  const moneyFlows = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];

    // **A CORREÇÃO ESTÁ AQUI**
    const high = parseFloat(c.high);
    const low = parseFloat(c.low);
    const close = parseFloat(c.close);
    const volume = parseFloat(c.volume);

    const prevHigh = parseFloat(p.high);
    const prevLow = parseFloat(p.low);
    const prevClose = parseFloat(p.close);

    // Validar se os dados são numéricos após a conversão
    if (isNaN(high) || isNaN(low) || isNaN(close) || isNaN(volume)) {
      console.warn(
        `⚠️ [MFI] Dados inválidos no candle ${i}: high=${c.high}, low=${c.low}, close=${c.close}, volume=${c.volume}`
      );
      continue;
    }

    const typicalPrice = (high + low + close) / 3;
    const prevTypicalPrice = (prevHigh + prevLow + prevClose) / 3;
    const rawMoneyFlow = typicalPrice * volume;

    moneyFlows.push({
      positive: typicalPrice > prevTypicalPrice ? rawMoneyFlow : 0,
      negative: typicalPrice < prevTypicalPrice ? rawMoneyFlow : 0,
    });
  }

  // O resto da função continua igual, pois agora ela receberá os dados corretos...

  // --- Passo 2: Calcular o histórico de MFI ---
  const mfiHistory = [];
  // (código omitido para brevidade, continua o mesmo da resposta anterior)
  for (let i = mfiPeriod - 1; i < moneyFlows.length; i++) {
    const slice = moneyFlows.slice(i - mfiPeriod + 1, i + 1);
    const totalPositiveFlow = slice.reduce((sum, val) => sum + val.positive, 0);
    const totalNegativeFlow = slice.reduce((sum, val) => sum + val.negative, 0);

    if (totalNegativeFlow === 0) {
      console.warn(`⚠️ [MFI] Fluxo negativo zero no período ${i}, definindo MFI como 100`);
      mfiHistory.push(100);
      continue;
    }

    const moneyRatio = totalPositiveFlow / totalNegativeFlow;
    const mfi = 100 - 100 / (1 + moneyRatio);
    mfiHistory.push(mfi);
  }

  // --- Passo 3: Calcular a média (linha de sinal) do MFI ---
  const mfiAvgHistory = [];
  if (mfiHistory.length >= signalPeriod) {
    for (let i = signalPeriod - 1; i < mfiHistory.length; i++) {
      const smaSlice = mfiHistory.slice(i - signalPeriod + 1, i + 1);
      const sma = smaSlice.reduce((sum, val) => sum + val, 0) / signalPeriod;
      mfiAvgHistory.push(sma);
    }
  }

  // --- Passo 4: Obter os valores atuais e anteriores ---
  const currentMfi = mfiHistory[mfiHistory.length - 1] || 50;
  const currentMfiAvg = mfiAvgHistory[mfiAvgHistory.length - 1] || 50;
  const currentMfiValue = currentMfi - currentMfiAvg;

  const previousMfi = mfiHistory[mfiHistory.length - 2] || 50;
  const previousMfiAvg = mfiAvgHistory[mfiAvgHistory.length - 2] || 50;
  const previousMfiValue = previousMfi - previousMfiAvg;

  // --- Passo 5: Montar o objeto de retorno com dados atuais e anteriores ---
  return {
    current: {
      value: currentMfiValue,
      mfi: currentMfi,
      mfiAvg: currentMfiAvg,
      isBullish: currentMfiValue > 0,
      isBearish: currentMfiValue < 0,
      isStrong: Math.abs(currentMfiValue) > 10,
      direction: currentMfiValue > 0 ? 'UP' : currentMfiValue < 0 ? 'DOWN' : 'NEUTRAL',
    },
    previous: {
      value: previousMfiValue,
      mfi: previousMfi,
      mfiAvg: previousMfiAvg,
      isBullish: previousMfiValue > 0,
      isBearish: previousMfiValue < 0,
      isStrong: Math.abs(previousMfiValue) > 10,
      direction: previousMfiValue > 0 ? 'UP' : previousMfiValue < 0 ? 'DOWN' : 'NEUTRAL',
    },
    history: mfiHistory,
  };
}

/**
 * REFATORADO: Calcula o Macro Money Flow baseado em dados diários reais
 * SEMPRE busca dados reais da API - sem fallback com dados fictícios
 * Espelha o comportamento do request.security() do Pine Script
 * @param {Array<Object>} candles - Array de candles do timeframe atual
 * @param {string} timeframe - Timeframe dos candles (ex: '5m', '1h', '1d')
 * @param {string} symbol - Símbolo do mercado (OBRIGATÓRIO para dados reais)
 * @returns {Object} - Objeto com macroBias e dados do MFI diário
 */
async function calculateMacroMoneyFlow(candles, timeframe = '5m', symbol = null) {
  try {
    // Símbolo é OBRIGATÓRIO para dados reais
    if (!symbol) {
      console.error(`❌ [MACRO] Símbolo obrigatório para dados reais`);
      return {
        macroBias: 0,
        mfiCurrent: 50,
        mfiPrevious: 50,
        mfiEmaCurrent: 50,
        mfiEmaPrevious: 50,
        isBullish: false,
        isBearish: false,
        direction: 'NEUTRAL',
        error: 'Símbolo não fornecido',
        dataSource: 'NO_SYMBOL',
      };
    }

    // Busca diretamente da Binance apenas os últimos 22 candles
    const binanceCandles = await getBinanceCandles(symbol, timeframe, 22);

    if (!binanceCandles || binanceCandles.length < 14) {
      console.warn(
        `⚠️ [MACRO] ${symbol}: Par não disponível na Binance ou dados ${timeframe} insuficientes (${binanceCandles?.length || 0} candles)`
      );
      return {
        macroBias: 0,
        mfiCurrent: 50,
        mfiPrevious: 50,
        mfiEmaCurrent: 50,
        mfiEmaPrevious: 50,
        isBullish: false,
        isBearish: false,
        direction: 'NEUTRAL',
        error: `Par não disponível na Binance`,
        dataSource: 'BINANCE_UNAVAILABLE',
        symbol,
      };
    }

    // Calcula MFI com período 14 nos dados do timeframe
    const mfiResult = calculateMoneyFlow(binanceCandles, 14, 9);

    if (!mfiResult.history || mfiResult.history.length < 8) {
      console.error(
        `❌ [MACRO] ${symbol}: Histórico MFI insuficiente (${mfiResult.history?.length || 0} valores) - mínimo 8 valores necessários`
      );
      return {
        macroBias: 0,
        mfiCurrent: 50,
        mfiPrevious: 50,
        mfiEmaCurrent: 50,
        mfiEmaPrevious: 50,
        isBullish: false,
        isBearish: false,
        direction: 'NEUTRAL',
        error: 'Histórico MFI insuficiente',
        dataSource: 'INSUFFICIENT_MFI_HISTORY',
        symbol,
      };
    }

    // Calcula EMA de 22 períodos sobre o MFI

    const mfiValues = mfiResult.history.filter(val => val !== null && !isNaN(val));

    // Ajusta o período da EMA baseado na quantidade de valores disponíveis
    const emaPeriod = Math.min(22, Math.floor(mfiValues.length / 2));

    if (mfiValues.length < emaPeriod) {
      console.warn(
        `⚠️ [MACRO] ${symbol}: Valores MFI insuficientes para EMA (${mfiValues.length} < ${emaPeriod})`
      );
      return {
        macroBias: 0,
        mfiCurrent: 50,
        mfiPrevious: 50,
        mfiEmaCurrent: 50,
        mfiEmaPrevious: 50,
        isBullish: false,
        isBearish: false,
        direction: 'NEUTRAL',
        error: 'Valores MFI insuficientes para EMA',
        dataSource: 'INSUFFICIENT_MFI_FOR_EMA',
        symbol,
      };
    }

    const mfiEma = EMA.calculate({ period: emaPeriod, values: mfiValues });

    // Obtém valores atuais e anteriores
    const mfiCurrent = mfiResult.current.mfi;
    const mfiPrevious = mfiResult.previous.mfi;
    const mfiEmaCurrent = mfiEma[mfiEma.length - 1];
    const mfiEmaPrevious = mfiEma[mfiEma.length - 2];

    // Calcula macroBias baseado na direção da EMA do MFI
    let macroBias = 0;
    let direction = 'NEUTRAL';

    if (mfiEmaCurrent > mfiEmaPrevious) {
      macroBias = 1;
      direction = 'UP';
    } else if (mfiEmaCurrent < mfiEmaPrevious) {
      macroBias = -1;
      direction = 'DOWN';
    }

    Logger.debug(
      `📊 [MACRO] ${symbol}: MFI=${mfiCurrent.toFixed(2)}, EMA=${mfiEmaCurrent.toFixed(2)}, Bias=${macroBias}`
    );

    return {
      macroBias,
      mfiCurrent,
      mfiPrevious,
      mfiEmaCurrent,
      mfiEmaPrevious,
      isBullish: macroBias === 1,
      isBearish: macroBias === -1,
      direction,
      history: mfiResult.history,
      emaHistory: mfiEma,
      dataSource: `${timeframe.toUpperCase()}_BINANCE`,
      symbol,
    };
  } catch (error) {
    console.error(
      `❌ [MACRO] Erro fatal ao calcular Macro Money Flow para ${symbol}: ${error.message}`
    );

    return {
      macroBias: 0,
      mfiCurrent: 50,
      mfiPrevious: 50,
      mfiEmaCurrent: 50,
      mfiEmaPrevious: 50,
      isBullish: false,
      isBearish: false,
      direction: 'NEUTRAL',
      error: error.message,
      dataSource: 'ERROR',
      symbol,
    };
  }
}

/**
 * Busca diretamente da Binance os últimos N candles do timeframe especificado
 * @param {string} symbol - Símbolo (ex: BTC_USDC_PERP)
 * @param {string} timeframe - Timeframe (ex: 1m, 5m, 1h)
 * @param {number} limit - Número de candles (máximo 1000)
 * @returns {Array} - Array de candles no formato padrão
 */
async function getBinanceCandles(symbol, timeframe, limit = 22) {
  try {
    // Converte símbolo para formato Binance
    const binanceSymbol = convertSymbolToBinance(symbol);
    const binanceInterval = convertTimeframeToBinance(timeframe);

    Logger.debug(
      `🔄 [BINANCE] Buscando ${limit} candles ${timeframe} para ${binanceSymbol} (${binanceInterval})`
    );

    const response = await axios.get(
      `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${binanceInterval}&limit=${limit}`
    );

    if (response.status !== 200) {
      // Se a resposta não for ok, retorna null em vez de throw error
      console.warn(
        `⚠️ [BINANCE] Par ${binanceSymbol} não encontrado na Binance (${response.status}: ${response.statusText})`
      );
      return null;
    }

    const data = response.data;

    if (!Array.isArray(data)) {
      console.warn(`⚠️ [BINANCE] Resposta inválida da Binance para ${binanceSymbol}`);
      return null;
    }

    // Converte para formato padrão
    const candles = data.map(candle => ({
      timestamp: candle[0], // Timestamp de abertura
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      volume: parseFloat(candle[5]),
      start: candle[0], // Para compatibilidade
    }));

    Logger.debug(`✅ [BINANCE] ${symbol}: ${candles.length} candles ${timeframe} obtidos`);
    return candles;
  } catch (error) {
    // Em caso de erro de rede ou outros problemas, retorna null em vez de throw
    console.warn(`⚠️ [BINANCE] Erro ao obter dados para ${symbol}: ${error.message}`);
    return null;
  }
}

/**
 * Converte símbolo para formato Binance
 * @param {string} symbol - Símbolo original (ex: BTC_USDC_PERP)
 * @returns {string} - Símbolo Binance (ex: BTCUSDT)
 */
function convertSymbolToBinance(symbol) {
  // Mapeamentos específicos conhecidos
  const mappings = {
    BTC_USDC_PERP: 'BTCUSDT',
    ETH_USDC_PERP: 'ETHUSDT',
    SOL_USDC_PERP: 'SOLUSDT',
    XRP_USDC_PERP: 'XRPUSDT',
    HYPE_USDC_PERP: 'HYPERUSDT', // Corrigido: HYPE -> HYPER
  };

  // Se temos um mapeamento específico, usa ele
  if (mappings[symbol]) {
    return mappings[symbol];
  }

  // Tenta diferentes variações do símbolo
  const variations = [
    symbol.replace('_USDC_PERP', 'USDT'), // BTC_USDC_PERP -> BTCUSDT
    symbol.replace('_USDC_PERP', ''), // BTC_USDC_PERP -> BTC
    symbol.replace('_PERP', 'USDT'), // BTC_PERPT -> BTCUSDT
    symbol.replace('_PERP', ''), // BTC_PERPT -> BTC
    symbol.replace('_', ''), // BTC_USDC -> BTCUSDC
    symbol, // Mantém original
  ];

  // Remove duplicatas
  const uniqueVariations = [...new Set(variations)];

  Logger.debug(`🔄 [BINANCE] Tentando variações para ${symbol}: ${uniqueVariations.join(', ')}`);

  // Retorna a primeira variação (será testada na função getBinanceCandles)
  return uniqueVariations[0];
}

/**
 * Converte timeframe para formato Binance
 * @param {string} timeframe - Timeframe original (ex: 1m, 5m)
 * @returns {string} - Timeframe Binance
 */
function convertTimeframeToBinance(timeframe) {
  // Binance usa os mesmos formatos
  return timeframe;
}

function findEMACross(ema9Arr, ema21Arr) {
  const len = Math.min(ema9Arr.length, ema21Arr.length);

  for (let i = len - 2; i >= 0; i--) {
    const currEma9 = ema9Arr[i + 1];
    const prevEma9 = ema9Arr[i];
    const currEma21 = ema21Arr[i + 1];
    const prevEma21 = ema21Arr[i];

    // Detecta cruzamentos
    if (prevEma9 <= prevEma21 && currEma9 > currEma21) {
      return { index: i, type: 'goldenCross' };
    }
    if (prevEma9 >= prevEma21 && currEma9 < currEma21) {
      return { index: i, type: 'deathCross' };
    }
  }

  return null;
}

function analyzeEMA(ema9Arr, ema21Arr) {
  const len = ema9Arr.length;
  if (len < 2 || ema21Arr.length < 2) return null;

  const lastEma9 = ema9Arr[ema9Arr.length - 1];
  const lastEma21 = ema21Arr[ema21Arr.length - 1];
  const prevEma9 = ema9Arr[ema9Arr.length - 2];
  const prevEma21 = ema21Arr[ema21Arr.length - 2];

  if (lastEma9 == null || lastEma21 == null || prevEma9 == null || prevEma21 == null) {
    return null;
  }

  // diferença absoluta e percentual
  const diff = lastEma9 - lastEma21;
  const diffPct = (diff / lastEma21) * 100;

  // sinal básico
  const signal = diff > 0 ? 'bullish' : 'bearish';

  // detectar cruzamento no último candle
  let crossed = null;
  if (prevEma9 <= prevEma21 && lastEma9 > lastEma21) {
    crossed = 'goldenCross';
  } else if (prevEma9 >= prevEma21 && lastEma9 < lastEma21) {
    crossed = 'deathCross';
  }

  return {
    ema9: lastEma9,
    ema21: lastEma21,
    diff,
    diffPct,
    signal,
    crossed,
  };
}

function analyzeTrends(data) {
  const n = data.length;
  const result = {};
  const metrics = ['volume', 'variance', 'price'];

  // soma dos índices de 0 a n-1 e sum(x^2) podem ser pré-calculados
  const sumX = ((n - 1) * n) / 2;
  const sumXX = ((n - 1) * n * (2 * n - 1)) / 6;

  metrics.forEach(metric => {
    let sumY = 0;
    let sumXY = 0;

    data.forEach((d, i) => {
      const y = d[metric];
      sumY += y;
      sumXY += i * y;
    });

    // slope = (n * Σ(xᵢyᵢ) - Σxᵢ * Σyᵢ) / (n * Σ(xᵢ²) - (Σxᵢ)²)
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    // intercept = mean(y) - slope * mean(x)
    const intercept = sumY / n - slope * (sumX / n);

    // previsão para o próximo ponto (índice n)
    const forecast = slope * n + intercept;

    // tendência
    const trend = slope > 0 ? 'increasing' : slope < 0 ? 'decreasing' : 'flat';

    result[metric] = {
      trend,
      slope,
      forecast,
    };
  });

  return result;
}

/**
 * Calcula o WaveTrend Oscillator (MOMENTUM)
 * Implementação fiel do WaveTrend baseada no Pine Script
 * @param {Array<Object>} candles - Array de candles com OHLCV
 * @param {number} channelLength - Período n1 para EMA (padrão: 10)
 * @param {number} averageLength - Período n2 para EMA (padrão: 21)
 * @returns {Object} - Dados do WaveTrend Oscillator
 */
export function calculateMomentum(candles, channelLength = 10, averageLength = 21) {
  if (!candles || candles.length < Math.max(channelLength, averageLength) + 4) {
    return {
      current: {
        wt1: null,
        wt2: null,
        cross: null,
        direction: 'NEUTRAL',
        isBullish: false,
        isBearish: false,
      },
      previous: {
        wt1: null,
        wt2: null,
        cross: null,
        direction: 'NEUTRAL',
        isBullish: false,
        isBearish: false,
      },
      history: {
        wt1: [],
        wt2: [],
      },
    };
  }

  // Passo a): Calcular o Preço Típico (AP) para cada vela
  const ap = candles.map(c => {
    const high = parseFloat(c.high);
    const low = parseFloat(c.low);
    const close = parseFloat(c.close);
    return (high + low + close) / 3;
  });

  // Passo b): Calcular a Primeira EMA (esa) - EMA do ap com período channelLength
  const esa = EMA.calculate({ period: channelLength, values: ap });

  // Passo c): Calcular a EMA da Diferença (d) - EMA da diferença absoluta
  const absDiff = [];
  for (let i = 0; i < ap.length; i++) {
    if (esa[i] !== null && !isNaN(esa[i])) {
      absDiff.push(Math.abs(ap[i] - esa[i]));
    } else {
      absDiff.push(0);
    }
  }
  const d = EMA.calculate({ period: channelLength, values: absDiff });

  // Passo d): Calcular o Índice do Canal (ci)
  const ci = [];
  for (let i = 0; i < ap.length; i++) {
    if (esa[i] !== null && d[i] !== null && d[i] !== 0 && !isNaN(esa[i]) && !isNaN(d[i])) {
      const ciValue = (ap[i] - esa[i]) / (0.015 * d[i]);
      ci.push(isNaN(ciValue) ? 0 : ciValue);
    } else {
      ci.push(0);
    }
  }

  // Passo e): Calcular o WaveTrend 1 (wt1) - EMA do ci com período averageLength
  const wt1 = EMA.calculate({ period: averageLength, values: ci });

  // Passo f): Calcular o WaveTrend 2 (wt2) - SMA da wt1 com período fixo de 4
  const wt2 = [];
  for (let i = 0; i < wt1.length; i++) {
    if (i >= 3) {
      // Precisa de pelo menos 4 valores para SMA de 4
      const validValues = wt1.slice(i - 3, i + 1).filter(val => val !== null && !isNaN(val));
      if (validValues.length > 0) {
        const sum = validValues.reduce((acc, val) => acc + val, 0);
        wt2.push(sum / validValues.length);
      } else {
        wt2.push(0);
      }
    } else {
      wt2.push(null);
    }
  }

  // Obter valores atuais
  const currentWt1 = wt1[wt1.length - 1];
  const currentWt2 = wt2[wt2.length - 1];
  const prevWt1 = wt1[wt1.length - 2];
  const prevWt2 = wt2[wt2.length - 2];

  // Detectar cruzamento atual
  let currentCross = null;
  if (
    currentWt1 !== null &&
    currentWt2 !== null &&
    prevWt1 !== null &&
    prevWt2 !== null &&
    !isNaN(currentWt1) &&
    !isNaN(currentWt2) &&
    !isNaN(prevWt1) &&
    !isNaN(prevWt2)
  ) {
    // Cruzamento BULLISH (wt1 cruza wt2 de baixo para cima)
    if (prevWt1 <= prevWt2 && currentWt1 > currentWt2) {
      currentCross = 'BULLISH';
    }
    // Cruzamento BEARISH (wt1 cruza wt2 de cima para baixo)
    else if (prevWt1 >= prevWt2 && currentWt1 < currentWt2) {
      currentCross = 'BEARISH';
    }
  }

  // Determinar direção atual
  let currentDirection = 'NEUTRAL';
  if (currentWt1 !== null && currentWt2 !== null && !isNaN(currentWt1) && !isNaN(currentWt2)) {
    currentDirection = currentWt1 > currentWt2 ? 'UP' : 'DOWN';
  }

  // Obter valores anteriores (para comparação)
  const prevPrevWt1 = wt1[wt1.length - 3];
  const prevPrevWt2 = wt2[wt2.length - 3];

  // Detectar cruzamento anterior
  let previousCross = null;
  if (
    prevWt1 !== null &&
    prevWt2 !== null &&
    prevPrevWt1 !== null &&
    prevPrevWt2 !== null &&
    !isNaN(prevWt1) &&
    !isNaN(prevWt2) &&
    !isNaN(prevPrevWt1) &&
    !isNaN(prevPrevWt2)
  ) {
    // Cruzamento BULLISH anterior
    if (prevPrevWt1 <= prevPrevWt2 && prevWt1 > prevWt2) {
      previousCross = 'BULLISH';
    }
    // Cruzamento BEARISH anterior
    else if (prevPrevWt1 >= prevPrevWt2 && prevWt1 < prevWt2) {
      previousCross = 'BEARISH';
    }
  }

  // Determinar direção anterior
  let previousDirection = 'NEUTRAL';
  if (prevWt1 !== null && prevWt2 !== null && !isNaN(prevWt1) && !isNaN(prevWt2)) {
    previousDirection = prevWt1 > prevWt2 ? 'UP' : 'DOWN';
  }

  return {
    current: {
      wt1: currentWt1,
      wt2: currentWt2,
      cross: currentCross,
      direction: currentDirection,
      isBullish: currentDirection === 'UP',
      isBearish: currentDirection === 'DOWN',
    },
    previous: {
      wt1: prevWt1,
      wt2: prevWt2,
      cross: previousCross,
      direction: previousDirection,
      isBullish: previousDirection === 'UP',
      isBearish: previousDirection === 'DOWN',
    },
    history: {
      wt1: wt1,
      wt2: wt2,
    },
  };
}

/**
 * Calcula o CVD (Cumulative Volume Delta) Periódico
 * @param {Array<Object>} candles - Array de candles
 * @param {number} period - Período para o CVD (padrão: 8)
 * @returns {Array<number>} - Array de valores de CVD
 */
function calculateCVD(candles, period = 8) {
  if (candles.length === 0) {
    return [];
  }

  const cvdValues = [];

  for (let i = 0; i < candles.length; i++) {
    let cvd = 0;

    // Calcula o CVD para as últimas 'period' velas, ou todas as velas disponíveis se menos que period
    const actualPeriod = Math.min(period, i + 1);
    const startIndex = Math.max(0, i - actualPeriod + 1);

    for (let j = startIndex; j <= i; j++) {
      const candle = candles[j];
      const open = parseFloat(candle.open);
      const close = parseFloat(candle.close);
      const volume = parseFloat(candle.volume);

      // Calcula o delta de volume para esta vela
      let delta = 0;
      if (close > open) {
        delta = volume; // Vela de alta
      } else if (close < open) {
        delta = -volume; // Vela de baixa
      }
      // Se close === open, delta = 0

      cvd += delta;
    }

    cvdValues.push(cvd);
  }

  return cvdValues;
}

/**
 * Encontra pivots (topos e fundos) em uma série de dados
 * @param {Array<number>} values - Array de valores
 * @param {number} fractalPeriod - Período do fractal (padrão: 1)
 * @returns {Array<Object>} - Array de pivots com {index, value, type}
 */
function findPivots(values, fractalPeriod = 1) {
  const pivots = [];

  for (let i = fractalPeriod; i < values.length - fractalPeriod; i++) {
    const current = values[i];
    let isTop = true;
    let isBottom = true;

    // Verifica se é um topo
    for (let j = 1; j <= fractalPeriod; j++) {
      if (values[i - j] >= current || values[i + j] >= current) {
        isTop = false;
        break;
      }
    }

    // Verifica se é um fundo
    for (let j = 1; j <= fractalPeriod; j++) {
      if (values[i - j] <= current || values[i + j] <= current) {
        isBottom = false;
        break;
      }
    }

    if (isTop) {
      pivots.push({ index: i, value: current, type: 'top' });
    } else if (isBottom) {
      pivots.push({ index: i, value: current, type: 'bottom' });
    }
  }

  return pivots;
}

/**
 * Detecta divergências entre preço e CVD
 * @param {Array<Object>} candles - Array de candles
 * @param {Array<number>} cvdValues - Array de valores de CVD
 * @returns {Object} - Objeto com divergências detectadas
 */
function findCvdDivergences(candles, cvdValues) {
  if (candles.length < 10 || cvdValues.length < 10) {
    return { bullish: false, bearish: false };
  }

  // Extrai preços de fechamento
  const prices = candles.map(c => parseFloat(c.close));

  // Encontra pivots de preço e CVD
  const pricePivots = findPivots(prices, 1);
  const cvdPivots = findPivots(cvdValues, 1);

  if (pricePivots.length < 2 || cvdPivots.length < 2) {
    return { bullish: false, bearish: false };
  }

  let bullishDivergence = false;
  let bearishDivergence = false;

  // Verifica divergência bullish (preço faz fundo mais baixo, CVD faz fundo mais alto)
  const priceBottoms = pricePivots.filter(p => p.type === 'bottom');
  const cvdBottoms = cvdPivots.filter(p => p.type === 'bottom');

  if (priceBottoms.length >= 2 && cvdBottoms.length >= 2) {
    const currentPriceBottom = priceBottoms[priceBottoms.length - 1];
    const previousPriceBottom = priceBottoms[priceBottoms.length - 2];
    const currentCvdBottom = cvdBottoms[cvdBottoms.length - 1];
    const previousCvdBottom = cvdBottoms[cvdBottoms.length - 2];

    // Verifica se o preço fez um fundo mais baixo mas o CVD fez um fundo mais alto
    if (
      currentPriceBottom.value < previousPriceBottom.value &&
      currentCvdBottom.value > previousCvdBottom.value
    ) {
      bullishDivergence = true;
    }
  }

  // Verifica divergência bearish (preço faz topo mais alto, CVD faz topo mais baixo)
  const priceTops = pricePivots.filter(p => p.type === 'top');
  const cvdTops = cvdPivots.filter(p => p.type === 'top');

  if (priceTops.length >= 2 && cvdTops.length >= 2) {
    const currentPriceTop = priceTops[priceTops.length - 1];
    const previousPriceTop = priceTops[priceTops.length - 2];
    const currentCvdTop = cvdTops[cvdTops.length - 1];
    const previousCvdTop = cvdTops[cvdTops.length - 2];

    // Verifica se o preço fez um topo mais alto mas o CVD fez um topo mais baixo
    if (
      currentPriceTop.value > previousPriceTop.value &&
      currentCvdTop.value < previousCvdTop.value
    ) {
      bearishDivergence = true;
    }
  }

  return {
    bullish: bullishDivergence,
    bearish: bearishDivergence,
  };
}

export async function calculateIndicators(candles, timeframe = '5m', symbol = null) {
  // Validação de entrada
  if (!candles || !Array.isArray(candles) || candles.length === 0) {
    // Retorna estrutura vazia para casos inválidos, mas ainda calcula Macro Money Flow se symbol fornecido
    const macroMoneyFlow = symbol
      ? await calculateMacroMoneyFlow(candles, timeframe, symbol)
      : {
          macroBias: 0,
          mfiCurrent: 50,
          mfiPrevious: 50,
          mfiEmaCurrent: 50,
          mfiEmaPrevious: 50,
          isBullish: false,
          isBearish: false,
          direction: 'NEUTRAL',
          error: 'Sem candles para análise',
          dataSource: 'NO_CANDLES',
          history: [],
        };

    return {
      ema: {
        isBullish: false,
        isBearish: false,
        crossIndex: null,
        crossType: null,
        candlesAgo: null,
      },
      rsi: {
        value: null,
        avg: null,
        prev: null,
        avgPrev: null,
        history: [],
      },
      macd: {
        MACD: null,
        MACD_signal: null,
        MACD_histogram: null,
        histogram: null,
        histogramPrev: null,
      },
      bollinger: {
        BOLL_upper: null,
        BOLL_middle: null,
        BOLL_lower: null,
      },
      volume: {
        history: [],
      },
      vwap: {
        vwap: null,
        stdDev: null,
        upperBands: [],
        lowerBands: [],
        current: null,
        previous: null,
      },
      atr: {
        atr: null,
        value: null,
        history: [],
      },
      stoch: {
        k: null,
        d: null,
        kPrev: null,
        dPrev: null,
        history: [],
      },
      slowStochastic: {
        k: null,
        d: null,
        kPrev: null,
        dPrev: null,
        history: [],
      },
      adx: {
        adx: null,
        diPlus: null,
        diMinus: null,
        diPlusPrev: null,
        diMinusPrev: null,
        adxEma: null,
        history: [],
        emaHistory: [],
      },
      momentum: {
        value: null,
        rsi: null,
        rsiAvg: null,
        isBullish: false,
        isBearish: false,
        reversal: false,
        isExhausted: false,
        isNearZero: false,
        direction: null,
        history: [],
        momentumValue: null,
        momentumHistory: [],
      },
      waveTrend: {
        wt1: null,
        wt2: null,
        vwap: null,
        reversal: false,
        isBullish: false,
        isBearish: false,
        history: [],
      },
      moneyFlow: {
        mfi: null,
        mfiAvg: null,
        value: null,
        isBullish: false,
        isBearish: false,
        isStrong: false,
        direction: null,
        history: [],
        mfiPrev: null,
      },
      cvd: {
        values: [],
        current: null,
        history: [],
      },
      cvdDivergence: {
        bullish: false,
        bearish: false,
      },
      macroMoneyFlow: {
        macroBias: 0,
        mfiCurrent: 50,
        mfiPrevious: 50,
        mfiEmaCurrent: 50,
        mfiEmaPrevious: 50,
        isBullish: false,
        isBearish: false,
        direction: 'NEUTRAL',
        error: 'Sem candles para análise',
        dataSource: 'NO_CANDLES',
        history: [],
      },
    };
  }

  const closes = candles.map(c => parseFloat(c.close));
  const highs = candles.map(c => parseFloat(c.high));
  const lows = candles.map(c => parseFloat(c.low));

  const volumesUSD = candles.map(c => ({
    volume: parseFloat(c.quoteVolume),
    variance: parseFloat(c.high) - parseFloat(c.low),
    price: parseFloat(c.start) - parseFloat(c.close),
  }));

  // Indicadores existentes
  const ema9 = EMA.calculate({ period: 9, values: closes });
  const ema21 = EMA.calculate({ period: 21, values: closes });

  const rsi = RSI.calculate({ period: 14, values: closes });

  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const boll = BollingerBands.calculate({
    period: 20,
    values: closes,
    stdDev: 2,
  });

  const atr = ATR.calculate({
    period: 14,
    high: highs,
    low: lows,
    close: closes,
  });

  const slowStoch = Stochastic.calculate({
    period: 14,
    high: highs,
    low: lows,
    close: closes,
    signalPeriod: 3,
  });

  const adx = ADX.calculate({
    period: 14,
    high: highs,
    low: lows,
    close: closes,
  });

  // Calculate EMA of ADX values
  const adxValues = adx.map(v => v.adx).filter(v => v !== null);
  const adxEma = EMA.calculate({
    values: adxValues,
    period: 21,
  });

  // MOMENTUM - WaveTrend Oscillator
  const momentum = calculateMomentum(candles, 10, 21);

  // INDICATORS - Baseados no PineScript
  const waveTrend = calculateWaveTrend(candles, 9, 12, 3); // MOMENTUM(2)
  const customMoneyFlow = calculateMoneyFlow(candles); // MONEY FLOW(3)

  const vwapHistory = calculateIntradayVWAP(candles);
  const latestVwapData = vwapHistory.current || {
    vwap: null,
    stdDev: null,
    upperBands: [],
    lowerBands: [],
  };
  const previousVwapData = vwapHistory.previous || {
    vwap: null,
    stdDev: null,
    upperBands: [],
    lowerBands: [],
  };

  const volumeAnalyse = analyzeTrends(volumesUSD);

  const emaAnalysis = analyzeEMA(ema9, ema21);
  const emaCrossInfo = findEMACross(ema9, ema21);

  // NOVO: CVD Periódico e Divergências
  const cvdValues = calculateCVD(candles, 8);
  const cvdDivergence = findCvdDivergences(candles, cvdValues);

  // Macro Money Flow (MFI diário)
  const macroMoneyFlow = symbol
    ? await calculateMacroMoneyFlow(candles, timeframe, symbol)
    : {
        macroBias: 0,
        mfiCurrent: 50,
        mfiPrevious: 50,
        mfiEmaCurrent: 50,
        mfiEmaPrevious: 50,
        isBullish: false,
        isBearish: false,
        direction: 'NEUTRAL',
        error: 'Sem symbol para análise',
        dataSource: 'NO_SYMBOL',
        history: [],
      };

  return {
    ema: {
      ...emaAnalysis,
      crossIndex: emaCrossInfo?.index ?? null,
      crossType: emaCrossInfo?.type ?? null,
      candlesAgo: emaCrossInfo ? ema9.length - 1 - emaCrossInfo.index : null,
    },
    rsi: {
      value: rsi[rsi.length - 1] ?? null,
      avg: rsi.length >= 14 ? rsi.slice(-14).reduce((sum, val) => sum + val, 0) / 14 : null,
      prev: rsi[rsi.length - 2] ?? null,
      avgPrev: rsi.length >= 15 ? rsi.slice(-15, -1).reduce((sum, val) => sum + val, 0) / 14 : null,
      history: rsi,
    },
    macd: {
      MACD: macd[macd.length - 1]?.MACD ?? null,
      MACD_signal: macd[macd.length - 1]?.signal ?? null,
      MACD_histogram: macd[macd.length - 1]?.histogram ?? null,
      histogram: macd[macd.length - 1]?.histogram ?? null,
      histogramPrev: macd[macd.length - 2]?.histogram ?? null,
    },
    bollinger: {
      BOLL_upper: boll[boll.length - 1]?.upper ?? null,
      BOLL_middle: boll[boll.length - 1]?.middle ?? null,
      BOLL_lower: boll[boll.length - 1]?.lower ?? null,
    },
    volume: {
      history: volumesUSD,
      ...volumeAnalyse,
    },
    vwap: {
      vwap: latestVwapData.vwap,
      stdDev: latestVwapData.stdDev,
      upperBands: latestVwapData.upperBands,
      lowerBands: latestVwapData.lowerBands,
      current: latestVwapData,
      previous: previousVwapData,
    },
    atr: {
      atr: atr[atr.length - 1] ?? null,
      value: atr[atr.length - 1] ?? null,
      history: atr,
    },
    stoch: {
      k: slowStoch[slowStoch.length - 1]?.k ?? null,
      d: slowStoch[slowStoch.length - 1]?.d ?? null,
      kPrev: slowStoch[slowStoch.length - 2]?.k ?? null,
      dPrev: slowStoch[slowStoch.length - 2]?.d ?? null,
      history: slowStoch,
    },
    slowStochastic: {
      k: slowStoch[slowStoch.length - 1]?.k ?? null,
      d: slowStoch[slowStoch.length - 1]?.d ?? null,
      history: slowStoch,
    },
    adx: {
      adx: adx[adx.length - 1]?.adx ?? null,
      diPlus: adx[adx.length - 1]?.pdi ?? null,
      diMinus: adx[adx.length - 1]?.mdi ?? null,
      diPlusPrev: adx[adx.length - 2]?.pdi ?? null,
      diMinusPrev: adx[adx.length - 2]?.mdi ?? null,
      adxEma: adxEma[adxEma.length - 1] ?? null,
      history: adx,
      emaHistory: adxEma,
    },
    // INDICATORS - WaveTrend Oscillator (MOMENTUM)
    momentum: momentum, // Return the full momentum structure with current/previous
    // WAVETREND (MOMENTUM 2)
    waveTrend: {
      wt1: waveTrend.wt1,
      wt2: waveTrend.wt2,
      vwap: waveTrend.vwap,
      reversal: waveTrend.reversal,
      isBullish: waveTrend.isBullish,
      isBearish: waveTrend.isBearish,
      history: waveTrend.history,
    },
    moneyFlow: {
      mfi: customMoneyFlow.current.mfi,
      mfiAvg: customMoneyFlow.current.mfiAvg,
      value: customMoneyFlow.current.value,
      isBullish: customMoneyFlow.current.isBullish,
      isBearish: customMoneyFlow.current.isBearish,
      isStrong: customMoneyFlow.current.isStrong,
      direction: customMoneyFlow.current.direction,
      history: customMoneyFlow.history,
      mfiPrev: customMoneyFlow.previous.mfi,
    },
    // NOVO: CVD Periódico
    cvd: {
      values: cvdValues,
      current: cvdValues[cvdValues.length - 1] ?? null,
      history: cvdValues,
    },
    // NOVO: Divergências de CVD
    cvdDivergence: {
      bullish: cvdDivergence.bullish,
      bearish: cvdDivergence.bearish,
    },
    // NOVO: Macro Money Flow (MFI diário)
    macroMoneyFlow: macroMoneyFlow, // Usa dados diários reais quando symbol disponível
  };
}
