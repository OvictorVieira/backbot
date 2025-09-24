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
import ConfigManagerSQLite from './src/Config/ConfigManagerSQLite.js';
import History from './src/Backpack/Authenticated/History.js';
import BotOrdersManager, { initializeBotOrdersManager } from './src/Config/BotOrdersManager.js';
import ImportOrdersFromBackpack from './src/Config/ImportOrdersFromBackpack.js';
import ImportPositionsFromBackpack from './src/Config/ImportPositionsFromBackpack.js';
import DatabaseService from './src/Services/DatabaseService.js';
import Markets from './src/Backpack/Public/Markets.js';
import RequestManager from './src/Utils/RequestManager.js';
import PositionSyncServiceClass from './src/Services/PositionSyncService.js';
import PositionTrackingService from './src/Services/PositionTrackingService.js';
import OrdersService from './src/Services/OrdersService.js';
import Order from './src/Backpack/Authenticated/Order.js';
import AccountController from './src/Controllers/AccountController.js';
import CachedOrdersService from './src/Utils/CachedOrdersService.js';
import HFTController from './src/Controllers/HFTController.js';
import FeatureToggleService from './src/Services/FeatureToggleService.js';

// Instância global do HFTController
const hftController = new HFTController();

// Instancia PositionSyncService (será inicializado depois que o DatabaseService estiver pronto)
let PositionSyncService = null;

// Configuração do servidor Express
const app = express();
const server = http.createServer(app);
const PORT = process.env.API_PORT || 3001;

// Debug: Verificar se as variáveis de ambiente estão sendo carregadas
Logger.info(
  `🔧 [ENV] API_PORT configurada: ${process.env.API_PORT || 'não definida (usando padrão 3001)'}`
);
Logger.info(
  `🔧 [ENV] FRONTEND_PORT configurada: ${process.env.FRONTEND_PORT || 'não definida (usando padrão 5173)'}`
);
Logger.info(`🔧 [ENV] Porta final utilizada: ${PORT}`);

// Função para verificar e matar processos na porta
function killProcessOnPort(port) {
  try {
    Logger.info(`🔍 [SERVER] Verificando se porta ${port} está em uso...`);

    // Busca processos usando a porta
    const command =
      process.platform === 'win32' ? `netstat -ano | findstr :${port}` : `lsof -ti:${port}`;

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
        const pids = result
          .trim()
          .split('\n')
          .filter(pid => pid);
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
    if (connection.readyState === 1) {
      // WebSocket.OPEN
      connection.send(messageStr);
    }
  });
}

// Função para broadcast via WebSocket
function broadcastViaWs(message) {
  const messageStr = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      // WebSocket.OPEN
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
        minInterval: 15000, // mínimo 15s
        lastErrorTime: null,
      },
      orphanOrders: {
        interval: 60000, // começa em 60s (menos agressivo)
        errorCount: 0,
        maxInterval: 300000, // máximo 5min
        minInterval: 60000, // mínimo 60s (menos agressivo)
        lastErrorTime: null,
        lastFullScan: 0, // timestamp da última varredura completa
      },
      takeProfit: {
        interval: 30000, // começa em 30s
        errorCount: 0,
        maxInterval: 300000, // máximo 5min
        minInterval: 30000, // mínimo 30s
        lastErrorTime: null,
      },
    });
  }
  return monitorRateLimits.get(botId);
}

/**
 * Carrega e recupera bots que estavam ativos
 */
async function loadAndRecoverBots() {
  try {
    CachedOrdersService.clearAllCache();

    // Carrega apenas bots tradicionais (não HFT) que estavam rodando ou em erro
    const configs = await ConfigManagerSQLite.loadTraditionalBots();

    const botsToRecover = configs.filter(
      config =>
        config.enabled &&
        (config.status === 'running' || config.status === 'error' || config.status === 'starting')
    );

    if (botsToRecover.length === 0) {
      Logger.debug(`ℹ️ [PERSISTENCE] Nenhum bot para recuperar encontrado`);
      return;
    }

    Logger.debug(`📋 [PERSISTENCE] Carregando ${botsToRecover.length} bots para recuperação...`);

    // Executa todos os bots em paralelo sem aguardar
    const recoveryPromises = botsToRecover.map(async botConfig => {
      try {
        Logger.debug(
          `🔄 [PERSISTENCE] Iniciando recuperação do bot: ${botConfig.id} (${botConfig.botName}) - Status anterior: ${botConfig.status}`
        );
        await recoverBot(botConfig.id, botConfig, botConfig.startTime);
      } catch (error) {
        Logger.error(`❌ [PERSISTENCE] Erro ao recuperar bot ${botConfig.id}:`, error.message);
      }
    });

    // Executa em background sem bloquear
    Promise.all(recoveryPromises)
      .then(() => {
        Logger.info(`✅ [PERSISTENCE] Recuperação de bots concluída`);
      })
      .catch(error => {
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

    // Mantém o status atual do bot (não altera durante recovery)

    // Configura o intervalo de execução baseado no executionMode
    let executionInterval;
    const timeframeConfig = new TimeframeConfig(config);

    // Força ON_CANDLE_CLOSE para estratégias que dependem de velas fechadas
    if (config.strategyName === 'ALPHA_FLOW') {
      Logger.info(`🧠 [ALPHA_FLOW] Bot ${botId}: Modo ON_CANDLE_CLOSE forçado automaticamente`);
      config.executionMode = 'ON_CANDLE_CLOSE';
    } else if (config.enableHeikinAshi === true || config.enableHeikinAshi === 'true') {
      Logger.info(
        `📊 [HEIKIN_ASHI] Bot ${botId}: Modo ON_CANDLE_CLOSE forçado automaticamente (Heikin Ashi habilitado)`
      );
      config.executionMode = 'ON_CANDLE_CLOSE';
    }

    const executionMode = config.executionMode || 'REALTIME';

    if (executionMode === 'ON_CANDLE_CLOSE') {
      // Modo ON_CANDLE_CLOSE: Aguarda o próximo fechamento de vela
      executionInterval = timeframeConfig.getTimeUntilNextCandleClose(config.time || '5m');
      Logger.info(
        `⏰ [ON_CANDLE_CLOSE] Bot ${botId}: Próxima análise em ${Math.floor(executionInterval / 1000)}s`
      );
    } else {
      // Modo REALTIME: Análise a cada 60 segundos
      executionInterval = 60000;
      Logger.info(
        `⏰ [REALTIME] Bot ${botId}: Próxima análise em ${Math.floor(executionInterval / 1000)}s`
      );
    }

    Logger.info(
      `🔧 [DEBUG] Bot ${botId}: Execution Mode: ${executionMode}, Next Interval: ${executionInterval}ms`
    );

    // Função de execução do bot
    const executeBot = async () => {
      try {
        // Atualiza status no ConfigManager
        await ConfigManagerSQLite.updateBotStatusById(botId, 'running');
        // Executa análise
        await startDecision(botId);

        // Executa trailing stop
        await startStops(botId);

        // Recarrega configuração atual para recalcular intervalo
        const currentBotConfig = await ConfigManagerSQLite.getBotConfigById(botId);
        const timeframeConfig = new TimeframeConfig(currentBotConfig);
        let currentExecutionInterval;

        if (currentBotConfig.executionMode === 'ON_CANDLE_CLOSE') {
          currentExecutionInterval = timeframeConfig.getTimeUntilNextCandleClose(
            currentBotConfig.time || '5m'
          );
          Logger.info(
            `⏰ [RECOVERY_EXECUTION] Bot ${botId}: Próxima análise ON_CANDLE_CLOSE em ${Math.floor(currentExecutionInterval / 1000)}s`
          );
        } else {
          currentExecutionInterval = 60000; // REALTIME: 60 segundos
          Logger.debug(
            `⏰ [RECOVERY_EXECUTION] Bot ${botId}: Próxima análise REALTIME em ${Math.floor(currentExecutionInterval / 1000)}s`
          );
        }

        // Calcula e salva o próximo horário de validação
        const nextValidationAt = new Date(Date.now() + currentExecutionInterval);
        await ConfigManagerSQLite.updateBotConfigById(botId, {
          nextValidationAt: nextValidationAt.toISOString(),
        });

        Logger.info(
          `✅ [RECOVERY_EXECUTION] Bot ${botId}: nextValidationAt atualizado para ${nextValidationAt.toISOString()}`
        );

        // Emite evento de execução bem-sucedida
        broadcastViaWs({
          type: 'BOT_EXECUTION_SUCCESS',
          botId,
          botName: config.botName,
          timestamp: new Date().toISOString(),
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
          error: error.message,
        });
      }
    };

    // Para ON_CANDLE_CLOSE: NÃO executa imediatamente, apenas agenda para próxima vela
    // Para REALTIME: Executa imediatamente
    if (config.executionMode !== 'ON_CANDLE_CLOSE') {
      Logger.info(
        `🚀 [RECOVER] Bot ${botId}: Executando imediatamente (modo ${config.executionMode})`
      );
      executeBot().catch(error => {
        Logger.error(
          `❌ [${config.botName}][BOT] Erro crítico na execução do bot ${botId}:`,
          error.message
        );
      });
    } else {
      Logger.info(
        `⏰ [RECOVER] Bot ${botId}: Modo ON_CANDLE_CLOSE - aguardando próximo fechamento de vela (${config.time})`
      );
    }

    // Configura agendamento baseado no modo de execução
    let intervalId;

    if (config.executionMode === 'ON_CANDLE_CLOSE') {
      // Para ON_CANDLE_CLOSE: usa setTimeout recursivo
      const scheduleNextExecution = async () => {
        try {
          const currentConfig = await ConfigManagerSQLite.getBotConfigById(botId);
          if (currentConfig.executionMode !== 'ON_CANDLE_CLOSE') {
            Logger.info(
              `🔄 [RECOVER-ON_CANDLE_CLOSE] Bot ${botId}: Modo alterado, parando agendamento`
            );
            return;
          }

          const timeframeConfig = new TimeframeConfig(currentConfig);
          const nextInterval = timeframeConfig.getTimeUntilNextCandleClose(
            currentConfig.time || '5m'
          );

          const timeoutId = setTimeout(async () => {
            try {
              Logger.info(
                `🕒 [RECOVER-ON_CANDLE_CLOSE] Bot ${botId}: Executando no fechamento da vela ${currentConfig.time}`
              );

              // Timeout para a execução do bot (máximo 3 minutos)
              const executionTimeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Bot execution timeout - 3 minutos')), 180000);
              });

              await Promise.race([executeBot(), executionTimeout]);
            } catch (error) {
              Logger.error(
                `❌ [RECOVER-ON_CANDLE_CLOSE] Erro durante execução do bot ${botId}:`,
                error.message
              );

              // Se deu timeout, força próxima execução
              if (error.message.includes('timeout')) {
                Logger.error(
                  `🚨 [RECOVER-ON_CANDLE_CLOSE] Bot ${botId}: TIMEOUT detectado - forçando próxima execução`
                );
                const timeframeConfig = new TimeframeConfig(currentConfig);
                const nextCandleCloseMs = timeframeConfig.getTimeUntilNextCandleClose(
                  currentConfig.time || '5m'
                );
                const nextValidationAt = new Date(Date.now() + nextCandleCloseMs);

                await ConfigManagerSQLite.updateBotConfigById(botId, {
                  nextValidationAt: nextValidationAt.toISOString(),
                });

                Logger.info(
                  `✅ [RECOVER-ON_CANDLE_CLOSE] Bot ${botId}: nextValidationAt forçado para ${nextValidationAt.toISOString()}`
                );
              }
            } finally {
              scheduleNextExecution();
            }
          }, nextInterval);

          intervalId = timeoutId;
        } catch (error) {
          Logger.error(
            `❌ [RECOVER-ON_CANDLE_CLOSE] Erro ao agendar execução do bot ${botId}:`,
            error.message
          );
        }
      };

      Logger.info(
        `🚀 [RECOVER-ON_CANDLE_CLOSE] Bot ${botId}: Iniciando agendamento para timeframe ${config.time}`
      );
      scheduleNextExecution();
    } else {
      // Para REALTIME: usa setInterval normal
      Logger.info(
        `🚀 [RECOVER-REALTIME] Bot ${botId}: Iniciando execução contínua a cada 60 segundos`
      );
      intervalId = setInterval(() => {
        executeBot().catch(error => {
          Logger.error(
            `❌ [${config.botName}][BOT] Erro na execução periódica do bot ${botId}:`,
            error.message
          );
        });
      }, 60000);
    }

    // Inicia TODOS os monitores usando função centralizada
    const monitorIds = setupBotMonitors(botId, config);
    const { pendingOrdersIntervalId, orphanOrdersIntervalId, takeProfitIntervalId } = monitorIds;

    // Calcula e salva o próximo horário de validação se não existir
    if (!config.nextValidationAt) {
      const nextValidationAt = new Date(Date.now() + executionInterval);
      await ConfigManagerSQLite.updateBotConfigById(botId, {
        nextValidationAt: nextValidationAt.toISOString(),
      });
    }

    // Armazena os intervalIds para poder parar depois
    activeBotInstances.set(botId, {
      intervalId,
      pendingOrdersIntervalId,
      orphanOrdersIntervalId,
      takeProfitIntervalId,
      config,
      status: 'running',
      updateConfig: async newConfig => {
        Logger.info(`🔄 [CONFIG_UPDATE] Atualizando configuração do bot ${botId} em tempo real`);
        // Atualiza a configuração na instância
        const botInstance = activeBotInstances.get(botId);
        if (botInstance) {
          botInstance.config = newConfig;
          Logger.info(`✅ [CONFIG_UPDATE] Configuração do bot ${botId} atualizada com sucesso`);

          // Invalida qualquer cache relacionado
          ConfigManagerSQLite.invalidateCache();

          // Log das principais mudanças (para debug)
          Logger.debug(`📊 [CONFIG_UPDATE] Bot ${botId} - Novas configurações aplicadas:`, {
            capitalPercentage: newConfig.capitalPercentage,
            maxOpenOrders: newConfig.maxOpenOrders,
            enableTrailingStop: newConfig.enableTrailingStop,
            enabled: newConfig.enabled,
          });
        }
      },
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
      Logger.warn(
        `⚠️ [DECISION] Bot ${botId} (${config.botName}) não tem credenciais configuradas`
      );
    }

    // Inicializa o Decision com a estratégia
    const decisionInstance = new Decision(botConfig.strategyName);

    // Inicializa o TrailingStop
    const trailingStopInstance = new TrailingStop(botConfig.strategyName, config);
    await trailingStopInstance.reinitializeStopLoss(botConfig.strategyName);

    // Reset do RequestManager antes da análise (força limpeza de deadlocks)
    RequestManager.forceReset();

    // Executa a análise passando as configurações
    const result = await decisionInstance.analyze(config.time || '5m', null, config);

    // Emite evento via WebSocket
    broadcastViaWs({
      type: 'DECISION_ANALYSIS',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString(),
      result,
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
      error: error.message,
    });

    throw error;
  }
}

// Função para inicializar e executar o TrailingStop
async function startStops(botId) {
  Logger.debug(`🔧 [START_STOPS] Executando trailing stop para bot ${botId}...`);
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
      result,
    });

    // Reset contador de erros em caso de sucesso
    const rateLimit = getMonitorRateLimit(botId);
    rateLimit.trailingStop = rateLimit.trailingStop || { errorCount: 0, interval: 30000 }; // 30s padrão
    rateLimit.trailingStop.errorCount = 0;

    // Reduz intervalo gradualmente até mínimo (30s -> 20s)
    if (rateLimit.trailingStop.interval > 20000) {
      rateLimit.trailingStop.interval = Math.max(20000, rateLimit.trailingStop.interval - 2000);
    }
  } catch (error) {
    // Incrementa contador de erros
    const rateLimit = getMonitorRateLimit(botId);
    rateLimit.trailingStop = rateLimit.trailingStop || { errorCount: 0, interval: 30000 };
    rateLimit.trailingStop.errorCount++;

    if (error?.response?.status === 429 || String(error).includes('rate limit')) {
      // Aumenta intervalo exponencialmente em caso de rate limit
      rateLimit.trailingStop.interval = Math.min(30000, rateLimit.trailingStop.interval * 2); // máximo 30s
      Logger.warn(
        `⚠️ [STOPS] Bot ${botId}: Rate limit detectado! Aumentando intervalo para ${Math.floor(rateLimit.trailingStop.interval / 1000)}s`
      );
    } else {
      Logger.error(`❌ [STOPS] Erro no trailing stop do bot ${botId}:`, error.message);
    }

    // Emite evento de erro via WebSocket
    broadcastViaWs({
      type: 'TRAILING_STOP_ERROR',
      botId,
      botName: botConfig?.botName || 'Unknown',
      timestamp: new Date().toISOString(),
      error: error.message,
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
      Logger.warn(
        `⚠️ [TAKE_PROFIT] Bot ${botId} (${config.botName}) não tem credenciais configuradas`
      );
    }

    // Executa o monitor de Take Profit
    const result = await OrderController.monitorAndCreateTakeProfit(config);

    // Se sucesso, reduz gradualmente o intervalo até o mínimo
    if (rateLimit.takeProfit.interval > rateLimit.takeProfit.minInterval) {
      rateLimit.takeProfit.interval = Math.max(
        rateLimit.takeProfit.minInterval,
        rateLimit.takeProfit.interval - 1000
      );
    }
    rateLimit.takeProfit.errorCount = 0;

    // Emite evento via WebSocket
    broadcastViaWs({
      type: 'TAKE_PROFIT_UPDATE',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString(),
      result,
    });

    return result;
  } catch (error) {
    // Detecta erro de rate limit (HTTP 429 ou mensagem)
    if (
      error?.response?.status === 429 ||
      String(error).includes('rate limit') ||
      String(error).includes('429')
    ) {
      rateLimit.takeProfit.errorCount++;
      rateLimit.takeProfit.lastErrorTime = Date.now();
      // Aumenta o intervalo exponencialmente até o máximo
      rateLimit.takeProfit.interval = Math.min(
        rateLimit.takeProfit.maxInterval,
        rateLimit.takeProfit.interval * 2
      );
      Logger.warn(
        `⚠️ [TAKE_PROFIT] Bot ${botId}: Rate limit detectado! Aumentando intervalo para ${Math.floor(rateLimit.takeProfit.interval / 1000)}s`
      );
    } else {
      Logger.error(
        `❌ [TAKE_PROFIT] Erro inesperado no monitoramento do bot ${botId}:`,
        error.message || error
      );
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
      Logger.warn(
        `⚠️ [PENDING_ORDERS] Bot ${botId} (${config.botName}) não tem credenciais configuradas`
      );
    }

    // Passa as configurações do bot para o monitor
    const result = await OrderController.monitorPendingEntryOrders(config.botName, config);

    // Se sucesso, reduz gradualmente o intervalo até o mínimo
    if (rateLimit.pendingOrders.interval > rateLimit.pendingOrders.minInterval) {
      rateLimit.pendingOrders.interval = Math.max(
        rateLimit.pendingOrders.minInterval,
        rateLimit.pendingOrders.interval - 1000
      );
    }
    rateLimit.pendingOrders.errorCount = 0;

    // Emite evento via WebSocket
    broadcastViaWs({
      type: 'PENDING_ORDERS_UPDATE',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString(),
      result,
    });

    return result;
  } catch (error) {
    // Detecta erro de rate limit (HTTP 429 ou mensagem)
    if (
      error?.response?.status === 429 ||
      String(error).includes('rate limit') ||
      String(error).includes('429')
    ) {
      rateLimit.pendingOrders.errorCount++;
      rateLimit.pendingOrders.lastErrorTime = Date.now();
      // Aumenta o intervalo exponencialmente até o máximo
      rateLimit.pendingOrders.interval = Math.min(
        rateLimit.pendingOrders.maxInterval,
        rateLimit.pendingOrders.interval * 2
      );
      Logger.warn(
        `⚠️ [PENDING_ORDERS] Bot ${botId}: Rate limit detectado! Aumentando intervalo para ${Math.floor(rateLimit.pendingOrders.interval / 1000)}s`
      );
    } else {
      Logger.error(
        `❌ [PENDING_ORDERS] Erro inesperado no monitoramento do bot ${botId}:`,
        error.message || error
      );
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
      Logger.warn(
        `⚠️ [ORPHAN_ORDERS] Bot ${botId} (${config.botName}) não tem credenciais configuradas`
      );
    }

    const now = Date.now();
    const lastFullScan = rateLimit.orphanOrders.lastFullScan || 0;
    const shouldDoFullScan = now - lastFullScan > 300000; // 5 minutos desde última varredura completa

    let result;
    if (shouldDoFullScan) {
      result = await OrderController.scanAndCleanupAllOrphanedOrders(config.botName, config);
      rateLimit.orphanOrders.lastFullScan = now;
      Logger.info(
        `🔍 [${config.botName}][ORPHAN_MONITOR] Varredura completa executada: ${result.ordersScanned} símbolos verificados`
      );
    } else {
      result = await OrderController.monitorAndCleanupOrphanedOrders(config.botName, config);
    }

    // Se sucesso, reduz gradualmente o intervalo até o mínimo
    if (rateLimit.orphanOrders.interval > rateLimit.orphanOrders.minInterval) {
      rateLimit.orphanOrders.interval = Math.max(
        rateLimit.orphanOrders.minInterval,
        rateLimit.orphanOrders.interval - 1000
      );
    }
    rateLimit.orphanOrders.errorCount = 0;

    // Emite evento via WebSocket
    broadcastViaWs({
      type: 'ORPHAN_ORDERS_CLEANUP',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString(),
      result,
    });

    return result;
  } catch (error) {
    // Detecta erro de rate limit (HTTP 429 ou mensagem)
    if (
      error?.response?.status === 429 ||
      String(error).includes('rate limit') ||
      String(error).includes('429')
    ) {
      rateLimit.orphanOrders.errorCount++;
      rateLimit.orphanOrders.lastErrorTime = Date.now();
      // Aumenta o intervalo exponencialmente até o máximo
      rateLimit.orphanOrders.interval = Math.min(
        rateLimit.orphanOrders.maxInterval,
        rateLimit.orphanOrders.interval * 2
      );
      Logger.warn(
        `⚠️ [ORPHAN_ORDERS] Bot ${botId}: Rate limit detectado! Aumentando intervalo para ${Math.floor(rateLimit.orphanOrders.interval / 1000)}s`
      );
    } else {
      Logger.error(
        `❌ [ORPHAN_ORDERS] Erro inesperado na limpeza do bot ${botId}:`,
        error.message || error
      );
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
      Logger.debug(
        `[TRAILING_CLEANER] Bot ${botId} (${botConfig.botName}) não tem credenciais configuradas`
      );
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
  const nextInterval = Math.min(maxInterval, baseInterval + errorCount * 2 * 60 * 1000); // +2min por erro

  setTimeout(() => startTrailingStopsCleanerMonitor(botId), nextInterval);
}

/**
 * Monitor de sincronização de active_order_id do trailing stop
 * Verifica se o active_order_id salvo corresponde ao stop loss real na corretora
 */
async function startTrailingStopSyncMonitor(botId) {
  try {
    // Carrega configuração do bot
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
    if (!botConfig) {
      throw new Error(`Configuração não encontrada para bot ID: ${botId}`);
    }

    // Verifica se as credenciais estão presentes
    if (!botConfig.apiKey || !botConfig.apiSecret) {
      Logger.debug(
        `⏭️ [TRAILING_SYNC] Bot ${botId} (${botConfig.botName}) não tem credenciais configuradas`
      );
      return;
    }

    // Busca trailing_states ativas do bot
    const trailingStates = await TrailingStop.dbService.getAll(
      'SELECT * FROM trailing_state WHERE botId = ?',
      [botId]
    );

    if (!trailingStates || trailingStates.length === 0) {
      Logger.debug(`⏭️ [TRAILING_SYNC] Bot ${botId}: Nenhum trailing state ativo para sincronizar`);
      return;
    }

    Logger.debug(
      `🔄 [TRAILING_SYNC] Bot ${botId}: Sincronizando ${trailingStates.length} trailing states...`
    );

    // Busca posições abertas na corretora
    const positions = (await Futures.getOpenPositions(botConfig.apiKey, botConfig.apiSecret)) || [];
    Logger.debug(
      `🔍 [TRAILING_SYNC] Bot ${botId}: ${positions.length} posições abertas na corretora`
    );

    let syncCount = 0;
    let orphanCount = 0;

    // Para cada trailing state ativo
    for (const state of trailingStates) {
      try {
        await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit

        // Define credentials para uso no loop
        const apiKey = botConfig.apiKey;
        const apiSecret = botConfig.apiSecret;

        // Busca preço atual do symbol
        const currentPrice = await OrderController.getCurrentPrice(state.symbol);
        if (!currentPrice) {
          Logger.error(`❌ [TRAILING_SYNC] Preço atual não encontrado para ${state.symbol}`);
          continue;
        }

        // Busca ordens abertas deste símbolo na corretora
        const activeOrders = await Order.getOpenOrders(state.symbol, 'PERP', apiKey, apiSecret);

        if (!activeOrders || activeOrders.length === 0) {
          // Nenhuma ordem aberta - marcar como órfão
          await TrailingStop.dbService.run(
            'UPDATE trailing_state SET active_stop_order_id = NULL, updatedAt = ? WHERE botId = ? AND symbol = ?',
            [new Date().toISOString(), botId, state.symbol]
          );
          orphanCount++;
          Logger.info(
            `🧹 [TRAILING_SYNC] ${state.symbol}: Nenhuma ordem aberta encontrada, marcado como órfão`
          );
          continue;
        }

        // Identifica trailing stop real baseado na posição e preço
        let positions = (await Futures.getOpenPositions(apiKey, apiSecret)) || [];
        const position = positions.find(pos => pos.symbol === state.symbol);
        if (!position) {
          Logger.debug(`🔍 [TRAILING_SYNC] Posição não encontrada para ${state.symbol}`);
          continue;
        }

        const isLong = parseFloat(position.netQuantity) > 0;
        const realTrailingStop = activeOrders.find(order => {
          // Deve ser uma ordem TriggerPending reduceOnly
          if (order.status !== 'TriggerPending' || !order.reduceOnly) {
            return false;
          }

          const orderPrice = parseFloat(
            order.triggerPrice || order.takeProfitTriggerPrice || order.price
          );

          // Para trailing stop: ordem deve estar "atrás" do preço atual (proteção)
          if (isLong) {
            // Long: trailing stop abaixo do preço atual
            return orderPrice < currentPrice;
          } else {
            // Short: trailing stop acima do preço atual
            return orderPrice > currentPrice;
          }
        });

        if (!realTrailingStop) {
          // Trailing stop não encontrado - tentar criar um
          Logger.warn(
            `⚠️ [TRAILING_SYNC] ${state.symbol}: Trailing stop não encontrado, tentando criar...`
          );

          try {
            // Busca configuração do bot para criar trailing stop
            const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
            if (!botConfig || !botConfig.enableTrailingStop) {
              Logger.debug(
                `🔍 [TRAILING_SYNC] ${state.symbol}: Trailing stop desabilitado para bot ${botId}`
              );
              continue;
            }

            // Cria trailing stop usando a lógica do TrailingStop
            const trailingStopPrice = isLong
              ? currentPrice * (1 - (botConfig.trailingStopDistance || 1.5) / 100)
              : currentPrice * (1 + (botConfig.trailingStopDistance || 1.5) / 100);

            const Account = await AccountController.get(botConfig);

            const marketInfo = Account.markets.find(m => m.symbol === state.symbol);
            if (!marketInfo) {
              Logger.error(`❌ [TRAILING_SYNC] Market info não encontrada para ${state.symbol}`);
              continue;
            }

            const formatPrice = value =>
              parseFloat(value).toFixed(marketInfo.decimal_price).toString();

            const orderPayload = {
              symbol: state.symbol,
              side: isLong ? 'Ask' : 'Bid',
              orderType: 'Limit',
              quantity: Math.abs(parseFloat(position.netQuantity)).toString(),
              stopLossTriggerPrice: formatPrice(trailingStopPrice),
              clientId: await OrderController.generateUniqueOrderId(botConfig),
              apiKey: apiKey,
              apiSecret: apiSecret,
            };

            const newOrder = await OrderController.ordersService.createStopLossOrder(orderPayload);

            if (newOrder && newOrder.id) {
              // Salva o active_order_id no banco
              await TrailingStop.dbService.run(
                'UPDATE trailing_state SET active_stop_order_id = ?, updatedAt = ? WHERE botId = ? AND symbol = ?',
                [newOrder.id, new Date().toISOString(), botId, state.symbol]
              );

              Logger.info(
                `✅ [TRAILING_SYNC] ${state.symbol}: Trailing stop criado ${newOrder.id} (${formatPrice(trailingStopPrice)})`
              );
              syncCount++;
            } else {
              throw new Error('Ordem não foi criada');
            }
          } catch (error) {
            Logger.error(
              `❌ [TRAILING_SYNC] Erro ao criar trailing stop para ${state.symbol}:`,
              error.message
            );
            // Marca como órfão se não conseguiu criar
            await TrailingStop.dbService.run(
              'UPDATE trailing_state SET active_stop_order_id = NULL, updatedAt = ? WHERE botId = ? AND symbol = ?',
              [new Date().toISOString(), botId, state.symbol]
            );
            orphanCount++;
          }
          continue;
        }

        // Verifica se precisa sincronizar
        if (realTrailingStop.id !== state.active_stop_order_id) {
          await TrailingStop.dbService.run(
            'UPDATE trailing_state SET active_stop_order_id = ?, updatedAt = ? WHERE botId = ? AND symbol = ?',
            [realTrailingStop.id, new Date().toISOString(), botId, state.symbol]
          );
          syncCount++;
          const orderPrice =
            realTrailingStop.triggerPrice ||
            realTrailingStop.takeProfitTriggerPrice ||
            realTrailingStop.price;
          Logger.info(
            `🔄 [TRAILING_SYNC] ${state.symbol}: Sincronizado active_order_id: ${state.active_stop_order_id} → ${realTrailingStop.id} (trigger: $${orderPrice})`
          );
        } else {
          Logger.debug(
            `✅ [TRAILING_SYNC] ${state.symbol}: active_order_id correto (${realTrailingStop.id})`
          );
        }
      } catch (error) {
        Logger.error(`❌ [TRAILING_SYNC] Erro ao sincronizar ${state.symbol}:`, error.message);
      }
    }

    if (syncCount > 0 || orphanCount > 0) {
      Logger.info(
        `✅ [TRAILING_SYNC] Bot ${botId}: Sincronização concluída - ${syncCount} atualizados, ${orphanCount} órfãos`
      );
    }

    return { synchronized: syncCount, orphaned: orphanCount, total: trailingStates.length };
  } catch (error) {
    Logger.error(
      `❌ [TRAILING_SYNC] Erro no monitor de sincronização do bot ${botId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Função centralizada para configurar TODOS os monitores de um bot
 * @param {number} botId - ID do bot
 * @param {Object} config - Configuração do bot
 */
function setupBotMonitors(botId, config) {
  Logger.info(
    `🚀 [MONITORS] Iniciando TODOS os monitores para bot ${botId} (${config.botName})...`
  );

  // Monitor de ordens pendentes - 90 segundos (aumentado de 15s)
  const runPendingOrdersMonitor = async () => {
    try {
      Logger.debug(`🔄 [PENDING_ORDERS] Executando para bot ${botId}`);
      await startPendingOrdersMonitor(botId);
    } catch (error) {
      Logger.error(
        `❌ [${config.botName}][PENDING_ORDERS] Erro no monitoramento do bot ${botId}:`,
        error.message
      );
    }
    setTimeout(runPendingOrdersMonitor, 90000);
  };
  setTimeout(runPendingOrdersMonitor, 90000);

  // Monitor de ordens órfãs - 120 segundos (aumentado de 60s)
  const runOrphanOrdersMonitor = async () => {
    try {
      Logger.debug(`🔄 [ORPHAN_MONITOR] Executando para bot ${botId}`);
      await startOrphanOrderMonitor(botId);
    } catch (error) {
      Logger.error(
        `❌ [${config.botName}][ORPHAN_MONITOR] Erro no monitoramento do bot ${botId}:`,
        error.message
      );
    }
    setTimeout(runOrphanOrdersMonitor, 120000);
  };
  setTimeout(runOrphanOrdersMonitor, 120000);

  // Monitor de take profit - 120 segundos (aumentado de 30s)
  const runTakeProfitMonitor = async () => {
    try {
      Logger.debug(`🔄 [TAKE_PROFIT] Executando para bot ${botId}`);
      await startTakeProfitMonitor(botId);
    } catch (error) {
      Logger.error(
        `❌ [${config.botName}][TAKE_PROFIT] Erro no monitoramento do bot ${botId}:`,
        error.message
      );
    }
    setTimeout(runTakeProfitMonitor, 120000);
  };
  setTimeout(runTakeProfitMonitor, 120000);

  // Monitor de trailing stops órfãos - 5 minutos inicialmente
  const runTrailingStopsCleanerMonitor = async () => {
    try {
      Logger.debug(`🔄 [TRAILING_CLEANER] Executando para bot ${botId}`);
      await startTrailingStopsCleanerMonitor(botId);
    } catch (error) {
      Logger.error(
        `❌ [${config.botName}][TRAILING_CLEANER] Erro no monitoramento do bot ${botId}:`,
        error.message
      );
      // startTrailingStopsCleanerMonitor já agenda a próxima execução internamente
    }
  };
  // Inicia com delay de 2 segundos para não sobrecarregar
  setTimeout(runTrailingStopsCleanerMonitor, 2000);

  // Monitor de sincronização trailing stop - 5 minutos (aumentado de 2 minutos)
  const runTrailingStopSyncMonitor = async () => {
    try {
      Logger.debug(`🔄 [TRAILING_SYNC] Executando para bot ${botId}`);
      await startTrailingStopSyncMonitor(botId);
    } catch (error) {
      Logger.error(
        `❌ [${config.botName}][TRAILING_SYNC] Erro no monitoramento do bot ${botId}:`,
        error.message
      );
    }
    setTimeout(runTrailingStopSyncMonitor, 300000); // 5 minutos
  };
  setTimeout(runTrailingStopSyncMonitor, 60000); // Inicia após 1 minuto

  Logger.info(`✅ [MONITORS] Todos os monitores iniciados para bot ${botId} (${config.botName})`);

  // Para compatibilidade, retorna IDs fictícios
  return {
    pendingOrdersIntervalId: 'timeout_pending',
    orphanOrdersIntervalId: 'timeout_orphan',
    takeProfitIntervalId: 'timeout_takeprofit',
    trailingStopsCleanerIntervalId: 'timeout_trailing_cleaner',
    trailingSyncIntervalId: 'timeout_trailing_sync',
  };
}

// Função para iniciar um bot específico
async function startBot(botId, forceRestart = false) {
  let botConfig = null; // Declaração movida para fora do try

  try {
    Logger.info(`🚀 [BOT] Iniciando bot com ID: ${botId}`);

    // Verifica se o bot pode ser iniciado (a menos que seja um restart forçado)
    if (!forceRestart && !(await ConfigManagerSQLite.canStartBotById(botId))) {
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
      timestamp: new Date().toISOString(),
    });

    // Configura o intervalo de execução baseado no executionMode
    let executionInterval;
    const timeframeConfig = new TimeframeConfig(botConfig);

    // Força ON_CANDLE_CLOSE para estratégias que dependem de velas fechadas
    if (botConfig.strategyName === 'ALPHA_FLOW') {
      Logger.info(`🧠 [ALPHA_FLOW] Bot ${botId}: Modo ON_CANDLE_CLOSE forçado automaticamente`);
      botConfig.executionMode = 'ON_CANDLE_CLOSE';
    } else if (botConfig.enableHeikinAshi === true || botConfig.enableHeikinAshi === 'true') {
      Logger.info(
        `📊 [HEIKIN_ASHI] Bot ${botId}: Modo ON_CANDLE_CLOSE forçado automaticamente (Heikin Ashi habilitado)`
      );
      botConfig.executionMode = 'ON_CANDLE_CLOSE';
    }

    const executionMode = botConfig.executionMode || 'REALTIME';

    if (executionMode === 'ON_CANDLE_CLOSE') {
      // Modo ON_CANDLE_CLOSE: Aguarda o próximo fechamento de vela
      executionInterval = timeframeConfig.getTimeUntilNextCandleClose(botConfig.time || '5m');
      Logger.debug(
        `⏰ [ON_CANDLE_CLOSE] Bot ${botId}: Próxima análise em ${Math.floor(executionInterval / 1000)}s`
      );
    } else {
      // Modo REALTIME: Análise a cada 60 segundos
      executionInterval = 60000;
      Logger.debug(
        `⏰ [REALTIME] Bot ${botId}: Próxima análise em ${Math.floor(executionInterval / 1000)}s`
      );
    }

    Logger.debug(
      `🔧 [DEBUG] Bot ${botId}: Execution Mode: ${executionMode}, Next Interval: ${executionInterval}ms`
    );

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

        // Monitores são gerenciados pela função setupBotMonitors() chamada no recoverBot()

        // Executa PnL Controller para este bot específico
        try {
          await PnlController.run(24, currentBotConfig);
        } catch (pnlError) {
          Logger.warn(`⚠️ [BOT] Erro no PnL Controller para bot ${botId}:`, pnlError.message);
        }

        // Recalcula o próximo horário de validação baseado no modo de execução
        let nextValidationAt;

        if (currentBotConfig.executionMode === 'ON_CANDLE_CLOSE') {
          // Para ON_CANDLE_CLOSE: calcula próximo fechamento de vela exato
          const timeframeConfig = new TimeframeConfig(currentBotConfig);
          const nextCandleCloseMs = timeframeConfig.getTimeUntilNextCandleClose(
            currentBotConfig.time || '5m'
          );
          nextValidationAt = new Date(Date.now() + nextCandleCloseMs);

          Logger.debug(
            `⏰ [EXECUTION] Bot ${botId}: Próxima análise ON_CANDLE_CLOSE às ${nextValidationAt.toISOString()} (em ${Math.floor(nextCandleCloseMs / 1000)}s)`
          );
        } else {
          // Para REALTIME: próxima execução em 60 segundos
          nextValidationAt = new Date(Date.now() + 60000);

          Logger.debug(
            `⏰ [EXECUTION] Bot ${botId}: Próxima análise REALTIME às ${nextValidationAt.toISOString()} (em 60s)`
          );
        }

        // Salva o próximo horário de validação
        await ConfigManagerSQLite.updateBotConfigById(botId, {
          nextValidationAt: nextValidationAt.toISOString(),
        });

        // Emite evento de execução bem-sucedida
        broadcastViaWs({
          type: 'BOT_EXECUTION_SUCCESS',
          botId,
          botName: currentBotConfig.botName,
          timestamp: new Date().toISOString(),
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
          error: error.message,
        });
      }
    };

    // Para ON_CANDLE_CLOSE: NÃO executa imediatamente, apenas agenda para próxima vela
    // Para REALTIME: Executa imediatamente
    if (botConfig.executionMode !== 'ON_CANDLE_CLOSE') {
      Logger.info(
        `🚀 [STARTUP] Bot ${botId}: Executando imediatamente (modo ${botConfig.executionMode})`
      );
      await executeBot();
    } else {
      Logger.info(
        `⏰ [STARTUP] Bot ${botId}: Modo ON_CANDLE_CLOSE - aguardando próximo fechamento de vela (${botConfig.time})`
      );

      // Calcula e salva o próximo fechamento de vela correto
      const timeframeConfig = new TimeframeConfig(botConfig);
      const nextCandleCloseMs = timeframeConfig.getTimeUntilNextCandleClose(botConfig.time || '5m');
      const nextValidationAt = new Date(Date.now() + nextCandleCloseMs);

      await ConfigManagerSQLite.updateBotConfigById(botId, {
        nextValidationAt: nextValidationAt.toISOString(),
      });

      Logger.info(
        `⏰ [STARTUP] Bot ${botId}: Próxima execução agendada para ${nextValidationAt.toISOString()}`
      );
    }

    let intervalId;

    if (botConfig.executionMode === 'ON_CANDLE_CLOSE') {
      // Para ON_CANDLE_CLOSE: usa setTimeout recursivo com execução precisa
      const scheduleNextExecution = async () => {
        try {
          // Recarrega config para pegar executionMode atualizado
          const currentConfig = await ConfigManagerSQLite.getBotConfigById(botId);
          if (currentConfig.executionMode !== 'ON_CANDLE_CLOSE') {
            Logger.info(
              `🔄 [ON_CANDLE_CLOSE] Bot ${botId}: Modo alterado para ${currentConfig.executionMode}, parando agendamento`
            );
            return; // Se mudou o modo, para
          }

          const timeframeConfig = new TimeframeConfig(currentConfig);
          const nextInterval = timeframeConfig.getTimeUntilNextCandleClose(
            currentConfig.time || '5m'
          );

          // Calcula o timestamp exato do próximo fechamento
          const nextCandleCloseTime = new Date(Date.now() + nextInterval);

          Logger.debug(
            `⏰ [ON_CANDLE_CLOSE] Bot ${botId}: Agendando execução para ${nextCandleCloseTime.toISOString()} (em ${Math.floor(nextInterval / 1000)}s)`
          );

          const timeoutId = setTimeout(async () => {
            try {
              Logger.info(
                `🕒 [ON_CANDLE_CLOSE] Bot ${botId}: Executando no fechamento da vela ${currentConfig.time} - ${new Date().toISOString()}`
              );
              await executeBot();
            } catch (error) {
              Logger.error(
                `❌ [ON_CANDLE_CLOSE] Erro durante execução do bot ${botId}:`,
                error.message
              );
            } finally {
              // SEMPRE reagenda para a próxima vela, mesmo se executeBot() falhar
              Logger.debug(`🔄 [ON_CANDLE_CLOSE] Bot ${botId}: Reagendando para próxima vela...`);
              scheduleNextExecution();
            }
          }, nextInterval);

          // Salva para poder cancelar depois
          intervalId = timeoutId;
        } catch (error) {
          Logger.error(
            `❌ [ON_CANDLE_CLOSE] Erro ao agendar próxima execução do bot ${botId}:`,
            error.message
          );

          // Tenta reagendar em 10 segundos se der erro
          setTimeout(() => {
            Logger.info(`🔄 [ON_CANDLE_CLOSE] Bot ${botId}: Tentando reagendar após erro...`);
            scheduleNextExecution();
          }, 10000);
        }
      };

      // Inicia o agendamento
      Logger.info(
        `🚀 [ON_CANDLE_CLOSE] Bot ${botId}: Iniciando sistema de agendamento para timeframe ${botConfig.time}`
      );
      scheduleNextExecution();
    } else {
      // Para REALTIME: usa setInterval normal de 60 segundos
      Logger.info(`🚀 [REALTIME] Bot ${botId}: Iniciando execução contínua a cada 60 segundos`);
      intervalId = setInterval(async () => {
        try {
          Logger.debug(
            `🕒 [REALTIME] Bot ${botId}: Executando análise - ${new Date().toISOString()}`
          );
          await executeBot();
        } catch (error) {
          Logger.error(`❌ [REALTIME] Erro durante execução do bot ${botId}:`, error.message);
        }
      }, 60000); // Sempre 60 segundos para REALTIME
    }

    // Carrega configuração inicial para a instância
    let botInstanceConfig = await ConfigManagerSQLite.getBotConfigById(botId);

    // Adiciona a instância do bot ao mapa de controle
    activeBotInstances.set(botId, {
      intervalId,
      executeBot,
      config: botInstanceConfig,
      status: 'running',
      updateConfig: async newConfig => {
        Logger.info(`🔄 [CONFIG_UPDATE] Atualizando configuração do bot ${botId} em tempo real`);
        // Atualiza a configuração na instância
        const botInstance = activeBotInstances.get(botId);
        if (botInstance) {
          botInstance.config = newConfig;
          Logger.info(`✅ [CONFIG_UPDATE] Configuração do bot ${botId} atualizada com sucesso`);

          // Invalida qualquer cache relacionado
          ConfigManagerSQLite.invalidateCache();

          // Log das principais mudanças (para debug)
          Logger.debug(`📊 [CONFIG_UPDATE] Bot ${botId} - Novas configurações aplicadas:`, {
            capitalPercentage: newConfig.capitalPercentage,
            maxOpenOrders: newConfig.maxOpenOrders,
            enableTrailingStop: newConfig.enableTrailingStop,
            enabled: newConfig.enabled,
          });
        }
      },
    });

    Logger.info(`✅ [BOT] Bot ${botId} iniciado com sucesso`);

    // Emite evento de início bem-sucedido
    broadcastViaWs({
      type: 'BOT_STARTED',
      botId,
      botName: botConfig.botName,
      timestamp: new Date().toISOString(),
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
      error: error.message,
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
      Logger.error(
        `❌ [BOT] Erro ao parar sincronização de posições para bot ${botId}:`,
        syncError.message
      );
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
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error(`❌ [BOT] Erro ao parar bot ${botId}:`, error.message);
    throw error;
  }
}

// API Routes

// Feature Toggles Routes
// GET /api/feature-toggles - Lista todas as feature toggles
app.get('/api/feature-toggles', async (req, res) => {
  try {
    const toggles = await FeatureToggleService.getAllToggles();
    res.json({
      success: true,
      data: toggles,
    });
  } catch (error) {
    Logger.error('❌ [API] Error getting feature toggles:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// POST /api/feature-toggles/:featureName/enable - Habilita uma feature
app.post('/api/feature-toggles/:featureName/enable', async (req, res) => {
  try {
    const { featureName } = req.params;
    const { description } = req.body;

    await FeatureToggleService.enable(featureName, description || '');

    res.json({
      success: true,
      message: `Feature '${featureName}' enabled successfully`,
    });
  } catch (error) {
    Logger.error(`❌ [API] Error enabling feature toggle:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// POST /api/feature-toggles/:featureName/disable - Desabilita uma feature
app.post('/api/feature-toggles/:featureName/disable', async (req, res) => {
  try {
    const { featureName } = req.params;

    await FeatureToggleService.disable(featureName);

    res.json({
      success: true,
      message: `Feature '${featureName}' disabled successfully`,
    });
  } catch (error) {
    Logger.error(`❌ [API] Error disabling feature toggle:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/feature-toggles/:featureName - Verifica status de uma feature
app.get('/api/feature-toggles/:featureName', async (req, res) => {
  try {
    const { featureName } = req.params;
    const enabled = await FeatureToggleService.isEnabled(featureName);

    res.json({
      success: true,
      feature: featureName,
      enabled,
    });
  } catch (error) {
    Logger.error(`❌ [API] Error checking feature toggle:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// POST /api/bot/debug/fix-status - Corrige status inconsistente
app.post('/api/bot/debug/fix-status', async (req, res) => {
  try {
    const fixes = [];

    for (const [botId, instance] of activeBotInstances.entries()) {
      if (instance && instance.status === 'running') {
        await ConfigManagerSQLite.updateBotStatusById(botId, 'running');
        fixes.push(`Bot ${botId}: status atualizado para 'running'`);
      }
    }

    res.json({
      success: true,
      message: 'Status corrigidos',
      fixes,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/bot/debug/active - Debug das instâncias ativas
app.get('/api/bot/debug/active', async (req, res) => {
  try {
    const activeInstances = Array.from(activeBotInstances.keys());
    const instancesDetails = Array.from(activeBotInstances.entries()).map(([botId, instance]) => ({
      botId,
      hasInstance: !!instance,
      hasConfig: !!instance.config,
      status: instance.status || 'unknown',
    }));

    res.json({
      success: true,
      activeInstancesCount: activeBotInstances.size,
      activeInstancesIds: activeInstances,
      details: instancesDetails,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/bot/status - Retorna status de todos os bots
app.get('/api/bot/status', async (req, res) => {
  try {
    const configs = await ConfigManagerSQLite.loadConfigs();
    const status = configs.map(config => {
      // SIMPLIFICADO: Usa apenas o status do banco como fonte única da verdade
      const isRunning = config.status === 'running';

      return {
        id: config.id,
        botName: config.botName,
        strategyName: config.strategyName,
        status: config.status || 'stopped',
        startTime: config.startTime,
        // REMOVIDO: isRunning - usar apenas 'status'
        config: config,
      };
    });

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'botId deve ser um número válido',
      });
    }

    // Busca configuração do bot por ID
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`,
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
            case 'm':
              timeframeMs = value * 60 * 1000;
              break;
            case 'h':
              timeframeMs = value * 60 * 60 * 1000;
              break;
            case 'd':
              timeframeMs = value * 24 * 60 * 60 * 1000;
              break;
            default:
              timeframeMs = 5 * 60 * 1000; // padrão 5m
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
          nextValidationAt: nextExecutionDate.toISOString(),
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
          case 'm':
            timeframeMs = value * 60 * 1000;
            break;
          case 'h':
            timeframeMs = value * 60 * 60 * 1000;
            break;
          case 'd':
            timeframeMs = value * 24 * 60 * 60 * 1000;
            break;
          default:
            timeframeMs = 5 * 60 * 1000; // padrão 5m
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
        nextValidationAt: nextExecutionDate.toISOString(),
      });
    }

    // Se temos um nextValidationAt válido, usa ele; senão usa o calculado
    const finalNextExecutionDate =
      botConfig.nextValidationAt && nextExecutionMs > 0
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
          hour12: false,
        }),
      },
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'botId deve ser um número válido',
      });
    }

    // Busca configuração do bot por ID
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`,
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
        orders,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
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
        data: {},
      });
    }

    const firstBotConfig = configs[0];
    const allBotsOrders = await OrderController.getAllBotsOrders(firstBotConfig);

    res.json({
      success: true,
      data: allBotsOrders,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'botId é obrigatório',
      });
    }

    await startBot(botId);

    res.json({
      success: true,
      message: `Bot ${botId} iniciado com sucesso`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'botId é obrigatório',
      });
    }

    await stopBot(botId);

    res.json({
      success: true,
      message: `Bot ${botId} parado com sucesso`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'botId é obrigatório',
      });
    }

    // Busca a configuração do bot
    const config = await ConfigManagerSQLite.getBotConfigById(botId);
    if (!config) {
      return res.status(404).json({
        success: false,
        error: `Bot ${botId} não encontrado`,
      });
    }

    // Verifica se as credenciais estão configuradas
    if (!config.apiKey || !config.apiSecret) {
      return res.status(400).json({
        success: false,
        error: 'Bot não possui credenciais de API configuradas',
      });
    }

    Logger.info(
      `🔄 [FORCE_SYNC] Iniciando sincronização forçada para bot ${botId} (${config.botName})`
    );

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
        syncedOrders,
      },
    });
  } catch (error) {
    Logger.error(`❌ [FORCE_SYNC] Erro no force sync para bot ${req.body?.botId}:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
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
        error: 'botId e config são obrigatórios',
      });
    }

    Logger.info(`🔄 [BOT_UPDATE] Atualizando configuração do bot ${botId} em execução...`);

    // Verifica se o bot está realmente rodando
    if (!activeBotInstances.has(botId)) {
      return res.status(400).json({
        success: false,
        error: `Bot ${botId} não está em execução`,
      });
    }

    // Recalcula nextValidationAt se necessário (modo ou timeframe mudaram)
    const currentConfig = await ConfigManagerSQLite.getBotConfigById(botId);
    let updatedConfig = { ...config };

    // Força ON_CANDLE_CLOSE para estratégias que dependem de velas fechadas
    if (config.strategyName === 'ALPHA_FLOW') {
      Logger.info(`🧠 [ALPHA_FLOW] Bot ${botId}: Modo ON_CANDLE_CLOSE forçado automaticamente`);
      updatedConfig.executionMode = 'ON_CANDLE_CLOSE';
    } else if (config.enableHeikinAshi === true || config.enableHeikinAshi === 'true') {
      Logger.info(
        `📊 [HEIKIN_ASHI] Bot ${botId}: Modo ON_CANDLE_CLOSE forçado automaticamente (Heikin Ashi habilitado)`
      );
      updatedConfig.executionMode = 'ON_CANDLE_CLOSE';
    }

    const modeChanged = currentConfig?.executionMode !== updatedConfig.executionMode;
    const timeframeChanged = currentConfig?.time !== config.time;

    if (modeChanged || timeframeChanged) {
      Logger.info(
        `🔄 [BOT_UPDATE] Bot ${botId}: Recalculando nextValidationAt (modo: ${updatedConfig.executionMode}, timeframe: ${config.time})`
      );

      const timeframeConfig = new TimeframeConfig(updatedConfig);
      let executionInterval;

      if (updatedConfig.executionMode === 'ON_CANDLE_CLOSE') {
        executionInterval = timeframeConfig.getTimeUntilNextCandleClose(config.time || '5m');
      } else {
        executionInterval = 60000; // REALTIME: 60 segundos
      }

      const nextValidationAt = new Date(Date.now() + executionInterval);
      updatedConfig.nextValidationAt = nextValidationAt.toISOString();

      Logger.info(
        `⏰ [BOT_UPDATE] Bot ${botId}: Próximo execução recalculada para ${nextValidationAt.toISOString()}`
      );
    }

    // Atualiza a configuração no banco de dados
    await ConfigManagerSQLite.updateBotConfigById(botId, updatedConfig);

    // Atualiza a configuração na instância ativa do bot
    const botInstance = activeBotInstances.get(botId);
    if (botInstance && botInstance.updateConfig) {
      await botInstance.updateConfig(updatedConfig);
    }

    Logger.info(`✅ [BOT_UPDATE] Bot ${botId} atualizado com sucesso`);

    res.json({
      success: true,
      message: `Bot ${botId} atualizado com sucesso`,
      botId: botId,
    });
  } catch (error) {
    Logger.error(`❌ [BOT_UPDATE] Erro ao atualizar bot ${req.body?.botId}:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
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
          error: 'apiKey e apiSecret são obrigatórios',
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
        const wasRunning =
          currentConfig &&
          currentConfig.status === 'running' &&
          activeBotInstances.has(botConfig.id);

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
              config: botConfig,
            }),
          });

          const updateResult = await updateResponse.json();

          if (!updateResult.success) {
            throw new Error(updateResult.error || 'Erro ao atualizar bot em execução');
          }

          res.json({
            success: true,
            message: updateResult.message,
            botId: botConfig.id,
            wasRunning: true,
          });
        } else {
          // Se não está rodando, atualiza normalmente
          // Preserva o status atual
          const currentConfig = await ConfigManagerSQLite.getBotConfigById(botConfig.id);
          const currentStatus = currentConfig ? currentConfig.status : 'stopped';

          // Remove o status do config enviado para não sobrescrever
          const configToUpdate = { ...botConfig };
          delete configToUpdate.status;

          await ConfigManagerSQLite.updateBotConfigById(botConfig.id, configToUpdate);

          // Explicitamente preserva o status atual
          await ConfigManagerSQLite.updateBotStatusById(botConfig.id, currentStatus);

          res.json({
            success: true,
            message: `Bot ${botConfig.id} atualizado com sucesso (status preservado: ${currentStatus})`,
            botId: botConfig.id,
            wasRunning: false,
          });
        }
      } else {
        const botId = await ConfigManagerSQLite.addBotConfig(botConfig);
        res.json({
          success: true,
          message: `Bot criado com sucesso`,
          botId: botId,
        });
      }
    } else if (strategyName && botConfig) {
      // Se o request tem a estrutura { strategyName, config: {...} } (compatibilidade)
      if (!botConfig.apiKey || !botConfig.apiSecret) {
        return res.status(400).json({
          success: false,
          error: 'apiKey e apiSecret são obrigatórios',
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
        const wasRunning =
          currentConfig &&
          currentConfig.status === 'running' &&
          activeBotInstances.has(botConfig.id);

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
              config: botConfig,
            }),
          });

          const updateResult = await updateResponse.json();

          if (!updateResult.success) {
            throw new Error(updateResult.error || 'Erro ao atualizar bot em execução');
          }

          res.json({
            success: true,
            message: updateResult.message,
            botId: botConfig.id,
            wasRunning: true,
          });
        } else {
          // Se não está rodando, atualiza normalmente
          // Preserva o status atual
          const currentConfig = await ConfigManagerSQLite.getBotConfigById(botConfig.id);
          const currentStatus = currentConfig ? currentConfig.status : 'stopped';

          // Remove o status do config enviado para não sobrescrever
          const configToUpdate = { ...botConfig };
          delete configToUpdate.status;

          await ConfigManagerSQLite.updateBotConfigById(botConfig.id, configToUpdate);

          // Explicitamente preserva o status atual
          await ConfigManagerSQLite.updateBotStatusById(botConfig.id, currentStatus);

          res.json({
            success: true,
            message: `Bot ${botConfig.id} atualizado com sucesso (status preservado: ${currentStatus})`,
            botId: botConfig.id,
            wasRunning: false,
          });
        }
      } else {
        const botId = await ConfigManagerSQLite.addBotConfig(botConfig);
        res.json({
          success: true,
          message: `Bot criado com sucesso`,
          botId: botId,
        });
      }
    } else {
      // Se o request tem a estrutura direta { strategyName, apiKey, apiSecret, ... }
      const config = req.body;

      if (!config.strategyName) {
        return res.status(400).json({
          success: false,
          error: 'strategyName é obrigatório',
        });
      }

      if (!config.apiKey || !config.apiSecret) {
        return res.status(400).json({
          success: false,
          error: 'apiKey e apiSecret são obrigatórios',
        });
      }

      // Se tem ID, atualiza; senão, cria novo
      if (config.id) {
        // Verifica se o bot estava rodando antes da atualização
        const currentConfig = await ConfigManagerSQLite.getBotConfigById(config.id);
        const wasRunning =
          currentConfig && currentConfig.status === 'running' && activeBotInstances.has(config.id);

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
              config: config,
            }),
          });

          const updateResult = await updateResponse.json();

          if (!updateResult.success) {
            throw new Error(updateResult.error || 'Erro ao atualizar bot em execução');
          }

          res.json({
            success: true,
            message: updateResult.message,
            botId: config.id,
            wasRunning: true,
          });
        } else {
          // Se não está rodando, atualiza normalmente
          // Preserva o status atual
          const currentConfigLegacy = await ConfigManagerSQLite.getBotConfigById(config.id);
          const currentStatusLegacy = currentConfigLegacy ? currentConfigLegacy.status : 'stopped';

          // Remove o status do config enviado para não sobrescrever
          const configToUpdateLegacy = { ...config };
          delete configToUpdateLegacy.status;

          await ConfigManagerSQLite.updateBotConfigById(config.id, configToUpdateLegacy);

          // Explicitamente preserva o status atual
          await ConfigManagerSQLite.updateBotStatusById(config.id, currentStatusLegacy);

          res.json({
            success: true,
            message: `Bot ${config.id} atualizado com sucesso (status preservado: ${currentStatusLegacy})`,
            botId: config.id,
            wasRunning: false,
          });
        }
      } else {
        const botId = await ConfigManagerSQLite.addBotConfig(config);
        res.json({
          success: true,
          message: `Bot criado com sucesso`,
          botId: botId,
        });
      }
    }
  } catch (error) {
    Logger.error(`❌ [CONFIG] Erro ao processar configuração:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'Database service não está inicializado',
      });
    }

    const configs = await ConfigManagerSQLite.loadConfigs();

    res.json({
      success: true,
      data: configs,
    });
  } catch (error) {
    Logger.error('❌ Erro no endpoint /api/configs:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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
      message: `Bot ${botName} removido com sucesso`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'ID do bot deve ser um número válido',
      });
    }

    // Verifica se o bot existe antes de deletar
    const existingConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!existingConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botIdNum} não encontrado`,
      });
    }

    // Para o bot se estiver rodando
    if (activeBotInstances.has(botIdNum)) {
      Logger.info(`🛑 [DELETE] Parando bot ${existingConfig.botName} antes de deletar...`);
      await stopBot(botIdNum);
    }

    // === LIMPEZA COMPLETA DO BOT ===

    // 1. Remove a configuração do bot (inclui ordens, trailing states e bot orders)
    await ConfigManagerSQLite.removeBotConfigById(botIdNum);
    Logger.info(`✅ [DELETE] Configuração do bot ${botIdNum} removida`);

    // Nota: trailing_state, bot_orders, ordens e posições já foram removidos pelo ConfigManagerSQLite

    // 2. Remove de instâncias ativas (se ainda estiver lá)
    if (activeBotInstances.has(botIdNum)) {
      activeBotInstances.delete(botIdNum);
      Logger.info(`🧹 [DELETE] Instância ativa do bot ${botIdNum} removida`);
    }

    // 3. Remove configurações de rate limit
    if (monitorRateLimits.has(botIdNum)) {
      monitorRateLimits.delete(botIdNum);
      Logger.info(`🧹 [DELETE] Rate limits do bot ${botIdNum} removidos`);
    }

    Logger.info(
      `🎯 [DELETE] Bot ${botIdNum} completamente removido - Config, Trailing, Ordens, Posições, Instâncias e Rate Limits`
    );

    res.json({
      success: true,
      message: `Bot ID ${botIdNum} removido com sucesso - Todos os dados foram limpos`,
    });
  } catch (error) {
    Logger.error('❌ [DELETE] Erro ao deletar bot:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/strategies - Retorna todas as estratégias disponíveis
app.get('/api/strategies', (req, res) => {
  try {
    const strategies = StrategyFactory.getAvailableStrategies();

    res.json({
      success: true,
      data: strategies,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// POST /api/account/clear-cache - Limpa o cache do AccountController
app.post('/api/account/clear-cache', (req, res) => {
  try {
    // Importa o AccountController dinamicamente
    import('./src/Controllers/AccountController.js')
      .then(module => {
        const AccountController = module.default;
        AccountController.clearCache();

        res.json({
          success: true,
          message: 'Cache do AccountController limpo com sucesso',
        });
      })
      .catch(error => {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'symbol é obrigatório',
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
      volume: Math.random() * 1000,
    }));

    res.json({
      success: true,
      data: mockKlines,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/health - Endpoint de saúde do sistema
app.get('/api/health', async (req, res) => {
  try {
    const health = {
      database: {
        initialized: ConfigManagerSQLite.dbService?.isInitialized() || false,
        path: ConfigManagerSQLite.dbService?.dbPath || 'N/A',
      },
      configManager: {
        initialized: !!ConfigManagerSQLite.dbService,
      },
      timestamp: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: health,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/tokens/available - Retorna tokens/markets disponíveis com dados de volume e change 24h
app.get('/api/tokens/available', async (req, res) => {
  try {
    Logger.info('🔍 [API] Buscando tokens disponíveis com dados de volume...');

    // Usar a classe Markets para obter dados da Backpack API
    const Markets = await import('./src/Backpack/Public/Markets.js');
    Logger.debug('✅ [API] Markets importado com sucesso');

    const marketsInstance = new Markets.default();
    Logger.debug('✅ [API] Instância Markets criada');

    // Buscar dados de mercados e tickers em paralelo
    const [markets, tickers] = await Promise.all([
      marketsInstance.getMarkets(),
      marketsInstance.getTickers('1d'),
    ]);

    Logger.debug(
      `📊 [API] Dados recebidos - Markets: ${markets ? markets.length : 0}, Tickers: ${tickers ? tickers.length : 0}`
    );

    if (!markets || !Array.isArray(markets)) {
      Logger.error('❌ [API] Dados inválidos recebidos da API:', markets);
      return res.status(500).json({
        success: false,
        error: 'Erro ao obter dados de mercado da API',
      });
    }

    // Criar map dos tickers para busca rápida por symbol
    const tickersMap = new Map();
    if (tickers && Array.isArray(tickers)) {
      tickers.forEach(ticker => {
        if (ticker.symbol) {
          tickersMap.set(ticker.symbol, ticker);
        }
      });
    }

    // Filtrar apenas mercados PERP ativos e enriquecer com dados de ticker
    Logger.debug(`🔍 [API] Filtrando ${markets.length} mercados...`);

    const availableTokens = markets
      .filter(market => market.marketType === 'PERP' && market.orderBookState === 'Open')
      .map(market => {
        const ticker = tickersMap.get(market.symbol) || {};
        return {
          symbol: market.symbol,
          baseSymbol: market.baseSymbol,
          quoteSymbol: market.quoteSymbol,
          marketType: market.marketType,
          orderBookState: market.orderBookState,
          status: market.status || 'Unknown',
          // Dados de volume e change das últimas 24h
          volume24h: ticker.volume || '0',
          quoteVolume24h: ticker.quoteVolume || '0',
          priceChange24h: ticker.priceChange || '0',
          priceChangePercent24h: ticker.priceChangePercent || '0',
          high24h: ticker.high || '0',
          low24h: ticker.low || '0',
          lastPrice: ticker.lastPrice || '0',
          trades24h: ticker.trades || '0',
        };
      })
      // Ordenar por volume (maior para menor)
      .sort((a, b) => {
        const volumeA = parseFloat(a.quoteVolume24h) || 0;
        const volumeB = parseFloat(b.quoteVolume24h) || 0;
        return volumeB - volumeA;
      });

    Logger.debug(
      `✅ [API] Tokens filtrados e ordenados por volume: ${availableTokens.length} PERP ativos`
    );

    res.json({
      success: true,
      tokens: availableTokens,
      total: availableTokens.length,
    });
  } catch (error) {
    Logger.error('❌ Erro ao buscar tokens disponíveis:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/positions - Retorna posições abertas de todos os bots
app.get('/api/positions', async (req, res) => {
  try {
    const positions = [];

    // Para cada bot ativo, buscar suas posições
    for (const [botName, bot] of activeBotInstances.entries()) {
      if (bot.status === 'running' && bot.intervalId) {
        // Verifica se o bot está rodando e tem intervalo
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
      data: positions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/orders - Retorna ordens pendentes de todos os bots
app.get('/api/orders', async (req, res) => {
  try {
    const orders = [];

    // Para cada bot ativo, buscar suas ordens pendentes
    for (const [botName, bot] of activeBotInstances.entries()) {
      if (bot.status === 'running' && bot.intervalId) {
        // Verifica se o bot está rodando e tem intervalo
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
      data: orders,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'ID do bot inválido',
      });
    }

    const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);

    if (!botConfig || !botConfig.apiKey || !botConfig.apiSecret) {
      return res.status(400).json({
        success: false,
        error: 'Configuração de API não encontrada',
      });
    }

    // Busca dados da Backpack API
    const [account, collateral] = await Promise.all([
      Account.getAccount(null, botConfig.apiKey, botConfig.apiSecret),
      Capital.getCollateral(null, botConfig.apiKey, botConfig.apiSecret),
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
      lastUpdated: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    Logger.error('Erro ao buscar estatísticas de trading:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'Configuração de API não encontrada',
      });
    }

    // Busca dados da Backpack API
    const [account, collateral] = await Promise.all([
      Account.getAccount(null, botConfig.apiKey, botConfig.apiSecret),
      Capital.getCollateral(null, botConfig.apiKey, botConfig.apiSecret),
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
      lastUpdated: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    Logger.error('Erro ao buscar estatísticas de trading:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'Configuração de API não encontrada',
      });
    }

    const positions = await makeBackpackRequest(
      botConfig.apiKey,
      botConfig.apiSecret,
      '/api/v1/positions'
    );

    res.json({
      success: true,
      data: positions.positions || [],
    });
  } catch (error) {
    Logger.error('Erro ao buscar posições da Backpack:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'API Key e API Secret são obrigatórios',
      });
    }

    // Validar credenciais na Backpack API
    try {
      const [accountData, collateralData] = await Promise.all([
        Account.getAccount(null, apiKey, apiSecret),
        Capital.getCollateral(null, apiKey, apiSecret),
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
            totalEquity: collateralData.totalEquity,
          },
        });
      } else {
        res.status(401).json({
          success: false,
          error: 'Credenciais inválidas',
          apiKeyStatus: 'inválida',
        });
      }
    } catch (backpackError) {
      Logger.error('Erro na validação da Backpack:', backpackError);
      res.status(401).json({
        success: false,
        error: 'Credenciais inválidas ou erro de conexão com a Backpack',
        apiKeyStatus: 'com erro',
      });
    }
  } catch (error) {
    Logger.error('Erro ao validar credenciais:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'API Key e API Secret são obrigatórios',
      });
    }

    // Buscar todas as configurações salvas
    const configs = await ConfigManagerSQLite.loadConfigs();

    // Verificar se já existe um bot com as mesmas credenciais
    const existingBot = configs.find(
      config => config.apiKey === apiKey && config.apiSecret === apiSecret
    );

    if (existingBot) {
      return res.status(409).json({
        success: false,
        error: 'Já existe um bot configurado com essas credenciais de API',
        existingBot: {
          botName: existingBot.botName,
          strategyName: existingBot.strategyName,
        },
      });
    }

    res.json({
      success: true,
      message: 'Credenciais únicas, pode prosseguir',
    });
  } catch (error) {
    Logger.error('Erro ao validar credenciais duplicadas:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// WebSocket connection handler
wss.on('connection', ws => {
  connections.add(ws);
  Logger.info(`🔌 [WS] Nova conexão WebSocket estabelecida`);

  // Envia status inicial
  ws.send(
    JSON.stringify({
      type: 'CONNECTION_ESTABLISHED',
      timestamp: new Date().toISOString(),
      message: 'Conexão WebSocket estabelecida',
    })
  );

  ws.on('close', () => {
    connections.delete(ws);
    Logger.info(`🔌 [WS] Conexão WebSocket fechada`);
  });

  ws.on('error', error => {
    Logger.error('🔌 [WS] Erro na conexão WebSocket:', error.message);
  });
});

// Função para buscar posições de um bot específico
async function getBotPositions(botName) {
  try {
    const bot = activeBotInstances.get(botName);
    if (!bot || !bot.intervalId) {
      // Verifica se o bot está rodando e tem intervalo
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
        botName: botName,
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
    if (!bot || !bot.intervalId) {
      // Verifica se o bot está rodando e tem intervalo
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
        timeInForce: 'GTC',
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
        error: 'botId deve ser um número válido',
      });
    }

    // Busca configuração do bot por ID
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`,
      });
    }

    // Opções de filtro
    const options = {};
    if (symbol) options.symbol = symbol;
    if (limit) options.limit = parseInt(limit);
    if (offset) options.offset = parseInt(offset);
    if (sortDirection) options.sortDirection = sortDirection;

    // Recupera posições do histórico da Backpack
    const positionsData = await OrderController.getBotPositionsFromHistory(
      botIdNum,
      botConfig,
      options
    );

    res.json({
      success: true,
      data: positionsData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'botId deve ser um número válido',
      });
    }

    // Busca configuração do bot por ID
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`,
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
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'botClientOrderId ou botId é obrigatório',
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
          error: 'botId deve ser um número válido',
        });
      }

      botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
      if (!botConfig) {
        return res.status(404).json({
          success: false,
          error: `Bot com ID ${botId} não encontrado`,
        });
      }

      // Se não foi fornecido botClientOrderId, usa o do bot configurado
      if (!botClientOrderId) {
        if (!botConfig.botClientOrderId) {
          return res.status(400).json({
            success: false,
            error: 'Bot não possui botClientOrderId configurado',
          });
        }
        botClientOrderIdToUse = botConfig.botClientOrderId;
      } else {
        botClientOrderIdToUse = botClientOrderId;
      }
    } else {
      // Se foi fornecido apenas botClientOrderId, busca um bot que use essas credenciais
      const configs = await ConfigManagerSQLite.loadConfigs();
      botConfig = configs.find(
        config =>
          config.apiKey &&
          config.apiSecret &&
          (config.botClientOrderId === botClientOrderId || config.botName === botClientOrderId)
      );

      if (!botConfig) {
        return res.status(404).json({
          success: false,
          error: `Nenhum bot encontrado com botClientOrderId: ${botClientOrderId}`,
        });
      }
    }

    // Validação das credenciais
    if (!botConfig.apiKey || !botConfig.apiSecret) {
      return res.status(400).json({
        success: false,
        error: 'Bot não possui credenciais de API configuradas',
      });
    }

    // Opções de análise
    const options = {
      days: parseInt(days),
      limit: parseInt(limit),
    };

    // Executa a análise de performance usando a classe History
    const performanceData = await History.analyzeBotPerformance(
      botClientOrderIdToUse,
      options,
      botConfig.apiKey,
      botConfig.apiSecret
    );

    res.json({
      success: true,
      data: performanceData,
    });
  } catch (error) {
    Logger.error('Erro ao analisar performance do bot:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'botClientOrderId ou botId é obrigatório',
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
          error: 'botId deve ser um número válido',
        });
      }

      botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
      if (!botConfig) {
        return res.status(404).json({
          success: false,
          error: `Bot com ID ${botId} não encontrado`,
        });
      }

      // Se não foi fornecido botClientOrderId, usa o do bot configurado
      if (!botClientOrderId) {
        if (!botConfig.botClientOrderId) {
          return res.status(400).json({
            success: false,
            error: 'Bot não possui botClientOrderId configurado',
          });
        }
        botClientOrderIdToUse = botConfig.botClientOrderId;
      } else {
        botClientOrderIdToUse = botClientOrderId;
      }
    } else {
      // Se foi fornecido apenas botClientOrderId, busca um bot que use essas credenciais
      const configs = await ConfigManagerSQLite.loadConfigs();
      botConfig = configs.find(
        config =>
          config.apiKey &&
          config.apiSecret &&
          (config.botClientOrderId === botClientOrderId || config.botName === botClientOrderId)
      );

      if (!botConfig) {
        return res.status(404).json({
          success: false,
          error: `Nenhum bot encontrado com botClientOrderId: ${botClientOrderId}`,
        });
      }
    }

    // Validação das credenciais
    if (!botConfig.apiKey || !botConfig.apiSecret) {
      return res.status(400).json({
        success: false,
        error: 'Bot não possui credenciais de API configuradas',
      });
    }

    // Opções de análise
    const options = {
      includeOpen: includeOpen === 'true',
    };

    // Executa a análise de detalhes usando a classe History
    const detailsData = await History.getBotPerformanceDetails(
      botClientOrderIdToUse,
      options,
      botConfig.apiKey,
      botConfig.apiSecret
    );

    res.json({
      success: true,
      data: {
        ...detailsData,
        botName: botConfig.botName,
      },
    });
  } catch (error) {
    Logger.error('Erro ao buscar detalhes de performance do bot:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'botId é obrigatório',
      });
    }

    const botIdNum = parseInt(botId);
    if (isNaN(botIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'botId deve ser um número válido',
      });
    }

    // Busca configuração do bot
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`,
      });
    }

    // Validação das credenciais
    if (!botConfig.apiKey || !botConfig.apiSecret) {
      return res.status(400).json({
        success: false,
        error: 'Bot não possui credenciais de API configuradas',
      });
    }

    // Usa botClientOrderId do bot ou botName como fallback
    const botClientOrderId = botConfig.botClientOrderId || botConfig.botName;

    Logger.info(`🔍 Testando performance para bot ${botId} (${botClientOrderId})`);
    Logger.info(`🔍 Configuração do bot:`, {
      id: botConfig.id,
      botName: botConfig.botName,
      botClientOrderId: botConfig.botClientOrderId,
      orderCounter: botConfig.orderCounter,
    });

    Logger.info(`🔍 [ENDPOINT] Chamando History.analyzeBotPerformance...`);
    Logger.info(`🔍 [ENDPOINT] History object:`, typeof History);
    Logger.info(
      `🔍 [ENDPOINT] History.analyzeBotPerformance:`,
      typeof History.analyzeBotPerformance
    );
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
        analysisPeriod: performanceData.analysisPeriod,
      },
    });
  } catch (error) {
    Logger.error('Erro no endpoint simples:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Função para iniciar monitores para todos os bots habilitados
async function startMonitorsForAllEnabledBots() {
  try {
    Logger.info('🔄 [MONITORS] Iniciando monitores para todos os bots habilitados...');

    // Carrega apenas bots tradicionais habilitados (não HFT)
    const configs = await ConfigManagerSQLite.loadTraditionalBots();
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
          Logger.debug(
            `⚠️ [MONITORS] Bot ${botId} (${botConfig.botName}) não tem credenciais, pulando monitores`
          );
          continue;
        }

        Logger.debug(`🔄 [MONITORS] Iniciando monitores para bot ${botId} (${botConfig.botName})`);

        // Todos os monitores agora são gerenciados pela função setupBotMonitors() em recoverBot()
        // Este local agora não inicia monitores duplicados

        Logger.debug(`✅ [MONITORS] Monitores iniciados para bot ${botId}`);
      } catch (error) {
        Logger.error(
          `❌ [MONITORS] Erro ao iniciar monitores para bot ${botConfig.id}:`,
          error.message
        );
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
      await TrailingStop.initializeFromDB(dbService);
    } else {
      Logger.warn(
        '⚠️ [SERVER] Database service não inicializado, Trailing Stop será carregado individualmente para cada bot'
      );
    }

    // Migração automática: cria estado para posições abertas existentes
    // Será executada individualmente para cada bot quando iniciarem
    Logger.debug(
      'ℹ️ [SERVER] Migração do Trailing Stop será executada individualmente para cada bot'
    );

    // PnL Controller será executado individualmente para cada bot
    Logger.debug('ℹ️ [SERVER] PnL Controller será executado individualmente para cada bot');

    // Inicializa o PositionSyncService
    Logger.info('🔄 [SERVER] Inicializando PositionSyncService...');
    PositionSyncService = new PositionSyncServiceClass(ConfigManagerSQLite.dbService);

    // Verifica e libera a porta antes de iniciar o servidor
    await killProcessOnPort(PORT);

    // Inicializa o servidor primeiro
    server
      .listen(PORT, () => {
        Logger.info(`✅ [SERVER] Servidor rodando na porta ${PORT}`);
        Logger.info(`📊 [SERVER] API disponível em http://localhost:${PORT}`);
        Logger.info(`🔌 [SERVER] WebSocket disponível em ws://localhost:${PORT}`);
        Logger.info(
          `🤖 [SERVER] Estratégias disponíveis: ${StrategyFactory.getAvailableStrategies().join(', ')}`
        );
      })
      .on('error', err => {
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

    // Inicia HFTController em background
    hftController.start().catch(error => {
      Logger.error('❌ [SERVER] Erro ao iniciar HFTController:', error.message);
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
        error: 'botId deve ser um número válido',
      });
    }

    // Busca configuração do bot
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`,
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
        lastSync: botSyncStatus.lastSync ? new Date(botSyncStatus.lastSync).toISOString() : null,
      },
    });
  } catch (error) {
    Logger.error('❌ Erro ao buscar status da sincronização:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'botId é obrigatório',
      });
    }

    const botIdNum = parseInt(botId);
    if (isNaN(botIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'botId deve ser um número válido',
      });
    }

    // Busca configuração do bot
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`,
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
          totalVolume: performanceMetrics.totalVolume || 0,
        },
        positions: {
          closed: performanceMetrics.closedTrades,
          open: performanceMetrics.openPositions,
          total: performanceMetrics.totalPositions,
        },
      };
    } catch (error) {
      Logger.warn(
        `⚠️ [SUMMARY] Erro ao buscar dados de performance (novo sistema): ${error.message}`
      );

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
          totalVolume: 0,
        },
        positions: {
          closed: 0,
          open: 0,
          total: 0,
        },
      };
    }

    // Busca posições ativas apenas do bot (usando novo sistema)
    let activePositions = [];
    try {
      const positionTracker = new PositionTrackingService(ConfigManagerSQLite.dbService);
      activePositions = await positionTracker.getBotOpenPositions(botIdNum);
      Logger.info(
        `📊 [SUMMARY] Usando ${activePositions.length} posições do bot (evitando posições manuais)`
      );
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
        profitRatio = '∞'; // Representa infinito
      } else if (losingTrades > 0 && winningTrades === 0) {
        // Só trades perdedores - Profit Factor = 0 (0 / perdas = 0)
        profitRatio = 0.0;
      } else if (totalPnl > 0) {
        // PnL positivo mas sem trades perdedores (trades parciais)
        profitRatio = '∞'; // Representa infinito
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
      updateInterval: '60s', // REALTIME (60s)
      statistics: {
        winningTrades: performanceData.performance.winningTrades,
        losingTrades: performanceData.performance.losingTrades,
        winRate: performanceData.performance.winRate,
        profitRatio: profitRatio,
        totalTrades: performanceData.performance.totalTrades,
        openPositions: activePositions.length,
      },
      performance: {
        totalPnl: performanceData.performance.totalPnl,
        averagePnl: performanceData.performance.averagePnl,
        maxDrawdown: performanceData.performance.maxDrawdown,
        totalVolume: performanceData.performance.totalVolume,
      },
      positions: {
        closed: performanceData.positions.closed,
        open: activePositions.length,
        total: performanceData.positions.closed + activePositions.length,
      },
      lastUpdated: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    Logger.error('❌ Erro no endpoint /api/bot/summary:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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
        error: 'botId deve ser um número válido',
      });
    }

    const botConfig = await ConfigManagerSQLite.getBotConfigById(botIdNum);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot com ID ${botId} não encontrado`,
      });
    }

    Logger.info(`🧪 [TEST-API] Testando API da corretora para bot ${botIdNum}`);

    // Testa busca de fills diretamente
    const History = (await import('./src/Backpack/Authenticated/History.js')).default;

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

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
    const fillsDetails = fills
      ? fills.map(fill => ({
          symbol: fill.symbol,
          side: fill.side,
          quantity: fill.quantity,
          price: fill.price,
          timestamp: fill.timestamp,
          orderId: fill.orderId,
          clientId: fill.clientId,
          fee: fill.fee,
          feeSymbol: fill.feeSymbol,
        }))
      : [];

    res.json({
      success: true,
      data: {
        botId: botIdNum,
        botName: botConfig.botName,
        apiTest: {
          fillsCount: fills ? fills.length : 0,
          fillsSample: fills && fills.length > 0 ? fills[0] : null,
          fillsDetails: fillsDetails,
          error: null,
        },
      },
    });
  } catch (error) {
    Logger.error('❌ Erro no teste da API da corretora:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ======= HFT APIs =======

// Inicia bot HFT
app.post('/api/hft/start', async (req, res) => {
  try {
    const { botId } = req.body;

    if (!botId) {
      return res.status(400).json({
        success: false,
        error: 'Bot ID é obrigatório',
      });
    }

    // Busca configuração do bot
    const botConfig = await ConfigManagerSQLite.getBotConfigById(botId);
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        error: `Bot ${botId} não encontrado`,
      });
    }

    // Verifica se é modo HFT
    if (botConfig.strategyName !== 'HFT') {
      return res.status(400).json({
        success: false,
        error: 'Bot não está configurado para modo HFT',
      });
    }

    // Inicia estratégia HFT
    const result = await hftController.startHFTBot(botConfig);

    Logger.info(`🚀 [API] Bot HFT iniciado: ${botId}`);

    res.json({
      success: true,
      message: 'Bot HFT iniciado com sucesso',
      data: result,
    });
  } catch (error) {
    Logger.error('❌ [API] Erro ao iniciar bot HFT:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Para bot HFT
app.post('/api/hft/stop', async (req, res) => {
  try {
    const { botId } = req.body;

    if (!botId) {
      return res.status(400).json({
        success: false,
        error: 'Bot ID é obrigatório',
      });
    }

    const result = await hftController.stopHFTBot(botId);

    Logger.info(`🛑 [API] Bot HFT parado: ${botId}`);

    res.json({
      success: true,
      message: 'Bot HFT parado com sucesso',
      data: result,
    });
  } catch (error) {
    Logger.error('❌ [API] Erro ao parar bot HFT:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Para todos os bots HFT
app.post('/api/hft/stop-all', async (req, res) => {
  try {
    const result = await hftController.stopAllHFTBots();

    Logger.info(`🛑 [API] Todos os bots HFT parados`);

    res.json({
      success: true,
      message: 'Todos os bots HFT parados com sucesso',
      data: result,
    });
  } catch (error) {
    Logger.error('❌ [API] Erro ao parar todos os bots HFT:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Status de um bot HFT específico
app.get('/api/hft/status/:botId', async (req, res) => {
  try {
    const { botId } = req.params;

    if (!botId) {
      return res.status(400).json({
        success: false,
        error: 'Bot ID é obrigatório',
      });
    }

    const status = HFTController.getHFTBotStatus(parseInt(botId));

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    Logger.error('❌ [API] Erro ao obter status do bot HFT:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Status de todos os bots HFT
app.get('/api/hft/status', async (req, res) => {
  try {
    const status = HFTController.getAllHFTStatus();

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    Logger.error('❌ [API] Erro ao obter status de todos os bots HFT:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Métricas e relatório de performance HFT
app.get('/api/hft/performance', async (req, res) => {
  try {
    const report = HFTController.getPerformanceReport();

    res.json({
      success: true,
      data: report,
    });
  } catch (error) {
    Logger.error('❌ [API] Erro ao obter relatório de performance HFT:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Habilita/desabilita sistema HFT globalmente
app.post('/api/hft/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Campo "enabled" deve ser boolean',
      });
    }

    HFTController.setHFTEnabled(enabled);

    Logger.info(`🔧 [API] Sistema HFT ${enabled ? 'habilitado' : 'desabilitado'}`);

    res.json({
      success: true,
      message: `Sistema HFT ${enabled ? 'habilitado' : 'desabilitado'} com sucesso`,
      data: { enabled },
    });
  } catch (error) {
    Logger.error('❌ [API] Erro ao alterar status do sistema HFT:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Atualiza configuração de um bot HFT em execução
app.put('/api/hft/config/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const newConfig = req.body;

    if (!botId) {
      return res.status(400).json({
        success: false,
        error: 'Bot ID é obrigatório',
      });
    }

    const result = await HFTController.updateHFTBotConfig(parseInt(botId), newConfig);

    Logger.info(`🔧 [API] Configuração do bot HFT atualizada: ${botId}`);

    res.json({
      success: true,
      message: 'Configuração do bot HFT atualizada com sucesso',
      data: result,
    });
  } catch (error) {
    Logger.error('❌ [API] Erro ao atualizar configuração do bot HFT:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
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
      server.close(err => {
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

    // Para todos os bots HFT
    try {
      await hftController.stopAllHFTBots();
      Logger.info(`✅ [SHUTDOWN] Todos os bots HFT parados`);
    } catch (error) {
      Logger.error(`❌ [SHUTDOWN] Erro ao parar bots HFT:`, error.message);
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
process.on('uncaughtException', error => {
  Logger.error('❌ [UNCAUGHT_EXCEPTION] Erro não capturado:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  Logger.error('❌ [UNHANDLED_REJECTION] Promise rejeitada não tratada:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

Logger.info('✅ [STARTUP] Handlers de shutdown configurados');
