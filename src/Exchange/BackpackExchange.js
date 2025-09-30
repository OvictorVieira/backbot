import { BaseExchange } from './BaseExchange.js';
import orderClient from '../Backpack/Authenticated/Order.js';
import Markets from '../Backpack/Public/Markets.js';
import BackpackWebSocket from '../Backpack/Public/WebSocket.js';
import Account from '../Backpack/Authenticated/Account.js';
import Capital from '../Backpack/Authenticated/Capital.js';
import Futures from '../Backpack/Authenticated/Futures.js';
import History from '../Backpack/Authenticated/History.js';
import Trades from '../Backpack/Public/Trades.js';
import Logger from '../Utils/Logger.js';

/**
 * Implementação concreta da BaseExchange para a Backpack.
 * Encapsula toda a lógica e chamadas de API específicas da Backpack.
 */
// Singleton WebSocket instance to avoid multiple connections
let sharedWebSocketInstance = null;

export class BackpackExchange extends BaseExchange {
  constructor() {
    super('Backpack');
    this.orderClient = orderClient; // Usando singleton importado
    this.marketsClient = new Markets(); // Criando instância da classe Markets

    // Use shared WebSocket instance (singleton pattern for connection reuse)
    if (!sharedWebSocketInstance) {
      sharedWebSocketInstance = new BackpackWebSocket();
    }
    this.wsClient = sharedWebSocketInstance;
  }

  async connectWebSocket(callbacks) {
    // Store callbacks for use with WebSocket events
    this.callbacks = callbacks;

    // Connect to WebSocket if not already connected
    if (!this.wsClient.connected) {
      await this.wsClient.connect();
    }

    Logger.info('[BackpackExchange] WebSocket connected with callbacks configured');
  }

  async subscribeUserTrades(symbols, apiKey, apiSecret) {
    if (!this.callbacks || !this.callbacks.onUserTradeUpdate) {
      Logger.warn('[BackpackExchange] No user trade update callback provided');
      return Promise.resolve();
    }

    if (!apiKey || !apiSecret) {
      Logger.error('[BackpackExchange] API credentials required for user trade monitoring');
      return Promise.resolve();
    }

    // Subscribe to authenticated user trade channels - covers ALL symbols for this account
    await this.wsClient.subscribeUserTrades(apiKey, apiSecret, tradeData => {
      try {
        // Transform Backpack WebSocket trade data to standardized format for HFT
        const userTradeUpdate = {
          symbol: tradeData.s || tradeData.symbol, // Symbol should come from the trade data
          orderId: tradeData.i || tradeData.orderId || tradeData.id,
          side:
            tradeData.S === 'Bid'
              ? 'BUY'
              : tradeData.S === 'Ask'
                ? 'SELL'
                : tradeData.side === 'Bid'
                  ? 'BUY'
                  : tradeData.side === 'Ask'
                    ? 'SELL'
                    : tradeData.side,
          price: parseFloat(tradeData.p || tradeData.price || tradeData.price || 0),
          quantity: parseFloat(
            tradeData.q || tradeData.quantity || tradeData.originalQuantity || 0
          ),
          status: this.mapOrderStatus(tradeData.X || tradeData.status || tradeData.e),
          timestamp: tradeData.T || tradeData.timestamp || Date.now(),
          eventType: tradeData.e,
          rawData: tradeData,
        };

        // Log the raw data for debugging
        Logger.debug(`🔍 [BackpackExchange] Raw WebSocket data:`, tradeData);

        // Call the HFT callback with standardized data
        this.callbacks.onUserTradeUpdate(userTradeUpdate);
      } catch (error) {
        Logger.error(`[BackpackExchange] Error processing user trade update:`, error.message);
      }
    });

    // Store credentials for potential order polling
    this.monitoredTradeSymbols = { symbols, apiKey, apiSecret };

    Logger.info(
      `[BackpackExchange] User trade monitoring enabled for ${symbols.length} symbols (using polling fallback)`
    );
  }

  /**
   * Map Backpack order status to standardized format
   */
  mapOrderStatus(backpackStatus) {
    if (!backpackStatus) return backpackStatus;

    // Convert to uppercase for consistent comparison
    const normalizedStatus = backpackStatus.toString().toUpperCase();

    const statusMap = {
      FILL: 'FILLED',
      ORDERUPDATE: 'UPDATED',
      ORDERACCEPTED: 'NEW',
      ORDERCANCELLED: 'CANCELED',
      ORDEREXPIRED: 'EXPIRED',
      ORDERFILL: 'FILLED',
      ORDERMODIFIED: 'UPDATED',
      NEW: 'NEW',
      PARTIALLY_FILLED: 'PARTIALLY_FILLED',
      FILLED: 'FILLED',
      CANCELED: 'CANCELED',
      CANCELLED: 'CANCELED',
      REJECTED: 'REJECTED',
    };

    return statusMap[normalizedStatus] || normalizedStatus;
  }

  async subscribeOrderbook(symbols) {
    if (!this.callbacks || !this.callbacks.onOrderbookUpdate) {
      Logger.warn('[BackpackExchange] No orderbook update callback provided');
      return Promise.resolve();
    }

    // Subscribe to symbols using the WebSocket client with proper callback
    for (const symbol of symbols) {
      await this.wsClient.subscribeSymbol(symbol, (receivedSymbol, currentPrice, rawData) => {
        try {
          // Transform Backpack WebSocket data to standardized format for HFT
          const orderbookUpdate = {
            symbol: receivedSymbol,
            marketPrice: currentPrice,
            bids: rawData.b ? [[parseFloat(rawData.b), parseFloat(rawData.B)]] : [], // [price, quantity]
            asks: rawData.a ? [[parseFloat(rawData.a), parseFloat(rawData.A)]] : [], // [price, quantity]
            timestamp: Date.now(),
          };

          // Call the HFT callback with standardized data
          this.callbacks.onOrderbookUpdate(orderbookUpdate);
        } catch (error) {
          Logger.error(
            `[BackpackExchange] Error processing orderbook update for ${receivedSymbol}:`,
            error.message
          );
        }
      });
    }

    Logger.info(`[BackpackExchange] Subscribed to orderbook updates for ${symbols.length} symbols`);
  }

  async getDepth(symbol) {
    try {
      const depth = await this.marketsClient.getDepth(symbol);
      Logger.debug(`[BackpackExchange] Obtido depth para ${symbol}`);

      return this.normalizeOrderbookData(depth);
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter depth: ${error.message}`);
      throw error;
    }
  }

  /**
   * Normaliza dados do orderbook para formato padrão
   * Garante compatibilidade entre diferentes exchanges
   */
  normalizeOrderbookData(rawDepth) {
    if (!rawDepth || !rawDepth.bids || !rawDepth.asks) {
      throw new Error('Dados de orderbook inválidos');
    }

    // Converte e ordena bids (desc - melhor bid primeiro)
    const normalizedBids = rawDepth.bids
      .map(([price, quantity]) => [parseFloat(price), parseFloat(quantity)])
      .sort((a, b) => b[0] - a[0]); // Descendente por preço

    // Converte e ordena asks (asc - melhor ask primeiro)
    const normalizedAsks = rawDepth.asks
      .map(([price, quantity]) => [parseFloat(price), parseFloat(quantity)])
      .sort((a, b) => a[0] - b[0]); // Ascendente por preço

    return {
      bids: normalizedBids,
      asks: normalizedAsks,
      timestamp: Date.now(),
    };
  }

  async getMarketPrice(symbol) {
    try {
      // Usa getTicker para um símbolo específico, não getTickers
      const ticker = await this.marketsClient.getTicker(symbol);
      return ticker?.lastPrice || null;
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter preço de mercado: ${error.message}`);
      return null;
    }
  }

  async placeOrder(symbol, side, price, quantity, apiKey, apiSecret, options = {}) {
    try {
      // Get market info for proper price formatting
      const marketInfo = await this.getMarketInfo(symbol, apiKey, apiSecret);

      // Converte side padrão para formato Backpack
      const backpackSide = side === 'BUY' ? 'Bid' : side === 'SELL' ? 'Ask' : side;

      // Determina tipo de ordem baseado nas opções ou presença de preço
      const orderType = options.orderType || (price ? 'Limit' : 'Market');

      // Use quantity as-is if it's already a string (from MarketFormatter)
      // Otherwise convert to string with proper precision
      const formattedQuantity = typeof quantity === 'string' ? quantity : quantity.toString();

      // Constrói orderBody baseado no tipo de ordem
      const orderBody = {
        symbol,
        side: backpackSide,
        orderType: orderType,
        quantity: formattedQuantity,
        timeInForce: options.timeInForce || (orderType === 'Market' ? 'IOC' : 'GTC'),
        selfTradePrevention: 'RejectTaker',
        clientId: options.clientId || null,
        ...options,
      };

      // Só inclui preço e postOnly para ordens Limit
      if (orderType === 'Limit' && price) {
        // Format price using market info for correct decimal places
        const formattedPrice = parseFloat(price).toFixed(marketInfo.decimal_price);
        orderBody.price = formattedPrice;
        orderBody.postOnly = options.postOnly !== undefined ? options.postOnly : true;
      }

      // Para market orders, não incluir postOnly (incompatível)
      if (orderType === 'Market') {
        delete orderBody.postOnly;
      }

      const priceInfo = orderType === 'Market' ? 'MARKET' : `@ ${orderBody.price}`;
      Logger.debug(
        `[BackpackExchange] Criando ordem: ${symbol} ${backpackSide} ${formattedQuantity} ${priceInfo} (${orderType})`,
        {
          clientId: orderBody.clientId,
          orderType: orderType,
          timestamp: new Date().toISOString(),
        }
      );

      const order = await this.orderClient.executeOrder(orderBody, apiKey, apiSecret);

      Logger.debug(`[BackpackExchange] Ordem colocada com sucesso: ${order.id || order.orderId}`, {
        clientId: orderBody.clientId,
        orderResponse: order,
      });
      return order;
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao colocar ordem: ${error.message}`);
      throw error;
    }
  }

  async cancelOrder(symbol, orderId, apiKey, apiSecret) {
    try {
      const result = await this.orderClient.cancelOpenOrder(
        symbol,
        orderId,
        null,
        apiKey,
        apiSecret
      );
      Logger.info(`[BackpackExchange] Ordem cancelada: ${orderId}`);
      return result;
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao cancelar ordem: ${error.message}`);
      throw error;
    }
  }

  async cancelAllOpenOrders(symbol, apiKey, apiSecret) {
    try {
      const result = await this.orderClient.cancelOpenOrders(symbol, null, apiKey, apiSecret);
      Logger.info(`[BackpackExchange] Todas as ordens para ${symbol} foram canceladas.`);
      return result;
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao cancelar todas as ordens: ${error.message}`);
      throw error;
    }
  }

  async getAccountData(apiKey, apiSecret) {
    try {
      Logger.debug(`[BackpackExchange] Obtendo dados da conta e capital...`);

      // Chama APIs separadamente para debug (não em paralelo)
      const accountData = await Account.getAccount(null, apiKey, apiSecret);

      const collateralData = await Capital.getCollateral(null, apiKey, apiSecret);

      if (!accountData || !collateralData) {
        throw new Error('Falha ao obter dados da conta ou colateral da Backpack');
      }

      // Verifica se temos os campos necessários (seguindo AccountController)
      if (!collateralData.netEquityAvailable && collateralData.netEquityAvailable !== 0) {
        Logger.error(
          `[BackpackExchange] Campo 'netEquityAvailable' não encontrado no collateralData. Campos disponíveis:`,
          Object.keys(collateralData)
        );
        throw new Error('Dados de colateral inválidos - campo "netEquityAvailable" não encontrado');
      }

      // Calcula capital disponível seguindo EXATAMENTE a lógica do AccountController
      const netEquityAvailable = parseFloat(collateralData.netEquityAvailable);
      const marginSafety = 0.95; // 5% de margem de segurança
      const realCapital = netEquityAvailable * marginSafety;
      const leverage = accountData.leverageLimit || 1;
      const capitalAvailable = realCapital * leverage;

      // Normaliza para formato padrão cross-exchange
      return {
        capitalAvailable: capitalAvailable,
        balances: accountData.balances || [],
        leverage: leverage,
        totalValue: collateralData.total || 0,
        netEquityAvailable: netEquityAvailable,
        realCapital: realCapital,
      };
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter dados da conta: ${error.message}`);
      throw error;
    }
  }

  async getMarketInfo(symbol, apiKey, apiSecret) {
    try {
      Logger.debug(`[BackpackExchange] Obtendo informações do mercado para ${symbol}...`);

      // Usa APIs diretas da Backpack (genérico)
      const [markets, accountData] = await Promise.all([
        this.marketsClient.getMarkets(),
        Account.getAccount(null, apiKey, apiSecret),
      ]);

      if (!markets || !Array.isArray(markets)) {
        throw new Error('Dados de mercados não disponíveis');
      }

      // Procura o símbolo específico nos dados públicos da exchange
      const market = markets.find(m => m.symbol === symbol);
      if (!market) {
        throw new Error(`Symbol ${symbol} not found in exchange markets`);
      }

      // Extract data from the correct API structure (filters object)
      const quantityFilters = market.filters?.quantity || {};
      const priceFilters = market.filters?.price || {};

      // Calculate decimal places from stepSize (count digits after decimal point)
      const calculateDecimals = stepSize => {
        if (!stepSize) return 8;
        const stepStr = stepSize.toString();
        if (!stepStr.includes('.')) return 0; // Integer values like "100" have 0 decimals
        return stepStr.split('.')[1].length;
      };

      const stepSize = parseFloat(quantityFilters.stepSize || '0.00001');
      const tickSize = parseFloat(priceFilters.tickSize || '0.1');
      const minQuantity = parseFloat(quantityFilters.minQuantity || stepSize);

      // Normaliza dados do mercado para formato padrão cross-exchange
      const quantityDecimals = calculateDecimals(quantityFilters.stepSize);
      const priceDecimals = calculateDecimals(priceFilters.tickSize);

      const marketInfo = {
        symbol: market.symbol,
        decimal_quantity: quantityDecimals !== undefined ? quantityDecimals : 8,
        decimal_price: priceDecimals !== undefined ? priceDecimals : 2,
        stepSize_quantity: stepSize,
        tickSize: tickSize,
        minQuantity: minQuantity,
      };

      Logger.debug(`[BackpackExchange] Market info para ${symbol}:`, {
        decimal_quantity: marketInfo.decimal_quantity,
        decimal_price: marketInfo.decimal_price,
        stepSize_quantity: marketInfo.stepSize_quantity,
        tickSize: marketInfo.tickSize,
        minQuantity: marketInfo.minQuantity,
      });

      return marketInfo;
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter informações do mercado: ${error.message}`);
      throw error;
    }
  }

  /**
   * Disconnect WebSocket and cleanup resources
   */
  async disconnectWebSocket() {
    if (this.wsClient) {
      this.wsClient.disconnect();
      Logger.info('[BackpackExchange] WebSocket disconnected');
    }
    this.callbacks = null;
    this.monitoredTradeSymbols = null;
  }

  /**
   * Get WebSocket connection status
   */
  isWebSocketConnected() {
    return this.wsClient && this.wsClient.connected;
  }

  // ============================================
  // 🔧 IMPLEMENTAÇÃO DOS MÉTODOS AUSENTES
  // ============================================

  /**
   * Account Management Methods
   */
  async getAccount(apiKey, apiSecret) {
    try {
      Logger.debug(`[BackpackExchange] Obtendo informações da conta...`);
      const accountData = await Account.getAccount(null, apiKey, apiSecret);
      return accountData;
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter informações da conta: ${error.message}`);
      throw error;
    }
  }

  async getPositions(apiKey, apiSecret) {
    try {
      Logger.debug(`[BackpackExchange] Obtendo posições...`);
      const positions = await Futures.getPositions(null, apiKey, apiSecret);
      return positions || [];
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter posições: ${error.message}`);
      throw error;
    }
  }

  async getCapital(apiKey, apiSecret) {
    try {
      Logger.debug(`[BackpackExchange] Obtendo informações de capital...`);
      const capitalData = await Capital.getCollateral(null, apiKey, apiSecret);
      return capitalData;
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter capital: ${error.message}`);
      throw error;
    }
  }

  /**
   * Market Data Methods
   */
  async getMarkets() {
    try {
      Logger.debug(`[BackpackExchange] Obtendo mercados...`);
      const markets = await this.marketsClient.getMarkets();
      return markets;
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter mercados: ${error.message}`);
      throw error;
    }
  }

  async getTicker(symbol) {
    try {
      Logger.debug(`[BackpackExchange] Obtendo ticker para ${symbol}...`);
      const ticker = await this.marketsClient.getTicker(symbol);
      return ticker;
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter ticker: ${error.message}`);
      throw error;
    }
  }

  async getKlines(symbol, interval, limit = 100) {
    try {
      Logger.debug(`[BackpackExchange] Obtendo klines para ${symbol} (${interval})...`);
      const klines = await this.marketsClient.getKlines(symbol, interval, limit);
      return klines;
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter klines: ${error.message}`);
      throw error;
    }
  }

  async getTrades(symbol, limit = 100) {
    try {
      Logger.debug(`[BackpackExchange] Obtendo trades para ${symbol}...`);
      const tradesClient = new Trades();
      const trades = await tradesClient.getTrades(symbol, limit);
      return trades;
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter trades: ${error.message}`);
      throw error;
    }
  }

  /**
   * Order Management Methods
   */
  async getOrderHistory(symbol, apiKey, apiSecret, options = {}) {
    try {
      Logger.debug(`[BackpackExchange] Obtendo histórico de ordens para ${symbol}...`);
      const historyClient = new History();
      const orderHistory = await historyClient.getOrderHistory(symbol, apiKey, apiSecret, options);
      return orderHistory;
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter histórico de ordens: ${error.message}`);
      throw error;
    }
  }

  async getOrderStatus(symbol, orderId, apiKey, apiSecret) {
    try {
      Logger.debug(`[BackpackExchange] Obtendo status da ordem ${orderId}...`);
      const orderStatus = await this.orderClient.getOrderStatus(symbol, orderId, apiKey, apiSecret);
      return orderStatus;
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter status da ordem: ${error.message}`);
      throw error;
    }
  }

  async modifyOrder(symbol, orderId, modifications, apiKey, apiSecret) {
    try {
      Logger.debug(`[BackpackExchange] Modificando ordem ${orderId}...`);
      // Backpack pode não suportar modificação direta, implementar como cancel + create
      Logger.warn(`[BackpackExchange] Modificação de ordem não suportada diretamente pela Backpack`);
      throw new Error('Modificação de ordem não suportada pela Backpack - use cancel + create');
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao modificar ordem: ${error.message}`);
      throw error;
    }
  }

  /**
   * Futures Specific Methods
   */
  async getFuturesPositions(apiKey, apiSecret) {
    try {
      Logger.debug(`[BackpackExchange] Obtendo posições de futuros...`);
      const positions = await Futures.getPositions(null, apiKey, apiSecret);
      return positions || [];
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter posições de futuros: ${error.message}`);
      throw error;
    }
  }

  async getFuturesPositionsForceRefresh(apiKey, apiSecret) {
    try {
      Logger.debug(`[BackpackExchange] Obtendo posições de futuros com force refresh...`);
      const positions = await Futures.getOpenPositionsForceRefresh(apiKey, apiSecret);
      return positions || [];
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter posições de futuros (force refresh): ${error.message}`);
      throw error;
    }
  }

  async getFuturesBalance(apiKey, apiSecret) {
    try {
      Logger.debug(`[BackpackExchange] Obtendo balanço de futuros...`);
      const balance = await Futures.getBalance(null, apiKey, apiSecret);
      return balance;
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter balanço de futuros: ${error.message}`);
      throw error;
    }
  }

  async changeLeverage(symbol, leverage, apiKey, apiSecret) {
    try {
      Logger.debug(`[BackpackExchange] Alterando alavancagem para ${symbol}: ${leverage}x...`);
      // Implementar se Backpack suportar mudança de leverage
      Logger.warn(`[BackpackExchange] Mudança de alavancagem pode não ser suportada pela Backpack`);
      throw new Error('Mudança de alavancagem não implementada para Backpack');
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao alterar alavancagem: ${error.message}`);
      throw error;
    }
  }

  /**
   * Utility Methods
   */
  async getOpenOrdersForSymbol(symbol, apiKey, apiSecret) {
    try {
      Logger.debug(`[BackpackExchange] Obtendo ordens abertas para ${symbol}...`);
      const openOrders = await this.orderClient.getOpenOrders(symbol, apiKey, apiSecret);
      return openOrders || [];
    } catch (error) {
      Logger.error(`[BackpackExchange] Erro ao obter ordens abertas: ${error.message}`);
      throw error;
    }
  }

  // O método isOrderFilled já está implementado na BaseExchange usando getOrderStatus
}

export default BackpackExchange;
