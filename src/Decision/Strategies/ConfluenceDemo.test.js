import { DefaultStrategy } from './DefaultStrategy.js';

describe('Confluence System Demo', () => {
  const strategy = new DefaultStrategy();

  it('deve demonstrar confluência LONG com 2+ indicadores concordando', async () => {
    // Mock de dados simulando Momentum + RSI concordando em LONG
    const mockData = {
      market: { symbol: 'ETH_USDC_PERP', decimal_price: 6, decimal_quantity: 4 },
      marketPrice: '2000.00',

      // Momentum: BULLISH (sinal forte)
      momentum: {
        current: {
          wt1: -45,
          wt2: -50,
          direction: 'UP',
          cross: 'BULLISH',
          isBullish: true,
          isBearish: false,
        },
        previous: { wt1: -55, wt2: -60 },
      },

      // RSI: Saindo de sobrevendido com cruzamento da média
      rsi: {
        value: 28, // Sobrevendido
        prev: 25, // Estava ainda mais baixo
        avg: 27, // Média
        avgPrev: 30, // Cruzamento: prev <= avgPrev, value > avg
        history: [35, 30, 27, 25, 28],
      },

      // Stochastic: Neutro (não dá sinal)
      stoch: { k: 45, d: 50, kPrev: 40, dPrev: 45 },

      // MACD: Neutro (não dá sinal)
      macd: { MACD: 0.1, MACD_signal: 0.05, MACD_histogram: 0.05, histogramPrev: 0.04 },

      // ADX: Fraco (não dá sinal)
      adx: { adx: 20, diPlus: 15, diMinus: 18 },

      vwap: { vwap: 1995.0 },
      moneyFlow: { mfi: 55, mfiAvg: 52, value: 3, isBullish: true },
    };

    const config = {
      // 🎯 CONFLUENCE HABILITADA
      enableConfluenceMode: true,
      minConfluences: 2, // Precisa de 2+ indicadores concordando

      // Indicadores habilitados
      enableMomentumSignals: true,
      enableRsiSignals: true,
      enableStochasticSignals: true,
      enableMacdSignals: true,
      enableAdxSignals: true,
      enableVwapFilter: true,
      enableMoneyFlowFilter: true,
      maxNegativePnlStopPct: -10,
      minProfitPercentage: 0.5,
    };

    const signals = strategy.analyzeSignals(mockData, { config });

    console.log('\n=== 🎯 DEMONSTRAÇÃO DE CONFLUÊNCIA ===');
    console.log('📊 Configuração:');
    console.log(
      `   • Confluência: ${config.enableConfluenceMode ? '✅ HABILITADA' : '❌ DESABILITADA'}`
    );
    console.log(`   • Mínimo de Confluências: ${config.minConfluences}`);

    console.log('\n📈 Sinais Individuais dos Indicadores:');
    console.log('   • Momentum: BULLISH (cruzamento forte)');
    console.log('   • RSI: LONG (saindo de sobrevendido + cruzamento média)');
    console.log('   • Stochastic: NEUTRO (sem sinal)');
    console.log('   • MACD: NEUTRO (sem sinal)');
    console.log('   • ADX: NEUTRO (tendência fraca)');

    console.log('\n🎯 Resultado da Confluência:');
    console.log(`   • Sinal detectado: ${signals.hasSignal ? '✅ SIM' : '❌ NÃO'}`);
    if (signals.hasSignal) {
      console.log(`   • Direção: ${signals.isLong ? '🟢 LONG' : '🔴 SHORT'}`);
      console.log(`   • Tipo: ${signals.signalType}`);
      console.log(
        `   • Indicadores concordando: ${signals.confluenceData?.indicators?.join(' + ') || 'N/A'}`
      );
      console.log(
        `   • Score: ${signals.confluenceData?.count}/${signals.confluenceData?.total} indicadores`
      );
    }

    console.log('\n📝 Análise Detalhada:');
    signals.analysisDetails.forEach((detail, index) => {
      console.log(`   ${index + 1}. ${detail}`);
    });

    console.log('\n💡 Comparação:');
    console.log('   • Modo Tradicional: Usaria apenas Momentum (primeiro da lista)');
    console.log('   • Modo Confluência: Momentum + RSI concordam = Sinal mais seguro!');

    // Validações
    expect(signals.hasSignal).toBe(true);
    expect(signals.isLong).toBe(true);
    expect(signals.confluenceData.count).toBeGreaterThanOrEqual(2);
    expect(signals.confluenceData.indicators).toContain('momentum');
    expect(signals.confluenceData.indicators).toContain('rsi');
  });

  it('deve demonstrar confluência insuficiente (menos de 2 indicadores)', async () => {
    // Mock de dados onde apenas 1 indicador dá sinal
    const mockData = {
      market: { symbol: 'BTC_USDC_PERP', decimal_price: 2, decimal_quantity: 6 },
      marketPrice: '45000.00',

      // Momentum: LONG (único sinal)
      momentum: {
        current: {
          wt1: -30,
          wt2: -35,
          direction: 'UP',
          cross: 'BULLISH',
          isBullish: true,
          isBearish: false,
        },
        previous: { wt1: -40, wt2: -45 },
      },

      // RSI: Neutro
      rsi: { value: 50, prev: 48, avg: 50, avgPrev: 49, history: [48, 49, 50, 51, 50] },

      // Stochastic: Neutro
      stoch: { k: 55, d: 50, kPrev: 50, dPrev: 52 },

      // MACD: Neutro
      macd: { MACD: 0.02, MACD_signal: 0.01, MACD_histogram: 0.01, histogramPrev: 0.01 },

      // ADX: Fraco
      adx: { adx: 18, diPlus: 12, diMinus: 15 },

      vwap: { vwap: 44900.0 },
      moneyFlow: { mfi: 50, mfiAvg: 50, value: 0, isBullish: false },
    };

    const config = {
      enableConfluenceMode: true,
      minConfluences: 2, // Precisa de 2+ indicadores
      enableMomentumSignals: true,
      enableRsiSignals: true,
      enableStochasticSignals: true,
      enableMacdSignals: true,
      enableAdxSignals: true,
    };

    const signals = strategy.analyzeSignals(mockData, { config });

    console.log('\n=== 🚨 DEMONSTRAÇÃO CONFLUÊNCIA INSUFICIENTE ===');
    console.log('📊 Situação: Apenas 1 indicador (Momentum) dá sinal LONG');
    console.log(`   • Confluence mínima exigida: ${config.minConfluences}`);
    console.log(`   • Indicadores com sinal LONG: 1 (apenas Momentum)`);
    console.log(`   • Resultado: ${signals.hasSignal ? 'SINAL ACEITO' : 'SINAL REJEITADO'}`);

    if (!signals.hasSignal) {
      console.log('\n✅ Confluência funcionando corretamente!');
      console.log(
        '   O sistema rejeitou o sinal pois precisa de pelo menos 2 indicadores concordando.'
      );
      console.log('   No modo tradicional, esse sinal seria aceito (apenas Momentum).');
    }

    // Validações
    expect(signals.hasSignal).toBe(false);
    expect(signals.confluenceData.longCount).toBe(1);
    expect(signals.confluenceData.minRequired).toBe(2);
  });

  it('deve demonstrar confluência SHORT com 3 indicadores', async () => {
    // Mock de dados simulando Momentum + RSI + Stochastic concordando em SHORT
    const mockData = {
      market: { symbol: 'SOL_USDC_PERP', decimal_price: 4, decimal_quantity: 2 },
      marketPrice: '95.50',

      // Momentum: BEARISH
      momentum: {
        current: {
          wt1: 60,
          wt2: 55,
          direction: 'DOWN',
          cross: 'BEARISH',
          isBullish: false,
          isBearish: true,
        },
        previous: { wt1: 50, wt2: 45 },
      },

      // RSI: Saindo de sobrecomprado
      rsi: {
        value: 72, // Sobrecomprado
        prev: 75, // Estava ainda mais alto
        avg: 74, // Média
        avgPrev: 70, // Cruzamento: prev >= avgPrev, value < avg
        history: [65, 70, 74, 75, 72],
      },

      // Stochastic: SHORT em sobrecomprado
      stoch: {
        k: 85, // Sobrecomprado
        d: 82, // Sobrecomprado
        kPrev: 88, // K estava acima do D
        dPrev: 85, // Agora K < D (cruzamento)
      },

      // MACD: Neutro
      macd: { MACD: -0.05, MACD_signal: -0.03, MACD_histogram: -0.02, histogramPrev: -0.01 },

      // ADX: Fraco
      adx: { adx: 22, diPlus: 18, diMinus: 15 },

      vwap: { vwap: 96.0 }, // Preço abaixo do VWAP (bearish)
      moneyFlow: { mfi: 45, mfiAvg: 48, value: -3, isBullish: false },
    };

    const config = {
      enableConfluenceMode: true,
      minConfluences: 2, // Vai ter 3 concordando
      enableMomentumSignals: true,
      enableRsiSignals: true,
      enableStochasticSignals: true,
      enableMacdSignals: true,
      enableAdxSignals: true,
    };

    const signals = strategy.analyzeSignals(mockData, { config });

    console.log('\n=== 🔴 DEMONSTRAÇÃO CONFLUÊNCIA SHORT ===');
    console.log('📊 Situação: 3 indicadores concordam em SHORT');
    console.log('   • Momentum: BEARISH (cruzamento)');
    console.log('   • RSI: SHORT (sobrecomprado + cruzamento média)');
    console.log('   • Stochastic: SHORT (K<D sobrecomprado)');
    console.log(`   • Resultado: ${signals.hasSignal ? 'SINAL ACEITO' : 'SINAL REJEITADO'}`);

    if (signals.hasSignal && signals.isShort) {
      console.log('\n✅ Confluência SHORT detectada com sucesso!');
      console.log(`   • ${signals.confluenceData.count} indicadores concordam em SHORT`);
      console.log(`   • Indicadores: ${signals.confluenceData.indicators.join(' + ')}`);
      console.log(`   • Muito mais confiável que apenas 1 indicador!`);
    }

    // Validações
    expect(signals.hasSignal).toBe(true);
    expect(signals.isShort).toBe(true);
    expect(signals.confluenceData.count).toBeGreaterThanOrEqual(2);
  });
});
