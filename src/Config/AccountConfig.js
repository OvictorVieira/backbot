/**
 * Sistema de configuração para múltiplas contas
 * Gerencia as configurações de cada conta individualmente
 */
class AccountConfig {
  constructor() {
    this.accounts = new Map();
    this.isInitialized = false;
  }

  /**
   * Inicializa as configurações (deve ser chamado antes de usar)
   */
  async initialize() {
    if (!this.isInitialized) {
      await this.loadConfigurations();
      this.isInitialized = true;
    }
  }

  /**
   * Valida se as credenciais de uma conta são válidas
   * @param {string} botName - Nome do bot
   * @param {string} apiKey - API Key
   * @param {string} apiSecret - API Secret
   * @returns {object} - Resultado da validação
   */
  async validateCredentials(botName, apiKey, apiSecret) {
    try {
      // Validação básica das credenciais
      if (!apiKey || !apiSecret) {
        return {
          isValid: false,
          error: 'API Key ou Secret não fornecidos',
        };
      }

      if (apiKey.trim() === '' || apiSecret.trim() === '') {
        return {
          isValid: false,
          error: 'API Key ou Secret estão vazios',
        };
      }

      // Validação de formato (API keys geralmente têm comprimento específico)
      if (apiKey.length < 10 || apiSecret.length < 10) {
        return {
          isValid: false,
          error: 'API Key ou Secret muito curtos (formato inválido)',
        };
      }

      // Testa conexão com a API usando as credenciais fornecidas
      try {
        const AccountController = await import('../Controllers/AccountController.js');
        const accountData = await AccountController.default.get({
          apiKey: apiKey,
          apiSecret: apiSecret,
          strategy: 'DEFAULT', // Usa estratégia padrão para validação
        });

        if (!accountData) {
          return {
            isValid: false,
            error: 'Falha ao conectar com a API - dados da conta não obtidos',
          };
        }

        return {
          isValid: true,
          data: accountData,
        };
      } catch (error) {
        return {
          isValid: false,
          error: `Erro na conexão com a API: ${error.message}`,
        };
      }
    } catch (error) {
      return {
        isValid: false,
        error: `Erro na validação: ${error.message}`,
      };
    }
  }

  /**
   * Carrega as configurações das contas do .env com validação
   * @deprecated Este método não deve mais ser usado. Use addBotConfig() para adicionar bots individuais
   */
  async loadConfigurations() {
    console.log('\n⚠️ [DEPRECATED] AccountConfig.loadConfigurations() não deve mais ser usado!');
    console.log(
      '   Use addBotConfig() para adicionar bots individuais com suas próprias configurações.'
    );
    console.log(
      '   Cada bot deve ter suas próprias credenciais e configurações passadas via parâmetro.\n'
    );

    // Não carrega mais configurações do .env
    // Cada bot deve ser adicionado individualmente via addBotConfig()
  }

  /**
   * Adiciona uma configuração de bot individual
   * @param {string} botId - ID único do bot
   * @param {object} config - Configurações completas do bot
   */
  addBotConfig(botId, config) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error(`Bot ${botId}: API_KEY e API_SECRET são obrigatórios`);
    }

    console.log(`🤖 Adicionando bot: ${botId}`);

    this.accounts.set(botId, {
      id: botId,
      name: config.name || `Bot ${botId}`,
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      strategy: config.strategy || 'DEFAULT',
      enabled: config.enabled !== false,

      // Configurações específicas do bot
      capitalPercentage: Number(config.capitalPercentage) || 0,
      limitOrder: Number(config.limitOrder) || 100,
      time: config.time || '5m',

      // Configurações de trailing stop
      enableTrailingStop: config.enableTrailingStop !== false,
      enableHybridStopStrategy: config.enableHybridStopStrategy === true,
      trailingStopDistance: Number(config.trailingStopDistance) || 2.0,
      initialStopAtrMultiplier: Number(config.initialStopAtrMultiplier) || 2.0,
      takeProfitPartialAtrMultiplier: Number(config.partialTakeProfitAtrMultiplier) || 1.5,
      partialProfitPercentage: Number(config.partialTakeProfitPercentage) || 50,
      maxNegativePnlStopPct: Number(config.maxNegativePnlStopPct) || -10,
      minProfitPercentage: Number(config.minProfitPercentage) || 0.5,

      // Configurações específicas da estratégia
      ignoreBronzeSignals: config.ignoreBronzeSignals !== false,
      adxLength: Number(config.adxLength) || 14,
      adxThreshold: Number(config.adxThreshold) || 20,

      // Configurações avançadas da estratégia PRO_MAX
      adxAverageLength: Number(config.adxAverageLength) || 21,
      useRsiValidation: config.useRsiValidation !== false,
      useStochValidation: config.useStochValidation !== false,
      useMacdValidation: config.useMacdValidation !== false,
      rsiLength: Number(config.rsiLength) || 14,
      rsiAverageLength: Number(config.rsiAverageLength) || 14,
      rsiBullThreshold: Number(config.rsiBullThreshold) || 45,
      rsiBearThreshold: Number(config.rsiBearThreshold) || 55,
      stochKLength: Number(config.stochKLength) || 14,
      stochDLength: Number(config.stochDLength) || 3,
      stochSmooth: Number(config.stochSmooth) || 3,
      stochBullThreshold: Number(config.stochBullThreshold) || 45,
      stochBearThreshold: Number(config.stochBearThreshold) || 55,
      macdFastLength: Number(config.macdFastLength) || 12,
      macdSlowLength: Number(config.macdSlowLength) || 26,
      macdSignalLength: Number(config.macdSignalLength) || 9,
    });

    console.log(`✅ Bot ${botId} adicionado com sucesso`);
  }

  /**
   * Obtém todas as contas configuradas
   */
  getAllAccounts() {
    if (!this.isInitialized) {
      console.warn('⚠️ AccountConfig não foi inicializado. Chame initialize() primeiro.');
      return [];
    }
    return Array.from(this.accounts.values());
  }

  /**
   * Obtém contas habilitadas
   */
  getEnabledAccounts() {
    if (!this.isInitialized) {
      console.warn('⚠️ AccountConfig não foi inicializado. Chame initialize() primeiro.');
      return [];
    }
    return this.getAllAccounts().filter(account => account.enabled);
  }

  /**
   * Obtém uma conta específica
   */
  getAccount(botName) {
    if (!this.isInitialized) {
      console.warn('⚠️ AccountConfig não foi inicializado. Chame initialize() primeiro.');
      return null;
    }
    return this.accounts.get(botName);
  }

  /**
   * Verifica se uma conta está configurada
   */
  hasAccount(botName) {
    if (!this.isInitialized) {
      console.warn('⚠️ AccountConfig não foi inicializado. Chame initialize() primeiro.');
      return false;
    }
    return this.accounts.has(botName);
  }

  /**
   * Verifica se há contas configuradas
   */
  hasAnyAccount() {
    if (!this.isInitialized) {
      console.warn('⚠️ AccountConfig não foi inicializado. Chame initialize() primeiro.');
      return false;
    }
    return this.accounts.size > 0;
  }

  /**
   * Verifica se há configuração de múltiplas contas
   */
  hasMultiAccountConfig() {
    if (!this.isInitialized) {
      console.warn('⚠️ AccountConfig não foi inicializado. Chame initialize() primeiro.');
      return false;
    }
    return this.accounts.size > 0;
  }

  /**
   * Obtém configuração específica de uma conta
   */
  getAccountConfig(botName, key) {
    const account = this.getAccount(botName);
    return account ? account[key] : null;
  }

  /**
   * Define configuração específica de uma conta
   */
  setAccountConfig(botName, key, value) {
    const account = this.getAccount(botName);
    if (account) {
      account[key] = value;
    }
  }

  /**
   * Valida se as configurações estão corretas
   */
  validateConfigurations() {
    const errors = [];

    for (const [botName, account] of this.accounts) {
      if (!account.apiKey || !account.apiSecret) {
        errors.push(`${botName}: API Key ou Secret não configurados`);
      }

      if (!['DEFAULT', 'PRO_MAX'].includes(account.strategy)) {
        errors.push(`${botName}: Estratégia inválida (${account.strategy})`);
      }

      if (account.capitalPercentage < 0 || account.capitalPercentage > 100) {
        errors.push(`${botName}: Porcentagem do capital deve estar entre 0 e 100`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Exibe resumo das configurações dos bots
   */
  showConfigurations() {
    console.log('\n📋 Configurações dos Bots:');
    console.log('=====================================');

    if (this.accounts.size === 0) {
      console.log('❌ Nenhum bot configurado');
      console.log('   Use addBotConfig() para adicionar bots individuais');
      return;
    }

    for (const [botId, bot] of this.accounts) {
      const status = bot.enabled ? '✅ Ativo' : '❌ Inativo';
      console.log(`\n🤖 ${botId}: ${bot.name}`);
      console.log(`   • Estratégia: ${bot.strategy}`);
      console.log(`   • Status: ${status}`);
      console.log(`   • Capital: ${bot.capitalPercentage}%`);
      console.log(`   • Timeframe: ${bot.time}`);

      // Configurações de trailing stop
      if (bot.enableTrailingStop) {
        console.log(`   • Trailing Stop: ✅ Ativo`);
        console.log(`   • Distância: ${bot.trailingStopDistance}%`);
        if (bot.enableHybridStopStrategy) {
          console.log(`   • Estratégia Híbrida: ✅ Ativa`);
        }
      } else {
        console.log(`   • Trailing Stop: ❌ Inativo`);
      }
    }
  }
}

export default AccountConfig;
