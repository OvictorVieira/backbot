import BaseStrategy from './BaseStrategy.js';
import Logger from '../../Utils/Logger.js';
import Markets from '../../Backpack/Public/Markets.js';
import Order from '../../Backpack/Authenticated/Order.js';
import OrderBookCache from '../../Utils/OrderBookCache.js';

/**
 * HFT (High-Frequency Trading) Strategy para maximizar volume de airdrop
 *
 * Diferente das estratégias tradicionais, o HFT:
 * - Não usa indicadores técnicos (RSI, VWAP, etc.)
 * - Foca em Grid Trading com spreads pequenos
 * - Opera como liquidity provider
 * - Monitora execução de ordens e reposiciona automaticamente
 */
class HFTStrategy extends BaseStrategy {
  constructor() {
    super();
    this.markets = new Markets();
    this.orderClient = Order;
    this.orderBookCache = new OrderBookCache();

    // Estado interno do grid
    this.activeGrids = new Map(); // symbol -> gridState
    this.isRunning = false;
    this.executionLoop = null;
  }

  /**
   * Ponto de entrada principal da estratégia HFT
   */
  async executeHFTStrategy(symbol, amount, config) {
    try {
      Logger.info(`🚀 [HFT] Iniciando estratégia HFT para ${symbol}`);

      // Valida configuração
      this.validateHFTConfig(config);

      // Inicializa cache do orderbook
      await this.orderBookCache.initialize(symbol);

      // Obtém preço atual de mercado
      const marketPrice = await this.getMarketPrice(symbol);
      if (!marketPrice) {
        throw new Error(`Não foi possível obter preço de mercado para ${symbol}`);
      }

      // Cria estado inicial do grid
      const gridState = this.createGridState(symbol, marketPrice, amount, config);
      this.activeGrids.set(symbol, gridState);

      // Coloca ordens iniciais do grid
      await this.placeInitialGridOrders(gridState);

      // Inicia loop de monitoramento
      this.startExecutionLoop(symbol);

      Logger.info(`✅ [HFT] Estratégia HFT iniciada para ${symbol}`);
      return { success: true, gridState };
    } catch (error) {
      Logger.error(`❌ [HFT] Erro ao executar estratégia HFT:`, error.message);
      throw error;
    }
  }

  /**
   * Cria estado inicial do grid para um símbolo
   */
  createGridState(symbol, marketPrice, amount, config) {
    const spread = config.hftSpread || 0.0001; // 0.01% default
    const gridSpacing = marketPrice * spread;

    return {
      symbol,
      marketPrice,
      amount,
      config,
      spread,
      gridSpacing,
      buyPrice: marketPrice - gridSpacing,
      sellPrice: marketPrice + gridSpacing,
      activeBuyOrder: null,
      activeSellOrder: null,
      executedTrades: [],
      totalVolume: 0,
      netPosition: 0,
      createdAt: new Date(),
      lastUpdate: new Date(),
    };
  }

  /**
   * Coloca ordens iniciais do grid (compra e venda)
   */
  async placeInitialGridOrders(gridState) {
    try {
      Logger.info(`📦 [HFT] Colocando ordens iniciais do grid para ${gridState.symbol}`);

      // Ordem de compra
      const buyOrder = await this.placeLimitOrder({
        symbol: gridState.symbol,
        side: 'Bid',
        price: gridState.buyPrice,
        quantity: gridState.amount,
        type: 'grid_buy',
      });

      // Ordem de venda
      const sellOrder = await this.placeLimitOrder({
        symbol: gridState.symbol,
        side: 'Ask',
        price: gridState.sellPrice,
        quantity: gridState.amount,
        type: 'grid_sell',
      });

      // Atualiza estado
      gridState.activeBuyOrder = buyOrder;
      gridState.activeSellOrder = sellOrder;
      gridState.lastUpdate = new Date();

      Logger.info(
        `✅ [HFT] Ordens iniciais colocadas - Buy: ${gridState.buyPrice}, Sell: ${gridState.sellPrice}`
      );
    } catch (error) {
      Logger.error(`❌ [HFT] Erro ao colocar ordens iniciais:`, error.message);
      throw error;
    }
  }

  /**
   * Coloca ordem limit usando OrderBookAnalyzer para otimização
   */
  async placeLimitOrder({ symbol, side, price, quantity, type }) {
    try {
      // Usa OrderBookAnalyzer para otimizar preço se disponível
      const OrderBookAnalyzer = await import('../../Utils/OrderBookAnalyzer.js');
      const optimalPrice = await OrderBookAnalyzer.default.getOptimalPrice(
        symbol,
        side === 'Bid' ? 'BUY' : 'SELL',
        price
      );

      const finalPrice = optimalPrice || price;

      const orderParams = {
        symbol,
        side,
        orderType: 'Limit',
        quantity: quantity.toString(),
        price: finalPrice.toString(),
        timeInForce: 'GTC',
        selfTradePrevention: 'RejectTaker',
        clientId: this.generateClientId(type),
      };

      Logger.debug(`📝 [HFT] Criando ordem ${type}: ${side} ${quantity} ${symbol} @ ${finalPrice}`);

      const result = await this.orderClient.executeOrder(
        orderParams,
        this.config.apiKey,
        this.config.apiSecret
      );

      if (result && !result.error) {
        Logger.info(`✅ [HFT] Ordem ${type} criada: ${result.id}`);
        return {
          id: result.id,
          symbol,
          side,
          price: finalPrice,
          quantity,
          type,
          status: 'pending',
          createdAt: new Date(),
        };
      } else {
        throw new Error(`Falha ao criar ordem: ${result?.error || 'Erro desconhecido'}`);
      }
    } catch (error) {
      Logger.error(`❌ [HFT] Erro ao colocar ordem limit:`, error.message);
      throw error;
    }
  }

  /**
   * Inicia loop de execução para monitorar e reposicionar ordens
   */
  startExecutionLoop(symbol) {
    if (this.executionLoop) {
      clearInterval(this.executionLoop);
    }

    this.isRunning = true;

    this.executionLoop = setInterval(async () => {
      try {
        await this.executeGridCycle(symbol);
      } catch (error) {
        Logger.error(`❌ [HFT] Erro no ciclo de execução:`, error.message);
      }
    }, 1000); // Executa a cada 1 segundo

    Logger.info(`🔄 [HFT] Loop de execução iniciado para ${symbol}`);
  }

  /**
   * Ciclo principal de execução do grid
   */
  async executeGridCycle(symbol) {
    const gridState = this.activeGrids.get(symbol);
    if (!gridState || !this.isRunning) return;

    try {
      // 1. Verifica se ordens foram executadas
      await this.checkOrderExecutions(gridState);

      // 2. Verifica se preço se moveu significativamente
      await this.checkPriceMovement(gridState);

      // 3. Rebalanceia grid se necessário
      await this.rebalanceGrid(gridState);

      gridState.lastUpdate = new Date();
    } catch (error) {
      Logger.error(`❌ [HFT] Erro no ciclo do grid:`, error.message);
    }
  }

  /**
   * Verifica se alguma ordem foi executada
   */
  async checkOrderExecutions(gridState) {
    const executions = [];

    // Verifica ordem de compra
    if (gridState.activeBuyOrder) {
      const buyStatus = await this.checkOrderStatus(gridState.activeBuyOrder);
      if (buyStatus.executed) {
        executions.push({ order: gridState.activeBuyOrder, type: 'buy' });
        gridState.activeBuyOrder = null;
      }
    }

    // Verifica ordem de venda
    if (gridState.activeSellOrder) {
      const sellStatus = await this.checkOrderStatus(gridState.activeSellOrder);
      if (sellStatus.executed) {
        executions.push({ order: gridState.activeSellOrder, type: 'sell' });
        gridState.activeSellOrder = null;
      }
    }

    // Processa execuções
    for (const execution of executions) {
      await this.processOrderExecution(gridState, execution);
    }
  }

  /**
   * Processa execução de uma ordem e cria ordem oposta
   */
  async processOrderExecution(gridState, execution) {
    try {
      const { order, type } = execution;

      Logger.info(`💰 [HFT] Ordem ${type} executada: ${order.id} @ ${order.price}`);

      // Registra trade executado
      gridState.executedTrades.push({
        orderId: order.id,
        type,
        price: order.price,
        quantity: order.quantity,
        timestamp: new Date(),
      });

      // Atualiza métricas
      gridState.totalVolume += parseFloat(order.quantity) * parseFloat(order.price);
      gridState.netPosition +=
        type === 'buy' ? parseFloat(order.quantity) : -parseFloat(order.quantity);

      // Obtém novo preço de mercado
      const newMarketPrice = await this.getMarketPrice(gridState.symbol);
      if (newMarketPrice) {
        gridState.marketPrice = newMarketPrice;

        // Recalcula preços do grid
        const gridSpacing = newMarketPrice * gridState.spread;
        gridState.buyPrice = newMarketPrice - gridSpacing;
        gridState.sellPrice = newMarketPrice + gridSpacing;

        // Cria ordem oposta
        await this.createOppositeOrder(gridState, type);
      }
    } catch (error) {
      Logger.error(`❌ [HFT] Erro ao processar execução de ordem:`, error.message);
    }
  }

  /**
   * Cria ordem oposta após execução
   */
  async createOppositeOrder(gridState, executedType) {
    try {
      if (executedType === 'buy' && !gridState.activeSellOrder) {
        // Compra foi executada, criar nova venda
        const sellOrder = await this.placeLimitOrder({
          symbol: gridState.symbol,
          side: 'Ask',
          price: gridState.sellPrice,
          quantity: gridState.amount,
          type: 'grid_sell',
        });
        gridState.activeSellOrder = sellOrder;
      } else if (executedType === 'sell' && !gridState.activeBuyOrder) {
        // Venda foi executada, criar nova compra
        const buyOrder = await this.placeLimitOrder({
          symbol: gridState.symbol,
          side: 'Bid',
          price: gridState.buyPrice,
          quantity: gridState.amount,
          type: 'grid_buy',
        });
        gridState.activeBuyOrder = buyOrder;
      }
    } catch (error) {
      Logger.error(`❌ [HFT] Erro ao criar ordem oposta:`, error.message);
    }
  }

  /**
   * Verifica se preço se moveu significativamente e reposiciona grid
   */
  async checkPriceMovement(gridState) {
    try {
      const currentMarketPrice = await this.getMarketPrice(gridState.symbol);
      if (!currentMarketPrice) return;

      const priceChange =
        Math.abs(currentMarketPrice - gridState.marketPrice) / gridState.marketPrice;
      const rebalanceThreshold = gridState.spread * 2; // 2x o spread

      if (priceChange > rebalanceThreshold) {
        Logger.info(
          `🔄 [HFT] Preço se moveu ${(priceChange * 100).toFixed(3)}%, rebalanceando grid`
        );
        await this.rebalanceGrid(gridState, currentMarketPrice);
      }
    } catch (error) {
      Logger.error(`❌ [HFT] Erro ao verificar movimento de preço:`, error.message);
    }
  }

  /**
   * Rebalanceia o grid cancelando ordens antigas e criando novas
   */
  async rebalanceGrid(gridState, newMarketPrice = null) {
    try {
      // Cancela ordens ativas
      await this.cancelActiveOrders(gridState);

      // Atualiza preço de mercado
      if (newMarketPrice) {
        gridState.marketPrice = newMarketPrice;
      } else {
        gridState.marketPrice = await this.getMarketPrice(gridState.symbol);
      }

      // Recalcula preços do grid
      const gridSpacing = gridState.marketPrice * gridState.spread;
      gridState.buyPrice = gridState.marketPrice - gridSpacing;
      gridState.sellPrice = gridState.marketPrice + gridSpacing;

      // Coloca novas ordens
      await this.placeInitialGridOrders(gridState);

      Logger.info(`✅ [HFT] Grid rebalanceado para ${gridState.symbol}`);
    } catch (error) {
      Logger.error(`❌ [HFT] Erro ao rebalancear grid:`, error.message);
    }
  }

  /**
   * Para estratégia HFT de forma segura
   */
  async stopHFTMode(symbol = null) {
    try {
      Logger.info(`🛑 [HFT] Parando modo HFT${symbol ? ` para ${symbol}` : ''}`);

      this.isRunning = false;

      // Para loop de execução
      if (this.executionLoop) {
        clearInterval(this.executionLoop);
        this.executionLoop = null;
      }

      // Cancela todas as ordens ativas
      const symbolsToStop = symbol ? [symbol] : Array.from(this.activeGrids.keys());

      for (const sym of symbolsToStop) {
        const gridState = this.activeGrids.get(sym);
        if (gridState) {
          await this.cancelActiveOrders(gridState);
          this.activeGrids.delete(sym);
        }
      }

      // Para cache do orderbook
      await this.orderBookCache.disconnect();

      Logger.info(`✅ [HFT] Modo HFT parado com sucesso`);
    } catch (error) {
      Logger.error(`❌ [HFT] Erro ao parar modo HFT:`, error.message);
    }
  }

  /**
   * Cancela ordens ativas do grid
   */
  async cancelActiveOrders(gridState) {
    const ordersToCancel = [];

    if (gridState.activeBuyOrder) {
      ordersToCancel.push(gridState.activeBuyOrder);
    }

    if (gridState.activeSellOrder) {
      ordersToCancel.push(gridState.activeSellOrder);
    }

    for (const order of ordersToCancel) {
      try {
        await this.orderClient.cancelOrder(
          order.symbol,
          order.id,
          this.config.apiKey,
          this.config.apiSecret
        );
        Logger.debug(`🗑️ [HFT] Ordem cancelada: ${order.id}`);
      } catch (error) {
        Logger.warn(`⚠️ [HFT] Erro ao cancelar ordem ${order.id}:`, error.message);
      }
    }

    gridState.activeBuyOrder = null;
    gridState.activeSellOrder = null;
  }

  /**
   * Obtém preço atual de mercado
   */
  async getMarketPrice(symbol) {
    try {
      // Tenta obter do cache do orderbook primeiro
      const orderbook = this.orderBookCache.getOrderbook(symbol);
      if (orderbook && orderbook.bids.length > 0 && orderbook.asks.length > 0) {
        const bestBid = parseFloat(orderbook.bids[0][0]);
        const bestAsk = parseFloat(orderbook.asks[0][0]);
        return (bestBid + bestAsk) / 2; // Preço médio
      }

      // Fallback para API REST
      const ticker = await this.markets.getTicker(symbol);
      return ticker ? parseFloat(ticker.lastPrice) : null;
    } catch (error) {
      Logger.error(`❌ [HFT] Erro ao obter preço de mercado:`, error.message);
      return null;
    }
  }

  /**
   * Verifica status de uma ordem
   */
  async checkOrderStatus(order) {
    try {
      const status = await this.orderClient.getOrder(
        order.symbol,
        order.id,
        this.config.apiKey,
        this.config.apiSecret
      );

      return {
        executed: status && (status.status === 'Filled' || status.status === 'PartiallyFilled'),
        status: status?.status || 'Unknown',
      };
    } catch (error) {
      Logger.warn(`⚠️ [HFT] Erro ao verificar status da ordem ${order.id}:`, error.message);
      return { executed: false, status: 'Error' };
    }
  }

  /**
   * Valida configuração HFT
   */
  validateHFTConfig(config) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error('API Key e Secret são obrigatórios para modo HFT');
    }

    if (!config.hftSpread || config.hftSpread <= 0) {
      throw new Error('HFT Spread deve ser maior que 0');
    }

    if (config.hftSpread > 0.01) {
      Logger.warn(`⚠️ [HFT] Spread muito alto: ${config.hftSpread * 100}%. Recomendado: < 1%`);
    }
  }

  /**
   * Gera client ID único para ordens
   */
  generateClientId(type) {
    return `hft_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Obtém métricas do HFT
   */
  getHFTMetrics(symbol = null) {
    const metrics = {
      totalVolume: 0,
      totalTrades: 0,
      activeGrids: 0,
      netPosition: 0,
      uptime: 0,
    };

    const gridsToAnalyze = symbol
      ? [this.activeGrids.get(symbol)].filter(Boolean)
      : Array.from(this.activeGrids.values());

    for (const grid of gridsToAnalyze) {
      metrics.totalVolume += grid.totalVolume;
      metrics.totalTrades += grid.executedTrades.length;
      metrics.netPosition += grid.netPosition;
      metrics.activeGrids++;

      if (grid.createdAt) {
        const gridUptime = Date.now() - grid.createdAt.getTime();
        metrics.uptime = Math.max(metrics.uptime, gridUptime);
      }
    }

    return metrics;
  }
}

export default HFTStrategy;
