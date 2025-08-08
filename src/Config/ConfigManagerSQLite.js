import DatabaseService from '../Services/DatabaseService.js';

/**
 * ConfigManager SQLite - Versão que usa banco de dados SQLite
 * 
 * Gerencia todas as configurações dos bots no banco de dados SQLite
 * em vez de arquivos JSON
 */
class ConfigManagerSQLite {
  static dbService = null;

  /**
   * Inicializa o ConfigManager com o DatabaseService
   * @param {DatabaseService} dbService - Instância do DatabaseService
   */
  static initialize(dbService) {
    ConfigManagerSQLite.dbService = dbService;
    console.log('🔧 [CONFIG_SQLITE] ConfigManager SQLite inicializado');
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
      const results = await ConfigManagerSQLite.dbService.getAll(
        'SELECT botId, config, createdAt, updatedAt FROM bot_configs ORDER BY botId'
      );
      
      return results.map(row => {
        const config = JSON.parse(row.config);
        return {
          id: row.botId,
          ...config,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        };
      });
    } catch (error) {
      console.error('❌ [CONFIG_SQLITE] Erro ao carregar configurações:', error.message);
      return [];
    }
  }

  /**
   * Salva configurações no banco de dados
   * @param {Array} configs - Array de configurações para salvar
   */
  static async saveConfigs(configs) {
    try {
      console.log(`💾 [CONFIG_SQLITE] Iniciando salvamento de ${configs.length} configurações...`);
      
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
      
      console.log(`✅ [CONFIG_SQLITE] Configurações salvas com sucesso`);
    } catch (error) {
      console.error('❌ [CONFIG_SQLITE] Erro ao salvar configurações:', error.message);
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
    console.log(`🔄 [CONFIG_SQLITE] Iniciando atualização do bot ID: ${botId}`);
    
    try {
      const currentConfig = await this.getBotConfigById(botId);
      if (!currentConfig) {
        throw new Error(`Bot com ID ${botId} não encontrado`);
      }
      
      console.log(`📝 [CONFIG_SQLITE] Configuração atual encontrada: ${currentConfig.botName}`);
      
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
      
      console.log(`✅ [CONFIG_SQLITE] Bot ${botId} atualizado com sucesso`);
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
      return botId;
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao criar bot:`, error.message);
      throw error;
    }
  }

  /**
   * Remove configuração de um bot por ID
   * @param {number} botId - ID único do bot
   */
  static async removeBotConfigById(botId) {
    try {
      const result = await ConfigManagerSQLite.dbService.run(
        'DELETE FROM bot_configs WHERE botId = ?',
        [botId]
      );
      
      if (result.changes > 0) {
        console.log(`✅ [CONFIG_SQLITE] Bot ${botId} removido com sucesso`);
      } else {
        console.log(`ℹ️ [CONFIG_SQLITE] Bot ${botId} não encontrado para remoção`);
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
      console.log(`✅ [CONFIG_SQLITE] Status do bot ${botId} atualizado para: ${status}`);
    } catch (error) {
      console.error(`❌ [CONFIG_SQLITE] Erro ao atualizar status do bot ${botId}:`, error.message);
      throw error;
    }
  }

  /**
   * Gera ID único para ordem
   * @param {number} botId - ID do bot
   * @param {number} botClientOrderId - botClientOrderId do bot
   * @param {number} orderCounter - Contador de ordens
   * @returns {string} ID único da ordem
   */
  static generateOrderId(botId, botClientOrderId, orderCounter) {
    return `${botId}_${botClientOrderId}_${orderCounter}`;
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
}

export default ConfigManagerSQLite;
