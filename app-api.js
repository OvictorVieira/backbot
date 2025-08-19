import dotenv from 'dotenv';
import Logger from './src/Utils/Logger.js';

dotenv.config();

// Verifica configuração do Logger (apenas para debug)
// Logger.checkConfig();

// Define a URL da API se não estiver definida
if (!process.env.API_URL) {
  process.env.API_URL = 'https://api.backpack.exchange';
}

import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import { execSync } from 'child_process';
import fetch from 'node-fetch';
import Account from './src/Backpack/Authenticated/Account.js';
import Capital from './src/Backpack/Authenticated/Capital.js';
import Futures from './src/Backpack/Authenticated/Futures.js';

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
import ConfigManagerSQLite from './src/Config/ConfigManagerSQLite.js';
import History from './src/Backpack/Authenticated/History.js';
import BotOrdersManager, { initializeBotOrdersManager } from './src/Config/BotOrdersManager.js';
import ImportOrdersFromBackpack from './src/Config/ImportOrdersFromBackpack.js';
import ImportPositionsFromBackpack from './src/Config/ImportPositionsFromBackpack.js';
import DatabaseService from './src/Services/DatabaseService.js';
import Markets from './src/Backpack/Public/Markets.js';
import PositionSyncServiceClass from './src/Services/PositionSyncService.js';
import PositionTrackingService from './src/Services/PositionTrackingService.js';
import OrdersService from "./src/Services/OrdersService.js";

// Instancia PositionSyncService (será inicializado depois que o DatabaseService estiver pronto)
let PositionSyncService = null;

// Configuração do servidor Express
const app = express();
const server = http.createServer(app);
const PORT = process.env.API_PORT || 3001;

// Função para verificar e matar processos na porta
function killProcessOnPort(port) {
  try {
    Logger.info(`🔍 [SERVER] Verificando se porta ${port} está em uso...`);

    // Busca processos usando a porta
    const command = process.platform === 'win32'
      ? `netstat -ano | findstr :${port}`
      : `lsof -ti:${port}`;

    const result = execSync(command, { encoding: 'utf8', stdio: 'pipe' });

    if (result.trim()) {
      Logger.warn(`⚠️ [SERVER] Porta ${port} está sendo usada. Encerrando processos...`);

      if (process.platform === 'win32') {
        // Windows
        const lines = result.trim().split('\n');
        const pids = lines.map(line => line.trim().split(/\s+/).pop()).filter(pid => pid);
        pids.forEach(pid => {
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            Logger.info(`✅ [SERVER] Processo ${pid} encerrado`);
          } catch (err) {
            Logger.warn(`⚠️ [SERVER] Não foi possível encerrar processo ${pid}`);
          }
        });
      } else {
        // Linux/macOS
        const pids = result.trim().split('\n').filter(pid => pid);
        pids.forEach(pid => {
          try {
            execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
            Logger.info(`✅ [SERVER] Processo ${pid} encerrado`);
          } catch (err) {
            Logger.warn(`⚠️ [SERVER] Não foi possível encerrar processo ${pid}`);
          }
        });
      }

      // Aguarda um momento para a porta ser liberada
      Logger.info(`⏳ [SERVER] Aguardando liberação da porta...`);
      return new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      Logger.info(`✅ [SERVER] Porta ${port} está livre`);
      return Promise.resolve();
    }
  } catch (error) {
    Logger.debug(`ℹ️ [SERVER] Nenhum processo encontrado na porta ${port} ou erro na verificação`);
    return Promise.resolve();
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// WebSocket Server
const wss = new WebSocketServer({ server });

// WebSocket connections
const connections = new Set();

// Função para broadcast de mensagens para todos os clientes WebSocket
function broadcast(message) {
  const messageStr = JSON.stringify(message);
  connections.forEach(connection => {
    if (connection.readyState === 1) { // WebSocket.OPEN
      connection.send(messageStr);
    }
  });
}

// Função para broadcast via WebSocket
function broadcastViaWs(message) {
  const messageStr = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(messageStr);
    }
  });
}


// Mapa de instâncias de bots ativos (apenas para controle de intervalos)
let activeBotInstances = new Map(); // Map<botName, {intervalId, executeBot}>

// Variáveis para controle de rate limit dos monitores por bot
let monitorRateLimits = new Map(); // Map<botId, {pendingOrders, orphanOrders}>

// Função para obter ou criar configuração de rate limit para um bot
function getMonitorRateLimit(botId) {
  if (!monitorRateLimits.has(botId)) {
    monitorRateLimits.set(botId, {
      pendingOrders: {
        interval: 15000, // começa em 15s
        errorCount: 0,
        maxInterval: 120000, // máximo 2min
        minInterval: 15000,  // mínimo 15s
        lastErrorTime: null
      },
      orphanOrders: {
        interval: 60000, // começa em 60s (menos agressivo)
        errorCount: 0,
        maxInterval: 300000, // máximo 5min
        minInterval: 60000,  // mínimo 60s (menos agressivo)
        lastErrorTime: null,
        lastFullScan: 0 // timestamp da última varredura completa
      },
      takeProfit: {
        interval: 30000, // começa em 30s
        errorCount: 0,
        maxInterval: 300000, // máximo 5min
        minInterval: 30000,  // mínimo 30s
        lastErrorTime: null
      }
    });
  }
  return monitorRateLimits.get(botId);
}

/**
 * Carrega e recupera bots que estavam ativos
 */
async function loadAndRecoverBots() {
  try {
    // Carrega todos os bots habilitados que estavam rodando ou em erro
    const configs = await ConfigManagerSQLite.loadConfigs();
    const botsToRecover = configs.filter(config =>
      config.enabled &&
      (config.status === 'running' || config.status === 'error' || config.status === 'starting')
    );

    if (botsToRecover.length === 0) {
      Logger.debug(`ℹ️ [PERSISTENCE] Nenhum bot para recuperar encontrado`);
      return;
    }

    Logger.debug(`📋 [PERSISTENCE] Carregando ${botsToRecover.length} bots para recuperação...`);

    // Executa todos os bots em paralelo sem aguardar
    const recoveryPromises = botsToRecover.map(async (botConfig) => {
      try {
        Logger.debug(`🔄 [PERSISTENCE] Iniciando recuperação do bot: ${botConfig.id} (${botConfig.botName}) - Status anterior: ${botConfig.status}`);
        await recoverBot(botConfig.id, botConfig, botConfig.startTime);
      } catch (error) {
        Logger.error(`❌ [PERSISTENCE] Erro ao recuperar bot ${botConfig.id}:`, error.message);
      }
    });

    // Executa em background sem bloquear
    Promise.all(recoveryPromises).then(() => {
      Logger.info(`✅ [PERSISTENCE] Recuperação de bots concluída`);
    }).catch((error) => {
      Logger.error(`❌ [PERSISTENCE] Erro na recuperação de bots:`, error.message);
    });

  } catch (error) {
    Logger.error(`❌ [PERSISTENCE] Erro ao carregar bots ativos:`, error.message);
  }
}



/**
 * Recupera um bot específico sem chamar startBot recursivamente
 */
async function recoverBot(botId, config, startTime) {
  try {
    // Verifica se a estratégia é válida
    if (!StrategyFactory.isValidStrategy(config.strategyName)) {
      Logger.error(`❌ [PERSISTENCE] Estratégia ${config.strategyName} não é válida`);
      return;
    }

    // Limpa status de erro se existir
    await ConfigManagerSQLite.clearErrorStatus(botId);

    // Atualiza status no ConfigManager
    await ConfigManagerSQLite.updateBotStatusById(botId, 'starting', startTime);

    // Configura o intervalo de execução baseado no executionMode
    let executionInterval;
    const timeframeConfig = new TimeframeConfig(config);
    const executionMode = config.executionMode || 'REALTIME';

    if (executionMode === 'ON_CANDLE_CLOSE') {
      // Modo ON_CANDLE_CLOSE: Aguarda o próximo fechamento de vela
      executionInterval = timeframeConfig.getTimeUntilNextCandleClose(config.time || '5m');
      Logger.info(`⏰ [ON_CANDLE_CLOSE] Bot ${botId}: Próxima análise em ${Math.floor(executionInterval / 1000)}s`);
    } else {
      // Modo REALTIME: Análise a cada 60 segundos
      executionInterval = 60000;
      Logger.info(`⏰ [REALTIME] Bot ${botId}: Próxima análise em ${Math.floor(executionInterval / 1000)}s`);
    }

    Logger.info(`🔧 [DEBUG] Bot ${botId}: Execution Mode: ${executionMode}, Next Interval: ${executionInterval}ms`);

    // Função de execução do bot
    const executeBot = async () => {
      try {
        // Atualiza status no ConfigManager
        await ConfigManagerSQLite.updateBotStatusById(botId, 'running');
        // Executa análise
        await startDecision(botId);

        // Executa trailing stop
        await startStops(botId);

        // Calcula e salva o próximo horário de validação
        const nextValidationAt = new Date(Date.now() + executionInterval);
        await ConfigManagerSQLite.updateBotConfigById(botId, {
          nextValidationAt: nextValidationAt.toISOString()
        });

        // Emite evento de execução bem-sucedida
        broadcastViaWs({
          type: 'BOT_EXECUTION_SUCCESS',
          botId,
          botName: config.botName,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        Logger.error(`❌ [BOT] Erro na execução do bot ${botId}:`, error.message);

        // Atualiza status de erro no ConfigManager
        await ConfigManagerSQLite.updateBotStatusById(botId, 'error');

        // Emite evento de erro
        broadcastViaWs({
          type: 'BOT_EXECUTION_ERROR',
          botId,
          botName: config.botName,
          timestamp: new Date().toISOString(),
          error: error.message
        });
      }
    };

    // Executa imediatamente em background
    executeBot().catch(error => {
      Logger.error(`❌ [${config.botName}][BOT] Erro crítico na execução do bot ${botId}:`, error.message);
    });

    // Configura execução periódica em background (apenas análise)
    const intervalId = setInterval(() => {
      executeBot().catch(error => {
        Logger.error(`❌ [${config.botName}][BOT] Erro na execução periódica do bot ${botId}:`, error.message);
      });
    }, executionInterval);

    // Configura monitores independentes com intervalos fixos
    const pendingOrdersIntervalId = setInterval(() => {
      startPendingOrdersMonitor(botId).catch(error => {
        Logger.error(`❌ [${config.botName}][PENDING_ORDERS] Erro no monitoramento do bot ${botId}:`, error.message);
      });
    }, 15000); // 15 segundos

    const orphanOrdersIntervalId = setInterval(() => {
      startOrphanOrderMonitor(botId).catch(error => {
        Logger.error(`❌ [${config.botName}][ORPHAN_MONITOR] Erro no monitoramento do bot ${botId}:`, error.message);
      });
    }, 60000); // 60 segundos (menos agressivo para evitar rate limits)

    const takeProfitIntervalId = setInterval(() => {
      startTakeProfitMonitor(botId).catch(error => {
        Logger.error(`❌ [${config.botName}][TAKE_PROFIT] Erro no monitoramento do bot ${botId}:`, error.message);
      });
    }, 30000); // 30 segundos

    // Calcula e salva o próximo horário de validação se não existir
    if (!config.nextValidationAt) {
      const nextValidationAt = new Date(Date.now() + executionInterval);
      await ConfigManagerSQLite.updateBotConfigById(botId, {
        nextValidationAt: nextValidationAt.toISOString()
      });
    }

    // Armazena os intervalIds para poder parar depois
    activeBotInstances.set(botId, {
      intervalId,
      pendingOrdersIntervalId,
      orphanOrdersIntervalId,
      takeProfitIntervalId,
      config,
      status: 'running'
    });

    Logger.info(`✅ [PERSISTENCE] Bot ${botId} (${config.botName}) recuperado com sucesso`);

  } catch (error) {
    Logger.error(`❌ [PERSISTENCE] Erro ao recuperar bot ${botId}:`, error.message);
    await ConfigManagerSQLite.updateBotStatusById(botId, 'error');
  }
}

// Função para inicializar e executar o Decision
async function startDecision(botId) {
  let botConfig = null;
  try {
    // Carrega configuração do bot
    botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Configuração não encontrada para bot ID: ${botId}`);
    }

    // Usa apenas as configurações do bot configurado
    const config = botConfig;

    // Debug: Verifica se as credenciais estão presentes
    if (!config.apiKey || !config.apiSecret) {
      Logger.warn(`⚠️ [DECISION] Bot ${botId} (${config.botName}) não tem credenciais configuradas`);
    }

    // Inicializa o Decision com a estratégia
    const decisionInstance = new Decision(botConfig.strategyName);

    // Inicializa o TrailingStop
    const trailingStopInstance = new TrailingStop(botConfig.strategyName, config);
    await trailingStopInstance.reinitializeStopLoss(botConfig.strategyName);

    // Executa a análise passando as configurações
    const result = await decisionInstance.analyze(config.time || '5m', null, config);

    // Emite evento via WebSocket
    broadcastViaWs({
      type: 'DECISION_ANALYSIS',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString(),
      result
    });

    return result;
  } catch (error) {
    Logger.error(`❌ [DECISION] Erro na análise do bot ${botId}:`, error.message);

    // Emite evento de erro via WebSocket
    broadcastViaWs({
      type: 'DECISION_ERROR',
      botId,
      botName: botConfig?.botName || 'Unknown',
      timestamp: new Date().toISOString(),
      error: error.message
    });

    throw error;
  }
}

// Função para inicializar e executar o TrailingStop
async function startStops(botId) {
  let botConfig = null;
  try {
    // Carrega configuração do bot
    botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Configuração não encontrada para bot ID: ${botId}`);
    }

    // Usa apenas as configurações do bot configurado
    const config = botConfig;

    // Debug: Verifica se as credenciais estão presentes
    if (!config.apiKey || !config.apiSecret) {
      Logger.warn(`⚠️ [STOPS] Bot ${botId} (${config.botName}) não tem credenciais configuradas`);
    }

    // Executa o trailing stop passando as configurações
    Logger.debug(`🔧 [STOPS] Bot ${botId}: Config recebida:`, {
      id: config.id,
      botName: config.botName,
      hasApiKey: !!config.apiKey,
      hasApiSecret: !!config.apiSecret,
      enableTrailingStop: config.enableTrailingStop
    });

    // Cria instância do OrdersService para sistema ativo de trailing stop
    const ordersService = new OrdersService(config.apiKey, config.apiSecret);

    const trailingStopInstance = new TrailingStop(botConfig.strategyName, config, ordersService);
    const result = await trailingStopInstance.stopLoss();

    // Emite evento via WebSocket
    broadcastViaWs({
      type: 'TRAILING_STOP_UPDATE',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString(),
      result
    });

    // Reset contador de erros em caso de sucesso
    const rateLimit = getMonitorRateLimit(botId);
    rateLimit.trailingStop = rateLimit.trailingStop || { errorCount: 0, interval: 5000 }; // 5s padrão
    rateLimit.trailingStop.errorCount = 0;

    // Reduz intervalo gradualmente até mínimo (5s -> 2s)
    if (rateLimit.trailingStop.interval > 2000) {
      rateLimit.trailingStop.interval = Math.max(2000, rateLimit.trailingStop.interval - 250);
    }

  } catch (error) {
    // Incrementa contador de erros
    const rateLimit = getMonitorRateLimit(botId);
    rateLimit.trailingStop = rateLimit.trailingStop || { errorCount: 0, interval: 5000 };
    rateLimit.trailingStop.errorCount++;

    if (error?.response?.status === 429 || String(error).includes('rate limit')) {
      // Aumenta intervalo exponencialmente em caso de rate limit
      rateLimit.trailingStop.interval = Math.min(30000, rateLimit.trailingStop.interval * 2); // máximo 30s
      Logger.warn(`⚠️ [STOPS] Bot ${botId}: Rate limit detectado! Aumentando intervalo para ${Math.floor(rateLimit.trailingStop.interval / 1000)}s`);
    } else {
      Logger.error(`❌ [STOPS] Erro no trailing stop do bot ${botId}:`, error.message);
    }

    // Emite evento de erro via WebSocket
    broadcastViaWs({
      type: 'TRAILING_STOP_ERROR',
      botId,
      botName: botConfig?.botName || 'Unknown',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }

  // Agenda próxima execução
  const rateLimit = getMonitorRateLimit(botId);
  const nextInterval = rateLimit.trailingStop?.interval || 5000;

  // Salva o timeout ID na instância do bot para poder cancelá-lo depois
  const timeoutId = setTimeout(() => startStops(botId), nextInterval);

  // Atualiza a instância do bot com o novo timeout
  const botInstance = activeBotInstances.get(botId);
  if (botInstance) {
    botInstance.trailingStopTimeoutId = timeoutId;
  }
}

// Função para monitorar e criar Take Profit orders
async function startTakeProfitMonitor(botId) {
  const rateLimit = getMonitorRateLimit(botId);

  try {
    // Carrega configuração do bot
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Configuração não encontrada para bot ID: ${botId}`);
    }

    // Usa apenas as configurações do bot configurado
    const config = botConfig;

    // Debug: Verifica se as credenciais estão presentes
    if (!config.apiKey || !config.apiSecret) {
      Logger.warn(`⚠️ [TAKE_PROFIT] Bot ${botId} (${config.botName}) não tem credenciais configuradas`);
    }

    // Executa o monitor de Take Profit
    const result = await OrderController.monitorAndCreateTakeProfit(config);

    // Se sucesso, reduz gradualmente o intervalo até o mínimo
    if (rateLimit.takeProfit.interval > rateLimit.takeProfit.minInterval) {
      rateLimit.takeProfit.interval = Math.max(rateLimit.takeProfit.minInterval, rateLimit.takeProfit.interval - 1000);
    }
    rateLimit.takeProfit.errorCount = 0;

    // Emite evento via WebSocket
    broadcastViaWs({
      type: 'TAKE_PROFIT_UPDATE',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString(),
      result
    });

    return result;
  } catch (error) {
    // Detecta erro de rate limit (HTTP 429 ou mensagem)
    if (error?.response?.status === 429 || String(error).includes('rate limit') || String(error).includes('429')) {
      rateLimit.takeProfit.errorCount++;
      rateLimit.takeProfit.lastErrorTime = Date.now();
      // Aumenta o intervalo exponencialmente até o máximo
      rateLimit.takeProfit.interval = Math.min(rateLimit.takeProfit.maxInterval, rateLimit.takeProfit.interval * 2);
      Logger.warn(`⚠️ [TAKE_PROFIT] Bot ${botId}: Rate limit detectado! Aumentando intervalo para ${Math.floor(rateLimit.takeProfit.interval / 1000)}s`);
    } else {
      Logger.error(`❌ [TAKE_PROFIT] Erro inesperado no monitoramento do bot ${botId}:`, error.message || error);
    }
    throw error;
  }
}

// Função para monitorar ordens pendentes
async function startPendingOrdersMonitor(botId) {
  const rateLimit = getMonitorRateLimit(botId);

  try {
    // Carrega configuração do bot
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Configuração não encontrada para bot ID: ${botId}`);
    }

    // Usa apenas as configurações do bot configurado
    const config = botConfig;

    // Debug: Verifica se as credenciais estão presentes
    if (!config.apiKey || !config.apiSecret) {
      Logger.warn(`⚠️ [PENDING_ORDERS] Bot ${botId} (${config.botName}) não tem credenciais configuradas`);
    }

    // Passa as configurações do bot para o monitor
    const result = await OrderController.monitorPendingEntryOrders(config.botName, config);

    // Se sucesso, reduz gradualmente o intervalo até o mínimo
    if (rateLimit.pendingOrders.interval > rateLimit.pendingOrders.minInterval) {
      rateLimit.pendingOrders.interval = Math.max(rateLimit.pendingOrders.minInterval, rateLimit.pendingOrders.interval - 1000);
    }
    rateLimit.pendingOrders.errorCount = 0;

    // Emite evento via WebSocket
    broadcastViaWs({
      type: 'PENDING_ORDERS_UPDATE',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString(),
      result
    });

    return result;
  } catch (error) {
    // Detecta erro de rate limit (HTTP 429 ou mensagem)
    if (error?.response?.status === 429 || String(error).includes('rate limit') || String(error).includes('429')) {
      rateLimit.pendingOrders.errorCount++;
      rateLimit.pendingOrders.lastErrorTime = Date.now();
      // Aumenta o intervalo exponencialmente até o máximo
      rateLimit.pendingOrders.interval = Math.min(rateLimit.pendingOrders.maxInterval, rateLimit.pendingOrders.interval * 2);
      Logger.warn(`⚠️ [PENDING_ORDERS] Bot ${botId}: Rate limit detectado! Aumentando intervalo para ${Math.floor(rateLimit.pendingOrders.interval / 1000)}s`);
    } else {
      Logger.error(`❌ [PENDING_ORDERS] Erro inesperado no monitoramento do bot ${botId}:`, error.message || error);
    }
    throw error;
  }
}

// Função para monitorar ordens órfãs
async function startOrphanOrderMonitor(botId) {
  const rateLimit = getMonitorRateLimit(botId);

  try {
    // Carrega configuração do bot
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Configuração não encontrada para bot ID: ${botId}`);
    }

    // Usa apenas as configurações do bot configurado
    const config = botConfig;

    // Debug: Verifica se as credenciais estão presentes
    if (!config.apiKey || !config.apiSecret) {
      Logger.warn(`⚠️ [ORPHAN_ORDERS] Bot ${botId} (${config.botName}) não tem credenciais configuradas`);
    }

    // Usa o novo método de varredura completa para ser mais eficiente
    // Alterna entre os métodos baseado em um timestamp para evitar sobrecarregar a API
    const now = Date.now();
    const lastFullScan = rateLimit.orphanOrders.lastFullScan || 0;
    const shouldDoFullScan = (now - lastFullScan) > 300000; // 5 minutos desde última varredura completa

    let result;
    if (shouldDoFullScan) {
      // Varredura completa a cada 5 minutos
      result = await OrderController.scanAndCleanupAllOrphanedOrders(config.botName, config);
      rateLimit.orphanOrders.lastFullScan = now;
      Logger.info(`🔍 [${config.botName}][ORPHAN_MONITOR] Varredura completa executada: ${result.symbolsScanned} símbolos verificados`);
    } else {
      // Limpeza normal baseada na configuração
      result = await OrderController.monitorAndCleanupOrphanedStopLoss(config.botName, config);
    }

    // Se sucesso, reduz gradualmente o intervalo até o mínimo
    if (rateLimit.orphanOrders.interval > rateLimit.orphanOrders.minInterval) {
      rateLimit.orphanOrders.interval = Math.max(rateLimit.orphanOrders.minInterval, rateLimit.orphanOrders.interval - 1000);
    }
    rateLimit.orphanOrders.errorCount = 0;

    // Emite evento via WebSocket
    broadcastViaWs({
      type: 'ORPHAN_ORDERS_CLEANUP',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString(),
      result
    });

    return result;
  } catch (error) {
    // Detecta erro de rate limit (HTTP 429 ou mensagem)
    if (error?.response?.status === 429 || String(error).includes('rate limit') || String(error).includes('429')) {
      rateLimit.orphanOrders.errorCount++;
      rateLimit.orphanOrders.lastErrorTime = Date.now();
      // Aumenta o intervalo exponencialmente até o máximo
      rateLimit.orphanOrders.interval = Math.min(rateLimit.orphanOrders.maxInterval, rateLimit.orphanOrders.interval * 2);
      Logger.warn(`⚠️ [ORPHAN_ORDERS] Bot ${botId}: Rate limit detectado! Aumentando intervalo para ${Math.floor(rateLimit.orphanOrders.interval / 1000)}s`);
    } else {
      Logger.error(`❌ [ORPHAN_ORDERS] Erro inesperado na limpeza do bot ${botId}:`, error.message || error);
    }
    throw error;
  }
}

// Monitor de trailing stops órfãos por bot
async function startTrailingStopsCleanerMonitor(botId) {
  const rateLimit = getMonitorRateLimit(botId);

  try {
    // Carrega configuração do bot
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Configuração não encontrada para bot ID: ${botId}`);
    }

    // Verifica se as credenciais estão presentes
    if (!botConfig.apiKey || !botConfig.apiSecret) {
      Logger.debug(`[TRAILING_CLEANER] Bot ${botId} (${botConfig.botName}) não tem credenciais configuradas`);
      setTimeout(() => startTrailingStopsCleanerMonitor(botId), 5 * 60 * 1000); // 5 minutos
      return;
    }

    // Executa limpeza de trailing stops órfãos
    await TrailingStop.cleanOrphanedTrailingStates(botConfig.apiKey, botConfig.apiSecret, botId);

    // Reset contador de erros em caso de sucesso
    rateLimit.trailingCleaner = rateLimit.trailingCleaner || { errorCount: 0 };
    rateLimit.trailingCleaner.errorCount = 0;

  } catch (error) {
    // Incrementa contador de erros
    const trailingCleanerLimit = rateLimit.trailingCleaner || { errorCount: 0 };
    trailingCleanerLimit.errorCount = (trailingCleanerLimit.errorCount || 0) + 1;
    rateLimit.trailingCleaner = trailingCleanerLimit;

    if (error?.response?.status === 429 || String(error).includes('rate limit')) {
      Logger.warn(`⚠️ [BOT ${botId}][TRAILING_CLEANER] Rate limit detectado`);
    } else {
      Logger.error(`❌ [BOT ${botId}][TRAILING_CLEANER] Erro no monitor:`, error.message);
    }
  }

  // Calcula próximo intervalo baseado em erros (5-15 minutos)
  const baseInterval = 5 * 60 * 1000; // 5 minutos
  const maxInterval = 15 * 60 * 1000; // 15 minutos
  const errorCount = rateLimit.trailingCleaner?.errorCount || 0;
  const nextInterval = Math.min(maxInterval, baseInterval + (errorCount * 2 * 60 * 1000)); // +2min por erro

  setTimeout(() => startTrailingStopsCleanerMonitor(botId), nextInterval);
}

// Função para iniciar um bot específico
async function startBot(botId, forceRestart = false) {
  let botConfig = null; // Declaração movida para fora do try

  try {
    Logger.info(`🚀 [BOT] Iniciando bot com ID: ${botId}`);

    // Verifica se o bot pode ser iniciado (a menos que seja um restart forçado)
    if (!forceRestart && !await ConfigManagerSQLite.canStartBotById(botId)) {
      const currentStatus = await ConfigManagerSQLite.getBotStatusById(botId);
      if (currentStatus === 'running') {
        throw new Error(`Bot ${botId} já está rodando`);
      } else {
        throw new Error(`Bot ${botId} não pode ser iniciado (status: ${currentStatus})`);
      }
    }

    // Se o bot estava em erro, limpa o status
    const currentStatus = await ConfigManagerSQLite.getBotStatusById(botId);
    if (currentStatus === 'error') {
      await ConfigManagerSQLite.clearErrorStatus(botId);
    }

    // Verifica se a configuração existe
    botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Configuração não encontrada para bot ID: ${botId}`);
    }

    // Debug: Verifica se as credenciais estão presentes
    if (!botConfig.apiKey || !botConfig.apiSecret) {
      Logger.warn(`⚠️ [BOT] Bot ${botId} (${botConfig.botName}) não tem credenciais configuradas`);
    }

    if (!botConfig.enabled) {
      throw new Error(`Bot ${botId} não está habilitado`);
    }

    // Verifica se a estratégia é válida
    if (!StrategyFactory.isValidStrategy(botConfig.strategyName)) {
      throw new Error(`Estratégia ${botConfig.strategyName} não é válida`);
    }

    // Atualiza status no ConfigManager
    await ConfigManagerSQLite.updateBotStatusById(botId, 'starting', new Date().toISOString());

    // Emite evento de início via WebSocket
    broadcastViaWs({
      type: 'BOT_STARTING',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString()
    });

    // Configura o intervalo de execução baseado no executionMode
    let executionInterval;
    const timeframeConfig = new TimeframeConfig(botConfig);
    const executionMode = botConfig.executionMode || 'REALTIME';

    if (executionMode === 'ON_CANDLE_CLOSE') {
      // Modo ON_CANDLE_CLOSE: Aguarda o próximo fechamento de vela
      executionInterval = timeframeConfig.getTimeUntilNextCandleClose(botConfig.time || '5m');
      Logger.debug(`⏰ [ON_CANDLE_CLOSE] Bot ${botId}: Próxima análise em ${Math.floor(executionInterval / 1000)}s`);
    } else {
      // Modo REALTIME: Análise a cada 60 segundos
      executionInterval = 60000;
      Logger.debug(`⏰ [REALTIME] Bot ${botId}: Próxima análise em ${Math.floor(executionInterval / 1000)}s`);
    }

    Logger.debug(`🔧 [DEBUG] Bot ${botId}: Execution Mode: ${executionMode}, Next Interval: ${executionInterval}ms`);

    // Função de execução do bot
    const executeBot = async () => {
      let currentBotConfig = null;
      try {
        // Recarrega a configuração do bot para garantir que está atualizada
        currentBotConfig = await ConfigManagerSQLite.getBotConfigById(botId);

        // Atualiza status no ConfigManager
        await ConfigManagerSQLite.updateBotStatusById(botId, 'running');

        // Executa análise
        await startDecision(botId);

        // Executa trailing stop
        await startStops(botId);

        await startPendingOrdersMonitor(botId);

        await startOrphanOrderMonitor(botId);

        await startTrailingStopsCleanerMonitor(botId);

        // Executa PnL Controller para este bot específico
        try {
          await PnlController.run(24, currentBotConfig);
        } catch (pnlError) {
          Logger.warn(`⚠️ [BOT] Erro no PnL Controller para bot ${botId}:`, pnlError.message);
        }
        // Calcula e salva o próximo horário de validação
        const nextValidationAt = new Date(Date.now() + executionInterval);
        await ConfigManagerSQLite.updateBotConfigById(botId, {
          nextValidationAt: nextValidationAt.toISOString()
        });

        // Emite evento de execução bem-sucedida
        broadcastViaWs({
          type: 'BOT_EXECUTION_SUCCESS',
          botId,
          botName: currentBotConfig.botName,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        Logger.error(`❌ [BOT] Erro na execução do bot ${botId}:`, error.message);

        // Atualiza status de erro no ConfigManager
        await ConfigManagerSQLite.updateBotStatusById(botId, 'error');

        // Emite evento de erro
        broadcastViaWs({
          type: 'BOT_EXECUTION_ERROR',
          botId,
          botName: currentBotConfig?.botName || 'Unknown',
          timestamp: new Date().toISOString(),
          error: error.message
        });
      }
    };

    // Calcula e salva o próximo horário de validação
    const nextValidationAt = new Date(Date.now() + executionInterval);
    await ConfigManagerSQLite.updateBotConfigById(botId, {
      nextValidationAt: nextValidationAt.toISOString()
    });

    // Executa imediatamente
    await executeBot();

    // Configura execução periódica
    const intervalId = setInterval(executeBot, executionInterval);

    // Adiciona a instância do bot ao mapa de controle
    activeBotInstances.set(botId, {
      intervalId,
      executeBot
    });

    Logger.info(`✅ [BOT] Bot ${botId} iniciado com sucesso`);

    // Emite evento de início bem-sucedido
    broadcastViaWs({
      type: 'BOT_STARTED',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    Logger.error(`❌ [BOT] Erro ao iniciar bot ${botId}:`, error.message);

    // Atualiza status de erro no ConfigManager
    await ConfigManagerSQLite.updateBotStatusById(botId, 'error');

    // Emite evento de erro
    broadcastViaWs({
      type: 'BOT_START_ERROR',
      botId,
      botName: botConfig?.botName || 'Unknown',
      timestamp: new Date().toISOString(),
      error: error.message
    });

    throw error;
  }
}

// Função para reiniciar um bot (para e inicia novamente)
async function restartBot(botId) {
  try {
    Logger.info(`🔄 [BOT] Reiniciando bot: ${botId}`);

    // Para o bot primeiro
    await stopBot(botId);
    Logger.info(`⏹️ [BOT] Bot ${botId} parado com sucesso`);

    // Aguarda um pouco para garantir que parou
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Reinicia o bot com restart forçado
    await startBot(botId, true);
    Logger.info(`✅ [BOT] Bot ${botId} reiniciado com sucesso`);

  } catch (error) {
    Logger.error(`❌ [BOT] Erro ao reiniciar bot ${botId}:`, error.message);
    throw error;
  }
}

// Função para parar um bot específico
async function stopBot(botId, updateStatus = true) {
  try {
    Logger.info(`🛑 [BOT] Parando bot: ${botId}`);

    // Verifica se o bot existe
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Bot ${botId} não encontrado`);
    }

    // Para todos os intervalos se existirem
    const botInstance = activeBotInstances.get(botId);
    if (botInstance) {
      if (botInstance.intervalId) {
        clearInterval(botInstance.intervalId);
      }
      if (botInstance.pendingOrdersIntervalId) {
        clearInterval(botInstance.pendingOrdersIntervalId);
      }
      if (botInstance.orphanOrdersIntervalId) {
        clearInterval(botInstance.orphanOrdersIntervalId);
      }
      if (botInstance.takeProfitIntervalId) {
        clearInterval(botInstance.takeProfitIntervalId);
      }
      if (botInstance.trailingStopTimeoutId) {
        clearTimeout(botInstance.trailingStopTimeoutId);
      }
    }

    // Remove da lista de instâncias ativas
    activeBotInstances.delete(botId);

    // Remove configurações de rate limit do bot
    monitorRateLimits.delete(botId);

    // Para sincronização de posições
    try {
      PositionSyncService.stopSyncForBot(botId);
      Logger.info(`🛑 [BOT] Sincronização de posições parada para bot ${botId}`);
    } catch (syncError) {
      Logger.error(`❌ [BOT] Erro ao parar sincronização de posições para bot ${botId}:`, syncError.message);
    }

    // Atualiza status no ConfigManager apenas se solicitado
    if (updateStatus) {
      await ConfigManagerSQLite.updateBotStatusById(botId, 'stopped');
    }

    Logger.info(`✅ [BOT] Bot ${botId} parado com sucesso`);

    // Emite evento de parada
    broadcastViaWs({
      type: 'BOT_STOPPED',
      botId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    Logger.error(`❌ [BOT] Erro ao parar bot ${botId}:`, error.message);
    throw error;
  }
}

// API Routes

// GET /api/bot/status - Retorna status de todos os bots
app.get('/api/bot/status', async (req, res) => {
  try {
    const configs = await ConfigManagerSQLite.loadConfigs();
    const status = configs.map(config => {
      const isRunning = config.status === 'running';

      const effectiveStatus = config.status === 'running' ? 'stopped' : config.status || 'stopped';

      return {
        id: config.id,
        botName: config.botName,
        strategyName: config.strategyName,
        status: effectiveStatus,
        startTime: config.startTime,
        isRunning: isRunning,
        config: config
      };
    });

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/bot/:botId/next-execution - Retorna próximo tempo de execução
app.get('/api/bot/:botId/next-execution', async (req, res) => {
  try {
    const { botId } = req.params;
    const botIdNum = parseInt(botId);

    if (isNaN(botIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'botId deve ser um número válido'
      });
    }

    // Busca configuração do bot por ID
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`
      });
    }

    // Usa o nextValidationAt salvo no bot ou calcula um novo
    let nextExecutionDate;
    let nextExecutionMs;
    const executionMode = botConfig.executionMode || 'REALTIME';

    if (botConfig.nextValidationAt) {
      // Usa o valor salvo no bot
      nextExecutionDate = new Date(botConfig.nextValidationAt);
      nextExecutionMs = nextExecutionDate.getTime() - Date.now();

      // Se já passou do tempo (com margem de 5 segundos), calcula o próximo
      if (nextExecutionMs <= 5000) {

        if (executionMode === 'ON_CANDLE_CLOSE') {
          // Para ON_CANDLE_CLOSE, calcula tempo até próximo fechamento de vela
          const timeframe = botConfig.time || '5m';
          const unit = timeframe.slice(-1);
          const value = parseInt(timeframe.slice(0, -1));

          let timeframeMs;
          switch (unit) {
            case 'm': timeframeMs = value * 60 * 1000; break;
            case 'h': timeframeMs = value * 60 * 60 * 1000; break;
            case 'd': timeframeMs = value * 24 * 60 * 60 * 1000; break;
            default: timeframeMs = 5 * 60 * 1000; // padrão 5m
          }

          const now = Date.now();
          const nextCandleClose = Math.ceil(now / timeframeMs) * timeframeMs;
          nextExecutionMs = nextCandleClose - now;
        } else {
          // Para REALTIME, usa 60 segundos
          nextExecutionMs = 60000;
        }

        nextExecutionDate = new Date(Date.now() + nextExecutionMs);

        // Atualiza o nextValidationAt no bot
        await ConfigManagerSQLite.updateBotConfigById(botIdNum, {
          nextValidationAt: nextExecutionDate.toISOString()
        });
      }
    } else {
      // Se não tem nextValidationAt, calcula um novo

      if (executionMode === 'ON_CANDLE_CLOSE') {
        // Para ON_CANDLE_CLOSE, calcula tempo até próximo fechamento de vela
        const timeframe = botConfig.time || '5m';
        const unit = timeframe.slice(-1);
        const value = parseInt(timeframe.slice(0, -1));

        let timeframeMs;
        switch (unit) {
          case 'm': timeframeMs = value * 60 * 1000; break;
          case 'h': timeframeMs = value * 60 * 60 * 1000; break;
          case 'd': timeframeMs = value * 24 * 60 * 60 * 1000; break;
          default: timeframeMs = 5 * 60 * 1000; // padrão 5m
        }

        const now = Date.now();
        const nextCandleClose = Math.ceil(now / timeframeMs) * timeframeMs;
        nextExecutionMs = nextCandleClose - now;
      } else {
        // Para REALTIME, usa 60 segundos
        nextExecutionMs = 60000;
      }

      nextExecutionDate = new Date(Date.now() + nextExecutionMs);

      // Salva o nextValidationAt no bot
      await ConfigManagerSQLite.updateBotConfigById(botIdNum, {
        nextValidationAt: nextExecutionDate.toISOString()
      });
    }

    // Se temos um nextValidationAt válido, usa ele; senão usa o calculado
    const finalNextExecutionDate = botConfig.nextValidationAt && nextExecutionMs > 0
      ? new Date(botConfig.nextValidationAt)
      : nextExecutionDate;

    const response = {
      success: true,
      data: {
        botId: botIdNum,
        botName: botConfig.botName,
        executionMode,
        timeframe: botConfig.time || '5m',
        nextExecutionMs,
        nextExecutionDate: finalNextExecutionDate.toISOString(),
        nextExecutionFormatted: finalNextExecutionDate.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        })
      }
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/bot/:botId/orders - Retorna ordens de um bot específico
app.get('/api/bot/:botId/orders', async (req, res) => {
  try {
    const { botId } = req.params;
    const botIdNum = parseInt(botId);

    if (isNaN(botIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'botId deve ser um número válido'
      });
    }

    // Busca configuração do bot por ID
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`
      });
    }

    // Recupera ordens do bot usando o botClientOrderId
    const orders = await OrderController.getBotOrdersById(botIdNum, botConfig);

    res.json({
      success: true,
      data: {
        botId: botConfig.id,
        botName: botConfig.botName,
        strategyName: botConfig.strategyName,
        botClientOrderId: botConfig.botClientOrderId,
        orders
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/bot/orders - Retorna ordens de todos os bots
app.get('/api/bot/orders', async (req, res) => {
  try {
    // Usa a configuração do primeiro bot para credenciais
    const configs = await ConfigManagerSQLite.loadConfigs();
    if (configs.length === 0) {
      return res.json({
        success: true,
        data: {}
      });
    }

    const firstBotConfig = configs[0];
    const allBotsOrders = await OrderController.getAllBotsOrders(firstBotConfig);

    res.json({
      success: true,
      data: allBotsOrders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/bot/start - Inicia uma instância de bot
app.post('/api/bot/start', async (req, res) => {
  try {
    const { botId } = req.body;

    if (!botId) {
      return res.status(400).json({
        success: false,
        error: 'botId é obrigatório'
      });
    }

    await startBot(botId);

    res.json({
      success: true,
      message: `Bot ${botId} iniciado com sucesso`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/bot/stop - Para uma instância de bot
app.post('/api/bot/stop', async (req, res) => {
  try {
    const { botId } = req.body;

    if (!botId) {
      return res.status(400).json({
        success: false,
        error: 'botId é obrigatório'
      });
    }

    await stopBot(botId);

    res.json({
      success: true,
      message: `Bot ${botId} parado com sucesso`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/bot/force-sync - Força sincronização das ordens com a corretora
app.post('/api/bot/force-sync', async (req, res) => {
  try {
    const { botId } = req.body;

    if (!botId) {
      return res.status(400).json({
        success: false,
        error: 'botId é obrigatório'
      });
    }

    // Busca a configuração do bot
    const config = await ConfigManagerSQLite.getBotConfigById(botId);
    if (!config) {
      return res.status(404).json({
        success: false,
        error: `Bot ${botId} não encontrado`
      });
    }

    // Verifica se as credenciais estão configuradas
    if (!config.apiKey || !config.apiSecret) {
      return res.status(400).json({
        success: false,
        error: 'Bot não possui credenciais de API configuradas'
      });
    }

    Logger.info(`🔄 [FORCE_SYNC] Iniciando sincronização forçada para bot ${botId} (${config.botName})`);

    // Importa OrdersService dinamicamente
    const { default: OrdersService } = await import('./src/Services/OrdersService.js');

    // Executa sincronização de ordens
    const syncedOrders = await OrdersService.syncOrdersWithExchange(botId, config);

    Logger.info(`✅ [FORCE_SYNC] Bot ${botId}: ${syncedOrders} ordens sincronizadas com sucesso`);

    res.json({
      success: true,
      message: `Force sync executado com sucesso: ${syncedOrders} ordens sincronizadas`,
      data: {
        botId,
        botName: config.botName,
        syncedOrders
      }
    });

  } catch (error) {
    Logger.error(`❌ [FORCE_SYNC] Erro no force sync para bot ${req.body?.botId}:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// POST /api/bot/update-running - Atualiza configuração de bot em execução
app.post('/api/bot/update-running', async (req, res) => {
  try {
    const { botId, config } = req.body;

    if (!botId || !config) {
      return res.status(400).json({
        success: false,
        error: 'botId e config são obrigatórios'
      });
    }

    Logger.info(`🔄 [BOT_UPDATE] Atualizando configuração do bot ${botId} em execução...`);

    // Verifica se o bot está realmente rodando
    if (!activeBotInstances.has(botId)) {
      return res.status(400).json({
        success: false,
        error: `Bot ${botId} não está em execução`
      });
    }

    // Atualiza a configuração no banco de dados
    await ConfigManagerSQLite.updateBotConfigById(botId, config);

    // Atualiza a configuração na instância ativa do bot
    const botInstance = activeBotInstances.get(botId);
    if (botInstance && botInstance.updateConfig) {
      await botInstance.updateConfig(config);
    }

    Logger.info(`✅ [BOT_UPDATE] Bot ${botId} atualizado com sucesso`);

    res.json({
      success: true,
      message: `Bot ${botId} atualizado com sucesso`,
      botId: botId
    });
  } catch (error) {
    Logger.error(`❌ [BOT_UPDATE] Erro ao atualizar bot ${req.body?.botId}:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/configs - Salva/atualiza configuração de bot
app.post('/api/configs', async (req, res) => {
  try {
    const { strategyName, botName, config: botConfig } = req.body;

    // Se o request tem a estrutura { botName, config: {...} }
    if (botName && botConfig) {
      if (!botConfig.apiKey || !botConfig.apiSecret) {
        return res.status(400).json({
          success: false,
          error: 'apiKey e apiSecret são obrigatórios'
        });
      }

      // Adiciona o botName ao config se não estiver presente
      if (!botConfig.botName) {
        botConfig.botName = botName;
      }

      // Adiciona o strategyName ao config se não estiver presente
      if (!botConfig.strategyName) {
        botConfig.strategyName = strategyName || 'DEFAULT';
      }

      // Se tem ID, atualiza; senão, cria novo
      if (botConfig.id) {
        // Verifica se o bot estava rodando antes da atualização
        const currentConfig = await ConfigManagerSQLite.getBotConfigById(botConfig.id);
        const wasRunning = currentConfig && currentConfig.status === 'running' && activeBotInstances.has(botConfig.id);

        if (wasRunning) {
          // Se está rodando, usa a nova rota de atualização
          Logger.info(`🔄 [CONFIG] Bot ${botConfig.id} está rodando, usando atualização segura...`);

          // Chama a nova rota de atualização
          const updateResponse = await fetch(`http://localhost:${PORT}/api/bot/update-running`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              botId: botConfig.id,
              config: botConfig
            })
          });

          const updateResult = await updateResponse.json();

          if (!updateResult.success) {
            throw new Error(updateResult.error || 'Erro ao atualizar bot em execução');
          }

          res.json({
            success: true,
            message: updateResult.message,
            botId: botConfig.id,
            wasRunning: true
          });
        } else {
          // Se não está rodando, atualiza normalmente
          await ConfigManagerSQLite.updateBotConfigById(botConfig.id, botConfig);

          res.json({
            success: true,
            message: `Bot ${botConfig.id} atualizado com sucesso`,
            botId: botConfig.id,
            wasRunning: false
          });
        }
      } else {
        const botId = await ConfigManagerSQLite.addBotConfig(botConfig);
        res.json({
          success: true,
          message: `Bot criado com sucesso`,
          botId: botId
        });
      }
    } else if (strategyName && botConfig) {
      // Se o request tem a estrutura { strategyName, config: {...} } (compatibilidade)
      if (!botConfig.apiKey || !botConfig.apiSecret) {
        return res.status(400).json({
          success: false,
          error: 'apiKey e apiSecret são obrigatórios'
        });
      }

      // Adiciona o strategyName ao config se não estiver presente
      if (!botConfig.strategyName) {
        botConfig.strategyName = strategyName;
      }

      // Adiciona o botName ao config se não estiver presente
      if (!botConfig.botName) {
        botConfig.botName = `${strategyName} Bot`;
      }

      // Se tem ID, atualiza; senão, cria novo
      if (botConfig.id) {
        // Verifica se o bot estava rodando antes da atualização
        const currentConfig = await ConfigManagerSQLite.getBotConfigById(botConfig.id);
        const wasRunning = currentConfig && currentConfig.status === 'running' && activeBotInstances.has(botConfig.id);

        if (wasRunning) {
          // Se está rodando, usa a nova rota de atualização
          Logger.info(`🔄 [CONFIG] Bot ${botConfig.id} está rodando, usando atualização segura...`);

          // Chama a nova rota de atualização
          const updateResponse = await fetch(`http://localhost:${PORT}/api/bot/update-running`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              botId: botConfig.id,
              config: botConfig
            })
          });

          const updateResult = await updateResponse.json();

          if (!updateResult.success) {
            throw new Error(updateResult.error || 'Erro ao atualizar bot em execução');
          }

          res.json({
            success: true,
            message: updateResult.message,
            botId: botConfig.id,
            wasRunning: true
          });
        } else {
          // Se não está rodando, atualiza normalmente
          await ConfigManagerSQLite.updateBotConfigById(botConfig.id, botConfig);

          res.json({
            success: true,
            message: `Bot ${botConfig.id} atualizado com sucesso`,
            botId: botConfig.id,
            wasRunning: false
          });
        }
      } else {
        const botId = await ConfigManagerSQLite.addBotConfig(botConfig);
        res.json({
          success: true,
          message: `Bot criado com sucesso`,
          botId: botId
        });
      }
    } else {
      // Se o request tem a estrutura direta { strategyName, apiKey, apiSecret, ... }
      const config = req.body;

      if (!config.strategyName) {
        return res.status(400).json({
          success: false,
          error: 'strategyName é obrigatório'
        });
      }

      if (!config.apiKey || !config.apiSecret) {
        return res.status(400).json({
          success: false,
          error: 'apiKey e apiSecret são obrigatórios'
        });
      }

      // Se tem ID, atualiza; senão, cria novo
      if (config.id) {
        // Verifica se o bot estava rodando antes da atualização
        const currentConfig = await ConfigManagerSQLite.getBotConfigById(config.id);
        const wasRunning = currentConfig && currentConfig.status === 'running' && activeBotInstances.has(config.id);

        if (wasRunning) {
          // Se está rodando, usa a nova rota de atualização
          Logger.info(`🔄 [CONFIG] Bot ${config.id} está rodando, usando atualização segura...`);

          // Chama a nova rota de atualização
          const updateResponse = await fetch(`http://localhost:${PORT}/api/bot/update-running`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              botId: config.id,
              config: config
            })
          });

          const updateResult = await updateResponse.json();

          if (!updateResult.success) {
            throw new Error(updateResult.error || 'Erro ao atualizar bot em execução');
          }

          res.json({
            success: true,
            message: updateResult.message,
            botId: config.id,
            wasRunning: true
          });
        } else {
          // Se não está rodando, atualiza normalmente
          await ConfigManagerSQLite.updateBotConfigById(config.id, config);

          res.json({
            success: true,
            message: `Bot ${config.id} atualizado com sucesso`,
            botId: config.id,
            wasRunning: false
          });
        }
      } else {
        const botId = await ConfigManagerSQLite.addBotConfig(config);
        res.json({
          success: true,
          message: `Bot criado com sucesso`,
          botId: botId
        });
      }
    }
  } catch (error) {
    Logger.error(`❌ [CONFIG] Erro ao processar configuração:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/configs - Retorna todas as configurações
app.get('/api/configs', async (req, res) => {
  try {
    // Verifica se o ConfigManagerSQLite está inicializado
    if (!ConfigManagerSQLite.dbService || !ConfigManagerSQLite.dbService.isInitialized()) {
      return res.status(500).json({
        success: false,
        error: 'Database service não está inicializado'
      });
    }

    const configs = await ConfigManagerSQLite.loadConfigs();

    res.json({
      success: true,
      data: configs
    });
  } catch (error) {
    Logger.error('❌ Erro no endpoint /api/configs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});





// DELETE /api/configs/bot/:botName - Remove uma configuração por botName
app.delete('/api/configs/bot/:botName', async (req, res) => {
  try {
    const { botName } = req.params;

    await ConfigManagerSQLite.removeBotConfigByBotName(botName);

    res.json({
      success: true,
      message: `Bot ${botName} removido com sucesso`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// DELETE /api/configs/:botId - Remove uma configuração por ID
app.delete('/api/configs/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const botIdNum = parseInt(botId);

    if (isNaN(botIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'ID do bot deve ser um número válido'
      });
    }

    // Verifica se o bot existe antes de deletar
    const existingConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!existingConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botIdNum} não encontrado`
      });
    }

    // Para o bot se estiver rodando
    if (activeBotInstances.has(botIdNum)) {
      Logger.info(`🛑 [DELETE] Parando bot ${existingConfig.botName} antes de deletar...`);
      await stopBot(botIdNum);
    }

    // === LIMPEZA COMPLETA DO BOT ===

    // 1. Remove a configuração do bot
    await ConfigManagerSQLite.removeBotConfigById(botIdNum);
    Logger.info(`✅ [DELETE] Configuração do bot ${botIdNum} removida`);

    // 2. Limpa o estado do trailing stop do bot
    const botKey = `bot_${botIdNum}`;
    const TrailingStateAdapter = await import('./src/Persistence/adapters/TrailingStateAdapter.js');
    const trailingRemoved = TrailingStateAdapter.default.removeBotState(botKey);

    if (trailingRemoved) {
      Logger.info(`🧹 [DELETE] Estado do trailing stop do bot ${botIdNum} removido`);
    }

    // 3. Limpa ordens do bot usando OrdersService
    try {
      const OrdersService = await import('./src/Services/OrdersService.js');
      const ordersRemoved = await OrdersService.default.clearOrdersByBotId(botIdNum);
      if (ordersRemoved > 0) {
        Logger.info(`🧹 [DELETE] ${ordersRemoved} ordens do bot ${botIdNum} removidas`);
      }
    } catch (error) {
      Logger.info(`ℹ️ [DELETE] OrdersService não disponível ou erro: ${error.message}`);
    }

    // 4. Limpa posições do bot da nova tabela positions
    try {
      const positionsResult = await ConfigManagerSQLite.dbService.run(
        'DELETE FROM positions WHERE botId = ?',
        [botIdNum]
      );
      if (positionsResult.changes > 0) {
        Logger.info(`🧹 [DELETE] ${positionsResult.changes} posições do bot ${botIdNum} removidas`);
      }
    } catch (error) {
      Logger.info(`ℹ️ [DELETE] Erro ao remover posições: ${error.message}`);
    }

    // 5. Remove de instâncias ativas (se ainda estiver lá)
    if (activeBotInstances.has(botIdNum)) {
      activeBotInstances.delete(botIdNum);
      Logger.info(`🧹 [DELETE] Instância ativa do bot ${botIdNum} removida`);
    }

    // 6. Remove configurações de rate limit
    if (monitorRateLimits.has(botIdNum)) {
      monitorRateLimits.delete(botIdNum);
      Logger.info(`🧹 [DELETE] Rate limits do bot ${botIdNum} removidos`);
    }

    Logger.info(`🎯 [DELETE] Bot ${botIdNum} completamente removido - Config, Trailing, Ordens, Posições, Instâncias e Rate Limits`);

    res.json({
      success: true,
      message: `Bot ID ${botIdNum} removido com sucesso - Todos os dados foram limpos`
    });
  } catch (error) {
    Logger.error('❌ [DELETE] Erro ao deletar bot:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/strategies - Retorna todas as estratégias disponíveis
app.get('/api/strategies', (req, res) => {
  try {
    const strategies = StrategyFactory.getAvailableStrategies();

    res.json({
      success: true,
      data: strategies
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/account/clear-cache - Limpa o cache do AccountController
app.post('/api/account/clear-cache', (req, res) => {
  try {
    // Importa o AccountController dinamicamente
    import('./src/Controllers/AccountController.js').then(module => {
      const AccountController = module.default;
      AccountController.clearCache();

      res.json({
        success: true,
        message: 'Cache do AccountController limpo com sucesso'
      });
    }).catch(error => {
      res.status(500).json({
        success: false,
        error: error.message
      });
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});



// GET /api/klines - Retorna dados de klines para um símbolo
app.get('/api/klines', async (req, res) => {
  try {
    const { symbol, interval = '5m', limit = 100 } = req.query;

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: 'symbol é obrigatório'
      });
    }

    // Aqui você implementaria a lógica para buscar os dados de klines
    // Por enquanto, retornamos dados mock
    const mockKlines = Array.from({ length: parseInt(limit) }, (_, i) => ({
      time: Date.now() - (parseInt(limit) - i) * 60000,
      open: 100 + Math.random() * 10,
      high: 100 + Math.random() * 15,
      low: 100 + Math.random() * 5,
      close: 100 + Math.random() * 10,
      volume: Math.random() * 1000
    }));

    res.json({
      success: true,
      data: mockKlines
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/health - Endpoint de saúde do sistema
app.get('/api/health', async (req, res) => {
  try {
    const health = {
      database: {
        initialized: ConfigManagerSQLite.dbService?.isInitialized() || false,
        path: ConfigManagerSQLite.dbService?.dbPath || 'N/A'
      },
      configManager: {
        initialized: !!ConfigManagerSQLite.dbService
      },
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      data: health
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/tokens/available - Retorna tokens/markets disponíveis
app.get('/api/tokens/available', async (req, res) => {
  try {
    Logger.info('🔍 [API] Buscando tokens disponíveis...');

    // Usar a classe Markets para obter dados da Backpack API
    const Markets = await import('./src/Backpack/Public/Markets.js');
    Logger.debug('✅ [API] Markets importado com sucesso');

    const marketsInstance = new Markets.default();
    Logger.debug('✅ [API] Instância Markets criada');

    const markets = await marketsInstance.getMarkets();
    Logger.debug(`📊 [API] Dados recebidos da API: ${markets ? markets.length : 0} mercados`);

    if (!markets || !Array.isArray(markets)) {
      Logger.error('❌ [API] Dados inválidos recebidos da API:', markets);
      return res.status(500).json({
        success: false,
        error: 'Erro ao obter dados de mercado da API'
      });
    }

    // Filtrar apenas mercados PERP ativos
    Logger.debug(`🔍 [API] Filtrando ${markets.length} mercados...`);
    Logger.debug(`🔍 [API] Primeiros 3 mercados:`, markets.slice(0, 3).map(m => ({ symbol: m.symbol, marketType: m.marketType, orderBookState: m.orderBookState })));

    const availableTokens = markets
      .filter(market =>
        market.marketType === 'PERP' &&
        market.orderBookState === 'Open'
      )
      .map(market => ({
        symbol: market.symbol,
        baseSymbol: market.baseSymbol,
        quoteSymbol: market.quoteSymbol,
        marketType: market.marketType,
        orderBookState: market.orderBookState,
        status: market.status || 'Unknown'
      }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));

    Logger.debug(`✅ [API] Tokens filtrados: ${availableTokens.length} PERP ativos`);

    res.json({
      success: true,
      tokens: availableTokens,
      total: availableTokens.length
    });
  } catch (error) {
    Logger.error('❌ Erro ao buscar tokens disponíveis:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/positions - Retorna posições abertas de todos os bots
app.get('/api/positions', async (req, res) => {
  try {
    const positions = [];

    // Para cada bot ativo, buscar suas posições
    for (const [botName, bot] of activeBotInstances.entries()) {
      if (bot.status === 'running' && bot.intervalId) { // Verifica se o bot está rodando e tem intervalo
        try {
          // Buscar posições da exchange (em produção, usar API real)
          const botPositions = await getBotPositions(botName);
          positions.push(...botPositions);
        } catch (error) {
          Logger.error(`Erro ao buscar posições do bot ${botName}:`, error);
        }
      }
    }

    res.json({
      success: true,
      data: positions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/orders - Retorna ordens pendentes de todos os bots
app.get('/api/orders', async (req, res) => {
  try {
    const orders = [];

    // Para cada bot ativo, buscar suas ordens pendentes
    for (const [botName, bot] of activeBotInstances.entries()) {
      if (bot.status === 'running' && bot.intervalId) { // Verifica se o bot está rodando e tem intervalo
        try {
          // Buscar ordens da exchange (em produção, usar API real)
          const botOrders = await getBotOrders(botName);
          orders.push(...botOrders);
        } catch (error) {
          Logger.error(`Erro ao buscar ordens do bot ${botName}:`, error);
        }
      }
    }

    res.json({
      success: true,
      data: orders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/trading-stats/:botId - Busca estatísticas de trading por ID do bot
app.get('/api/trading-stats/:botId', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);

    if (isNaN(botId)) {
      return res.status(400).json({
        success: false,
        error: 'ID do bot inválido'
      });
    }

    const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);

    if (!botConfig || !botConfig.apiKey || !botConfig.apiSecret) {
      return res.status(400).json({
        success: false,
        error: 'Configuração de API não encontrada'
      });
    }

    // Busca dados da Backpack API
    const [account, collateral] = await Promise.all([
      Account.getAccount(null, botConfig.apiKey, botConfig.apiSecret),
      Capital.getCollateral(null, botConfig.apiKey, botConfig.apiSecret)
    ]);

    if (!account || !collateral) {
      throw new Error('Falha ao obter dados da conta');
    }

    // Processa dados da conta
    const totalBalance = parseFloat(collateral.netEquityAvailable || 0);

    // Dados simplificados para validação
    const stats = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnl: 0,
      totalOpenPositions: 0,
      totalPositionPnl: 0,
      totalBalance: Math.round(totalBalance * 100) / 100,
      lastUpdated: new Date().toISOString()
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    Logger.error('Erro ao buscar estatísticas de trading:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/trading-stats/bot/:botName - Busca estatísticas de trading por botName
app.get('/api/trading-stats/bot/:botName', async (req, res) => {
  try {
    const { botName } = req.params;
    const botConfig = await ConfigManagerSQLite.getBotConfigByBotName(botName);

    if (!botConfig || !botConfig.apiKey || !botConfig.apiSecret) {
      return res.status(400).json({
        success: false,
        error: 'Configuração de API não encontrada'
      });
    }

                            // Busca dados da Backpack API
            const [account, collateral] = await Promise.all([
              Account.getAccount(null, botConfig.apiKey, botConfig.apiSecret),
              Capital.getCollateral(null, botConfig.apiKey, botConfig.apiSecret)
            ]);

            if (!account || !collateral) {
              throw new Error('Falha ao obter dados da conta');
            }

            // Processa dados da conta
            const totalBalance = parseFloat(collateral.netEquityAvailable || 0);

            // Dados simplificados para validação
            const stats = {
              totalTrades: 0,
              winningTrades: 0,
              losingTrades: 0,
              winRate: 0,
              totalPnl: 0,
              totalOpenPositions: 0,
              totalPositionPnl: 0,
              totalBalance: Math.round(totalBalance * 100) / 100,
              lastUpdated: new Date().toISOString()
            };



    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    Logger.error('Erro ao buscar estatísticas de trading:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});



// GET /api/backpack-positions/bot/:botName - Busca posições da Backpack por botName
app.get('/api/backpack-positions/bot/:botName', async (req, res) => {
  try {
    const { botName } = req.params;
    const botConfig = await ConfigManagerSQLite.getBotConfigByBotName(botName);

    if (!botConfig || !botConfig.apiKey || !botConfig.apiSecret) {
      return res.status(400).json({
        success: false,
        error: 'Configuração de API não encontrada'
      });
    }

    const positions = await makeBackpackRequest(botConfig.apiKey, botConfig.apiSecret, '/api/v1/positions');

    res.json({
      success: true,
      data: positions.positions || []
    });
  } catch (error) {
    Logger.error('Erro ao buscar posições da Backpack:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/validate-credentials - Valida credenciais da Backpack
app.post('/api/validate-credentials', async (req, res) => {
  try {
    const { apiKey, apiSecret } = req.body;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        success: false,
        error: 'API Key e API Secret são obrigatórios'
      });
    }

    // Validar credenciais na Backpack API
    try {
      const [accountData, collateralData] = await Promise.all([
        Account.getAccount(null, apiKey, apiSecret),
        Capital.getCollateral(null, apiKey, apiSecret)
      ]);

      if (accountData && accountData.leverageLimit && collateralData) {
        res.json({
          success: true,
          message: 'Credenciais válidas',
          apiKeyStatus: 'válida',
          account: {
            exchangeName: 'Backpack Account',
            leverageLimit: accountData.leverageLimit,
            futuresMakerFee: accountData.futuresMakerFee,
            futuresTakerFee: accountData.futuresTakerFee,
            netEquityAvailable: collateralData.netEquityAvailable,
            totalEquity: collateralData.totalEquity
          }
        });
      } else {
        res.status(401).json({
          success: false,
          error: 'Credenciais inválidas',
          apiKeyStatus: 'inválida'
        });
      }
    } catch (backpackError) {
      Logger.error('Erro na validação da Backpack:', backpackError);
      res.status(401).json({
        success: false,
        error: 'Credenciais inválidas ou erro de conexão com a Backpack',
        apiKeyStatus: 'com erro'
      });
    }
  } catch (error) {
    Logger.error('Erro ao validar credenciais:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/validate-duplicate-credentials - Valida se já existe bot com as mesmas credenciais
app.post('/api/validate-duplicate-credentials', async (req, res) => {
  try {
    const { apiKey, apiSecret } = req.body;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        success: false,
        error: 'API Key e API Secret são obrigatórios'
      });
    }

    // Buscar todas as configurações salvas
    const configs = await ConfigManagerSQLite.loadConfigs();

    // Verificar se já existe um bot com as mesmas credenciais
    const existingBot = configs.find(config =>
      config.apiKey === apiKey && config.apiSecret === apiSecret
    );

    if (existingBot) {
      return res.status(409).json({
        success: false,
        error: 'Já existe um bot configurado com essas credenciais de API',
        existingBot: {
          botName: existingBot.botName,
          strategyName: existingBot.strategyName
        }
      });
    }

    res.json({
      success: true,
      message: 'Credenciais únicas, pode prosseguir'
    });
  } catch (error) {
    Logger.error('Erro ao validar credenciais duplicadas:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// WebSocket connection handler
wss.on('connection', (ws) => {
  connections.add(ws);
  Logger.info(`🔌 [WS] Nova conexão WebSocket estabelecida`);

  // Envia status inicial
  ws.send(JSON.stringify({
    type: 'CONNECTION_ESTABLISHED',
    timestamp: new Date().toISOString(),
    message: 'Conexão WebSocket estabelecida'
  }));

  ws.on('close', () => {
    connections.delete(ws);
    Logger.info(`🔌 [WS] Conexão WebSocket fechada`);
  });

  ws.on('error', (error) => {
    Logger.error('🔌 [WS] Erro na conexão WebSocket:', error.message);
  });
});

// Função para buscar posições de um bot específico
async function getBotPositions(botName) {
  try {
    const bot = activeBotInstances.get(botName);
    if (!bot || !bot.intervalId) { // Verifica se o bot está rodando e tem intervalo
      return [];
    }

    // Em produção, aqui você faria uma chamada real para a API da exchange
    // Por enquanto, simulamos dados baseados no estado do bot
    const positions = [];

    // Simular posições baseadas no status do bot
    if (bot.status === 'running') {
      // Simular algumas posições ativas
      const symbols = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP'];
      const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];
      const isLong = Math.random() > 0.5;
      const entryPrice = 50000 + Math.random() * 10000;
      const currentPrice = entryPrice + (Math.random() - 0.5) * 2000;
      const size = 0.1 + Math.random() * 0.9;
      const pnl = (currentPrice - entryPrice) * (isLong ? 1 : -1) * size;

      positions.push({
        symbol: randomSymbol,
        side: isLong ? 'LONG' : 'SHORT',
        size: size,
        entryPrice: entryPrice,
        currentPrice: currentPrice,
        pnl: pnl,
        pnlPercentage: (pnl / (entryPrice * size)) * 100,
        stopLoss: entryPrice * (isLong ? 0.95 : 1.05),
        takeProfit: entryPrice * (isLong ? 1.05 : 0.95),
        botName: botName
      });
    }

    return positions;
  } catch (error) {
    Logger.error(`Erro ao buscar posições do bot ${botName}:`, error);
    return [];
  }
}

// Função para buscar ordens pendentes de um bot específico
async function getBotOrders(botName) {
  try {
    const bot = activeBotInstances.get(botName);
    if (!bot || !bot.intervalId) { // Verifica se o bot está rodando e tem intervalo
      return [];
    }

    // Em produção, aqui você faria uma chamada real para a API da exchange
    // Por enquanto, simulamos dados baseados no estado do bot
    const orders = [];

    // Simular ordens pendentes baseadas no status do bot
    if (bot.status === 'running') {
      // Simular algumas ordens pendentes
      const symbols = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP'];
      const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];
      const isLong = Math.random() > 0.5;
      const price = 50000 + Math.random() * 10000;
      const size = 0.1 + Math.random() * 0.9;

      orders.push({
        id: `order-${botName}-${Date.now()}`,
        symbol: randomSymbol,
        side: isLong ? 'LONG' : 'SHORT',
        type: 'LIMIT',
        size: size,
        price: price,
        status: 'PENDING',
        botName: botName,
        createdAt: new Date(Date.now() - Math.random() * 10 * 60 * 1000), // 0-10 minutos atrás
        timeInForce: 'GTC'
      });
    }

    return orders;
  } catch (error) {
    Logger.error(`Erro ao buscar ordens do bot ${botName}:`, error);
    return [];
  }
}

// GET /api/bot/:botId/positions/history - Retorna posições do histórico da Backpack
app.get('/api/bot/:botId/positions/history', async (req, res) => {
  try {
    const { botId } = req.params;
    const { symbol, limit, offset, sortDirection } = req.query; // Filtros opcionais
    const botIdNum = parseInt(botId);

    if (isNaN(botIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'botId deve ser um número válido'
      });
    }

    // Busca configuração do bot por ID
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`
      });
    }

    // Opções de filtro
    const options = {};
    if (symbol) options.symbol = symbol;
    if (limit) options.limit = parseInt(limit);
    if (offset) options.offset = parseInt(offset);
    if (sortDirection) options.sortDirection = sortDirection;

    // Recupera posições do histórico da Backpack
    const positionsData = await OrderController.getBotPositionsFromHistory(botIdNum, botConfig, options);

    res.json({
      success: true,
      data: positionsData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/bot/:botId/positions/history/summary - Retorna resumo das posições do histórico
app.get('/api/bot/:botId/positions/history/summary', async (req, res) => {
  try {
    const { botId } = req.params;
    const botIdNum = parseInt(botId);

    if (isNaN(botIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'botId deve ser um número válido'
      });
    }

    // Busca configuração do bot por ID
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`
      });
    }

    // Recupera apenas estatísticas das posições do histórico
    const positionsData = await OrderController.getBotPositionsFromHistory(botIdNum, botConfig);

    res.json({
      success: true,
      data: {
        botId: positionsData.botId,
        botName: positionsData.botName,
        strategyName: positionsData.strategyName,
        statistics: positionsData.statistics,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/bot/performance - Analisa performance de um bot específico
app.get('/api/bot/performance', async (req, res) => {
  try {
    const { botClientOrderId, botId, days = 90, limit = 1000 } = req.query;

    // Validação dos parâmetros
    if (!botClientOrderId && !botId) {
      return res.status(400).json({
        success: false,
        error: 'botClientOrderId ou botId é obrigatório'
      });
    }

    let botConfig;
    let botClientOrderIdToUse;

    // Se foi fornecido botId, busca a configuração do bot
    if (botId) {
      const botIdNum = parseInt(botId);
      if (isNaN(botIdNum)) {
        return res.status(400).json({
          success: false,
          error: 'botId deve ser um número válido'
        });
      }

      botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
      if (!botConfig) {
        return res.status(404).json({
          success: false,
          error: `Bot com ID ${botId} não encontrado`
        });
      }

      // Se não foi fornecido botClientOrderId, usa o do bot configurado
      if (!botClientOrderId) {
        if (!botConfig.botClientOrderId) {
          return res.status(400).json({
            success: false,
            error: 'Bot não possui botClientOrderId configurado'
          });
        }
        botClientOrderIdToUse = botConfig.botClientOrderId;
      } else {
        botClientOrderIdToUse = botClientOrderId;
      }
    } else {
      // Se foi fornecido apenas botClientOrderId, busca um bot que use essas credenciais
      const configs = await ConfigManagerSQLite.loadConfigs();
      botConfig = configs.find(config =>
        config.apiKey && config.apiSecret &&
        (config.botClientOrderId === botClientOrderId || config.botName === botClientOrderId)
      );

      if (!botConfig) {
        return res.status(404).json({
          success: false,
          error: `Nenhum bot encontrado com botClientOrderId: ${botClientOrderId}`
        });
      }
    }

    // Validação das credenciais
    if (!botConfig.apiKey || !botConfig.apiSecret) {
      return res.status(400).json({
        success: false,
        error: 'Bot não possui credenciais de API configuradas'
      });
    }

    // Opções de análise
    const options = {
      days: parseInt(days),
      limit: parseInt(limit)
    };

    // Executa a análise de performance usando a classe History
    const performanceData = await History.analyzeBotPerformance(botClientOrderIdToUse, options, botConfig.apiKey, botConfig.apiSecret);

    res.json({
      success: true,
      data: performanceData
    });

  } catch (error) {
    Logger.error('Erro ao analisar performance do bot:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/bot/performance/details - Retorna detalhes das posições individuais
app.get('/api/bot/performance/details', async (req, res) => {
  try {
    const { botClientOrderId, botId, includeOpen = 'false' } = req.query;

    // Validação dos parâmetros
    if (!botClientOrderId && !botId) {
      return res.status(400).json({
        success: false,
        error: 'botClientOrderId ou botId é obrigatório'
      });
    }

    let botConfig;
    let botClientOrderIdToUse;

    // Se foi fornecido botId, busca a configuração do bot
    if (botId) {
      const botIdNum = parseInt(botId);
      if (isNaN(botIdNum)) {
        return res.status(400).json({
          success: false,
          error: 'botId deve ser um número válido'
          });
        }

        botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
        if (!botConfig) {
          return res.status(404).json({
            success: false,
            error: `Bot com ID ${botId} não encontrado`
          });
        }

        // Se não foi fornecido botClientOrderId, usa o do bot configurado
        if (!botClientOrderId) {
          if (!botConfig.botClientOrderId) {
            return res.status(400).json({
              success: false,
              error: 'Bot não possui botClientOrderId configurado'
            });
          }
          botClientOrderIdToUse = botConfig.botClientOrderId;
        } else {
          botClientOrderIdToUse = botClientOrderId;
        }
      } else {
        // Se foi fornecido apenas botClientOrderId, busca um bot que use essas credenciais
        const configs = await ConfigManagerSQLite.loadConfigs();
        botConfig = configs.find(config =>
          config.apiKey && config.apiSecret &&
          (config.botClientOrderId === botClientOrderId || config.botName === botClientOrderId)
        );

        if (!botConfig) {
          return res.status(404).json({
            success: false,
            error: `Nenhum bot encontrado com botClientOrderId: ${botClientOrderId}`
          });
        }
      }

      // Validação das credenciais
      if (!botConfig.apiKey || !botConfig.apiSecret) {
        return res.status(400).json({
          success: false,
          error: 'Bot não possui credenciais de API configuradas'
        });
      }

      // Opções de análise
      const options = {
        includeOpen: includeOpen === 'true'
      };

      // Executa a análise de detalhes usando a classe History
      const detailsData = await History.getBotPerformanceDetails(botClientOrderIdToUse, options, botConfig.apiKey, botConfig.apiSecret);

      res.json({
        success: true,
        data: {
          ...detailsData,
          botName: botConfig.botName
        }
      });

    } catch (error) {
      Logger.error('Erro ao buscar detalhes de performance do bot:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

// GET /api/bot/performance/simple - Endpoint simples para teste
app.get('/api/bot/performance/simple', async (req, res) => {
  try {
    const { botId } = req.query;

    if (!botId) {
      return res.status(400).json({
        success: false,
        error: 'botId é obrigatório'
      });
    }

    const botIdNum = parseInt(botId);
    if (isNaN(botIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'botId deve ser um número válido'
      });
    }

    // Busca configuração do bot
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`
      });
    }

    // Validação das credenciais
    if (!botConfig.apiKey || !botConfig.apiSecret) {
      return res.status(400).json({
        success: false,
        error: 'Bot não possui credenciais de API configuradas'
      });
    }

    // Usa botClientOrderId do bot ou botName como fallback
    const botClientOrderId = botConfig.botClientOrderId || botConfig.botName;

    Logger.info(`🔍 Testando performance para bot ${botId} (${botClientOrderId})`);
    Logger.info(`🔍 Configuração do bot:`, {
      id: botConfig.id,
      botName: botConfig.botName,
      botClientOrderId: botConfig.botClientOrderId,
      orderCounter: botConfig.orderCounter
    });

    Logger.info(`🔍 [ENDPOINT] Chamando History.analyzeBotPerformance...`);
    Logger.info(`🔍 [ENDPOINT] History object:`, typeof History);
    Logger.info(`🔍 [ENDPOINT] History.analyzeBotPerformance:`, typeof History.analyzeBotPerformance);
    // Executa análise simples
    const performanceData = await History.analyzeBotPerformance(
      botClientOrderId,
      { days: 30, limit: 100 },
      botConfig.apiKey,
      botConfig.apiSecret
    );
    Logger.info(`🔍 [ENDPOINT] History.analyzeBotPerformance concluído`);

    res.json({
      success: true,
      data: {
        botId: botIdNum,
        botName: botConfig.botName,
        botClientOrderId: botClientOrderId,
        performance: performanceData.performance,
        positions: performanceData.positions,
        lastAnalyzed: performanceData.lastAnalyzed,
        analysisPeriod: performanceData.analysisPeriod
      }
    });

  } catch (error) {
    Logger.error('Erro no endpoint simples:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Função para iniciar monitores para todos os bots habilitados
async function startMonitorsForAllEnabledBots() {
  try {
    Logger.info('🔄 [MONITORS] Iniciando monitores para todos os bots habilitados...');

    // Carrega todos os bots habilitados
    const configs = await ConfigManagerSQLite.loadConfigs();
    const enabledBots = configs.filter(config => config.enabled);

    if (enabledBots.length === 0) {
      Logger.debug('ℹ️ [MONITORS] Nenhum bot habilitado encontrado');
      return;
    }

    Logger.info(`🔄 [MONITORS] Iniciando monitores para ${enabledBots.length} bots habilitados...`);

    // Inicia monitores para cada bot habilitado
    for (const botConfig of enabledBots) {
      try {
        const botId = botConfig.id;

        // Verifica se tem credenciais antes de iniciar monitores
        if (!botConfig.apiKey || !botConfig.apiSecret) {
          Logger.debug(`⚠️ [MONITORS] Bot ${botId} (${botConfig.botName}) não tem credenciais, pulando monitores`);
          continue;
        }

        Logger.debug(`🔄 [MONITORS] Iniciando monitores para bot ${botId} (${botConfig.botName})`);

        // Inicia apenas o monitor de trailing stops órfãos (outros monitores são para bots ativos)
        setTimeout(() => startTrailingStopsCleanerMonitor(botId), 2000); // Delay de 2s para não sobrecarregar

        Logger.debug(`✅ [MONITORS] Monitores iniciados para bot ${botId}`);

      } catch (error) {
        Logger.error(`❌ [MONITORS] Erro ao iniciar monitores para bot ${botConfig.id}:`, error.message);
      }
    }

    Logger.info('✅ [MONITORS] Monitores globais iniciados com sucesso');

  } catch (error) {
    Logger.error('❌ [MONITORS] Erro ao carregar bots para monitores:', error.message);
  }
}

// Inicialização do servidor
async function initializeServer() {
  try {
    Logger.info('🚀 [SERVER] Iniciando servidor API...');

    // Inicializa o database service
    const dbService = new DatabaseService();
    await dbService.init();

    // Inicializa o ConfigManager SQLite
    ConfigManagerSQLite.initialize(dbService);

    // Inicializa o OrdersService
    const OrdersService = await import('./src/Services/OrdersService.js');
    OrdersService.default.init(dbService);

    // Inicializa o BotOrdersManager
    await initializeBotOrdersManager();

    // Carrega o estado persistido do Trailing Stop do banco de dados
    if (dbService && dbService.isInitialized()) {
      await TrailingStop.loadStateFromDB(dbService);
    } else {
      Logger.warn('⚠️ [SERVER] Database service não inicializado, Trailing Stop será carregado individualmente para cada bot');
    }

    // Migração automática: cria estado para posições abertas existentes
    // Será executada individualmente para cada bot quando iniciarem
    Logger.debug('ℹ️ [SERVER] Migração do Trailing Stop será executada individualmente para cada bot');

    // PnL Controller será executado individualmente para cada bot
    Logger.debug('ℹ️ [SERVER] PnL Controller será executado individualmente para cada bot');

    // Inicializa o PositionSyncService
    Logger.info('🔄 [SERVER] Inicializando PositionSyncService...');
    PositionSyncService = new PositionSyncServiceClass(ConfigManagerSQLite.dbService);

    // Verifica e libera a porta antes de iniciar o servidor
    await killProcessOnPort(PORT);

    // Inicializa o servidor primeiro
    server.listen(PORT, () => {
      Logger.info(`✅ [SERVER] Servidor rodando na porta ${PORT}`);
      Logger.info(`📊 [SERVER] API disponível em http://localhost:${PORT}`);
      Logger.info(`🔌 [SERVER] WebSocket disponível em ws://localhost:${PORT}`);
      Logger.info(`🤖 [SERVER] Estratégias disponíveis: ${StrategyFactory.getAvailableStrategies().join(', ')}`);
    }).on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        Logger.error(`❌ [SERVER] Porta ${PORT} ainda está em uso após limpeza. Abortando...`);
        process.exit(1);
      } else {
        Logger.error(`❌ [SERVER] Erro ao iniciar servidor:`, err.message);
        process.exit(1);
      }
    });

    // Carrega e recupera bots em background (não bloqueia o servidor)
    loadAndRecoverBots().catch(error => {
      Logger.error('❌ [SERVER] Erro ao carregar e recuperar bots:', error.message);
    });

    // Inicia monitores para todos os bots habilitados (independente de estarem rodando)
    startMonitorsForAllEnabledBots().catch(error => {
      Logger.error('❌ [SERVER] Erro ao iniciar monitores globais:', error.message);
    });

  } catch (error) {
    Logger.error('❌ [SERVER] Erro ao inicializar servidor:', error.message);
    process.exit(1);
  }
}

// Inicializa o servidor
initializeServer();

export { startBot, stopBot, activeBotInstances, broadcast };

// GET /api/bot/:botId/sync-status - Retorna status da sincronização de posições
app.get('/api/bot/:botId/sync-status', async (req, res) => {
  try {
    const { botId } = req.params;
    const botIdNum = parseInt(botId);

    if (isNaN(botIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'botId deve ser um número válido'
      });
    }

    // Busca configuração do bot
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`
      });
    }

    // Obtém status da sincronização
    const syncStatus = PositionSyncService.getSyncStatus();
    const botSyncStatus = syncStatus[botIdNum] || { isActive: false, lastSync: null };

    res.json({
      success: true,
      data: {
        botId: botIdNum,
        botName: botConfig.botName,
        syncStatus: botSyncStatus,
        lastSync: botSyncStatus.lastSync ? new Date(botSyncStatus.lastSync).toISOString() : null
      }
    });

  } catch (error) {
    Logger.error('❌ Erro ao buscar status da sincronização:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// GET /api/bot/summary - Retorna resumo completo das estatísticas do bot para o card
app.get('/api/bot/summary', async (req, res) => {
  try {
    const { botId } = req.query;

    if (!botId) {
      return res.status(400).json({
        success: false,
        error: 'botId é obrigatório'
      });
    }

    const botIdNum = parseInt(botId);
    if (isNaN(botIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'botId deve ser um número válido'
      });
    }

    // Busca configuração do bot
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`
      });
    }

    // Usa botClientOrderId do bot
    const botClientOrderId = botConfig.botClientOrderId;

    Logger.info(`🔍 [SUMMARY] Gerando resumo para bot ${botId} (${botClientOrderId})`);

    // NOVO SISTEMA: Usa PositionTrackingService para dados de performance
    let performanceData;
    try {
      Logger.info(`🔄 [SUMMARY] Usando novo sistema de rastreamento para bot ${botIdNum}`);

      // Instancia o PositionTrackingService com o DatabaseService
      const positionTracker = new PositionTrackingService(ConfigManagerSQLite.dbService);
      const trackingResult = await positionTracker.trackBotPositions(botIdNum, botConfig);
      const { performanceMetrics } = trackingResult;

      // Converte para o formato esperado pelo endpoint
      performanceData = {
        performance: {
          totalTrades: performanceMetrics.totalTrades,
          winningTrades: performanceMetrics.winningTrades,
          losingTrades: performanceMetrics.losingTrades,
          winRate: performanceMetrics.winRate,
          profitFactor: performanceMetrics.profitFactor,
          totalPnl: performanceMetrics.totalPnl,
          averagePnl: performanceMetrics.avgPnl,
          maxDrawdown: performanceMetrics.maxDrawdown || 0,
          openTrades: performanceMetrics.openPositions,
          totalVolume: performanceMetrics.totalVolume || 0
        },
        positions: {
          closed: performanceMetrics.closedTrades,
          open: performanceMetrics.openPositions,
          total: performanceMetrics.totalPositions
        }
      };

    } catch (error) {
      Logger.warn(`⚠️ [SUMMARY] Erro ao buscar dados de performance (novo sistema): ${error.message}`);

      performanceData = {
        performance: {
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          profitFactor: 0,
          totalPnl: 0,
          averagePnl: 0,
          maxDrawdown: 0,
          openTrades: 0,
          totalVolume: 0
        },
        positions: {
          closed: 0,
          open: 0,
          total: 0
        }
      };
    }

    // Busca posições ativas apenas do bot (usando novo sistema)
    let activePositions = [];
    try {
      const positionTracker = new PositionTrackingService(ConfigManagerSQLite.dbService);
      activePositions = await positionTracker.getBotOpenPositions(botIdNum);
      Logger.info(`📊 [SUMMARY] Usando ${activePositions.length} posições do bot (evitando posições manuais)`);
    } catch (error) {
      Logger.warn(`⚠️ [SUMMARY] Erro ao buscar posições ativas do bot: ${error.message}`);
    }

    // Calcula profitRatio profissional baseado na análise trade a trade
    let profitRatio = 0;
    if (performanceData.performance.totalTrades > 0) {
      const winningTrades = performanceData.performance.winningTrades;
      const losingTrades = performanceData.performance.losingTrades;
      const totalPnl = performanceData.performance.totalPnl;
      const profitFactor = performanceData.performance.profitFactor;

      // Cálculo profissional do Profit Ratio como número float:
      // 1. Se tem trades vencedores e perdedores, usa Profit Factor
      // 2. Se só tem trades vencedores, usa ∞ (infinito) - divisão por zero
      // 3. Se só tem trades perdedores, usa 0 (zero ganhos)
      // 4. Se não tem trades fechados, usa 0.0

      if (winningTrades > 0 && losingTrades > 0) {
        // Tem trades vencedores e perdedores - usa Profit Factor
        profitRatio = profitFactor > 0 ? profitFactor : 1.0;
      } else if (winningTrades > 0 && losingTrades === 0) {
        // Só trades vencedores - Profit Factor = ∞ (ganhos / 0 = ∞)
        profitRatio = "∞"; // Representa infinito
      } else if (losingTrades > 0 && winningTrades === 0) {
        // Só trades perdedores - Profit Factor = 0 (0 / perdas = 0)
        profitRatio = 0.0;
      } else if (totalPnl > 0) {
        // PnL positivo mas sem trades perdedores (trades parciais)
        profitRatio = "∞"; // Representa infinito
      } else if (totalPnl < 0) {
        // PnL negativo
        profitRatio = 0.0;
      } else {
        // PnL zero ou sem trades fechados
        profitRatio = 0.0;
      }

    }

    // Calcula estatísticas do card
    const summary = {
      botId: botIdNum,
      botName: botConfig.botName,
      strategyName: botConfig.strategyName,
      updateInterval: "60s", // REALTIME (60s)
      statistics: {
        winningTrades: performanceData.performance.winningTrades,
        losingTrades: performanceData.performance.losingTrades,
        winRate: performanceData.performance.winRate,
        profitRatio: profitRatio,
        totalTrades: performanceData.performance.totalTrades,
        openPositions: activePositions.length
      },
      performance: {
        totalPnl: performanceData.performance.totalPnl,
        averagePnl: performanceData.performance.averagePnl,
        maxDrawdown: performanceData.performance.maxDrawdown,
        totalVolume: performanceData.performance.totalVolume
      },
      positions: {
        closed: performanceData.positions.closed,
        open: activePositions.length,
        total: performanceData.positions.closed + activePositions.length
      },
      lastUpdated: new Date().toISOString()
    };

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    Logger.error('❌ Erro no endpoint /api/bot/summary:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/bot/test-api/:botId - Testa a API da corretora diretamente
app.get('/api/bot/test-api/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const botIdNum = parseInt(botId);

    if (isNaN(botIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'botId deve ser um número válido'
      });
    }

    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`
      });
    }

    Logger.info(`🧪 [TEST-API] Testando API da corretora para bot ${botIdNum}`);

    // Testa busca de fills diretamente
    const History = (await import('./src/Backpack/Authenticated/History.js')).default;

    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

    const fills = await History.getFillHistory(
      null, // symbol - todos os símbolos
      null, // orderId
      sevenDaysAgo,
      now,
      1000, // limit
      0, // offset
      null, // fillType
      'PERP', // marketType
      null, // sortDirection
      botConfig.apiKey,
      botConfig.apiSecret
    );

    // Retorna mais detalhes dos fills para debug
    const fillsDetails = fills ? fills.map(fill => ({
      symbol: fill.symbol,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
      timestamp: fill.timestamp,
      orderId: fill.orderId,
      clientId: fill.clientId,
      fee: fill.fee,
      feeSymbol: fill.feeSymbol
    })) : [];

    res.json({
      success: true,
      data: {
        botId: botIdNum,
        botName: botConfig.botName,
        apiTest: {
          fillsCount: fills ? fills.length : 0,
          fillsSample: fills && fills.length > 0 ? fills[0] : null,
          fillsDetails: fillsDetails,
          error: null
        }
      }
    });

  } catch (error) {
    Logger.error('❌ Erro no teste da API da corretora:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ======= SHUTDOWN HANDLERS =======
// Função para fazer shutdown graceful de todos os bots
async function gracefulShutdown(signal) {
  Logger.info(`🛑 [SHUTDOWN] Recebido sinal ${signal}. Iniciando shutdown graceful...`);

  try {
    // Para o servidor HTTP primeiro
    if (server && server.listening) {
      Logger.info(`🛑 [SHUTDOWN] Fechando servidor HTTP...`);
      server.close((err) => {
        if (err) {
          Logger.error(`❌ [SHUTDOWN] Erro ao fechar servidor:`, err.message);
        } else {
          Logger.info(`✅ [SHUTDOWN] Servidor HTTP fechado`);
        }
      });
    }

    // Para todos os bots ativos
    const activeBotIds = Array.from(activeBotInstances.keys());
    Logger.info(`🛑 [SHUTDOWN] Parando ${activeBotIds.length} bots ativos...`);

    for (const botId of activeBotIds) {
      try {
        await stopBot(botId, false); // Não atualiza status durante shutdown graceful
        Logger.info(`✅ [SHUTDOWN] Bot ${botId} parado com sucesso`);
      } catch (error) {
        Logger.error(`❌ [SHUTDOWN] Erro ao parar bot ${botId}:`, error.message);
      }
    }

    // Para serviços globais se existirem
    if (PositionSyncService && typeof PositionSyncService.stopAllSync === 'function') {
      PositionSyncService.stopAllSync();
      Logger.info(`✅ [SHUTDOWN] PositionSyncService parado`);
    }

    if (typeof TrailingStop.cleanup === 'function') {
      await TrailingStop.cleanup();
    }

    Logger.info(`✅ [SHUTDOWN] Shutdown graceful concluído`);

    // Força saída após um tempo limite
    setTimeout(() => {
      Logger.warn(`⚠️ [SHUTDOWN] Forçando saída após timeout`);
      process.exit(0);
    }, 3000);

    process.exit(0);

  } catch (error) {
    Logger.error(`❌ [SHUTDOWN] Erro durante shutdown:`, error.message);
    process.exit(1);
  }
}

// Registra handlers para sinais de shutdown
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handler para erros não capturados
process.on('uncaughtException', (error) => {
  Logger.error('❌ [UNCAUGHT_EXCEPTION] Erro não capturado:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  Logger.error('❌ [UNHANDLED_REJECTION] Promise rejeitada não tratada:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

Logger.info('✅ [STARTUP] Handlers de shutdown configurados');