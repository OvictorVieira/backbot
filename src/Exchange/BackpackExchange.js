import { BaseExchange } from './BaseExchange.js';
import orderClient from '../Backpack/Authenticated/Order.js';
import Markets from '../Backpack/Public/Markets.js';
import BackpackWebSocket from '../Backpack/Public/WebSocket.js';
import Account from '../Backpack/Authenticated/Account.js';
import Capital from '../Backpack/Authenticated/Capital.js';
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
      // Converte side padrão para formato Backpack
      const backpackSide = side === 'BUY' ? 'Bid' : side === 'SELL' ? 'Ask' : side;

      // Formatar preço com 1 casa decimal para compatibilidade com Backpack API
      const formattedPrice = parseFloat(price).toFixed(1);
      const formattedQuantity = parseFloat(quantity).toFixed(8); // Quantidade com mais precisão

      // Constrói orderBody no formato correto da Backpack
      const orderBody = {
        symbol,
        side: backpackSide,
        orderType: 'Limit',
        quantity: formattedQuantity,
        price: formattedPrice,
        timeInForce: 'GTC', // Good Till Cancel
        postOnly: options.postOnly || true, // Evita taker fees
        selfTradePrevention: 'RejectTaker',
        clientId: options.clientId || null,
        ...options,
      };

      Logger.debug(
        `[BackpackExchange] Criando ordem: ${symbol} ${backpackSide} ${formattedQuantity} @ ${formattedPrice}`,
        {
          clientId: orderBody.clientId,
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

      // Normaliza dados do mercado para formato padrão cross-exchange
      const marketInfo = {
        symbol: market.symbol,
        decimal_quantity: market.quantityScale || 8,
        decimal_price: market.priceScale || 2,
        stepSize_quantity: parseFloat(market.quantityIncrement || '0.00001'),
        tickSize: parseFloat(market.priceIncrement || '0.1'),
        minQuantity: parseFloat(market.minOrderSize || market.quantityIncrement || '0.00001'),
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
}

export default BackpackExchange;
