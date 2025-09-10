import { DefaultStrategy } from './DefaultStrategy.js';

describe('Demonstração da validação RSI implementada', () => {
  const strategy = new DefaultStrategy();

  it('deve mostrar a nova validação RSI em ação', async () => {
    // Mock de dados simulando RSI sobrevendido (< 30) com cruzamento da média
    const mockData = {
      market: { symbol: 'ETH_USDC_PERP', decimal_price: 6, decimal_quantity: 4 },
      marketPrice: '2000.00',
      rsi: {
        value: 25, // Sobrevendido (< 30)
        prev: 22, // Estava ainda mais baixo
        avg: 24, // Média
        avgPrev: 26, // Média anterior era maior
        history: [30, 28, 26, 24, 22, 25], // Histórico mostrando recuperação
      },
      stoch: { k: 40, d: 35, kPrev: 35, dPrev: 30 }, // Neutro
      macd: { MACD: 0.1, MACD_signal: 0.05, MACD_histogram: 0.05, histogramPrev: 0.02 }, // Neutro
      adx: { adx: 20, diPlus: 15, diMinus: 18 }, // Fraco
      momentum: {
        current: {
          wt1: 0,
          wt2: -5,
          direction: 'NEUTRAL',
          cross: 'NONE',
          isBullish: false,
          isBearish: false,
        },
        previous: { wt1: -2, wt2: -8 },
      },
      vwap: { vwap: 1995.0 }, // Preço acima do VWAP (bullish)
      moneyFlow: { mfi: 55, mfiAvg: 52, value: 3, isBullish: true },
    };

    const config = {
      enableRsiSignals: true,
      enableStochasticSignals: true,
      enableMacdSignals: true,
      enableAdxSignals: true,
      enableMomentumSignals: true,
      enableVwapFilter: true,
      enableMoneyFlowFilter: true,
      maxNegativePnlStopPct: -10,
      minProfitPercentage: 0.5,
    };

    const signals = strategy.analyzeSignals(mockData, { config });

    console.log('\n=== DEMONSTRAÇÃO RSI ===');
    console.log('📊 Dados RSI:');
    console.log(`   • RSI Atual: ${mockData.rsi.value} (sobrevendido < 30)`);
    console.log(`   • RSI Anterior: ${mockData.rsi.prev}`);
    console.log(`   • Média RSI: ${mockData.rsi.avg}`);
    console.log(`   • Média Anterior: ${mockData.rsi.avgPrev}`);
    console.log(
      `   • Cruzamento: RSI(${mockData.rsi.prev}) <= Média Anterior(${mockData.rsi.avgPrev}) → RSI(${mockData.rsi.value}) > Média(${mockData.rsi.avg})`
    );

    console.log('\n🎯 Análise de Sinais:');
    console.log(`   • Sinal detectado: ${signals.hasSignal ? '✅ SIM' : '❌ NÃO'}`);
    if (signals.hasSignal) {
      console.log(`   • Tipo: ${signals.isLong ? '🟢 LONG' : '🔴 SHORT'}`);
      console.log(`   • Origem: ${signals.signalType}`);
    }
    console.log('\n📝 Detalhes da análise:');
    signals.analysisDetails.forEach((detail, index) => {
      console.log(`   ${index + 1}. ${detail}`);
    });

    // Valida que detectou o sinal RSI corretamente
    expect(signals.hasSignal).toBe(true);
    expect(signals.isLong).toBe(true);
    expect(signals.signalType).toContain('RSI');
  });

  it('deve mostrar RSI sobrecomprado com cruzamento para baixo (SHORT)', async () => {
    const mockData = {
      market: { symbol: 'BTC_USDC_PERP', decimal_price: 2, decimal_quantity: 6 },
      marketPrice: '45000.00',
      rsi: {
        value: 75, // Sobrecomprado (> 70)
        prev: 78, // Estava ainda mais alto
        avg: 76, // Média
        avgPrev: 74, // Média anterior era menor
        history: [65, 70, 74, 76, 78, 75], // Histórico mostrando topo
      },
      stoch: { k: 60, d: 65, kPrev: 65, dPrev: 70 }, // Neutro
      macd: { MACD: -0.1, MACD_signal: -0.05, MACD_histogram: -0.05, histogramPrev: -0.02 }, // Neutro
      adx: { adx: 18, diPlus: 12, diMinus: 15 }, // Fraco
      momentum: {
        current: {
          wt1: 0,
          wt2: 5,
          direction: 'NEUTRAL',
          cross: 'NONE',
          isBullish: false,
          isBearish: false,
        },
        previous: { wt1: 2, wt2: 8 },
      },
      vwap: { vwap: 45100.0 }, // Preço abaixo do VWAP (bearish)
      moneyFlow: { mfi: 45, mfiAvg: 48, value: -3, isBullish: false },
    };

    const config = {
      enableRsiSignals: true,
      enableStochasticSignals: true,
      enableMacdSignals: true,
      enableAdxSignals: true,
      enableMomentumSignals: true,
      enableVwapFilter: true,
      enableMoneyFlowFilter: true,
      maxNegativePnlStopPct: -10,
      minProfitPercentage: 0.5,
    };

    const signals = strategy.analyzeSignals(mockData, { config });

    console.log('\n=== DEMONSTRAÇÃO RSI SOBRECOMPRADO ===');
    console.log('📊 Dados RSI:');
    console.log(`   • RSI Atual: ${mockData.rsi.value} (sobrecomprado > 70)`);
    console.log(`   • RSI Anterior: ${mockData.rsi.prev}`);
    console.log(`   • Média RSI: ${mockData.rsi.avg}`);
    console.log(`   • Média Anterior: ${mockData.rsi.avgPrev}`);
    console.log(
      `   • Cruzamento: RSI(${mockData.rsi.prev}) >= Média Anterior(${mockData.rsi.avgPrev}) → RSI(${mockData.rsi.value}) < Média(${mockData.rsi.avg})`
    );

    console.log('\n🎯 Análise de Sinais:');
    console.log(`   • Sinal detectado: ${signals.hasSignal ? '✅ SIM' : '❌ NÃO'}`);
    if (signals.hasSignal) {
      console.log(`   • Tipo: ${signals.isLong ? '🟢 LONG' : '🔴 SHORT'}`);
      console.log(`   • Origem: ${signals.signalType}`);
    }
    console.log('\n📝 Detalhes da análise:');
    signals.analysisDetails.forEach((detail, index) => {
      console.log(`   ${index + 1}. ${detail}`);
    });

    // Valida que detectou o sinal RSI SHORT corretamente
    expect(signals.hasSignal).toBe(true);
    expect(signals.isShort).toBe(true);
    expect(signals.signalType).toContain('RSI');
  });

  it('deve mostrar Stochastic corrigido com cruzamento K>D em sobrevendido', async () => {
    const mockData = {
      market: { symbol: 'SOL_USDC_PERP', decimal_price: 4, decimal_quantity: 2 },
      marketPrice: '95.50',
      rsi: { value: 45, prev: 44, avg: 50, avgPrev: 49 }, // Neutro
      stoch: {
        k: 18, // Sobrevendido
        d: 15, // Sobrevendido
        kPrev: 12, // K estava abaixo do D
        dPrev: 16, // D estava acima do K
      }, // K(18) > D(15) e KPrev(12) <= DPrev(16) = cruzamento válido
      macd: { MACD: 0.05, MACD_signal: 0.03, MACD_histogram: 0.02, histogramPrev: 0.01 },
      adx: { adx: 22, diPlus: 18, diMinus: 15 },
      momentum: {
        current: {
          wt1: -15,
          wt2: -20,
          direction: 'NEUTRAL',
          cross: 'NONE',
          isBullish: false,
          isBearish: false,
        },
        previous: { wt1: -18, wt2: -22 },
      },
      vwap: { vwap: 94.0 }, // Preço acima do VWAP (bullish)
      moneyFlow: { mfi: 52, mfiAvg: 50, value: 2, isBullish: true },
    };

    const config = {
      enableRsiSignals: true,
      enableStochasticSignals: true,
      enableMomentumSignals: true,
      maxNegativePnlStopPct: -8,
      minProfitPercentage: 1.0,
    };

    const signals = strategy.analyzeSignals(mockData, { config });

    console.log('\n=== DEMONSTRAÇÃO STOCHASTIC CORRIGIDO ===');
    console.log('📊 Dados Stochastic:');
    console.log(
      `   • K Atual: ${mockData.stoch.k} | D Atual: ${mockData.stoch.d} (ambos < 20 = sobrevendido)`
    );
    console.log(`   • K Anterior: ${mockData.stoch.kPrev} | D Anterior: ${mockData.stoch.dPrev}`);
    console.log(
      `   • Cruzamento: KPrev(${mockData.stoch.kPrev}) <= DPrev(${mockData.stoch.dPrev}) → K(${mockData.stoch.k}) > D(${mockData.stoch.d})`
    );
    console.log(`   • ✅ Cruzamento válido K>D em região sobrevendida detectado!`);

    console.log('\n🎯 Análise de Sinais:');
    console.log(`   • Sinal detectado: ${signals.hasSignal ? '✅ SIM' : '❌ NÃO'}`);
    if (signals.hasSignal) {
      console.log(`   • Tipo: ${signals.isLong ? '🟢 LONG' : '🔴 SHORT'}`);
      console.log(`   • Origem: ${signals.signalType}`);
    }

    // Valida que detectou o sinal Stochastic corretamente
    expect(signals.hasSignal).toBe(true);
    expect(signals.isLong).toBe(true);
    expect(signals.signalType).toContain('Stochastic');
  });
});
