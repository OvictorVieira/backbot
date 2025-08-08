import ColorLogger from '../Utils/ColorLogger.js';
import AccountConfig from '../Config/AccountConfig.js';
import Decision from '../Decision/Decision.js';
import AccountController from '../Controllers/AccountController.js';
import OrderController from '../Controllers/OrderController.js';

/**
 * Instância individual do bot para cada conta
 * Cada instância roda independentemente com suas próprias configurações
 */
class BotInstance {
  constructor(botName, accountConfig) {
    this.botName = botName;
    this.config = accountConfig;
    this.logger = new ColorLogger(botName, accountConfig.strategy);
    this.isRunning = false;
    this.analysisInterval = null;
    this.monitoringInterval = null;
    
    // Configurações específicas da conta
    this.capitalPercentage = accountConfig.capitalPercentage;
    this.limitOrder = accountConfig.limitOrder;
    this.time = accountConfig.time;
    
    // Configurações da estratégia
    this.strategy = accountConfig.strategy;
    this.ignoreBronzeSignals = accountConfig.ignoreBronzeSignals;
    this.adxLength = accountConfig.adxLength;
    this.adxThreshold = accountConfig.adxThreshold;
    
    this.logger.info(`Instância criada - Estratégia: ${this.strategy}`);
  }

  /**
   * Inicia a instância do bot
   */
  async start() {
    try {
      this.logger.success('Iniciando bot...');
      
      // Valida configurações
      const validation = this.validateConfig();
      if (!validation.isValid) {
        this.logger.error(`Configuração inválida: ${validation.errors.join(', ')}`);
        return false;
      }
      
      // Testa conexão com a API
      const connectionTest = await this.testConnection();
      if (!connectionTest.success) {
        this.logger.error(`Falha na conexão: ${connectionTest.error}`);
        return false;
      }
      
      this.logger.success('Conexão estabelecida com sucesso');
      

      
      // Inicia análise
      this.startAnalysis();
      
      // Inicia monitoramento (para PRO_MAX)
      if (this.strategy === 'PRO_MAX') {
        this.startMonitoring();
      }
      
      this.isRunning = true;
      this.logger.success('Bot iniciado com sucesso');
      
      return true;
      
    } catch (error) {
      this.logger.error(`Erro ao iniciar bot: ${error.message}`);
      return false;
    }
  }

  /**
   * Para a instância do bot
   */
  stop() {
    try {
      this.logger.info('Parando bot...');
      
      if (this.analysisInterval) {
        clearInterval(this.analysisInterval);
        this.analysisInterval = null;
      }
      
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }
      
      this.isRunning = false;
      this.logger.success('Bot parado com sucesso');
      
    } catch (error) {
      this.logger.error(`Erro ao parar bot: ${error.message}`);
    }
  }

  /**
   * Valida configurações da instância
   */
  validateConfig() {
    const errors = [];
    
    if (!this.config.apiKey || !this.config.apiSecret) {
      errors.push('API Key ou Secret não configurados');
    }
    
    if (!['DEFAULT', 'PRO_MAX'].includes(this.strategy)) {
      errors.push(`Estratégia inválida: ${this.strategy}`);
    }
    

    
    if (this.capitalPercentage < 0 || this.capitalPercentage > 100) {
      errors.push('Porcentagem do capital deve estar entre 0 e 100');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Testa conexão com a API
   */
  async testConnection() {
    try {
      // Testa conexão usando config do bot
      const accountData = await AccountController.get({ 
        apiKey: this.config.apiKey, 
        apiSecret: this.config.apiSecret,
        strategy: this.strategy 
      });
      
      if (!accountData) {
        return {
          success: false,
          error: 'Falha ao obter dados da conta'
        };
      }
      
      return {
        success: true,
        data: accountData
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }



  /**
   * Inicia o ciclo de análise
   */
  startAnalysis() {
    this.logger.info(`Iniciando análise - Timeframe: ${this.time}`);
    
    // Primeira análise imediata
    this.runAnalysis();
    
    // Configura intervalo (60 segundos)
    this.analysisInterval = setInterval(() => {
      this.runAnalysis();
    }, 60000);
  }

  /**
   * Executa uma análise
   */
  async runAnalysis() {
    try {
      // Cria objeto de configuração para esta instância
      const instanceConfig = {
        // Configurações básicas
        apiKey: this.config.apiKey,
        apiSecret: this.config.apiSecret,
        capitalPercentage: this.capitalPercentage,
        limitOrder: this.limitOrder,
        time: this.time,
        strategy: this.strategy,
        ignoreBronzeSignals: this.ignoreBronzeSignals,
        adxLength: this.adxLength,
        adxThreshold: this.adxThreshold,
        botName: this.botName,
        
        // Configurações avançadas da estratégia PRO_MAX
        adxAverageLength: this.config.adxAverageLength,
        useRsiValidation: this.config.useRsiValidation,
        useStochValidation: this.config.useStochValidation,
        useMacdValidation: this.config.useMacdValidation,
        rsiLength: this.config.rsiLength,
        rsiAverageLength: this.config.rsiAverageLength,
        rsiBullThreshold: this.config.rsiBullThreshold,
        rsiBearThreshold: this.config.rsiBearThreshold,
        stochKLength: this.config.stochKLength,
        stochDLength: this.config.stochDLength,
        stochSmooth: this.config.stochSmooth,
        stochBullThreshold: this.config.stochBullThreshold,
        stochBearThreshold: this.config.stochBearThreshold,
        macdFastLength: this.config.macdFastLength,
        macdSlowLength: this.config.macdSlowLength,
        macdSignalLength: this.config.macdSignalLength,
        
        // Configurações de stop loss e take profit
        maxNegativePnlStopPct: this.config.maxNegativePnlStopPct,
        minProfitPercentage: this.config.minProfitPercentage,
        enableTpValidation: this.config.enableTpValidation,
        enableTrailingStop: this.config.enableTrailingStop,
        
        // Configurações de ordem (Alpha Flow)
        order1WeightPct: this.config.order1WeightPct,
        order2WeightPct: this.config.order2WeightPct,
        order3WeightPct: this.config.order3WeightPct,
        
        // Configurações de trailing stop
        initialStopAtrMultiplier: this.config.initialStopAtrMultiplier,
        partialTakeProfitAtrMultiplier: this.config.partialTakeProfitAtrMultiplier,
        partialProfitPercentage: this.config.partialProfitPercentage,
        enableHybridStopStrategy: this.config.enableHybridStopStrategy
      };
      
      // Cria uma instância do Decision com a estratégia específica desta conta
      const decisionInstance = new Decision(this.strategy);
      
      // Executa análise passando o timeframe específico da conta, o logger e a configuração
      await decisionInstance.analyze(this.time, this.logger, instanceConfig);
      
    } catch (error) {
      this.logger.error(`Erro na análise: ${error.message}`);
    }
  }

  /**
   * Inicia monitoramento (para estratégia PRO_MAX)
   */
  startMonitoring() {
    this.logger.info('Iniciando monitoramento de take profits...');
    
    this.monitoringInterval = setInterval(async () => {
      try {
        // Executa monitoramento APENAS para esta conta usando config do bot
        await OrderController.monitorPendingEntryOrders(this.botName, this.config);
        
      } catch (error) {
        this.logger.error(`Erro no monitoramento: ${error.message}`);
      }
    }, 5000); // A cada 5 segundos
  }

  /**
   * Obtém status da instância
   */
  getStatus() {
    return {
      botName: this.botName,
      name: this.config.name,
      strategy: this.strategy,
      isRunning: this.isRunning,
      capitalPercentage: this.capitalPercentage,
      time: this.time
    };
  }

  /**
   * Obtém logs da instância
   */
  getLogs() {
    return {
      botName: this.botName,
      strategy: this.strategy,
      isRunning: this.isRunning
    };
  }
}

export default BotInstance; 