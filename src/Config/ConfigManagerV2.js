import { ConfigAdapter } from '../Persistence/index.js';

/**
 * ConfigManager V2 - Usando Sistema de Persistência Isolado
 * 
 * Esta é a nova versão do ConfigManager que usa o sistema de persistência
 * isolado, facilitando migração para outras tecnologias.
 * 
 * Todas as operações são delegadas para o ConfigAdapter, que gerencia
 * a persistência de forma transparente.
 */
class ConfigManagerV2 {
  /**
   * Gera um ID único para um novo bot
   * @returns {number} ID único do bot
   */
  static generateBotId() {
    return ConfigAdapter.generateBotId();
  }
  
  /**
   * Carrega todas as configurações
   * @returns {Array} Array de configurações de bots
   */
  static loadConfigs() {
    return ConfigAdapter.loadConfigs();
  }
  
  /**
   * Salva configurações
   * @param {Array} configs - Array de configurações para salvar
   */
  static saveConfigs(configs) {
    ConfigAdapter.saveConfigs(configs);
  }
  
  /**
   * Obtém configuração de um bot específico
   * @param {string} strategyName - Nome da estratégia
   * @returns {Object|null} Configuração do bot ou null
   */
  static getBotConfig(strategyName) {
    return ConfigAdapter.getBotConfig(strategyName);
  }
  
  /**
   * Obtém configuração de um bot por ID
   * @param {number} botId - ID do bot
   * @returns {Object|null} Configuração do bot ou null
   */
  static getBotConfigById(botId) {
    return ConfigAdapter.getBotConfigById(botId);
  }
  
  /**
   * Obtém configuração de um bot por nome
   * @param {string} botName - Nome do bot
   * @returns {Object|null} Configuração do bot ou null
   */
  static getBotConfigByBotName(botName) {
    return ConfigAdapter.getBotConfigByBotName(botName);
  }
  
  /**
   * Adiciona uma nova configuração de bot
   * @param {Object} config - Configuração do bot
   * @returns {Object} Configuração salva com ID
   */
  static addBotConfig(config) {
    return ConfigAdapter.addBotConfig(config);
  }
  
  /**
   * Atualiza configuração de um bot
   * @param {number} botId - ID do bot
   * @param {Object} newConfig - Nova configuração
   * @returns {Object|null} Configuração atualizada ou null
   */
  static updateBotConfig(botId, newConfig) {
    return ConfigAdapter.updateBotConfig(botId, newConfig);
  }
  
  /**
   * Remove configuração de um bot
   * @param {number} botId - ID do bot
   * @returns {boolean} True se removido com sucesso
   */
  static removeBotConfig(botId) {
    return ConfigAdapter.removeBotConfig(botId);
  }
  
  /**
   * Remove configuração de um bot por nome
   * @param {string} botName - Nome do bot
   * @returns {boolean} True se removido com sucesso
   */
  static removeBotConfigByBotName(botName) {
    const config = this.getBotConfigByBotName(botName);
    if (config) {
      return this.removeBotConfig(config.id);
    }
    return false;
  }
  
  /**
   * Atualiza status de um bot
   * @param {number} botId - ID do bot
   * @param {string} status - Novo status
   * @param {string} startTime - Timestamp de início (opcional)
   * @returns {boolean} True se atualizado com sucesso
   */
  static updateBotStatus(botId, status, startTime = null) {
    return ConfigAdapter.updateBotStatus(botId, status, startTime);
  }
  
  /**
   * Obtém todos os bots ativos
   * @returns {Array} Array de bots ativos
   */
  static getActiveBots() {
    return ConfigAdapter.getActiveBots();
  }
  
  /**
   * Obtém estatísticas das configurações
   * @returns {Object} Estatísticas
   */
  static getStats() {
    return ConfigAdapter.getStats();
  }
  
  /**
   * Valida configuração de bot
   * @param {Object} config - Configuração para validar
   * @returns {Object} Resultado da validação
   */
  static validateConfig(config) {
    const errors = [];
    
    // Validações básicas
    if (!config.botName || config.botName.trim() === '') {
      errors.push('Nome do bot é obrigatório');
    }
    
    if (!config.strategyName || config.strategyName.trim() === '') {
      errors.push('Nome da estratégia é obrigatório');
    }
    
    if (!config.apiKey || config.apiKey.trim() === '') {
      errors.push('API Key é obrigatória');
    }
    
    if (!config.apiSecret || config.apiSecret.trim() === '') {
      errors.push('API Secret é obrigatório');
    }
    
    if (!config.capitalPercentage || config.capitalPercentage <= 0) {
      errors.push('Percentual de capital deve ser maior que 0');
    }
    
    if (!config.time || config.time.trim() === '') {
      errors.push('Timeframe é obrigatório');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Cria configuração padrão para uma estratégia
   * @param {string} strategyName - Nome da estratégia
   * @returns {Object} Configuração padrão
   */
  static createDefaultConfig(strategyName) {
    return {
      strategyName,
      botName: `Bot ${strategyName}`,
      apiKey: '',
      apiSecret: '',
      capitalPercentage: 20,
      time: '30m',
      enabled: true,
      executionMode: 'REALTIME',
      maxNegativePnlStopPct: -10,
      minProfitPercentage: 10,
      maxSlippagePct: 0.5,
      enableHybridStopStrategy: false,
      initialStopAtrMultiplier: 2,
      trailingStopAtrMultiplier: 1.5,
      partialTakeProfitAtrMultiplier: 3,
      partialTakeProfitPercentage: 50,
      enableTrailingStop: false,
      trailingStopDistance: 1.5,
      enablePostOnly: true,
      enableMarketFallback: true,
      enableOrphanOrderMonitor: true,
      enablePendingOrdersMonitor: true,
      maxOpenOrders: 5,
      status: 'stopped'
    };
  }
  
  /**
   * Obtém todos os nomes de estratégias
   * @returns {string[]} Array de nomes de estratégias
   */
  static getAllStrategyNames() {
    const configs = this.loadConfigs();
    return [...new Set(configs.map(config => config.strategyName))];
  }
  
  /**
   * Obtém todos os nomes de bots
   * @returns {string[]} Array de nomes de bots
   */
  static getAllBotNames() {
    const configs = this.loadConfigs();
    return configs.map(config => config.botName);
  }
  
  /**
   * Verifica se um bot está ativo
   * @param {number} botId - ID do bot
   * @returns {boolean} True se ativo
   */
  static isBotActiveById(botId) {
    const config = this.getBotConfigById(botId);
    return config && config.status === 'running';
  }
  
  /**
   * Verifica se um bot pode ser iniciado
   * @param {number} botId - ID do bot
   * @returns {boolean} True se pode ser iniciado
   */
  static canStartBotById(botId) {
    const config = this.getBotConfigById(botId);
    return config && config.enabled && config.status !== 'running';
  }
  
  /**
   * Limpa status de erro de um bot
   * @param {number} botId - ID do bot
   * @returns {boolean} True se limpo com sucesso
   */
  static clearErrorStatus(botId) {
    const config = this.getBotConfigById(botId);
    if (config && config.status === 'error') {
      return this.updateBotStatus(botId, 'stopped');
    }
    return false;
  }
}

export default ConfigManagerV2;
