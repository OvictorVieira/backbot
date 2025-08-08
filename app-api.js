import dotenv from 'dotenv';
dotenv.config();

// Define a URL da API se não estiver definida
if (!process.env.API_URL) {
  process.env.API_URL = 'https://api.backpack.exchange';
}

import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
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
import History from './src/Backpack/Authenticated/History.js';
import BotOrdersManager from './src/Config/BotOrdersManager.js';
import ImportOrdersFromBackpack from './src/Config/ImportOrdersFromBackpack.js';
import ImportPositionsFromBackpack from './src/Config/ImportPositionsFromBackpack.js';
import readline from 'readline';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuração do servidor Express
const app = express();
const server = http.createServer(app);
const PORT = process.env.API_PORT || 3001;

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
        interval: 20000, // começa em 20s
        errorCount: 0,
        maxInterval: 180000, // máximo 3min
        minInterval: 20000,  // mínimo 20s
        lastErrorTime: null
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
    const configs = ConfigManager.loadConfigs();
    const botsToRecover = configs.filter(config => 
      config.enabled && 
      (config.status === 'running' || config.status === 'error' || config.status === 'starting')
    );
    
    if (botsToRecover.length === 0) {
      console.log(`ℹ️ [PERSISTENCE] Nenhum bot para recuperar encontrado`);
      return;
    }
    
    console.log(`📋 [PERSISTENCE] Carregando ${botsToRecover.length} bots para recuperação...`);
    
    // Executa todos os bots em paralelo sem aguardar
    const recoveryPromises = botsToRecover.map(async (botConfig) => {
      try {
        console.log(`🔄 [PERSISTENCE] Iniciando recuperação do bot: ${botConfig.id} (${botConfig.botName}) - Status anterior: ${botConfig.status}`);
        await recoverBot(botConfig.id, botConfig, botConfig.startTime);
      } catch (error) {
        console.error(`❌ [PERSISTENCE] Erro ao recuperar bot ${botConfig.id}:`, error.message);
      }
    });
    
    // Executa em background sem bloquear
    Promise.all(recoveryPromises).then(() => {
      console.log(`✅ [PERSISTENCE] Recuperação de bots concluída`);
    }).catch((error) => {
      console.error(`❌ [PERSISTENCE] Erro na recuperação de bots:`, error.message);
    });
    
  } catch (error) {
    console.error(`❌ [PERSISTENCE] Erro ao carregar bots ativos:`, error.message);
  }
}



/**
 * Recupera um bot específico sem chamar startBot recursivamente
 */
async function recoverBot(botId, config, startTime) {
  try {
    // Verifica se a estratégia é válida
    if (!StrategyFactory.isValidStrategy(config.strategyName)) {
      console.error(`❌ [PERSISTENCE] Estratégia ${config.strategyName} não é válida`);
      return;
    }
    
    // Limpa status de erro se existir
    ConfigManager.clearErrorStatus(botId);
    
    // Atualiza status no ConfigManager
    ConfigManager.updateBotStatusById(botId, 'starting', startTime);
    
    // Configura o intervalo de execução baseado no executionMode
    let executionInterval;
    const timeframeConfig = new TimeframeConfig();
    const executionMode = config.executionMode || 'REALTIME';
    
    if (executionMode === 'ON_CANDLE_CLOSE') {
      // Modo ON_CANDLE_CLOSE: Aguarda o próximo fechamento de vela
      executionInterval = timeframeConfig.getTimeUntilNextCandleClose(config.time || '5m');
      console.log(`⏰ [ON_CANDLE_CLOSE] Bot ${botId}: Próxima análise em ${Math.floor(executionInterval / 1000)}s`);
    } else {
      // Modo REALTIME: Análise a cada 60 segundos
      executionInterval = 60000;
      console.log(`⏰ [REALTIME] Bot ${botId}: Próxima análise em ${Math.floor(executionInterval / 1000)}s`);
    }
    
    console.log(`🔧 [DEBUG] Bot ${botId}: Execution Mode: ${executionMode}, Next Interval: ${executionInterval}ms`);
    
    // Função de execução do bot
    const executeBot = async () => {
      try {
        // Atualiza status no ConfigManager
        ConfigManager.updateBotStatusById(botId, 'running');
        
        // Executa análise
        await startDecision(botId);
        
        // Executa trailing stop
        await startStops(botId);
        
        // Calcula e salva o próximo horário de validação
        const nextValidationAt = new Date(Date.now() + executionInterval);
        ConfigManager.updateBotConfigById(botId, {
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
        console.error(`❌ [BOT] Erro na execução do bot ${botId}:`, error.message);
        
        // Atualiza status de erro no ConfigManager
        ConfigManager.updateBotStatusById(botId, 'error');
        
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
      console.error(`❌ [${config.botName}][BOT] Erro crítico na execução do bot ${botId}:`, error.message);
    });
    
    // Configura execução periódica em background (apenas análise)
    const intervalId = setInterval(() => {
      executeBot().catch(error => {
        console.error(`❌ [${config.botName}][BOT] Erro na execução periódica do bot ${botId}:`, error.message);
      });
    }, executionInterval);
    
    // Configura monitores independentes com intervalos fixos
    const pendingOrdersIntervalId = setInterval(() => {
      if (config.enablePendingOrdersMonitor) {
        startPendingOrdersMonitor(botId).catch(error => {
          console.error(`❌ [${config.botName}][PENDING_ORDERS] Erro no monitoramento do bot ${botId}:`, error.message);
        });
      }
    }, 15000); // 15 segundos
    
    const orphanOrdersIntervalId = setInterval(() => {
      if (config.enableOrphanOrderMonitor) {
        startOrphanOrderMonitor(botId).catch(error => {
          console.error(`❌ [${config.botName}][ORPHAN_MONITOR] Erro no monitoramento do bot ${botId}:`, error.message);
        });
      }
    }, 20000); // 20 segundos
    
    const takeProfitIntervalId = setInterval(() => {
      if (config.enableTakeProfitMonitor !== false) { // Ativo por padrão
        startTakeProfitMonitor(botId).catch(error => {
          console.error(`❌ [${config.botName}][TAKE_PROFIT] Erro no monitoramento do bot ${botId}:`, error.message);
        });
      }
    }, 30000); // 30 segundos
    
    // Calcula e salva o próximo horário de validação se não existir
    if (!config.nextValidationAt) {
      const nextValidationAt = new Date(Date.now() + executionInterval);
      ConfigManager.updateBotConfigById(botId, {
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
    
    console.log(`✅ [PERSISTENCE] Bot ${botId} (${config.botName}) recuperado com sucesso`);
    
  } catch (error) {
    console.error(`❌ [PERSISTENCE] Erro ao recuperar bot ${botId}:`, error.message);
    ConfigManager.updateBotStatusById(botId, 'error');
  }
}

// Função para inicializar e executar o Decision
async function startDecision(botId) {
  try {
    // Carrega configuração do bot
    const botConfig = ConfigManager.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Configuração não encontrada para bot ID: ${botId}`);
    }

    // Usa apenas as configurações do bot configurado
    const config = botConfig;
    
    // Debug: Verifica se as credenciais estão presentes
    if (!config.apiKey || !config.apiSecret) {
      console.warn(`⚠️ [DECISION] Bot ${botId} (${config.botName}) não tem credenciais configuradas`);
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
    console.error(`❌ [DECISION] Erro na análise do bot ${botId}:`, error.message);
    
    // Emite evento de erro via WebSocket
    broadcastViaWs({
      type: 'DECISION_ERROR',
      botId,
      botName: botConfig?.botName,
      timestamp: new Date().toISOString(),
      error: error.message
    });
    
    throw error;
  }
}

// Função para inicializar e executar o TrailingStop
async function startStops(botId) {
  try {
    // Carrega configuração do bot
    const botConfig = ConfigManager.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Configuração não encontrada para bot ID: ${botId}`);
    }

    // Usa apenas as configurações do bot configurado
    const config = botConfig;
    
    // Debug: Verifica se as credenciais estão presentes
    if (!config.apiKey || !config.apiSecret) {
      console.warn(`⚠️ [STOPS] Bot ${botId} (${config.botName}) não tem credenciais configuradas`);
    }

    // Executa o trailing stop passando as configurações
    const trailingStopInstance = new TrailingStop(botConfig.strategyName, config);
    const result = await trailingStopInstance.stopLoss();
    
    // Emite evento via WebSocket
    broadcastViaWs({
      type: 'TRAILING_STOP_UPDATE',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString(),
      result
    });
    
    return result;
  } catch (error) {
    console.error(`❌ [STOPS] Erro no trailing stop do bot ${botId}:`, error.message);
    
    // Emite evento de erro via WebSocket
    broadcastViaWs({
      type: 'TRAILING_STOP_ERROR',
      botId,
      botName: botConfig?.botName,
      timestamp: new Date().toISOString(),
      error: error.message
    });
    
    throw error;
  }
}

// Função para monitorar e criar Take Profit orders
async function startTakeProfitMonitor(botId) {
  const rateLimit = getMonitorRateLimit(botId);
  
  try {
    // Carrega configuração do bot
    const botConfig = ConfigManager.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Configuração não encontrada para bot ID: ${botId}`);
    }

    // Usa apenas as configurações do bot configurado
    const config = botConfig;
    
    // Debug: Verifica se as credenciais estão presentes
    if (!config.apiKey || !config.apiSecret) {
      console.warn(`⚠️ [TAKE_PROFIT] Bot ${botId} (${config.botName}) não tem credenciais configuradas`);
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
      console.warn(`⚠️ [TAKE_PROFIT] Bot ${botId}: Rate limit detectado! Aumentando intervalo para ${Math.floor(rateLimit.takeProfit.interval / 1000)}s`);
    } else {
      console.error(`❌ [TAKE_PROFIT] Erro inesperado no monitoramento do bot ${botId}:`, error.message || error);
    }
    throw error;
  }
}

// Função para monitorar ordens pendentes
async function startPendingOrdersMonitor(botId) {
  const rateLimit = getMonitorRateLimit(botId);
  
  try {
    // Carrega configuração do bot
    const botConfig = ConfigManager.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Configuração não encontrada para bot ID: ${botId}`);
    }

    // Usa apenas as configurações do bot configurado
    const config = botConfig;
    
    // Debug: Verifica se as credenciais estão presentes
    if (!config.apiKey || !config.apiSecret) {
      console.warn(`⚠️ [PENDING_ORDERS] Bot ${botId} (${config.botName}) não tem credenciais configuradas`);
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
      console.warn(`⚠️ [PENDING_ORDERS] Bot ${botId}: Rate limit detectado! Aumentando intervalo para ${Math.floor(rateLimit.pendingOrders.interval / 1000)}s`);
    } else {
      console.error(`❌ [PENDING_ORDERS] Erro inesperado no monitoramento do bot ${botId}:`, error.message || error);
    }
    throw error;
  }
}

// Função para monitorar ordens órfãs
async function startOrphanOrderMonitor(botId) {
  const rateLimit = getMonitorRateLimit(botId);
  
  try {
    // Carrega configuração do bot
    const botConfig = ConfigManager.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Configuração não encontrada para bot ID: ${botId}`);
    }

    // Usa apenas as configurações do bot configurado
    const config = botConfig;
    
    // Debug: Verifica se as credenciais estão presentes
    if (!config.apiKey || !config.apiSecret) {
      console.warn(`⚠️ [ORPHAN_ORDERS] Bot ${botId} (${config.botName}) não tem credenciais configuradas`);
    }

    // Passa as configurações do bot para o monitor
    const result = await OrderController.monitorAndCleanupOrphanedStopLoss(config.botName, config);
    
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
      console.warn(`⚠️ [ORPHAN_ORDERS] Bot ${botId}: Rate limit detectado! Aumentando intervalo para ${Math.floor(rateLimit.orphanOrders.interval / 1000)}s`);
    } else {
      console.error(`❌ [ORPHAN_ORDERS] Erro inesperado na limpeza do bot ${botId}:`, error.message || error);
    }
    throw error;
  }
}

// Função para iniciar um bot específico
async function startBot(botId) {
  try {
    console.log(`🚀 [BOT] Iniciando bot com ID: ${botId}`);
    
    // Verifica se o bot pode ser iniciado
    if (!ConfigManager.canStartBotById(botId)) {
      const currentStatus = ConfigManager.getBotStatusById(botId);
      if (currentStatus === 'running') {
        throw new Error(`Bot ${botId} já está rodando`);
      } else {
        throw new Error(`Bot ${botId} não pode ser iniciado (status: ${currentStatus})`);
      }
    }
    
    // Se o bot estava em erro, limpa o status
    const currentStatus = ConfigManager.getBotStatusById(botId);
    if (currentStatus === 'error') {
      ConfigManager.clearErrorStatus(botId);
    }
    
    // Verifica se a configuração existe
    const botConfig = ConfigManager.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Configuração não encontrada para bot ID: ${botId}`);
    }
    
    // Debug: Verifica se as credenciais estão presentes
    if (!botConfig.apiKey || !botConfig.apiSecret) {
      console.warn(`⚠️ [BOT] Bot ${botId} (${botConfig.botName}) não tem credenciais configuradas`);
    }
    
    if (!botConfig.enabled) {
      throw new Error(`Bot ${botId} não está habilitado`);
    }
    
    // Verifica se a estratégia é válida
    if (!StrategyFactory.isValidStrategy(botConfig.strategyName)) {
      throw new Error(`Estratégia ${botConfig.strategyName} não é válida`);
    }
    
    // Atualiza status no ConfigManager
    ConfigManager.updateBotStatusById(botId, 'starting', new Date().toISOString());
    
    // Emite evento de início via WebSocket
    broadcastViaWs({
      type: 'BOT_STARTING',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString()
    });
    
    // Configura o intervalo de execução baseado no executionMode
    let executionInterval;
    const timeframeConfig = new TimeframeConfig();
    const executionMode = botConfig.executionMode || 'REALTIME';
    
    if (executionMode === 'ON_CANDLE_CLOSE') {
      // Modo ON_CANDLE_CLOSE: Aguarda o próximo fechamento de vela
      executionInterval = timeframeConfig.getTimeUntilNextCandleClose(botConfig.time || '5m');
      console.log(`⏰ [ON_CANDLE_CLOSE] Bot ${botId}: Próxima análise em ${Math.floor(executionInterval / 1000)}s`);
    } else {
      // Modo REALTIME: Análise a cada 60 segundos
      executionInterval = 60000;
      console.log(`⏰ [REALTIME] Bot ${botId}: Próxima análise em ${Math.floor(executionInterval / 1000)}s`);
    }
    
    console.log(`🔧 [DEBUG] Bot ${botId}: Execution Mode: ${executionMode}, Next Interval: ${executionInterval}ms`);
    
    // Função de execução do bot
    const executeBot = async () => {
      try {
        // Recarrega a configuração do bot para garantir que está atualizada
        const currentBotConfig = ConfigManager.getBotConfigById(botId);
        
        // Atualiza status no ConfigManager
        ConfigManager.updateBotStatusById(botId, 'running');
        
        // Executa análise
        await startDecision(botId);
        
        // Executa trailing stop
        await startStops(botId);
        
        // Monitora ordens pendentes se habilitado
        if (currentBotConfig.enablePendingOrdersMonitor) {
          await startPendingOrdersMonitor(botId);
        }
        
        // Limpa ordens órfãs se habilitado
        if (currentBotConfig.enableOrphanOrderMonitor) {
          await startOrphanOrderMonitor(botId);
        }
        
        // Executa PnL Controller para este bot específico
        try {
          await PnlController.run(24, currentBotConfig);
        } catch (pnlError) {
          console.warn(`⚠️ [BOT] Erro no PnL Controller para bot ${botId}:`, pnlError.message);
        }
        
        // Executa migração do Trailing Stop para este bot específico
        try {
          await TrailingStop.backfillStateForOpenPositions(currentBotConfig);
        } catch (trailingError) {
          console.warn(`⚠️ [BOT] Erro na migração do Trailing Stop para bot ${botId}:`, trailingError.message);
        }
        
        // Calcula e salva o próximo horário de validação
        const nextValidationAt = new Date(Date.now() + executionInterval);
        ConfigManager.updateBotConfigById(botId, {
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
        console.error(`❌ [BOT] Erro na execução do bot ${botId}:`, error.message);
        
        // Atualiza status de erro no ConfigManager
        ConfigManager.updateBotStatusById(botId, 'error');
        
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
    ConfigManager.updateBotConfigById(botId, {
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
    
    console.log(`✅ [BOT] Bot ${botId} iniciado com sucesso`);
    
    // Emite evento de início bem-sucedido
    broadcastViaWs({
      type: 'BOT_STARTED',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`❌ [BOT] Erro ao iniciar bot ${botId}:`, error.message);
    
    // Atualiza status de erro no ConfigManager
    ConfigManager.updateBotStatusById(botId, 'error');
    
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

// Função para parar um bot específico
async function stopBot(botId) {
  try {
    console.log(`🛑 [BOT] Parando bot: ${botId}`);
    
    // Verifica se o bot existe
    const botConfig = ConfigManager.getBotConfigById(botId);
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
    }
    
    // Remove da lista de instâncias ativas
    activeBotInstances.delete(botId);
    
    // Remove configurações de rate limit do bot
    monitorRateLimits.delete(botId);
    
    // Atualiza status no ConfigManager
    ConfigManager.updateBotStatusById(botId, 'stopped');
    
    console.log(`✅ [BOT] Bot ${botId} parado com sucesso`);
    
    // Emite evento de parada
    broadcastViaWs({
      type: 'BOT_STOPPED',
      botId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`❌ [BOT] Erro ao parar bot ${botId}:`, error.message);
    throw error;
  }
}

// API Routes

// GET /api/bot/status - Retorna status de todos os bots
app.get('/api/bot/status', (req, res) => {
  try {
    const configs = ConfigManager.loadConfigs();
    const status = configs.map(config => {
      // Verifica se o bot está realmente rodando (status no DB + instância ativa)
      const isRunning = config.status === 'running' && activeBotInstances.has(config.id);
      
      // Se o status no DB é 'running' mas não há instância ativa, considera como 'stopped'
      const effectiveStatus = config.status === 'running' && !activeBotInstances.has(config.id) 
        ? 'stopped' 
        : config.status || 'stopped';
      
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
app.get('/api/bot/:botId/next-execution', (req, res) => {
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
    const botConfig = ConfigManager.getBotConfigById(botIdNum);
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
        ConfigManager.updateBotConfigById(botIdNum, {
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
      ConfigManager.updateBotConfigById(botIdNum, {
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
    const botConfig = ConfigManager.getBotConfigById(botIdNum);
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
    const configs = ConfigManager.loadConfigs();
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
    const { botId, botName, strategyName } = req.body;
    
    // Se recebeu botName, busca o botId correspondente
    let targetBotId = botId;
    if (!botId && botName) {
      const configs = ConfigManager.loadConfigs();
      const botConfig = configs.find(config => config.botName === botName);
      if (botConfig) {
        targetBotId = botConfig.id;
      } else {
        return res.status(400).json({
          success: false,
          error: `Nenhum bot encontrado com botName: ${botName}`
        });
      }
    }
    
    // Se recebeu strategyName, busca o botId correspondente (compatibilidade)
    if (!targetBotId && strategyName) {
      const configs = ConfigManager.loadConfigs();
      const botConfig = configs.find(config => config.strategyName === strategyName);
      if (botConfig) {
        targetBotId = botConfig.id;
      } else {
        return res.status(400).json({
          success: false,
          error: `Nenhum bot encontrado com strategyName: ${strategyName}`
        });
      }
    }
    
    if (!targetBotId) {
      return res.status(400).json({
        success: false,
        error: 'botId, botName ou strategyName é obrigatório'
      });
    }
    
    await startBot(targetBotId);
    
    res.json({
      success: true,
      message: `Bot ${targetBotId} iniciado com sucesso`
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
    const { botId, botName, strategyName } = req.body;
    
    // Se recebeu botName, busca o botId correspondente
    let targetBotId = botId;
    if (!botId && botName) {
      const configs = ConfigManager.loadConfigs();
      const botConfig = configs.find(config => config.botName === botName);
      if (botConfig) {
        targetBotId = botConfig.id;
      } else {
        return res.status(400).json({
          success: false,
          error: `Nenhum bot encontrado com botName: ${botName}`
        });
      }
    }
    
    // Se recebeu strategyName, busca o botId correspondente (compatibilidade)
    if (!targetBotId && strategyName) {
      const configs = ConfigManager.loadConfigs();
      const botConfig = configs.find(config => config.strategyName === strategyName);
      if (botConfig) {
        targetBotId = botConfig.id;
      } else {
        return res.status(400).json({
          success: false,
          error: `Nenhum bot encontrado com strategyName: ${strategyName}`
        });
      }
    }
    
    if (!targetBotId) {
      return res.status(400).json({
        success: false,
        error: 'botId, botName ou strategyName é obrigatório'
      });
    }
    
    await stopBot(targetBotId);
    
    res.json({
      success: true,
      message: `Bot ${targetBotId} parado com sucesso`
    });
  } catch (error) {
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
        const currentConfig = ConfigManager.getBotConfigById(botConfig.id);
        const wasRunning = currentConfig && currentConfig.status === 'running';
        
        ConfigManager.updateBotConfigById(botConfig.id, botConfig);
        
        // Se o bot estava rodando, reinicia automaticamente
        if (wasRunning) {
          console.log(`🔄 [CONFIG] Bot ${botConfig.id} estava rodando, reiniciando...`);
          try {
            await startBot(botConfig.id);
            console.log(`✅ [CONFIG] Bot ${botConfig.id} reiniciado com sucesso`);
          } catch (error) {
            console.error(`❌ [CONFIG] Erro ao reiniciar bot ${botConfig.id}:`, error.message);
          }
        }
        
        res.json({
          success: true,
          message: `Bot ${botConfig.id} atualizado com sucesso${wasRunning ? ' e reiniciado' : ''}`,
          botId: botConfig.id,
          wasRunning: wasRunning
        });
      } else {
        const botId = ConfigManager.addBotConfig(botConfig);
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
        const currentConfig = ConfigManager.getBotConfigById(botConfig.id);
        const wasRunning = currentConfig && currentConfig.status === 'running';
        
        ConfigManager.updateBotConfigById(botConfig.id, botConfig);
        
        // Se o bot estava rodando, reinicia automaticamente
        if (wasRunning) {
          console.log(`🔄 [CONFIG] Bot ${botConfig.id} estava rodando, reiniciando...`);
          try {
            await startBot(botConfig.id);
            console.log(`✅ [CONFIG] Bot ${botConfig.id} reiniciado com sucesso`);
          } catch (error) {
            console.error(`❌ [CONFIG] Erro ao reiniciar bot ${botConfig.id}:`, error.message);
          }
        }
        
        res.json({
          success: true,
          message: `Bot ${botConfig.id} atualizado com sucesso${wasRunning ? ' e reiniciado' : ''}`,
          botId: botConfig.id,
          wasRunning: wasRunning
        });
      } else {
        const botId = ConfigManager.addBotConfig(botConfig);
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
        const currentConfig = ConfigManager.getBotConfigById(config.id);
        const wasRunning = currentConfig && currentConfig.status === 'running';
        
        ConfigManager.updateBotConfigById(config.id, config);
        
        // Se o bot estava rodando, reinicia automaticamente
        if (wasRunning) {
          console.log(`🔄 [CONFIG] Bot ${config.id} estava rodando, reiniciando...`);
          try {
            await startBot(config.id);
            console.log(`✅ [CONFIG] Bot ${config.id} reiniciado com sucesso`);
          } catch (error) {
            console.error(`❌ [CONFIG] Erro ao reiniciar bot ${config.id}:`, error.message);
          }
        }
        
        res.json({
          success: true,
          message: `Bot ${config.id} atualizado com sucesso${wasRunning ? ' e reiniciado' : ''}`,
          botId: config.id,
          wasRunning: wasRunning
        });
      } else {
        const botId = ConfigManager.addBotConfig(config);
        res.json({
          success: true,
          message: `Bot criado com sucesso`,
          botId: botId
        });
      }
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/configs - Retorna todas as configurações
app.get('/api/configs', (req, res) => {
  try {
    const configs = ConfigManager.loadConfigs();
    
    res.json({
      success: true,
      data: configs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});





// DELETE /api/configs/bot/:botName - Remove uma configuração por botName
app.delete('/api/configs/bot/:botName', (req, res) => {
  try {
    const { botName } = req.params;
    
    ConfigManager.removeBotConfigByBotName(botName);
    
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
          console.error(`Erro ao buscar posições do bot ${botName}:`, error);
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
          console.error(`Erro ao buscar ordens do bot ${botName}:`, error);
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
    
    const botConfig = ConfigManager.getBotConfigById(botId);
    
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
    console.error('Erro ao buscar estatísticas de trading:', error);
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
    const botConfig = ConfigManager.getBotConfigByBotName(botName);
    
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
    console.error('Erro ao buscar estatísticas de trading:', error);
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
    const botConfig = ConfigManager.getBotConfigByBotName(botName);
    
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
    console.error('Erro ao buscar posições da Backpack:', error);
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
            totalEquity: collateralData.netEquityAvailable || '0',
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
      console.error('Erro na validação da Backpack:', backpackError);
      res.status(401).json({
        success: false,
        error: 'Credenciais inválidas ou erro de conexão com a Backpack',
        apiKeyStatus: 'com erro'
      });
    }
  } catch (error) {
    console.error('Erro ao validar credenciais:', error);
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
    const configs = ConfigManager.loadConfigs();
    
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
    console.error('Erro ao validar credenciais duplicadas:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// WebSocket connection handler
wss.on('connection', (ws) => {
  connections.add(ws);
  console.log(`🔌 [WS] Nova conexão WebSocket estabelecida`);
  
  // Envia status inicial
  ws.send(JSON.stringify({
    type: 'CONNECTION_ESTABLISHED',
    timestamp: new Date().toISOString(),
    message: 'Conexão WebSocket estabelecida'
  }));
  
  ws.on('close', () => {
    connections.delete(ws);
    console.log(`🔌 [WS] Conexão WebSocket fechada`);
  });
  
  ws.on('error', (error) => {
    console.error('🔌 [WS] Erro na conexão WebSocket:', error.message);
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
    console.error(`Erro ao buscar posições do bot ${botName}:`, error);
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
    console.error(`Erro ao buscar ordens do bot ${botName}:`, error);
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
    const botConfig = ConfigManager.getBotConfigById(botIdNum);
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
    const botConfig = ConfigManager.getBotConfigById(botIdNum);
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
      
      botConfig = ConfigManager.getBotConfigById(botIdNum);
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
      const configs = ConfigManager.loadConfigs();
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
    console.error('Erro ao analisar performance do bot:', error);
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
        
        botConfig = ConfigManager.getBotConfigById(botIdNum);
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
        const configs = ConfigManager.loadConfigs();
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
      console.error('Erro ao buscar detalhes de performance do bot:', error);
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
    const botConfig = ConfigManager.getBotConfigById(botIdNum);
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
    
    console.log(`🔍 Testando performance para bot ${botId} (${botClientOrderId})`);
    console.log(`🔍 Configuração do bot:`, {
      id: botConfig.id,
      botName: botConfig.botName,
      botClientOrderId: botConfig.botClientOrderId,
      orderCounter: botConfig.orderCounter
    });
    
    console.log(`🔍 [ENDPOINT] Chamando History.analyzeBotPerformance...`);
    console.log(`🔍 [ENDPOINT] History object:`, typeof History);
    console.log(`🔍 [ENDPOINT] History.analyzeBotPerformance:`, typeof History.analyzeBotPerformance);
    // Executa análise simples
    const performanceData = await History.analyzeBotPerformance(
      botClientOrderId, 
      { days: 30, limit: 100 }, 
      botConfig.apiKey, 
      botConfig.apiSecret
    );
    console.log(`🔍 [ENDPOINT] History.analyzeBotPerformance concluído`);
    
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
    console.error('Erro no endpoint simples:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/bot/orders - Endpoint para listar ordens do bot
app.get('/api/bot/orders', async (req, res) => {
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

    const botOrders = BotOrdersManager.getBotOrders(botIdNum);
    const stats = BotOrdersManager.getBotOrderStats(botIdNum);

    res.json({
      success: true,
      data: {
        botId: botIdNum,
        orders: botOrders,
        stats: stats
      }
    });

  } catch (error) {
    console.error('❌ Erro no endpoint /api/bot/orders:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// POST /api/bot/orders/import - Importa ordens ativas da Backpack
app.post('/api/bot/orders/import', async (req, res) => {
  try {
    const { botId } = req.body;
    
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

    const config = ConfigManager.getBotConfigById(botIdNum);
    if (!config) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`
      });
    }

    console.log(`🔄 [API] Iniciando importação de ordens para Bot ${botId}`);
    
    const result = await ImportOrdersFromBackpack.importActiveOrders(botIdNum, config);

    res.json({
      success: result.success,
      data: result
    });

  } catch (error) {
    console.error('❌ Erro no endpoint /api/bot/orders/import:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// POST /api/bot/orders/import-all - Importa ordens de todos os bots
app.post('/api/bot/orders/import-all', async (req, res) => {
  try {
    console.log(`🔄 [API] Iniciando importação de ordens para todos os bots`);
    
    const result = await ImportOrdersFromBackpack.importAllBotsOrders();

    res.json({
      success: result.success,
      data: result
    });

  } catch (error) {
    console.error('❌ Erro no endpoint /api/bot/orders/import-all:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// GET /api/bot/orders/test - Teste do BotOrdersManager
app.get('/api/bot/orders/test', async (req, res) => {
  try {
    console.log(`🔍 [TEST] Testando BotOrdersManager`);
    console.log(`🔍 [TEST] Total de ordens: ${BotOrdersManager.orders.orders.length}`);
    console.log(`🔍 [TEST] Ordens do Bot 1: ${BotOrdersManager.getBotOrders(1).length}`);
    
    res.json({
      success: true,
      data: {
        totalOrders: BotOrdersManager.orders.orders.length,
        bot1Orders: BotOrdersManager.getBotOrders(1).length,
        bot1OrdersList: BotOrdersManager.getBotOrders(1).map(o => ({ symbol: o.symbol, side: o.side, quantity: o.quantity }))
      }
    });

  } catch (error) {
    console.error('❌ Erro no endpoint /api/bot/orders/test:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// GET /api/bot/orders/stats - Estatísticas do sistema de persistência
app.get('/api/bot/orders/stats', async (req, res) => {
  try {
    const result = ImportOrdersFromBackpack.showStats();

    res.json({
      success: result.success,
      data: result
    });

  } catch (error) {
    console.error('❌ Erro no endpoint /api/bot/orders/stats:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// POST /api/bot/orders/cleanup - Limpa ordens antigas
app.post('/api/bot/orders/cleanup', async (req, res) => {
  try {
    const { daysOld = 30 } = req.body;
    
    const result = ImportOrdersFromBackpack.cleanOldOrders(daysOld);

    res.json({
      success: result.success,
      data: result
    });

  } catch (error) {
    console.error('❌ Erro no endpoint /api/bot/orders/cleanup:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// POST /api/bot/positions/import - Importa posições ativas da Backpack
app.post('/api/bot/positions/import', async (req, res) => {
  try {
    const { botId } = req.query;
    
    if (!botId) {
      return res.status(400).json({
        success: false,
        error: 'botId é obrigatório'
      });
    }
    
    const result = await ImportPositionsFromBackpack.importActivePositions(parseInt(botId));

    res.json({
      success: result.success,
      data: result
    });

  } catch (error) {
    console.error('❌ Erro no endpoint /api/bot/positions/import:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// POST /api/bot/positions/import-all - Importa posições de todos os bots
app.post('/api/bot/positions/import-all', async (req, res) => {
  try {
    const result = await ImportPositionsFromBackpack.importAllBotsPositions();

    res.json({
      success: result.success,
      data: result
    });

  } catch (error) {
    console.error('❌ Erro no endpoint /api/bot/positions/import-all:', error);
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
    const botConfig = ConfigManager.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`
      });
    }
    
    // Usa botClientOrderId do bot
    const botClientOrderId = botConfig.botClientOrderId || botConfig.botName;
    
    console.log(`🔍 [SUMMARY] Gerando resumo para bot ${botId} (${botClientOrderId})`);
    
    // Busca dados de performance
    const performanceData = await History.analyzeBotPerformance(
      botClientOrderId, 
      { days: 30, limit: 100 }, 
      botConfig.apiKey, 
      botConfig.apiSecret
    );
    
    // Busca posições ativas
    let activePositions = [];
    try {
      const positionsData = await Futures.getOpenPositions(botConfig.apiKey, botConfig.apiSecret);
      activePositions = positionsData || [];
    } catch (error) {
      console.log(`⚠️ [SUMMARY] Erro ao buscar posições ativas: ${error.message}`);
    }
    
    // Calcula profitRatio profissional baseado na análise trade a trade
    let profitRatio = 0;
    if (performanceData.performance.totalTrades > 0) {
      const winningTrades = performanceData.performance.winningTrades;
      const losingTrades = performanceData.performance.losingTrades;
      const totalTrades = performanceData.performance.totalTrades;
      const totalPnl = performanceData.performance.totalPnl;
      const profitFactor = performanceData.performance.profitFactor;
      const winRate = performanceData.performance.winRate;
      
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
        profitRatio: profitRatio, // 🔧 CORRIGIDO: Retorna ∞ para infinito
        totalTrades: performanceData.performance.totalTrades,
        openPositions: activePositions.length // Usa apenas posições reais da Backpack
      },
      performance: {
        totalPnl: performanceData.performance.totalPnl,
        averagePnl: performanceData.performance.averagePnl,
        maxDrawdown: performanceData.performance.maxDrawdown,
        totalVolume: performanceData.performance.totalVolume
      },
      positions: {
        closed: performanceData.positions.closed,
        open: activePositions.length, // Usa apenas posições reais da Backpack
        total: performanceData.positions.closed + activePositions.length // Fechadas + Abertas reais
      },
      lastUpdated: new Date().toISOString()
    };
    
    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('❌ Erro no endpoint /api/bot/summary:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// GET /api/bot/positions/show - Mostra posições ativas da Backpack
app.get('/api/bot/positions/show', async (req, res) => {
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
    const botConfig = ConfigManager.getBotConfigById(botIdNum);
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
    
    console.log(`🔍 [POSITIONS_SHOW] Buscando posições para bot ${botId} (${botConfig.botName})`);
    
    const positions = await Futures.getOpenPositions(botConfig.apiKey, botConfig.apiSecret);
    
    res.json({
      success: true,
      data: {
        botId: botIdNum,
        botName: botConfig.botName,
        totalPositions: positions ? positions.length : 0,
        positions: positions || []
      }
    });

  } catch (error) {
    console.error('❌ Erro no endpoint /api/bot/positions/show:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Inicialização do servidor
async function initializeServer() {
  try {
    console.log('🚀 [SERVER] Iniciando servidor API...');
    
    // Carrega o estado persistido do Trailing Stop
    await TrailingStop.loadStateFromFile();
    
    // Migração automática: cria estado para posições abertas existentes
    // Será executada individualmente para cada bot quando iniciarem
    console.log('ℹ️ [SERVER] Migração do Trailing Stop será executada individualmente para cada bot');
    
    // PnL Controller será executado individualmente para cada bot
    console.log('ℹ️ [SERVER] PnL Controller será executado individualmente para cada bot');
    
    // Inicializa o servidor primeiro
    server.listen(PORT, () => {
      console.log(`✅ [SERVER] Servidor rodando na porta ${PORT}`);
      console.log(`📊 [SERVER] API disponível em http://localhost:${PORT}`);
      console.log(`🔌 [SERVER] WebSocket disponível em ws://localhost:${PORT}`);
      console.log(`🤖 [SERVER] Estratégias disponíveis: ${StrategyFactory.getAvailableStrategies().join(', ')}`);
    });
    
    // Carrega e recupera bots em background (não bloqueia o servidor)
    loadAndRecoverBots();
    
  } catch (error) {
    console.error('❌ [SERVER] Erro ao inicializar servidor:', error.message);
    process.exit(1);
  }
}

// Inicializa o servidor
initializeServer();

export { startBot, stopBot, activeBotInstances, broadcast }; 