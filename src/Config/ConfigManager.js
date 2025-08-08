import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Gerenciador de configurações persistentes para instâncias de bots
 * Gerencia todas as configurações em um arquivo JSON em vez de variáveis de ambiente
 */
class ConfigManager {
  static CONFIG_FILE_PATH = path.join(process.cwd(), 'persistence', 'bot_configs.json');
  
  /**
   * Gera um ID único para um novo bot
   * @returns {number} ID único do bot
   */
  static generateBotId() {
    const configs = this.loadConfigs();
    if (configs.length === 0) {
      return 1;
    }
    
    // Encontra o maior ID existente e adiciona 1
    const maxId = Math.max(...configs.map(config => config.id || 0));
    return maxId + 1;
  }
  
  /**
   * Carrega todas as configurações do arquivo JSON
   * @returns {Array} Array de configurações de bots
   */
  static loadConfigs() {
    try {
      // Cria o diretório se não existir
      const configDir = path.dirname(this.CONFIG_FILE_PATH);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      // Se o arquivo não existir, cria com array vazio
      if (!fs.existsSync(this.CONFIG_FILE_PATH)) {
        const defaultConfigs = [];
        fs.writeFileSync(this.CONFIG_FILE_PATH, JSON.stringify(defaultConfigs, null, 2));
        return defaultConfigs;
      }
      
      const configData = fs.readFileSync(this.CONFIG_FILE_PATH, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      console.error('Erro ao carregar configurações:', error.message);
      return [];
    }
  }
  
  /**
   * Salva configurações no arquivo JSON
   * @param {Array} configs - Array de configurações para salvar
   */
  static saveConfigs(configs) {
    try {
      console.log(`💾 [CONFIG] Iniciando salvamento de ${configs.length} configurações...`);
      
      // Cria o diretório se não existir
      const configDir = path.dirname(this.CONFIG_FILE_PATH);
      if (!fs.existsSync(configDir)) {
        console.log(`📁 [CONFIG] Criando diretório: ${configDir}`);
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      console.log(`📄 [CONFIG] Salvando em: ${this.CONFIG_FILE_PATH}`);
      fs.writeFileSync(this.CONFIG_FILE_PATH, JSON.stringify(configs, null, 2));
      console.log(`✅ [CONFIG] Configurações salvas com sucesso`);
    } catch (error) {
      console.error('❌ [CONFIG] Erro ao salvar configurações:', error.message);
      throw error;
    }
  }
  
  /**
   * Obtém configuração de um bot específico
   * @param {string} strategyName - Nome da estratégia (ex: 'DEFAULT', 'ALPHA_FLOW')
   * @returns {Object|null} Configuração do bot ou null se não encontrado
   */
  static getBotConfig(strategyName) {
    const configs = this.loadConfigs();
    return configs.find(config => config.strategyName === strategyName) || null;
  }

  /**
   * Obtém configuração de um bot por botName
   * @param {string} botName - Nome único do bot
   * @returns {Object|null} Configuração do bot ou null se não encontrado
   */
  static getBotConfigByBotName(botName) {
    const configs = this.loadConfigs();
    return configs.find(config => config.botName === botName) || null;
  }

  /**
   * Obtém configuração de um bot por ID
   * @param {number} botId - ID único do bot
   * @returns {Object|null} Configuração do bot ou null se não encontrado
   */
  static getBotConfigById(botId) {
    const configs = this.loadConfigs();
    return configs.find(config => config.id === botId) || null;
  }

  /**
   * Obtém configuração de um bot por botClientOrderId
   * @param {string|number} botClientOrderId - botClientOrderId do bot
   * @returns {Object|null} Configuração do bot ou null se não encontrado
   */
  static getBotConfigByClientOrderId(botClientOrderId) {
    const configs = this.loadConfigs();
    return configs.find(config => config.botClientOrderId == botClientOrderId) || null;
  }

  /**
   * Atualiza configuração de um bot específico
   * @param {string} strategyName - Nome da estratégia
   * @param {Object} newConfig - Nova configuração
   */
  static updateBotConfig(strategyName, newConfig) {
    const configs = this.loadConfigs();
    const existingIndex = configs.findIndex(config => config.strategyName === strategyName);
    
    if (existingIndex !== -1) {
      // Atualiza configuração existente
      configs[existingIndex] = { ...configs[existingIndex], ...newConfig };
    } else {
      // Adiciona nova configuração
      configs.push({ strategyName, ...newConfig });
    }
    
    this.saveConfigs(configs);
  }

  /**
   * Atualiza configuração de um bot por botName
   * @param {string} botName - Nome único do bot
   * @param {Object} newConfig - Nova configuração
   */
  static updateBotConfigByBotName(botName, newConfig) {
    const configs = this.loadConfigs();
    const existingIndex = configs.findIndex(config => config.botName === botName);
    
    if (existingIndex !== -1) {
      // Atualiza configuração existente
      configs[existingIndex] = { ...configs[existingIndex], ...newConfig };
      this.saveConfigs(configs);
    } else {
      throw new Error(`Bot com nome ${botName} não encontrado`);
    }
  }

  /**
   * Atualiza configuração de um bot por ID
   * @param {number} botId - ID único do bot
   * @param {Object} newConfig - Nova configuração
   */
  static updateBotConfigById(botId, newConfig) {
    console.log(`🔄 [CONFIG] Iniciando atualização do bot ID: ${botId}`);
    
    try {
      const configs = this.loadConfigs();
      console.log(`📊 [CONFIG] Configurações carregadas: ${configs.length} bots`);
      
      const configIndex = configs.findIndex(config => config.id === botId);
      console.log(`🔍 [CONFIG] Índice encontrado: ${configIndex}`);
      
      if (configIndex !== -1) {
        const currentConfig = configs[configIndex];
        console.log(`📝 [CONFIG] Configuração atual encontrada: ${currentConfig.botName}`);
        
        // Preserva os campos de rastreamento de ordens se não estiverem no newConfig
        const updatedConfig = {
          ...currentConfig,
          ...newConfig,
          // Garante que os campos de rastreamento sejam preservados
          botClientOrderId: newConfig.botClientOrderId || currentConfig.botClientOrderId,
          orderCounter: newConfig.orderCounter !== undefined ? newConfig.orderCounter : currentConfig.orderCounter
        };
        
        console.log(`💾 [CONFIG] Salvando configuração atualizada...`);
        configs[configIndex] = updatedConfig;
        this.saveConfigs(configs);
        console.log(`✅ [CONFIG] Bot ${botId} atualizado com sucesso`);
      } else {
        console.error(`❌ [CONFIG] Bot com ID ${botId} não encontrado`);
        throw new Error(`Bot com ID ${botId} não encontrado`);
      }
    } catch (error) {
      console.error(`❌ [CONFIG] Erro ao atualizar bot ${botId}:`, error.message);
      throw error;
    }
  }

  /**
   * Adiciona uma nova configuração de bot
   * @param {Object} config - Configuração completa do bot
   * @returns {number} ID do bot criado
   */
  static addBotConfig(config) {
    const configs = this.loadConfigs();
    const botId = this.generateBotId();
    
    // Garante que os campos de rastreamento de ordens sejam sempre incluídos
    const newBotConfig = {
      id: botId,
      ...config,
      // Campos de rastreamento de ordens (gerenciados pelo sistema)
      botClientOrderId: config.botClientOrderId || Math.floor(Math.random() * 10000),
      orderCounter: config.orderCounter || 0,
      createdAt: new Date().toISOString(),
      status: 'stopped', // Status inicial
      nextValidationAt: new Date(Date.now() + 60000).toISOString() // Próxima validação em 60s
    };
    
    configs.push(newBotConfig);
    this.saveConfigs(configs);
    
    console.log(`✅ Bot criado com ID: ${botId} e botClientOrderId: ${newBotConfig.botClientOrderId}`);
    return botId;
  }
  
  /**
   * Remove configuração de um bot
   * @param {string} strategyName - Nome da estratégia
   */
  static removeBotConfig(strategyName) {
    const configs = this.loadConfigs();
    const filteredConfigs = configs.filter(config => config.strategyName !== strategyName);
    this.saveConfigs(filteredConfigs);
  }

  /**
   * Remove configuração de um bot por botName
   * @param {string} botName - Nome único do bot
   */
  static removeBotConfigByBotName(botName) {
    const configs = this.loadConfigs();
    const filteredConfigs = configs.filter(config => config.botName !== botName);
    this.saveConfigs(filteredConfigs);
  }

  /**
   * Remove configuração de um bot por ID
   * @param {number} botId - ID único do bot
   */
  static removeBotConfigById(botId) {
    const configs = this.loadConfigs();
    const filteredConfigs = configs.filter(config => config.id !== botId);
    this.saveConfigs(filteredConfigs);
    console.log(`🗑️ [CONFIG] Bot ID ${botId} removido com sucesso`);
  }

  /**
   * Atualiza o status de um bot (ativo/inativo)
   * @param {string} strategyName - Nome da estratégia
   * @param {string} status - Status do bot ('running', 'stopped', 'starting', 'error')
   * @param {string} startTime - Timestamp de início (opcional)
   */
  static updateBotStatus(strategyName, status, startTime = null) {
    const configs = this.loadConfigs();
    const configIndex = configs.findIndex(config => config.strategyName === strategyName);
    
    if (configIndex !== -1) {
      configs[configIndex].status = status;
      if (startTime) {
        configs[configIndex].startTime = startTime;
      }
      this.saveConfigs(configs);
    }
  }

  /**
   * Atualiza o status de um bot por botName
   * @param {string} botName - Nome único do bot
   * @param {string} status - Status do bot ('running', 'stopped', 'starting', 'error')
   * @param {string} startTime - Timestamp de início (opcional)
   */
  static updateBotStatusByBotName(botName, status, startTime = null) {
    const configs = this.loadConfigs();
    const configIndex = configs.findIndex(config => config.botName === botName);
    
    if (configIndex !== -1) {
      configs[configIndex].status = status;
      if (startTime) {
        configs[configIndex].startTime = startTime;
      }
      this.saveConfigs(configs);
    } else {
      throw new Error(`Bot com nome ${botName} não encontrado`);
    }
  }

  /**
   * Atualiza o status de um bot por ID
   * @param {number} botId - ID único do bot
   * @param {string} status - Status do bot ('running', 'stopped', 'starting', 'error')
   * @param {string} startTime - Timestamp de início (opcional)
   */
  static updateBotStatusById(botId, status, startTime = null) {
    const configs = this.loadConfigs();
    const configIndex = configs.findIndex(config => config.id === botId);
    
    if (configIndex !== -1) {
      configs[configIndex].status = status;
      if (startTime) {
        configs[configIndex].startTime = startTime;
      }
      this.saveConfigs(configs);
    } else {
      throw new Error(`Bot com ID ${botId} não encontrado`);
    }
  }

  /**
   * Obtém todos os bots com status ativo
   * @returns {Array} Array de bots ativos
   */
  static getActiveBots() {
    const configs = this.loadConfigs();
    return configs.filter(config => config.status === 'running');
  }

  /**
   * Obtém todos os bots com status específico
   * @param {string} status - Status para filtrar
   * @returns {Array} Array de bots com o status especificado
   */
  static getBotsByStatus(status) {
    const configs = this.loadConfigs();
    return configs.filter(config => config.status === status);
  }

  /**
   * Verifica se um bot está ativo
   * @param {string} strategyName - Nome da estratégia
   * @returns {boolean} True se o bot estiver ativo
   */
  static isBotActive(strategyName) {
    const config = this.getBotConfig(strategyName);
    return config && config.status === 'running';
  }

  /**
   * Verifica se um bot está ativo por botName
   * @param {string} botName - Nome único do bot
   * @returns {boolean} True se o bot estiver ativo
   */
  static isBotActiveByBotName(botName) {
    const config = this.getBotConfigByBotName(botName);
    return config && config.status === 'running';
  }

  /**
   * Verifica se um bot está ativo por ID
   * @param {number} botId - ID único do bot
   * @returns {boolean} True se o bot estiver ativo
   */
  static isBotActiveById(botId) {
    const config = this.getBotConfigById(botId);
    return config && config.status === 'running';
  }
  
  /**
   * Verifica se um bot pode ser iniciado (não está rodando)
   * @param {number} botId - ID único do bot
   * @returns {boolean} True se o bot pode ser iniciado
   */
  static canStartBotById(botId) {
    const config = this.getBotConfigById(botId);
    if (!config) return false;
    
    // Pode iniciar se estiver stopped, error, ou starting
    return ['stopped', 'error', 'starting'].includes(config.status);
  }

  /**
   * Obtém o status de um bot
   * @param {string} strategyName - Nome da estratégia
   * @returns {string|null} Status do bot ou null se não encontrado
   */
  static getBotStatus(strategyName) {
    const config = this.getBotConfig(strategyName);
    return config ? config.status : null;
  }

  /**
   * Obtém o status de um bot por botName
   * @param {string} botName - Nome único do bot
   * @returns {string|null} Status do bot ou null se não encontrado
   */
  static getBotStatusByBotName(botName) {
    const config = this.getBotConfigByBotName(botName);
    return config ? config.status : null;
  }

  /**
   * Obtém o status de um bot por ID
   * @param {number} botId - ID único do bot
   * @returns {string|null} Status do bot ou null se não encontrado
   */
  static getBotStatusById(botId) {
    const config = this.getBotConfigById(botId);
    return config ? config.status : null;
  }

  /**
   * Limpa status de erro para bots que estavam rodando antes da reinicialização
   * @param {number} botId - ID único do bot
   */
  static clearErrorStatus(botId) {
    const configs = this.loadConfigs();
    const configIndex = configs.findIndex(config => config.id === botId);
    
    if (configIndex !== -1 && configs[configIndex].status === 'error') {
      configs[configIndex].status = 'stopped';
      this.saveConfigs(configs);
      console.log(`🔄 [CONFIG] Status de erro limpo para bot ${botId}`);
    }
  }
  
  /**
   * Lista todas as estratégias configuradas
   * @returns {Array} Array com nomes das estratégias
   */
  static getAllStrategyNames() {
    const configs = this.loadConfigs();
    return configs.map(config => config.strategyName);
  }

  /**
   * Lista todos os nomes de bots configurados
   * @returns {Array} Array com nomes dos bots
   */
  static getAllBotNames() {
    const configs = this.loadConfigs();
    return configs.map(config => config.botName);
  }
  
  /**
   * Valida se uma configuração está completa
   * @param {Object} config - Configuração para validar
   * @returns {Object} Resultado da validação
   */
  static validateConfig(config) {
    const requiredFields = ['capitalPercentage'];
    const missingFields = requiredFields.filter(field => {
      const value = config[field];
      return value === undefined || value === null || value === '';
    });
    
    if (missingFields.length > 0) {
      return {
        isValid: false,
        errors: missingFields.map(field => `Campo obrigatório ausente: ${field}`)
      };
    }
    
    // Validações específicas
    const errors = [];
    
    if (config.capitalPercentage <= 0 || config.capitalPercentage > 100) {
      errors.push('Percentual de capital deve estar entre 0 e 100');
    }
    
    // Validações de API keys - obrigatórias para bots ativos
    if (!config.apiKey || config.apiKey.trim() === '') {
      errors.push('API Key é obrigatória');
    } else if (config.apiKey.length < 10) {
      errors.push('API Key muito curta');
    }
    
    if (!config.apiSecret || config.apiSecret.trim() === '') {
      errors.push('API Secret é obrigatório');
    } else if (config.apiSecret.length < 10) {
      errors.push('API Secret muito curto');
    }
    
    // Validações de configurações opcionais
    if (config.trailingStopDistance !== undefined && config.trailingStopDistance <= 0) {
      errors.push('Distância do Trailing Stop deve ser maior que zero');
    }
    
    if (config.partialTakeProfitPercentage !== undefined && (config.partialTakeProfitPercentage <= 0 || config.partialTakeProfitPercentage > 100)) {
      errors.push('Percentual de Take Profit parcial deve estar entre 0 e 100');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Cria uma configuração padrão para uma estratégia
   * @param {string} strategyName - Nome da estratégia
   * @returns {Object} Configuração padrão
   */
  static createDefaultConfig(strategyName) {
    return {
      strategyName,
      botName: `${strategyName} Bot`,
      apiKey: '',
      apiSecret: '',
      capitalPercentage: 20, // Valor padrão
      time: '30m', // Valor padrão
      enabled: true, // Sempre habilitado, controle via botão Iniciar/Pausar
      executionMode: 'REALTIME', // Valor padrão
      // Configurações de Stop Loss
      maxNegativePnlStopPct: -10, // Valor padrão
      minProfitPercentage: 0.5, // Valor padrão (0.5% = apenas vs taxas)
      // Configurações da Estratégia Híbrida de Stop Loss (ATR)
      enableHybridStopStrategy: false, // Valor padrão
      initialStopAtrMultiplier: 2.0, // Valor padrão
      trailingStopAtrMultiplier: 1.5, // Valor padrão
      partialTakeProfitAtrMultiplier: 3.0, // Valor padrão
      partialTakeProfitPercentage: 50, // Valor padrão
      // Configurações de Trailing Stop
      enableTrailingStop: false, // Valor padrão
      trailingStopDistance: 1.5, // Valor padrão
      // Configurações de Ordem (sempre habilitadas)
      enablePostOnly: true,
      enableMarketFallback: true,
      // Configurações de Monitoramento (sempre habilitadas)
      enableOrphanOrderMonitor: true,
      enablePendingOrdersMonitor: true,
      // Configurações de Rastreamento de Ordens
      botClientOrderId: Math.floor(Math.random() * 10000), // ID único para o bot (1-9999)
      orderCounter: 0, // Contador de ordens criadas pelo bot
      // Configurações de Limite de Ordens
      maxOpenOrders: 5, // Máximo de ordens ativas de uma vez
      maxSlippagePct: 0.5 // Adicionado
    };
  }

  /**
   * Cria uma configuração padrão para um bot
   * @param {string} botName - Nome único do bot
   * @param {string} strategyName - Nome da estratégia (opcional, será gerado se não fornecido)
   * @returns {Object} Configuração padrão
   */
  static createDefaultConfigByBotName(botName, strategyName = null) {
    // Se strategyName não foi fornecido, gera baseado no botName
    const defaultStrategyName = strategyName || botName.replace(/\s+/g, '_').toUpperCase();
    
    return {
      strategyName: defaultStrategyName,
      botName,
      apiKey: '',
      apiSecret: '',
      capitalPercentage: 20, // Valor padrão
      time: '30m', // Valor padrão
      enabled: true, // Sempre habilitado, controle via botão Iniciar/Pausar
      executionMode: 'REALTIME', // Valor padrão
      // Configurações de Stop Loss
      maxNegativePnlStopPct: -10, // Valor padrão
      minProfitPercentage: 0.5, // Valor padrão (0.5% = apenas vs taxas)
      // Configurações da Estratégia Híbrida de Stop Loss (ATR)
      enableHybridStopStrategy: false, // Valor padrão
      initialStopAtrMultiplier: 2.0, // Valor padrão
      trailingStopAtrMultiplier: 1.5, // Valor padrão
      partialTakeProfitAtrMultiplier: 3.0, // Valor padrão
      partialTakeProfitPercentage: 50, // Valor padrão
      // Configurações de Trailing Stop
      enableTrailingStop: false, // Valor padrão
      trailingStopDistance: 1.5, // Valor padrão
      // Configurações de Ordem (sempre habilitadas)
      enablePostOnly: true,
      enableMarketFallback: true,
      // Configurações de Monitoramento (sempre habilitadas)
      enableOrphanOrderMonitor: true,
      enablePendingOrdersMonitor: true,
      // Configurações de Rastreamento de Ordens
      botClientOrderId: Math.floor(Math.random() * 10000), // ID único para o bot (1-9999)
      orderCounter: 0, // Contador de ordens criadas pelo bot
      // Configurações de Limite de Ordens
      maxOpenOrders: 5, // Máximo de ordens ativas de uma vez
      maxSlippagePct: 0.5 // Adicionado
    };
  }

  /**
   * Gera um ID único para uma ordem do bot
   * @param {number} botId - ID do bot
   * @param {number} botClientOrderId - ID único do bot para ordens
   * @param {number} orderCounter - Contador atual de ordens
   * @returns {number} ID único da ordem como Int (ex: 1548001)
   */
  static generateOrderId(botId, botClientOrderId, orderCounter) {
    // Concatena botClientOrderId + orderCounter como números
    // Exemplo: botClientOrderId=1548, orderCounter=1 → 1548001
    // Exemplo: botClientOrderId=1548, orderCounter=12 → 1548012
    // Exemplo: botClientOrderId=1548, orderCounter=1234 → 15481234
    // Suporte ilimitado: botClientOrderId pode ter até 4 dígitos, orderCounter ilimitado
    return parseInt(`${botClientOrderId}${orderCounter}`);
  }

  /**
   * Incrementa o contador de ordens de um bot
   * @param {number} botId - ID do bot
   * @returns {number} Novo valor do contador
   */
  static incrementOrderCounter(botId) {
    const configs = this.loadConfigs();
    const configIndex = configs.findIndex(config => config.id === botId);
    
    if (configIndex !== -1) {
      configs[configIndex].orderCounter = (configs[configIndex].orderCounter || 0) + 1;
      this.saveConfigs(configs);
      return configs[configIndex].orderCounter;
    }
    
    return 0;
  }

  /**
   * Obtém o próximo ID de ordem para um bot
   * @param {number} botId - ID do bot
   * @returns {string} Próximo ID de ordem (ex: "1548-1")
   */
  static getNextOrderId(botId) {
    const config = this.getBotConfigById(botId);
    if (!config) {
      throw new Error(`Bot com ID ${botId} não encontrado`);
    }
    
    const newCounter = this.incrementOrderCounter(botId);
    return this.generateOrderId(botId, config.botClientOrderId, newCounter);
  }

  /**
   * Obtém o contador atual de ordens de um bot
   * @param {number} botId - ID do bot
   * @returns {number} Contador atual de ordens
   */
  static getOrderCounter(botId) {
    const config = this.getBotConfigById(botId);
    return config ? (config.orderCounter || 0) : 0;
  }

  /**
   * Reseta o contador de ordens de um bot
   * @param {number} botId - ID do bot
   */
  static resetOrderCounter(botId) {
    const configs = this.loadConfigs();
    const configIndex = configs.findIndex(config => config.id === botId);
    
    if (configIndex !== -1) {
      configs[configIndex].orderCounter = 0;
      this.saveConfigs(configs);
      console.log(`🔄 [CONFIG] Contador de ordens resetado para bot ${botId}`);
    }
  }

  /**
   * Obtém todas as ordens de um bot específico (baseado no botClientOrderId)
   * @param {number} botId - ID do bot
   * @param {Array} orders - Lista de ordens da exchange
   * @returns {Array} Ordens criadas pelo bot específico
   */
  static getBotOrders(botId, orders) {
    const config = this.getBotConfigById(botId);
    if (!config || !config.botClientOrderId) {
      return [];
    }
    
    return orders.filter(order => {
      if (!order.clientId) return false;
      
      // Verifica se o clientId começa com o botClientOrderId do bot
      const clientIdStr = order.clientId.toString();
      const botClientOrderIdStr = config.botClientOrderId.toString();
      
      // Verifica se o clientId começa com o botClientOrderId
      return clientIdStr.startsWith(botClientOrderIdStr);
    });
  }
}

export default ConfigManager; 