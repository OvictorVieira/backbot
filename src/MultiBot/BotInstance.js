import ColorLogger from '../Utils/ColorLogger.js';
import AccountConfig from '../Config/AccountConfig.js';
import Decision from '../Decision/Decision.js';
import AccountController from '../Controllers/AccountController.js';
import OrderController from '../Controllers/OrderController.js';
import PositionTrackingService from '../Services/PositionTrackingService.js';
import DatabaseService from '../Services/DatabaseService.js';
import History from '../Backpack/Authenticated/History.js';

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
    this.fillMonitoringInterval = null;
    this.lastFillCheck = null;

    // Inicializa PositionTrackingService
    this.positionTracker = null;

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

      // Inicializa PositionTrackingService
      await this.initializePositionTracking();

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
      errors,
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
        strategy: this.strategy,
      });

      if (!accountData) {
        return {
          success: false,
          error: 'Falha ao obter dados da conta',
        };
      }

      return {
        success: true,
        data: accountData,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Inicializa o PositionTrackingService e o monitoramento de fills
   */
  async initializePositionTracking() {
    try {
      this.logger.debug('Inicializando sistema de rastreamento de posições...');

      // Inicializa DatabaseService se ainda não foi inicializado
      const dbService = new DatabaseService();
      if (!dbService.isInitialized()) {
        await dbService.init();
      }

      // Cria instância do PositionTrackingService
      this.positionTracker = new PositionTrackingService(dbService);

      // Inicia monitoramento de fills
      this.startFillMonitoring();

      this.logger.success('Sistema de rastreamento de posições inicializado');
    } catch (error) {
      this.logger.error('Erro ao inicializar rastreamento de posições:', error.message);
      throw error;
    }
  }

  /**
   * Inicia o monitoramento de fills via polling
   */
  startFillMonitoring() {
    this.logger.debug('Iniciando monitoramento de fills...');

    // Define timestamp inicial para buscar apenas fills novos
    this.lastFillCheck = Date.now() - 5 * 60 * 1000; // 5 minutos atrás

    // Primeira verificação imediata
    this.checkForNewFills();

    // Configura verificação periódica a cada 30 segundos
    this.fillMonitoringInterval = setInterval(() => {
      this.checkForNewFills();
    }, 30000); // 30 segundos
  }

  /**
   * Verifica por novos fills e processa com o PositionTrackingService
   */
  async checkForNewFills() {
    try {
      if (!this.positionTracker) {
        return;
      }

      const now = Date.now();
      const history = new History();

      // Busca fills desde a última verificação
      const fills = await history.getFillHistory(
        null, // symbol - todos os símbolos
        null, // orderId
        this.lastFillCheck,
        now,
        100, // limit - máximo 100 fills
        0, // offset
        null, // fillType - TODOS os fills (incluindo fechamentos automáticos da exchange)
        'PERP', // marketType
        'desc', // sortDirection - mais recentes primeiro
        this.config.apiKey,
        this.config.apiSecret
      );

      if (!fills || !Array.isArray(fills) || fills.length === 0) {
        // Sem novos fills
        this.lastFillCheck = now;
        return;
      }

      this.logger.debug(`📊 [FILL_MONITOR] Encontrados ${fills.length} fills para processar`);

      // Processa cada fill
      for (const fill of fills) {
        try {
          // Valida se o fill pertence a este bot (baseado no clientId ou posições abertas)
          if (!(await this.isOurFill(fill))) {
            continue;
          }

          // Converte fill da API para o formato esperado pelo PositionTrackingService
          const fillEvent = this.convertFillToEvent(fill);

          // Processa o fill
          await this.positionTracker.updatePositionOnFill(fillEvent);

          this.logger.debug(
            `✅ [FILL_MONITOR] Fill processado: ${fill.symbol} ${fill.side} ${fill.quantity} @ ${fill.price}`
          );
        } catch (error) {
          this.logger.error(`❌ [FILL_MONITOR] Erro ao processar fill:`, error.message);
        }
      }

      // Atualiza timestamp da última verificação
      this.lastFillCheck = now;
    } catch (error) {
      this.logger.error('❌ [FILL_MONITOR] Erro ao verificar fills:', error.message);
    }
  }

  /**
   * Verifica se um fill pertence a este bot
   * @param {Object} fill - Fill da API
   * @returns {boolean} True se pertence a este bot
   */
  async isOurFill(fill) {
    try {
      if (!fill || !fill.symbol) {
        return false;
      }

      // CASO 1: Fill tem clientId do bot (ordem de abertura)
      if (fill.clientId) {
        const hasValidClientId = OrderController.validateOrderForImport(
          {
            symbol: fill.symbol,
            clientId: fill.clientId,
            createdAt: fill.createdAt || fill.timestamp,
          },
          this.config
        );

        if (hasValidClientId) {
          this.logger.debug(
            `✅ [FILL_MONITOR] Fill de abertura detectado: ${fill.symbol} (clientId: ${fill.clientId})`
          );
          return true;
        }
      }

      // CASO 2: Fill SEM clientId - pode ser fechamento automático de posição nossa
      if (!fill.clientId) {
        // Verifica se temos posição aberta neste símbolo
        const hasOpenPosition = await this.hasOpenPositionForSymbol(fill.symbol);

        if (hasOpenPosition) {
          this.logger.debug(
            `🔄 [FILL_MONITOR] Fill de fechamento automático detectado: ${fill.symbol}`
          );
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.debug(`⚠️ [FILL_MONITOR] Erro na validação do fill: ${error.message}`);
      return false;
    }
  }

  /**
   * Verifica se temos posição aberta para um símbolo específico
   * @param {string} symbol - Símbolo do mercado
   * @returns {Promise<boolean>} True se temos posição aberta
   */
  async hasOpenPositionForSymbol(symbol) {
    try {
      if (!this.positionTracker) {
        return false;
      }

      // Busca posições abertas do bot para este símbolo
      const openPositions = await this.positionTracker.getBotOpenPositions(this.config.botId);
      const symbolPosition = openPositions.find(pos => pos.symbol === symbol);

      return !!symbolPosition;
    } catch (error) {
      this.logger.debug(
        `⚠️ [FILL_MONITOR] Erro ao verificar posição para ${symbol}: ${error.message}`
      );
      return false;
    }
  }

  /**
   * Converte fill da API para o formato do PositionTrackingService
   * @param {Object} fill - Fill da API
   * @returns {Object} Evento de fill formatado
   */
  convertFillToEvent(fill) {
    return {
      symbol: fill.symbol,
      side: fill.side, // 'Bid' ou 'Ask'
      quantity: parseFloat(fill.quantity),
      price: parseFloat(fill.price),
      orderId: fill.orderId,
      clientId: fill.clientId,
      timestamp: fill.timestamp || fill.createdAt || new Date().toISOString(),
      botId: this.config.botId || null,
    };
  }

  /**
   * Inicia o ciclo de análise
   */
  startAnalysis() {
    this.logger.verbose(`Iniciando análise - Timeframe: ${this.time}`);

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
        partialProfitPercentage: this.config.partialTakeProfitPercentage,
        enableHybridStopStrategy: this.config.enableHybridStopStrategy,

        // ID do bot para rastreamento de posições próprias
        botId: this.config.botId,
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
    this.logger.verbose('Iniciando monitoramento de take profits...');

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
      time: this.time,
    };
  }

  /**
   * Para a instância do bot
   */
  async stop() {
    try {
      this.logger.info('Parando bot...');

      this.isRunning = false;

      // Para intervalos de análise
      if (this.analysisInterval) {
        clearInterval(this.analysisInterval);
        this.analysisInterval = null;
      }

      // Para intervalos de monitoramento
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }

      // Para monitoramento de fills
      if (this.fillMonitoringInterval) {
        clearInterval(this.fillMonitoringInterval);
        this.fillMonitoringInterval = null;
      }

      this.logger.success('Bot parado com sucesso');
    } catch (error) {
      this.logger.error('Erro ao parar bot:', error.message);
      throw error;
    }
  }

  /**
   * Obtém logs da instância
   */
  getLogs() {
    return {
      botName: this.botName,
      strategy: this.strategy,
      isRunning: this.isRunning,
    };
  }
}

export default BotInstance;
