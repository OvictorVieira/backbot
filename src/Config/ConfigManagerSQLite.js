import DatabaseService from '../Services/DatabaseService.js';
import Logger from '../Utils/Logger.js';

/**
 * ConfigManager SQLite - Versão que usa banco de dados SQLite
 *
 * Gerencia todas as configurações dos bots no banco de dados SQLite
 * em vez de arquivos JSON
 */
class ConfigManagerSQLite {
  static dbService = null;
  static configsCache = null;
  static lastLoadTime = 0;
  static cacheTimeout = 5000; // 5 segundos de cache

  /**
   * Inicializa o ConfigManager com o DatabaseService
   * @param {DatabaseService} dbService - Instância do DatabaseService
   */
  static initialize(dbService) {
    ConfigManagerSQLite.dbService = dbService;
    Logger.info('🔧 [CONFIG_SQLITE] ConfigManager SQLite inicializado');
  }

  /**
   * Invalida o cache de configurações
   */
  static invalidateCache() {
    ConfigManagerSQLite.configsCache = null;
    ConfigManagerSQLite.lastLoadTime = 0;
    Logger.debug('🗑️ [CONFIG_SQLITE] Cache de configurações invalidado');
  }

  /**
   * Gera um ID único para um novo bot
   * @returns {number} ID único do bot
   */
  static async generateBotId() {
    const result = await ConfigManagerSQLite.dbService.get(
      'SELECT MAX(botId) as maxId FROM bot_configs'
    );
    return (result?.maxId || 0) + 1;
  }

  /**
   * Carrega todas as configurações do banco de dados
   * @returns {Promise<Array>} Array de configurações de bots
   */
  static async loadConfigs() {
    try {
      if (!ConfigManagerSQLite.dbService || !ConfigManagerSQLite.dbService.isInitialized()) {
        Logger.error('❌ [CONFIG_SQLITE] Database service não está inicializado');
        throw new Error('Database service não está inicializado');
      }

      // Verifica cache
      const now = Date.now();
      if (ConfigManagerSQLite.configsCache &&
          (now - ConfigManagerSQLite.lastLoadTime) < ConfigManagerSQLite.cacheTimeout) {
        Logger.debug('🔍 [CONFIG_SQLITE] Retornando configurações do cache');
        return ConfigManagerSQLite.configsCache;
      }

      const results = await ConfigManagerSQLite.dbService.getAll(
        'SELECT botId, config, createdAt, updatedAt FROM bot_configs ORDER BY botId'
      );

      const configs = results.map(row => {
        try {
          const config = JSON.parse(row.config);
          return {
            id: row.botId,
            ...config,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt
          };
        } catch (parseError) {
          Logger.error(`❌ [CONFIG_SQLITE] Erro ao fazer parse do JSON para botId ${row.botId}:`, parseError.message);
          return null;
        }
      }).filter(config => config !== null);

      // Atualiza cache
      ConfigManagerSQLite.configsCache = configs;
      ConfigManagerSQLite.lastLoadTime = now;

      Logger.infoOnce('config-load', `✅ [CONFIG_SQLITE] ${configs.length} configurações carregadas`);
      return configs;

    } catch (error) {
      Logger.error('❌ [CONFIG_SQLITE] Erro ao carregar configurações:', error.message);
      throw error;
    }
  }

  /**
   * Salva configurações no banco de dados
   * @param {Array} configs - Array de configurações para salvar
   */
  static async saveConfigs(configs) {
    try {
      Logger.info(`💾 [CONFIG_SQLITE] Iniciando salvamento de ${configs.length} configurações...`);

      // Limpa todas as configurações existentes
      await ConfigManagerSQLite.dbService.run('DELETE FROM bot_configs');

      // Insere as novas configurações
      for (const config of configs) {
        const { id, createdAt, updatedAt, ...configData } = config;
        const configJson = JSON.stringify(configData);
        const now = new Date().toISOString();

        await ConfigManagerSQLite.dbService.run(
          'INSERT INTO bot_configs (botId, config, createdAt, updatedAt) VALUES (?, ?, ?, ?)',
          [id, configJson, createdAt || now, updatedAt || now]
        );
      }

      Logger.info(`✅ [CONFIG_SQLITE] Configurações salvas com sucesso`);
    } catch (error) {
      Logger.error('❌ [CONFIG_SQLITE] Erro ao salvar configurações:', error.message);
      throw error;
    }
  }

  /**
   * Obtém configuração de um bot específico
   * @param {string} strategyName - Nome da estratégia
   * @returns {Promise<Object|null>} Configuração do bot ou null se não encontrado
   */
  static async getBotConfig(strategyName) {
    const configs = await this.loadConfigs();
    return configs.find(config => config.strategyName === strategyName) || null;
  }

  /**
   * Obtém configuração de um bot por botName
   * @param {string} botName - Nome único do bot
   * @returns {Promise<Object|null>} Configuração do bot ou null se não encontrado
   */
  static async getBotConfigByBotName(botName) {
    const configs = await this.loadConfigs();
    return configs.find(config => config.botName === botName) || null;
  }

  /**
   * Obtém configuração de um bot por ID
   * @param {number} botId - ID único do bot
   * @returns {Promise<Object|null>} Configuração do bot ou null se não encontrado
   */
  static async getBotConfigById(botId) {
    try {
      const result = await ConfigManagerSQLite.dbService.get(
        'SELECT botId, config, createdAt, updatedAt FROM bot_configs WHERE botId = ?',
        [botId]
      );

      if (!result) return null;

      const config = JSON.parse(result.config);
      return {
        id: result.botId,
        ...config,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt
      };
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao buscar bot ${botId}:`, error.message);
      return null;
    }
  }

  /**
   * Obtém configuração de um bot por botClientOrderId
   * @param {string|number} botClientOrderId - botClientOrderId do bot
   * @returns {Promise<Object|null>} Configuração do bot ou null se não encontrado
   */
  static async getBotConfigByClientOrderId(botClientOrderId) {
    const configs = await this.loadConfigs();
    return configs.find(config => config.botClientOrderId == botClientOrderId) || null;
  }

  /**
   * Atualiza configuração de um bot por ID
   * @param {number} botId - ID único do bot
   * @param {Object} newConfig - Nova configuração
   */
  static async updateBotConfigById(botId, newConfig) {
    Logger.debug(`🔄 [CONFIG_SQLITE] Iniciando atualização do bot ID: ${botId}`);

    try {
      const currentConfig = await this.getBotConfigById(botId);
      if (!currentConfig) {
        throw new Error(`Bot com ID ${botId} não encontrado`);
      }

      Logger.debug(`📝 [CONFIG_SQLITE] Configuração atual encontrada: ${currentConfig.botName}`);

      // Preserva os campos de rastreamento de ordens se não estiverem no newConfig
      const updatedConfig = {
        ...currentConfig,
        ...newConfig,
        // Garante que os campos de rastreamento sejam preservados
        botClientOrderId: newConfig.botClientOrderId || currentConfig.botClientOrderId,
        orderCounter: newConfig.orderCounter !== undefined ? newConfig.orderCounter : currentConfig.orderCounter
      };

      const configJson = JSON.stringify(updatedConfig);
      const now = new Date().toISOString();

      await ConfigManagerSQLite.dbService.run(
        'UPDATE bot_configs SET config = ?, updatedAt = ? WHERE botId = ?',
        [configJson, now, botId]
      );

      Logger.debug(`✅ [CONFIG_SQLITE] Bot ${botId} atualizado com sucesso`);

      // Invalida cache após atualização
      ConfigManagerSQLite.invalidateCache();
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao atualizar bot ${botId}:`, error.message);
      throw error;
    }
  }

  /**
   * Adiciona uma nova configuração de bot
   * @param {Object} config - Configuração completa do bot
   * @returns {Promise<number>} ID do bot criado
   */
  static async addBotConfig(config) {
    try {
      const botId = await this.generateBotId();

      // Garante que os campos de rastreamento de ordens sejam sempre incluídos
      const newBotConfig = {
        ...config,
        // Campos de rastreamento de ordens (gerenciados pelo sistema)
        botClientOrderId: config.botClientOrderId || Math.floor(Math.random() * 10000),
        orderCounter: config.orderCounter || 0,
        status: 'stopped', // Status inicial
        nextValidationAt: new Date(Date.now() + 60000).toISOString() // Próxima validação em 60s
      };

      const configJson = JSON.stringify(newBotConfig);
      const now = new Date().toISOString();

      await ConfigManagerSQLite.dbService.run(
        'INSERT INTO bot_configs (botId, config, createdAt, updatedAt) VALUES (?, ?, ?, ?)',
        [botId, configJson, now, now]
      );

      console.log(`✅ [CONFIG_SQLITE] Bot criado com ID: ${botId} e botClientOrderId: ${newBotConfig.botClientOrderId}`);

      // Invalida cache após criação
      ConfigManagerSQLite.invalidateCache();

      return botId;
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao criar bot:`, error.message);
      throw error;
    }
  }

  /**
   * Remove configuração de um bot por ID e todas suas ordens
   * @param {number} botId - ID único do bot
   */
  static async removeBotConfigById(botId) {
    try {
      // Primeiro remove todas as ordens do bot
      const { default: OrdersService } = await import('../Services/OrdersService.js');
      const removedOrdersCount = await OrdersService.removeOrdersByBotId(botId);

      // Depois remove a configuração do bot
      const result = await ConfigManagerSQLite.dbService.run(
        'DELETE FROM bot_configs WHERE botId = ?',
        [botId]
      );

      if (result.changes > 0) {
        console.log(`✅ [CONFIG_SQLITE] Bot ${botId} removido com sucesso (${removedOrdersCount} ordens removidas)`);

        // Invalida cache após remoção
        ConfigManagerSQLite.invalidateCache();
      } else {
        console.log(`ℹ️ [CONFIG_SQLITE] Bot ${botId} não encontrado para remoção (${removedOrdersCount} ordens removidas)`);
      }
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao remover bot ${botId}:`, error.message);
      throw error;
    }
  }

  /**
   * Atualiza status de um bot por ID
   * @param {number} botId - ID único do bot
   * @param {string} status - Novo status
   * @param {string} startTime - Tempo de início (opcional)
   */
  static async updateBotStatusById(botId, status, startTime = null) {
    try {
      const currentConfig = await this.getBotConfigById(botId);
      if (!currentConfig) {
        throw new Error(`Bot com ID ${botId} não encontrado`);
      }

      const updatedConfig = {
        ...currentConfig,
        status: status,
        startTime: startTime || currentConfig.startTime
      };

      await this.updateBotConfigById(botId, updatedConfig);
      Logger.debug(`✅ [CONFIG_SQLITE] Status do bot ${botId} atualizado para: ${status}`);
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao atualizar status do bot ${botId}:`, error.message);
      throw error;
    }
  }

  /**
   * Gera ID único para ordem
   * @param {number} botId - ID do bot (não usado no clientId final)
   * @param {number} botClientOrderId - botClientOrderId do bot
   * @param {number} orderCounter - Contador de ordens
   * @returns {number} ID único da ordem como número inteiro
   */
  static generateOrderId(botId, botClientOrderId, orderCounter) {
    // Concatena botClientOrderId + orderCounter para manter compatibilidade com validações
    // Exemplo: botClientOrderId=730, orderCounter=1 → 7301
    // Exemplo: botClientOrderId=870, orderCounter=2 → 8702
    // O botId não é incluído no clientId final para manter a lógica de validação
    return parseInt(`${botClientOrderId}${orderCounter}`);
  }

  /**
   * Incrementa contador de ordens de um bot
   * @param {number} botId - ID do bot
   * @returns {Promise<number>} Novo valor do contador
   */
  static async incrementOrderCounter(botId) {
    try {
      const currentConfig = await this.getBotConfigById(botId);
      if (!currentConfig) {
        throw new Error(`Bot com ID ${botId} não encontrado`);
      }

      const newCounter = (currentConfig.orderCounter || 0) + 1;
      await this.updateBotConfigById(botId, { orderCounter: newCounter });

      return newCounter;
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao incrementar contador do bot ${botId}:`, error.message);
      throw error;
    }
  }

  /**
   * Obtém próximo ID de ordem para um bot
   * @param {number} botId - ID do bot
   * @returns {Promise<string>} Próximo ID de ordem
   */
  static async getNextOrderId(botId) {
    try {
      const currentConfig = await this.getBotConfigById(botId);
      if (!currentConfig) {
        throw new Error(`Bot com ID ${botId} não encontrado`);
      }

      const newCounter = await this.incrementOrderCounter(botId);
      return this.generateOrderId(botId, currentConfig.botClientOrderId, newCounter);
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao obter próximo ID de ordem para bot ${botId}:`, error.message);
      throw error;
    }
  }

  /**
   * Remove configuração de um bot por botName
   * @param {string} botName - Nome único do bot
   */
  static async removeBotConfigByBotName(botName) {
    try {
      const configs = await this.loadConfigs();
      const configToRemove = configs.find(config => config.botName === botName);

      if (configToRemove) {
        await this.removeBotConfigById(configToRemove.id);
        console.log(`✅ [CONFIG_SQLITE] Bot ${botName} removido com sucesso`);
      } else {
        console.log(`ℹ️ [CONFIG_SQLITE] Bot ${botName} não encontrado para remoção`);
      }
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao remover bot ${botName}:`, error.message);
      throw error;
    }
  }

  /**
   * Verifica se um bot pode ser iniciado
   * @param {number} botId - ID único do bot
   * @returns {Promise<boolean>} True se pode ser iniciado
   */
  static async canStartBotById(botId) {
    try {
      const config = await this.getBotConfigById(botId);
      if (!config) return false;

      // Verifica se o bot está habilitado e não está rodando
      return config.enabled && config.status !== 'running';
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao verificar se bot ${botId} pode ser iniciado:`, error.message);
      return false;
    }
  }

  /**
   * Obtém status de um bot por ID
   * @param {number} botId - ID único do bot
   * @returns {Promise<string|null>} Status do bot ou null
   */
  static async getBotStatusById(botId) {
    try {
      const config = await this.getBotConfigById(botId);
      if (!config) return null;

      return config.status || 'stopped';
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao obter status do bot ${botId}:`, error.message);
      return null;
    }
  }

  /**
   * Obtém status completo de um bot por ID
   * @param {number} botId - ID único do bot
   * @returns {Promise<Object|null>} Status completo do bot ou null
   */
  static async getBotStatusCompleteById(botId) {
    try {
      const config = await this.getBotConfigById(botId);
      if (!config) return null;

      return {
        id: config.id,
        botName: config.botName,
        strategyName: config.strategyName,
        status: config.status || 'stopped',
        startTime: config.startTime,
        isRunning: config.status === 'running',
        config: config
      };
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao obter status completo do bot ${botId}:`, error.message);
      return null;
    }
  }

  /**
   * Limpa status de erro de um bot
   * @param {number} botId - ID único do bot
   */
  static async clearErrorStatus(botId) {
    try {
      const currentConfig = await this.getBotConfigById(botId);
      if (!currentConfig) return;

      if (currentConfig.status === 'error') {
        await this.updateBotStatusById(botId, 'stopped');
        console.log(`✅ [CONFIG_SQLITE] Status de erro do bot ${botId} limpo`);
      }
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao limpar status de erro do bot ${botId}:`, error.message);
    }
  }

  /**
   * Obtém todos os nomes de estratégias
   * @returns {Promise<Array>} Array de nomes de estratégias
   */
  static async getAllStrategyNames() {
    try {
      const configs = await this.loadConfigs();
      const strategyNames = [...new Set(configs.map(config => config.strategyName))];
      return strategyNames;
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao obter nomes de estratégias:`, error.message);
      return [];
    }
  }

  /**
   * Obtém todos os nomes de bots
   * @returns {Promise<Array>} Array de nomes de bots
   */
  static async getAllBotNames() {
    try {
      const configs = await this.loadConfigs();
      return configs.map(config => config.botName);
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao obter nomes de bots:`, error.message);
      return [];
    }
  }

  /**
   * Valida configuração de um bot
   * @param {Object} config - Configuração do bot
   * @returns {Promise<boolean>} True se válida
   */
  static async validateConfig(config) {
    try {
      // Validações básicas
      if (!config.botName || config.botName.trim() === '') {
        return false;
      }

      if (!config.apiKey || !config.apiSecret) {
        return false;
      }

      if (!config.strategyName) {
        return false;
      }

      return true;
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao validar configuração:`, error.message);
      return false;
    }
  }

  /**
   * Cria configuração padrão para uma estratégia
   * @param {string} strategyName - Nome da estratégia
   * @returns {Promise<Object>} Configuração padrão
   */
  static async createDefaultConfig(strategyName) {
    return {
      strategyName: strategyName,
      botName: `${strategyName} Bot`,
      apiKey: '',
      apiSecret: '',
      capitalPercentage: 20,
      time: '30m',
      enabled: true,
      maxNegativePnlStopPct: -10,
      minProfitPercentage: 10,
      maxSlippagePct: 0.5,
      executionMode: 'REALTIME',
      enableHybridStopStrategy: false,
      initialStopAtrMultiplier: 2.0,
      trailingStopAtrMultiplier: 1.5,
      partialTakeProfitAtrMultiplier: 1.5,
      partialTakeProfitPercentage: 50,
      enableTrailingStop: false,
      trailingStopDistance: 1.5,
      enablePostOnly: true,
      enableMarketFallback: true,
      enableOrphanOrderMonitor: true,
      enablePendingOrdersMonitor: true,
      maxOpenOrders: 5,
      leverageLimit: 10, // Alavancagem padrão da conta
      authorizedTokens: [], // Lista de tokens autorizados (vazio = todos os tokens)
      botClientOrderId: Math.floor(Math.random() * 10000),
      orderCounter: 0,
      status: 'stopped'
    };
  }
}

export default ConfigManagerSQLite;
