import dotenv from 'dotenv';
import Logger from './src/Utils/Logger.js';

dotenv.config();

// Define a URL da API se não estiver definida
if (!process.env.API_URL) {
  process.env.API_URL = 'https://api.backpack.exchange';
}

import Decision from './src/Decision/Decision.js';
import { StrategyFactory } from './src/Decision/Strategies/StrategyFactory.js';
import TrailingStop from './src/TrailingStop/TrailingStop.js';
import PnlController from './src/Controllers/PnlController.js';
import OrderController from './src/Controllers/OrderController.js';
import { StrategySelector } from './src/Utils/StrategySelector.js';
import MultiBotManager from './src/MultiBot/MultiBotManager.js';
import AccountConfig from './src/Config/AccountConfig.js';
import TimeframeConfig from './src/Config/TimeframeConfig.js';
import ConfigManager from './src/Config/ConfigManager.js';
import DatabaseService from './src/Services/DatabaseService.js';
import readline from 'readline';

// BOT_MODE removido - sempre usa modo DEFAULT

// Instância global do Decision (será inicializada com a estratégia selecionada)
let decisionInstance = null;

// Configuração do bot ativo
let activeBotConfig = null;

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

// Variáveis para controle do intervalo dos monitores
let pendingOrdersInterval = 15000; // começa em 15s
let pendingOrdersErrorCount = 0;
let pendingOrdersMaxInterval = 120000; // máximo 2min
let pendingOrdersMinInterval = 15000;  // mínimo 15s
let pendingOrdersLastErrorTime = null;

// Ordens órfãs agora são gerenciadas pelo sistema multi-bot do app-api.js

// Variável global para OrdersService (necessária para injeção de dependência no TrailingStop)
let globalOrdersService = null;

// Inicializa o TrailingStop com a estratégia correta
function initializeTrailingStop(ordersService = null) {
  if (!activeBotConfig) {
    Logger.error('❌ Configuração do bot não encontrada para inicializar TrailingStop');
    return;
  }
  
  // Verifica se as credenciais estão configuradas
  if (!activeBotConfig.apiKey || !activeBotConfig.apiSecret) {
    Logger.error('❌ Credenciais de API não configuradas para inicializar TrailingStop');
    Logger.error(`💡 Configure as credenciais para o bot: ${activeBotConfig.botName}`);
    return;
  }
  
  const strategyType = activeBotConfig.strategyName || 'DEFAULT';
  Logger.debug(`🔧 [APP_INIT] Inicializando TrailingStop com estratégia: ${strategyType}`);
  
  // Injeção de dependência do OrdersService para sistema ativo
  const trailingStopInstance = new TrailingStop(strategyType, activeBotConfig, ordersService);
  trailingStopInstance.reinitializeStopLoss(strategyType);
  
  if (ordersService) {
    Logger.info(`✅ [TRAILING_INIT] TrailingStop inicializado com sistema ATIVO de ordens`);
  } else {
    Logger.info(`✅ [TRAILING_INIT] TrailingStop inicializado com sistema PASSIVO (modo tradicional)`);
  }
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
    // Usa o timeframe passado como parâmetro ou fallback para activeBotConfig
    const timeframeMs = waitTimeMs || TimeframeConfig.parseTimeframeToMs(activeBotConfig?.time || '5m');
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
    const botName = activeBotConfig?.botName || 'N/A';
    process.stdout.write(`⏳ [${botName}] Aguardando próxima análise... `);
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
      Logger.info(`🔄 [${activeBotConfig.botName}] Iniciando nova análise...\n`);
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
  
  // Verifica se há configuração do bot ativo
  if (!activeBotConfig) {
    console.error('❌ Configuração do bot ativo não encontrada');
    return;
  }
  
  // Verifica se as credenciais estão configuradas
  if (!activeBotConfig.apiKey || !activeBotConfig.apiSecret) {
    console.error('❌ API_KEY e API_SECRET são obrigatórios');
    console.log('   Configure as credenciais no dashboard para o bot:', activeBotConfig.botName);
    return;
  }
  
  // Verifica se o bot está habilitado
  if (!activeBotConfig.enabled) {
    console.log(`⏸️ Bot ${activeBotConfig.botName} está pausado. Ative-o no dashboard para continuar.`);
    return;
  }
  
  await decisionInstance.analyze(null, null, activeBotConfig);
  
  // Executa migração do Trailing Stop para este bot específico
  try {
    await TrailingStop.backfillStateForOpenPositions(activeBotConfig);
  } catch (trailingError) {
    console.warn(`⚠️ [${activeBotConfig.botName}][APP] Erro na migração do Trailing Stop para bot ${activeBotConfig.botName}:`, trailingError.message);
  }
  
  // SISTEMA GLOBAL DE INTERVALO BASEADO NO EXECUTION_MODE
  let nextInterval;
  const timeframeConfig = new TimeframeConfig(activeBotConfig);
  
  // Usa configuração do bot para determinar o modo de execução
  const executionMode = activeBotConfig.executionMode || 'REALTIME';
  
  if (executionMode === 'ON_CANDLE_CLOSE') {
    // Modo ON_CANDLE_CLOSE: Aguarda o próximo fechamento de vela
    nextInterval = timeframeConfig.getTimeUntilNextCandleClose(activeBotConfig.time);
          Logger.debug(`⏰ [${activeBotConfig.botName}][ON_CANDLE_CLOSE] Próxima análise em ${Math.floor(nextInterval / 1000)}s`);
  } else {
    // Modo REALTIME: Análise a cada 60 segundos
    nextInterval = 60000;
          Logger.debug(`⏰ [${activeBotConfig.botName}][REALTIME] Próxima análise em ${Math.floor(nextInterval / 1000)}s`);
  }
  
  console.log(`🔧 [${activeBotConfig.botName}][DEBUG] Execution Mode: ${executionMode}, Next Interval: ${nextInterval}ms`);
  
  // Inicia o timer geral após cada análise
  showGlobalTimer();
  
  setTimeout(startDecision, nextInterval);
}

async function startStops() {
  try {
    // Verifica se há configuração do bot ativo
    if (!activeBotConfig || !activeBotConfig.apiKey || !activeBotConfig.apiSecret) {
      console.warn(`⚠️ [${activeBotConfig.botName}][TRAILING] Configuração do bot não encontrada ou credenciais ausentes`);
      return;
    }
    
    const trailingStopInstance = new TrailingStop(activeBotConfig.strategyName || 'DEFAULT', activeBotConfig, globalOrdersService);
    await trailingStopInstance.stopLoss();
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
      console.warn(`⚠️ [${activeBotConfig.botName}][TRAILING] Rate limit detectado! Aumentando intervalo para ${trailingStopInterval}ms`);
    } else {
      console.error(`❌ [${activeBotConfig.botName}][TRAILING] Erro inesperado no trailing stop:`, error.message || error);
    }
  }
  setTimeout(startStops, trailingStopInterval);
}

// Função para exibir status do stop loss dinâmico
function showDynamicStopLossStatus() {
  try {
    console.log('='.repeat(40));
  } catch (error) {
    console.error('Erro ao exibir status do stop loss:', error.message);
  }
}

// Monitoramento rápido de ordens pendentes (apenas estratégia PRO_MAX)
let monitorInterval = 5000; // 5 segundos padrão

async function startPendingOrdersMonitor() {
  try {
    // Verifica se há configuração do bot ativo
    if (!activeBotConfig || !activeBotConfig.apiKey || !activeBotConfig.apiSecret) {
      console.warn(`⚠️ [${activeBotConfig.botName}][PENDING_ORDERS] Configuração do bot não encontrada ou credenciais ausentes`);
      return;
    }
    
    await OrderController.monitorPendingEntryOrders(activeBotConfig.botName, activeBotConfig);
    
    // Se sucesso, reduz gradualmente o intervalo até o mínimo
    if (pendingOrdersInterval > pendingOrdersMinInterval) {
      pendingOrdersInterval = Math.max(pendingOrdersMinInterval, pendingOrdersInterval - 1000);
    }
    pendingOrdersErrorCount = 0;
  } catch (error) {
    // Detecta erro de rate limit (HTTP 429 ou mensagem)
    if (error?.response?.status === 429 || String(error).includes('rate limit') || String(error).includes('429')) {
      pendingOrdersErrorCount++;
      pendingOrdersLastErrorTime = Date.now();
      // Aumenta o intervalo exponencialmente até o máximo
      pendingOrdersInterval = Math.min(pendingOrdersMaxInterval, pendingOrdersInterval * 2);
      console.warn(`⚠️ [${activeBotConfig.botName}][PENDING_ORDERS] Rate limit detectado! Aumentando intervalo para ${Math.floor(pendingOrdersInterval / 1000)}s`);
    } else {
      console.error(`❌ [${activeBotConfig.botName}][PENDING_ORDERS] Erro inesperado no monitoramento de ordens pendentes:`, error.message || error);
    }
  }
  setTimeout(startPendingOrdersMonitor, pendingOrdersInterval);
}

// Função para inicializar ou re-inicializar a estratégia do Decision
function initializeDecisionStrategy(strategyType) {
  try {
    // Cria instância do Decision com a estratégia selecionada
    decisionInstance = new Decision(strategyType);
    console.log(`✅ Estratégia ${strategyType} inicializada com sucesso`);
  } catch (error) {
    console.error(`❌ Erro ao inicializar estratégia ${strategyType}:`, error.message);
    process.exit(1);
  }
}

// Monitor de ordens órfãs removido - agora é gerenciado pelo sistema multi-bot

async function startBot() {
  try {
    console.log('🚀 Iniciando BackBot...');
    
    // Carrega todas as configurações de bots
    const allConfigs = ConfigManager.loadConfigs();
    console.log(`📋 Encontradas ${allConfigs.length} configurações de bots`);
    
    // Filtra apenas bots habilitados (inclui bots que não estão rodando mas estão habilitados)
    let enabledBots = allConfigs.filter(config => config.enabled);
    console.log(`✅ ${enabledBots.length} bots habilitados encontrados`);
    
    // Filtra bots com credenciais válidas
    const botsWithCredentials = enabledBots.filter(config => config.apiKey && config.apiSecret);
    console.log(`🔑 ${botsWithCredentials.length} bots com credenciais configuradas`);
    
    if (botsWithCredentials.length === 0) {
      console.error('❌ Nenhum bot com credenciais válidas encontrado!');
      console.error('💡 Configure as credenciais de API no dashboard');
      process.exit(1);
    }
    
    // Usa apenas bots com credenciais válidas
    enabledBots = botsWithCredentials;
    
    if (enabledBots.length === 0) {
      console.log('❌ Nenhum bot habilitado encontrado!');
      console.log('💡 Configure pelo menos um bot no dashboard ou crie uma configuração padrão');
      
      // Verifica se há bots configurados mas não habilitados
      const configuredBots = allConfigs.filter(config => config.apiKey && config.apiSecret);
      if (configuredBots.length > 0) {
        console.log('📋 Bots configurados mas não habilitados:');
        configuredBots.forEach(bot => {
          console.log(`   • ${bot.botName} (${bot.strategyName}) - Status: ${bot.status}`);
        });
        console.log('💡 Ative um bot no dashboard para iniciar');
      } else {
        console.log('💡 Crie uma configuração de bot no dashboard primeiro');
      }
      
      process.exit(1);
    }
    
    // Se há múltiplos bots habilitados, usa modo multi-bot
    if (enabledBots.length > 1) {
      console.log('🤖 Iniciando modo Multi-Bot...');
      isMultiBotMode = true;
      const multiBotManager = new MultiBotManager();
      await multiBotManager.runMultiMode();
      return;
    }
    
    // Modo single bot - usa o primeiro bot habilitado
    activeBotConfig = enabledBots[0];
    
    // Verifica se as credenciais estão configuradas
    if (!activeBotConfig.apiKey || !activeBotConfig.apiSecret) {
      console.error(`❌ Bot ${activeBotConfig.botName} não tem credenciais configuradas!`);
      console.error('💡 Configure as credenciais no dashboard antes de iniciar o bot');
      process.exit(1);
    }
    
    console.log(`🤖 Iniciando bot: ${activeBotConfig.botName} (${activeBotConfig.strategyName})`);
    
    // 1. Inicializar a base de dados
    console.log('🔧 [DATABASE] Inicializando base de dados...');
    const dbService = new DatabaseService();
    await dbService.init();

    // 2. Inicializar OrdersService
    console.log('📋 [ORDERS] Inicializando OrdersService...');
    const OrdersService = await import('./src/Services/OrdersService.js');
    OrdersService.default.init(dbService);
    globalOrdersService = OrdersService.default; // Armazena para uso global

    // 3. Carregar o estado do Trailing Stop da base de dados
    console.log('📂 [PERSISTENCE] Carregando estado do Trailing Stop...');
    await TrailingStop.loadStateFromDB(dbService);

    // 4. Preencher o estado para posições abertas que não estavam na base de dados
    console.log('🔄 [BACKFILL] Preenchendo estado para posições abertas...');
    await TrailingStop.backfillStateForOpenPositions(activeBotConfig, dbService);
    
    // Inicializa a estratégia selecionada
    initializeDecisionStrategy(activeBotConfig.strategyName);
    
    // Inicializa o TrailingStop com a estratégia correta e sistema ativo de ordens
    initializeTrailingStop(globalOrdersService);
    
    // Log da estratégia selecionada
    console.log(`🔑 Estratégia ${activeBotConfig.strategyName}: usando credenciais do bot ${activeBotConfig.botName}`);
    
    // Log do modo de execução
    const executionMode = activeBotConfig.executionMode || 'REALTIME';
    if (activeBotConfig.strategyName === 'ALPHA_FLOW') {
      console.log('🧠 [ALPHA_FLOW] Modo ON_CANDLE_CLOSE forçado automaticamente');
      activeBotConfig.executionMode = 'ON_CANDLE_CLOSE';
    } else {
      console.log(`⚙️ [EXECUTION_MODE] Modo configurado: ${executionMode}`);
    }

    // Inicia o PnL Controller para este bot específico
    try {
      await PnlController.run(24, activeBotConfig);
    } catch (pnlError) {
      console.warn(`⚠️ [APP] Erro no PnL Controller para bot ${activeBotConfig.botName}:`, pnlError.message);
    }

    // Inicia os serviços
    console.log('🚀 Iniciando serviços...');
    startStops();
    startPendingOrdersMonitor();
    // Monitor de ordens órfãs agora é gerenciado pelo sistema multi-bot do app-api.js

    // Verifica se deve fazer análise imediatamente ou aguardar
    const timeframeConfig = new TimeframeConfig(activeBotConfig);
    const waitCheck = timeframeConfig.shouldWaitBeforeAnalysis(activeBotConfig.time);
    
    console.log(`🔧 [DEBUG] Execution Mode: ${activeBotConfig.executionMode}`);
    console.log(`🔧 [DEBUG] Strategy: ${activeBotConfig.strategyName}`);
    console.log(`🔧 [DEBUG] Timeframe: ${activeBotConfig.time}`);
    console.log(`🔧 [DEBUG] Wait Check:`, waitCheck);
    
    if (waitCheck.shouldWait) {
      console.log(`⏰ [ON_CANDLE_CLOSE] Próxima análise em ${Math.floor(waitCheck.waitTime / 1000)}s (fechamento de vela)`);
      
      // Inicia o timer geral para mostrar progresso
      showGlobalTimer(waitCheck.waitTime);
      
      // Agenda a primeira análise
      setTimeout(() => {
        startDecision();
      }, waitCheck.waitTime);
    } else {
      // Inicia análise imediatamente
      console.log('🚀 Iniciando primeira análise...');
      startDecision();
    }

    // Configura comandos interativos
    setupInteractiveCommands();
    
    console.log('✅ BackBot iniciado com sucesso!');
    console.log(`📊 Bot ativo: ${activeBotConfig.botName}`);
    console.log(`🔧 Estratégia: ${activeBotConfig.strategyName}`);
    console.log(`💰 Capital: ${activeBotConfig.capitalPercentage}%`);
    console.log(`⏰ Timeframe: ${activeBotConfig.time}`);
    
  } catch (error) {
    console.error('❌ Erro ao iniciar BackBot:', error.message);
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
          OrderController.monitorAndCleanupOrphanedStopLoss(activeBotConfig.botName, activeBotConfig).then(result => {
            console.log(`🧹 Limpeza concluída: ${result.orphaned} ordens órfãs detectadas, ${result.cancelled} canceladas`);
            if (result.errors.length > 0) {
              console.log(`❌ Erros: ${result.errors.join(', ')}`);
            }
          });
        });
        break;
      case 'force-cleanup':
        console.log('🧹 Iniciando limpeza AGRESSIVA de ordens órfãs...');
        console.log('⚠️ ATENÇÃO: Este comando cancela TODAS as ordens reduceOnly sem posição ativa!');
        import('./src/Controllers/OrderController.js').then(({ default: OrderController }) => {
          OrderController.forceCleanupAllOrphanedOrders(activeBotConfig.botName, activeBotConfig).then(result => {
            console.log(`🧹 Limpeza agressiva concluída: ${result.orphaned} ordens órfãs detectadas, ${result.cancelled} canceladas`);
            if (result.errors.length > 0) {
              console.log(`❌ Erros: ${result.errors.join(', ')}`);
            }
          });
        });
        break;
      case 'scan-cleanup':
        console.log('🔍 Iniciando varredura COMPLETA de ordens órfãs na corretora...');
        console.log('⚠️ Este comando verifica TODOS os símbolos na corretora!');
        import('./src/Controllers/OrderController.js').then(({ default: OrderController }) => {
          OrderController.scanAndCleanupAllOrphanedOrders(activeBotConfig.botName, activeBotConfig).then(result => {
            console.log(`🔍 Varredura completa concluída:`);
            console.log(`   • Símbolos verificados: ${result.symbolsScanned}`);
            console.log(`   • Ordens órfãs detectadas: ${result.orphaned}`);
            console.log(`   • Ordens canceladas: ${result.cancelled}`);
            if (result.errors.length > 0) {
              console.log(`❌ Erros: ${result.errors.join(', ')}`);
            }
            if (result.detailedResults && result.detailedResults.length > 0) {
              console.log('\n📊 Resultados detalhados:');
              result.detailedResults.forEach(r => {
                console.log(`   • ${r.symbol}: ${r.orphanedFound} órfãs → ${r.cancelled} canceladas`);
              });
            }
          });
        });
        break;
      case 'help':
        console.log('\n💡 Comandos disponíveis:');
        console.log('   • "status" - Ver status do stop loss dinâmico');
        console.log('   • "cleanup" - Limpar ordens de stop loss órfãs');
        console.log('   • "force-cleanup" - Limpeza agressiva (cancela TODAS as ordens reduceOnly órfãs)');
        console.log('   • "scan-cleanup" - Varredura completa da corretora (verifica TODOS os símbolos)');
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
