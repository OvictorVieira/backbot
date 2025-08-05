import dotenv from 'dotenv';
dotenv.config();

import Decision from './src/Decision/Decision.js';
import { StrategyFactory } from './src/Decision/Strategies/StrategyFactory.js';
import TrailingStop from './src/TrailingStop/TrailingStop.js';
import PnlController from './src/Controllers/PnlController.js';
import OrderController from './src/Controllers/OrderController.js';
import { StrategySelector } from './src/Utils/StrategySelector.js';
import MultiBotManager from './src/MultiBot/MultiBotManager.js';
import AccountConfig from './src/Config/AccountConfig.js';
import TimeframeConfig from './src/Config/TimeframeConfig.js';
import readline from 'readline';

// BOT_MODE removido - sempre usa modo DEFAULT

// Instância global do Decision (será inicializada com a estratégia selecionada)
let decisionInstance = null;

// Funções de timeframe movidas para TimeframeConfig.js

// Variáveis para controle do timer geral
let globalTimerInterval = null;
let isMultiBotMode = false;

// Variável para controle do intervalo do trailing stop
let trailingStopInterval = 1000; // começa em 1s
let trailingStopErrorCount = 0;
let trailingStopMaxInterval = 10000; // máximo 10s
let trailingStopMinInterval = 500;   // mínimo 0.5s
let trailingStopLastErrorTime = null;

// Inicializa o TrailingStop com a estratégia correta
function initializeTrailingStop() {
  const strategyType = process.env.TRADING_STRATEGY || 'DEFAULT';
  console.log(`🔧 [APP_INIT] Inicializando TrailingStop com estratégia: ${strategyType}`);
  TrailingStop.reinitializeStopLoss(strategyType);
}

// Função para exibir timer geral unificado
function showGlobalTimer(waitTimeMs = null) {
  if (globalTimerInterval) {
    clearInterval(globalTimerInterval);
  }

  const durationMs = waitTimeMs || 60000; // Usa o tempo fornecido ou 60 segundos padrão
  const startTime = Date.now();
  const nextAnalysis = new Date(startTime + durationMs);
  const timeString = nextAnalysis.toLocaleTimeString('pt-BR', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: false 
  });

  // Função para calcular o progresso baseado no tempo real decorrido
  const calculateProgress = () => {
    // Calcula o tempo decorrido desde o início do período atual
    const timeframeMs = TimeframeConfig.parseTimeframeToMs(process.env.ACCOUNT1_TIME || process.env.TIME || '5m');
    const now = Date.now();
    const currentPeriodStart = Math.floor(now / timeframeMs) * timeframeMs;
    const elapsedInPeriod = now - currentPeriodStart;
    const progress = Math.min((elapsedInPeriod / timeframeMs) * 100, 100);
    

    
    return Math.floor(progress);
  };



  // Intercepta console.log para manter o progresso no rodapé
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  
  // Função para limpar a linha do progresso
  const clearProgressLine = () => {
    process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
  };
  
  // Função para mostrar o progresso no rodapé
  const showProgress = (progress, progressBar, percentage) => {
    // Move o cursor para o final da tela
    process.stdout.write('\x1b[9999;0H');
    // Limpa a linha atual
    clearProgressLine();
    // Mostra o progresso
    process.stdout.write('⏳ Aguardando próxima análise... ');
    process.stdout.write(`[${progressBar}] ${percentage}% | Próxima: ${timeString}`);
  };

  // Intercepta console.log para manter o progresso no rodapé
  console.log = (...args) => {
    // Filtra logs que podem quebrar a barra de progresso
    const message = args.join(' ');
    const isSpamLog = message.includes('Stop loss já existe') || 
                     message.includes('ℹ️ [CONTA') ||
                     message.includes('⚠️ [CONTA');
    
    // Se for log de spam, não mostra para não quebrar a barra
    if (isSpamLog) {
      return;
    }
    
    // Limpa a linha do progresso antes de mostrar o log
    clearProgressLine();
    // Mostra o log
    originalLog.apply(console, args);
    // Restaura o progresso no rodapé
    const percentage = calculateProgress();
    const bars = Math.floor(percentage / 5);
    const emptyBars = 20 - bars;
    const progressBar = '█'.repeat(bars) + '░'.repeat(emptyBars);
    showProgress(percentage, progressBar, percentage);
  };

  // Intercepta console.error
  console.error = (...args) => {
    clearProgressLine();
    originalError.apply(console, args);
    const percentage = calculateProgress();
    const bars = Math.floor(percentage / 5);
    const emptyBars = 20 - bars;
    const progressBar = '█'.repeat(bars) + '░'.repeat(emptyBars);
    showProgress(percentage, progressBar, percentage);
  };

  // Intercepta console.warn
  console.warn = (...args) => {
    clearProgressLine();
    originalWarn.apply(console, args);
    const percentage = calculateProgress();
    const bars = Math.floor(percentage / 5);
    const emptyBars = 20 - bars;
    const progressBar = '█'.repeat(bars) + '░'.repeat(emptyBars);
    showProgress(percentage, progressBar, percentage);
  };

  globalTimerInterval = setInterval(() => {
    const percentage = calculateProgress();
    const bars = Math.floor(percentage / 5);
    const emptyBars = 20 - bars;
    
    const progressBar = '█'.repeat(bars) + '░'.repeat(emptyBars);
    
    // Mostra o progresso no rodapé
    showProgress(percentage, progressBar, percentage);
    
    if (percentage >= 100) {
      clearInterval(globalTimerInterval);
      // Restaura console.log original
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      // Limpa a linha do progresso
      clearProgressLine();
      console.log('🔄 Iniciando nova análise...\n');
    }
  }, 1000);
}

// Função para parar o timer geral
function stopGlobalTimer() {
  if (globalTimerInterval) {
    clearInterval(globalTimerInterval);
    globalTimerInterval = null;
  }
}

async function startDecision() {
  // Usa a instância global do Decision
  if (!decisionInstance) {
    console.error('❌ Instância do Decision não inicializada');
    return;
  }
  
  // Para modo single, cria configuração baseada na estratégia selecionada
  let config = null;
  const strategy = process.env.TRADING_STRATEGY || 'DEFAULT';
  
  if (strategy === 'DEFAULT') {
    // Usa configurações da CONTA1
    config = {
      volumeOrder: Number(process.env.ACCOUNT1_VOLUME_ORDER) || Number(process.env.VOLUME_ORDER) || 100,
      capitalPercentage: Number(process.env.ACCOUNT1_CAPITAL_PERCENTAGE) || Number(process.env.CAPITAL_PERCENTAGE) || 0,
      limitOrder: Number(process.env.ACCOUNT1_LIMIT_ORDER) || Number(process.env.LIMIT_ORDER) || 100,
      time: process.env.ACCOUNT1_TIME || process.env.TIME || '5m',
      accountId: 'CONTA1'
    };
  } else if (strategy === 'ALPHA_FLOW') {
    // Configurações específicas para Alpha Flow
    config = {
      volumeOrder: Number(process.env.ACCOUNT1_VOLUME_ORDER) || Number(process.env.VOLUME_ORDER) || 100,
      capitalPercentage: Number(process.env.ACCOUNT1_CAPITAL_PERCENTAGE) || Number(process.env.CAPITAL_PERCENTAGE) || 0,
      limitOrder: Number(process.env.ACCOUNT1_LIMIT_ORDER) || Number(process.env.LIMIT_ORDER) || 100,
      time: process.env.ACCOUNT1_TIME || process.env.TIME || '5m',
      accountId: 'CONTA1',
      // Configurações específicas da estratégia Alpha Flow
      capitalPercentageBronze: Number(process.env.CAPITAL_PERCENTAGE_BRONZE) || 50,
      capitalPercentageSilver: Number(process.env.CAPITAL_PERCENTAGE_SILVER) || 75,
      capitalPercentageGold: Number(process.env.CAPITAL_PERCENTAGE_GOLD) || 100,
      order1WeightPct: Number(process.env.ORDER_1_WEIGHT_PCT) || 50,
      order2WeightPct: Number(process.env.ORDER_2_WEIGHT_PCT) || 30,
      order3WeightPct: Number(process.env.ORDER_3_WEIGHT_PCT) || 20
    };
  }
  
  await decisionInstance.analyze(null, null, config);
  
  // SISTEMA GLOBAL DE INTERVALO BASEADO NO EXECUTION_MODE
  let nextInterval;
  const timeframeConfig = new TimeframeConfig();
  
  if (process.env.EXECUTION_MODE === 'ON_CANDLE_CLOSE') {
    // Modo ON_CANDLE_CLOSE: Aguarda o próximo fechamento de vela
    nextInterval = timeframeConfig.getTimeUntilNextCandleClose();
  } else {
    // Modo REALTIME: Análise a cada 60 segundos
    nextInterval = 60000;
  }
  
  // Inicia o timer geral após cada análise
  showGlobalTimer();
  
  setTimeout(startDecision, nextInterval);
}

async function startStops() {
  try {
    await TrailingStop.stopLoss();
    // Se sucesso, reduz gradualmente o intervalo até o mínimo
    if (trailingStopInterval > trailingStopMinInterval) {
      trailingStopInterval = Math.max(trailingStopMinInterval, trailingStopInterval - 250);
      // if (trailingStopInterval === trailingStopMinInterval) {
      //   console.log(`⏱️ [TRAILING] Intervalo mínimo atingido: ${trailingStopInterval}ms`);
      // }
    }
    trailingStopErrorCount = 0;
  } catch (error) {
    // Detecta erro de rate limit (HTTP 429 ou mensagem)
    if (error?.response?.status === 429 || String(error).includes('rate limit') || String(error).includes('429')) {
      trailingStopErrorCount++;
      trailingStopLastErrorTime = Date.now();
      // Aumenta o intervalo exponencialmente até o máximo
      trailingStopInterval = Math.min(trailingStopMaxInterval, trailingStopInterval * 2);
      console.warn(`⚠️ [TRAILING] Rate limit detectado! Aumentando intervalo para ${trailingStopInterval}ms`);
    } else {
      console.error('[TRAILING] Erro inesperado no trailing stop:', error.message || error);
    }
  }
  setTimeout(startStops, trailingStopInterval);
}

// Função para exibir status do stop loss dinâmico
function showDynamicStopLossStatus() {
  try {
    const status = TrailingStop.getCurrentStopLossValues();
    const stopLossType = process.env.STOP_LOSS_TYPE || 'USD';
    
    console.log('\n🛡️ STATUS DO STOP LOSS DINÂMICO');
    console.log('='.repeat(40));
    console.log(`📊 Tipo: ${stopLossType}`);
    console.log(`💰 Stop Loss USD: $${status.usd.toFixed(2)}`);
    console.log(`📈 Stop Loss %: ${status.percentage.toFixed(2)}%`);
    console.log(`🔢 Total de fechamentos: ${status.totalCloses}`);
    console.log(`⚠️ Fechamentos prematuros: ${status.prematureCloses}`);
    console.log(`⏰ Fechamentos tardios: ${status.lateCloses}`);
    
    if (status.totalCloses > 0) {
      const prematureRate = (status.prematureCloses / status.totalCloses * 100).toFixed(1);
      const lateRate = (status.lateCloses / status.totalCloses * 100).toFixed(1);
      console.log(`📊 Taxa prematuros: ${prematureRate}%`);
      console.log(`📊 Taxa tardios: ${lateRate}%`);
    }
    
    console.log('='.repeat(40));
  } catch (error) {
    console.error('Erro ao exibir status do stop loss:', error.message);
  }
}

// Monitoramento rápido de ordens pendentes (apenas estratégia PRO_MAX)
let monitorInterval = 5000; // 5 segundos padrão

async function startPendingOrdersMonitor() {
  // No modo conta única, o monitoramento é feito pelo BotInstance no modo multi-conta
  // Esta função é mantida apenas para compatibilidade
  setTimeout(startPendingOrdersMonitor, monitorInterval);
}

// Função para exibir menu de seleção de modo interativo (simplificado)
async function showModeSelectionMenu(hasMultiAccountConfig) {
  return new Promise((resolve) => {
    console.log('\n🤖 BACKBOT - Configuração Inicial');
    console.log('=====================================\n');
    console.log('📋 Escolha como deseja operar:\n');
    
    console.log('1️⃣  Estratégia VOLUMES (PADRÃO)');
    console.log('   📊 Foco: Volume na corretora');
    console.log('   🎯 Ideal para: Fazer volume na corretora');
    console.log('   💡 Características:');
    console.log('      • Sinais mais frequentes');
    console.log('      • Stop loss dinâmico');
    console.log('      • Take profit único');
    console.log('      • Ideal para corretoras que pagam por volume\n');
    
    console.log('2️⃣  Estratégia ALPHA FLOW [NOVA]');
    console.log('   🧠 Foco: Análise avançada de momentum e money flow');
    console.log('   🎯 Ideal para: Trading baseado em análise técnica avançada');
    console.log('   💡 Características:');
    console.log('      • Análise de momentum e money flow');
    console.log('      • Detecção de divergência CVD');
    console.log('      • Sinais BRONZE, PRATA e OURO');
    console.log('      • Ordens escalonadas com pirâmide invertida\n');
    
    console.log('3️⃣  Sair\n');
    
    console.log('💡 Digite o número da opção desejada');
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('\nEscolha (1-3): ', (answer) => {
      rl.close();
      const choice = parseInt(answer.trim());
      
      if (choice === 1) {
        resolve('DEFAULT');
      } else if (choice === 2) {
        resolve('ALPHA_FLOW');
      } else if (choice === 3) {
        resolve('exit');
      } else {
        console.log('❌ Opção inválida. Tente novamente.');
        resolve(showModeSelectionMenu(hasMultiAccountConfig));
      }
    });
  });
}

// Função para inicializar ou re-inicializar a estratégia do Decision
function initializeDecisionStrategy(strategyType) {
  if (!strategyType) {
    console.log('⚠️ StrategyType não fornecido para inicialização');
    return;
  }
  
  // Cria nova instância do Decision com a estratégia selecionada
  decisionInstance = new Decision(strategyType);
  console.log(`✅ Instância do Decision inicializada com estratégia: ${strategyType}`);
}

// Função para iniciar o monitor de ordens órfãs
function startOrphanOrderMonitor() {
  console.log('🧹 Iniciando Monitor de Ordens Órfãs...');
  
  // Monitoramento de ordens órfãs a cada 60 segundos
  setInterval(async () => {
    try {
      await OrderController.cleanupOrphanedConditionalOrders('DEFAULT');
    } catch (error) {
      console.error('❌ Erro no monitor de ordens órfãs:', error.message);
    }
  }, 60000);
  
  console.log('✅ Monitor de Ordens Órfãs iniciado (verificação a cada 60 segundos)');
}

async function startBot() {
  try {
    // Verifica se há configurações de múltiplas contas
    const accountConfig = new AccountConfig();
    await accountConfig.initialize();
    const hasMultiAccountConfig = accountConfig.hasMultiAccountConfig();

    // Verifica se há pelo menos uma conta válida
    if (!accountConfig.hasAnyAccount()) {
      console.log('❌ Nenhuma conta com credenciais válidas encontrada!');
      console.log('   Configure as credenciais no arquivo .env:');
      console.log('   • ACCOUNT1_API_KEY e ACCOUNT1_API_SECRET');
      console.log('   • ACCOUNT2_API_KEY e ACCOUNT2_API_SECRET');
      process.exit(1);
    }

    // Carrega o estado persistido do Trailing Stop
    await TrailingStop.loadStateFromFile();
    
    // Migração automática: cria estado para posições abertas existentes
    await TrailingStop.backfillStateForOpenPositions();

    // Verifica se a estratégia foi definida via variável de ambiente
    const envStrategy = process.env.TRADING_STRATEGY;
    let selectedStrategy;

    if (envStrategy) {
      // Executa diretamente com a estratégia definida
      selectedStrategy = envStrategy;
      console.log(`🚀 Iniciando BackBot com estratégia: ${selectedStrategy}`);
    } else {
      // Exibe menu de seleção de estratégia (simplificado)
      selectedStrategy = await showModeSelectionMenu(hasMultiAccountConfig);

      if (selectedStrategy === 'exit') {
        console.log('👋 Encerrando BackBot.');
        process.exit(0);
      }
    }

    // Lógica simplificada: opção 2 sempre executa PRO MAX
    if (selectedStrategy === 'PRO_MAX') {
      // Estratégia PRO_MAX = sempre modo multi-conta (mesmo com uma conta)
      console.log('🚀 Iniciando BackBot em modo PRO MAX...\n');
      isMultiBotMode = true;
      const multiBotManager = new MultiBotManager();
      await multiBotManager.runMultiMode();
    } else {
      // Estratégia DEFAULT = sempre modo conta única
      console.log('🚀 Iniciando BackBot em modo Conta Única...\n');
      isMultiBotMode = false;
      
          // Inicializa a estratégia selecionada
    initializeDecisionStrategy(selectedStrategy);
    
    // Inicializa o TrailingStop com a estratégia correta
    initializeTrailingStop();
    
    // Log da estratégia selecionada
    console.log(`🔑 Estratégia ${selectedStrategy}: usando credenciais da CONTA1`);
    
    // Log do modo de execução
    const executionMode = process.env.EXECUTION_MODE || 'REALTIME';
    if (selectedStrategy === 'ALPHA_FLOW') {
      console.log('🧠 [ALPHA_FLOW] Modo ON_CANDLE_CLOSE forçado automaticamente');
    } else {
      console.log(`⚙️ [EXECUTION_MODE] Modo configurado: ${executionMode}`);
    }

    // Inicia o PnL Controller
    PnlController.run(24);

    // Inicia os serviços
    console.log('🚀 Iniciando serviços...');
    startStops();
    startPendingOrdersMonitor();
    startOrphanOrderMonitor();

    // Força EXECUTION_MODE para ON_CANDLE_CLOSE se for Alpha Flow
    if (selectedStrategy === 'ALPHA_FLOW') {
      process.env.EXECUTION_MODE = 'ON_CANDLE_CLOSE';
    }

    // Verifica se deve fazer análise imediatamente ou aguardar
    const timeframeConfig = new TimeframeConfig();
    const waitCheck = timeframeConfig.shouldWaitBeforeAnalysis();
    
    if (waitCheck.shouldWait) {
      console.log(`⏰ [ON_CANDLE_CLOSE] Próxima análise em ${Math.floor(waitCheck.waitTime / 1000)}s (fechamento de vela)`);
      
      // Inicia o timer geral para mostrar progresso
      showGlobalTimer(waitCheck.waitTime);
      
      // Agenda a primeira análise
      setTimeout(() => {
        startDecision();
      }, waitCheck.waitTime);
    } else {
      console.log(`⏰ [TIMEFRAME] ${waitCheck.reason} - iniciando análise imediatamente`);
      startDecision();
    }

      setInterval(() => {
        OrderController.checkForUnmonitoredPositions('DEFAULT');
      }, 30000);
    }

  } catch (error) {
    console.error('❌ Erro ao iniciar o bot:', error.message);
    process.exit(1);
  }
}

// Sistema de comandos interativos
function setupInteractiveCommands() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on('line', (input) => {
    const command = input.trim().toLowerCase();
    
    switch (command) {
      case 'status':
        showDynamicStopLossStatus();
        break;
      case 'cleanup':
        console.log('🧹 Iniciando limpeza manual de ordens órfãs...');
        import('./src/Controllers/OrderController.js').then(({ default: OrderController }) => {
          OrderController.monitorAndCleanupOrphanedStopLoss('DEFAULT').then(result => {
            console.log(`🧹 Limpeza concluída: ${result.orphaned} ordens órfãs detectadas, ${result.cancelled} canceladas`);
            if (result.errors.length > 0) {
              console.log(`❌ Erros: ${result.errors.join(', ')}`);
            }
          });
        });
        break;
      case 'help':
        console.log('\n💡 Comandos disponíveis:');
        console.log('   • "status" - Ver status do stop loss dinâmico');
        console.log('   • "cleanup" - Limpar ordens de stop loss órfãs');
        console.log('   • "exit" - Sair do bot');
        console.log('   • "help" - Ver esta ajuda\n');
        break;
      case 'exit':
        console.log('\n👋 Encerrando BackBot...');
        process.exit(0);
        break;
      default:
        console.log('❌ Comando não reconhecido. Digite "help" para ver os comandos disponíveis.');
    }
  });
}

// Inicia o bot
startBot();

// Configura comandos interativos após 3 segundos
setTimeout(() => {
  setupInteractiveCommands();
}, 3000);
