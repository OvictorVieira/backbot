import { BaseStrategy } from './BaseStrategy.js';
import Logger from '../../Utils/Logger.js';
import { ExchangeFactory } from '../../Exchange/ExchangeFactory.js';
import OrderController from '../../Controllers/OrderController.js';
import MarketFormatter from '../../Utils/MarketFormatter.js';
import OrdersService from '../../Services/OrdersService.js';
import orderClient from '../../Backpack/Authenticated/Order.js';
import ConfigManagerSQLite from '../../Config/ConfigManagerSQLite.js';

/**
 * HFT (High-Frequency Trading) Strategy para maximizar volume de airdrop
 *
 * Esta classe foi refatorada para ser agnóstica à exchange,
 * recebendo uma instância da exchange por injeção de dependência.
 */
class HFTStrategy extends BaseStrategy {
  constructor(exchangeName = 'Backpack') {
    super();
    this.activeGrids = new Map(); // symbol -> gridState
    this.isRunning = false;
    this.executionLoop = null;

    // Cache do orderbook por símbolo para melhor posicionamento de ordens
    this.orderbookCache = new Map(); // symbol -> { bids: [], asks: [], timestamp: number }
    this.orderbookCacheTimeout = 5000; // 5 segundos de cache

    // Position monitoring for Stop Loss and Take Profit
    this.activePositions = new Map(); // symbol -> positionState

    // Recent orders cache to handle race conditions (orderId -> orderData)
    this.recentOrdersCache = new Map(); // orderId -> { timestamp, orderData }
    this.cacheCleanupInterval = 30000; // 30 seconds

    // Injeção de dependência da exchange
    this.exchange = ExchangeFactory.createExchange(exchangeName);
    Logger.info(`🔌 [HFT] Usando exchange: ${this.exchange.name}`);

    // Start cache cleanup interval
    setInterval(() => this.cleanupRecentOrdersCache(), this.cacheCleanupInterval);
  }

  /**
   * Ponto de entrada principal da estratégia HFT
   */
  async executeHFTStrategy(symbol, amount, config) {
    try {
      Logger.info(`🚀 [HFT] Iniciando estratégia HFT para ${symbol}`);
      Logger.info(`📊 [HFT] Input parameters: symbol=${symbol}, amount=${amount}, capitalPercentage=${config.capitalPercentage}%`);
      Logger.info(`🔍 [HFT] Amount type: ${typeof amount}, value: ${amount}`);

      // STEP 1: CRITICAL LOCK CHECK - Must be the FIRST operation
      // This prevents race conditions between WebSocket events and grid recreation
      const activeLock = await this.hasActiveTradingLock(symbol, config);
      if (activeLock) {
        Logger.info(
          `🔒 [HFT] Strategy execution BLOCKED for ${symbol} - active trading lock detected (position open)`
        );
        Logger.debug(`🔒 [HFT] Execution skipped to prevent race condition with position closure`);
        return { success: false, blocked: true, reason: 'Active trading lock' };
      }

      Logger.info(
        `✅ [HFT] No active trading lock found for ${symbol} - proceeding with grid creation`
      );

      // Valida configuração
      this.validateHFTConfig(config);

      // Conecta ao WebSocket da exchange e assina os canais necessários
      await this.exchange.connectWebSocket({
        onOrderbookUpdate: data => this.handleOrderbookUpdate(data, config),
        onUserTradeUpdate: data => this.handleUserTradeUpdate(data, config),
      });

      // Subscribe to orderbook updates for the symbol
      await this.exchange.subscribeOrderbook([symbol]);

      // Subscribe to authenticated user trade updates
      await this.exchange.subscribeUserTrades([symbol], config.apiKey, config.apiSecret);

      // CHECK FOR EXISTING ORDERS - Order Recovery System
      const existingOrders = await this.checkExistingOrdersForBot(config.id, symbol);
      if (existingOrders.length > 0) {
        Logger.info(
          `🔄 [HFT] Found ${existingOrders.length} existing orders for bot ${config.id} on ${symbol}. Recovering...`
        );

        // Recover existing orders instead of creating new ones
        await this.recoverExistingOrders(existingOrders, symbol, config);
        return { success: true, recovered: true };
      }

      // Obtém e cacheia dados iniciais do orderbook
      const orderbook = await this.getOrderbookWithCache(symbol);
      if (!orderbook || !orderbook.bids.length || !orderbook.asks.length) {
        throw new Error(`Orderbook vazio ou inválido para ${symbol}`);
      }

      // Obter informações de formatação do mercado
      const marketInfo = await this.exchange.getMarketInfo(symbol, config.apiKey, config.apiSecret);

      // Calcula preços otimizados baseado no orderbook real
      const { bidPrice, askPrice } = this.calculateOptimalPrices(
        orderbook,
        config.hftSpread,
        marketInfo
      );

      Logger.info(`📊 [HFT] Preços otimizados para ${symbol}:`, {
        bestBid: orderbook.bids[0]?.[0],
        bestAsk: orderbook.asks[0]?.[0],
        ourBid: bidPrice,
        ourAsk: askPrice,
        spread: `${config.hftSpread}%`,
      });

      // VALIDAÇÃO DE SALDO: Verificar se há margem suficiente antes de criar ordens
      try {
        const accountData = await this.exchange.getAccountData(config.apiKey, config.apiSecret);
        if (!accountData || !accountData.capitalAvailable) {
          Logger.error(
            `❌ [HFT] Não foi possível obter dados da conta para ${symbol}. Abortando criação de ordens.`
          );
          return { success: false, error: 'Unable to fetch account data' };
        }

        Logger.debug(`💰 [HFT] Saldo disponível: ${accountData.capitalAvailable} USDC`);

        // Verificar se há capital suficiente (usando uma margem de segurança de 20%)
        const requiredCapital = bidPrice * amount * 1.2; // 20% buffer para segurança
        if (accountData.capitalAvailable < requiredCapital) {
          Logger.warn(`⚠️ [HFT] Margem insuficiente para ${symbol}:`, {
            available: accountData.capitalAvailable,
            required: requiredCapital.toFixed(2),
            orderValue: (bidPrice * amount).toFixed(2),
            amount: amount,
            bidPrice: bidPrice,
          });
          return { success: false, error: 'Insufficient margin' };
        }

        Logger.info(
          `✅ [HFT] Margem validada para ${symbol}: ${accountData.capitalAvailable} USDC disponível`
        );
      } catch (error) {
        Logger.error(`❌ [HFT] Erro ao validar margem para ${symbol}:`, error.message);
        return { success: false, error: 'Failed to validate margin' };
      }

      // Calcular proteções SL/TP para ambas as ordens
      const buyProtection = this.calculateSLTPPrices(orderbook, 'BUY', config, bidPrice);
      const sellProtection = this.calculateSLTPPrices(orderbook, 'SELL', config, askPrice);

      Logger.info(`🛡️ [HFT] Proteções calculadas para ${symbol}:`, {
        buyOrder: {
          stopLoss: buyProtection.stopLossPrice.toFixed(4),
          takeProfit: buyProtection.takeProfitPrice.toFixed(4),
        },
        sellOrder: {
          stopLoss: sellProtection.stopLossPrice.toFixed(4),
          takeProfit: sellProtection.takeProfitPrice.toFixed(4),
        },
      });

      // Generate unique client IDs BEFORE creating promises to avoid conflicts
      const bidClientId = await OrderController.generateUniqueOrderId(config);
      const askClientId = await OrderController.generateUniqueOrderId(config);

      Logger.debug(`🔍 [HFT] Generated unique client IDs:`, {
        bidClientId,
        askClientId,
        symbol,
      });

      // TEMPORARY FIX: Create orders SEQUENTIALLY instead of parallel to test
      // This helps us identify if the issue is with parallel execution or API behavior

      let bidOrder = { status: 'rejected', reason: new Error('Not executed') };
      let askOrder = { status: 'rejected', reason: new Error('Not executed') };

      // Format quantity using market requirements - CRITICAL for API compatibility
      let finalAmount = amount;
      Logger.info(`🔍 [HFT] Initial amount before validation: ${amount}`);

      if (marketInfo && marketInfo.minQuantity) {
        const minQty = parseFloat(marketInfo.minQuantity);

        Logger.debug(`🔍 [HFT] Market requirements for ${symbol}: minQuantity=${marketInfo.minQuantity}, decimal_quantity=${marketInfo.decimal_quantity}`);

        // Safety check - this should already be handled by HFTController, but double-check
        if (amount < minQty) {
          finalAmount = minQty;
          Logger.warn(`⚠️ [HFT] SAFETY CHECK: Amount ${amount} below minimum ${minQty} for ${symbol}, using minimum quantity`);
        } else {
          finalAmount = amount; // Use the amount as-is (should already be validated)
        }

        // CRITICAL: Format the quantity with correct decimal places for the exchange
        finalAmount = MarketFormatter.formatQuantity(finalAmount, marketInfo);
        Logger.info(`📊 [HFT] Final formatted quantity for ${symbol}: ${amount} → ${finalAmount} (with ${marketInfo.decimal_quantity} decimals)`);
      } else {
        Logger.warn(`⚠️ [HFT] No market info with minQuantity found for ${symbol}`);
        finalAmount = amount.toString(); // Use as-is if no market info but ensure it's a string
      }

      try {
        // Place BID order first
        Logger.debug(`🔄 [HFT] Placing BID order sequentially...`);
        const bidResult = await this.exchange.placeOrder(
          symbol,
          'BUY',
          bidPrice,
          finalAmount,
          config.apiKey,
          config.apiSecret,
          this.createOrderOptionsWithProtection(
            orderbook,
            'BUY',
            config,
            marketInfo,
            {
              clientId: bidClientId,
            },
            bidPrice
          )
        );
        bidOrder = { status: 'fulfilled', value: bidResult };
        Logger.debug(`✅ [HFT] BID order completed sequentially`);

        // Small delay between orders to ensure they don't conflict
        await new Promise(resolve => setTimeout(resolve, 100));

        // Place ASK order second
        Logger.debug(`🔄 [HFT] Placing ASK order sequentially...`);
        const askResult = await this.exchange.placeOrder(
          symbol,
          'SELL',
          askPrice,
          finalAmount,
          config.apiKey,
          config.apiSecret,
          this.createOrderOptionsWithProtection(
            orderbook,
            'SELL',
            config,
            marketInfo,
            {
              clientId: askClientId,
            },
            askPrice
          )
        );
        askOrder = { status: 'fulfilled', value: askResult };
        Logger.debug(`✅ [HFT] ASK order completed sequentially`);
      } catch (error) {
        if (!bidOrder.value) {
          bidOrder = { status: 'rejected', reason: error };
          Logger.error(`❌ [HFT] BID order failed:`, error.message);
        } else {
          askOrder = { status: 'rejected', reason: error };
          Logger.error(`❌ [HFT] ASK order failed:`, error.message);
        }
      }

      // Debug log the results
      Logger.info(`🔍 [HFT] Order execution results for ${symbol}:`, {
        bidOrder: {
          status: bidOrder.status,
          id:
            bidOrder.status === 'fulfilled' ? bidOrder.value?.id || bidOrder.value?.orderId : null,
          error: bidOrder.status === 'rejected' ? bidOrder.reason?.message : null,
        },
        askOrder: {
          status: askOrder.status,
          id:
            askOrder.status === 'fulfilled' ? askOrder.value?.id || askOrder.value?.orderId : null,
          error: askOrder.status === 'rejected' ? askOrder.reason?.message : null,
        },
      });

      // Process bid order result
      let bidSuccess = false;
      if (
        bidOrder.status === 'fulfilled' &&
        bidOrder.value &&
        (bidOrder.value.id || bidOrder.value.orderId)
      ) {
        const bidOrderId = bidOrder.value.id || bidOrder.value.orderId;
        Logger.info(`✅ [HFT] BID order created successfully: ${bidOrderId}`);
        // Save to database IMMEDIATELY to avoid race condition
        await this.saveHFTOrderToDatabase(bidOrder.value, symbol, 'BUY', bidPrice, amount, config);
        bidSuccess = true;
      } else {
        Logger.error(
          `❌ [HFT] BID order failed:`,
          bidOrder.status === 'rejected' ? bidOrder.reason : 'No valid order ID'
        );
      }

      // Process ask order result
      let askSuccess = false;
      if (
        askOrder.status === 'fulfilled' &&
        askOrder.value &&
        (askOrder.value.id || askOrder.value.orderId)
      ) {
        const askOrderId = askOrder.value.id || askOrder.value.orderId;
        Logger.info(`✅ [HFT] ASK order created successfully: ${askOrderId}`);
        // Save to database IMMEDIATELY to avoid race condition
        await this.saveHFTOrderToDatabase(askOrder.value, symbol, 'SELL', askPrice, amount, config);
        askSuccess = true;
      } else {
        Logger.error(
          `❌ [HFT] ASK order failed:`,
          askOrder.status === 'rejected' ? askOrder.reason : 'No valid order ID'
        );
      }

      // Salva o estado do grid apenas se pelo menos uma ordem foi criada
      if (bidSuccess || askSuccess) {
        this.activeGrids.set(symbol, {
          bidOrderId: bidSuccess ? bidOrder.value.id || bidOrder.value.orderId : null,
          askOrderId: askSuccess ? askOrder.value.id || askOrder.value.orderId : null,
          bidPrice: bidPrice,
          askPrice: askPrice,
          lastPrice: (bidPrice + askPrice) / 2,
          config: config,
          amount: amount,
        });

        Logger.info(
          `✅ [HFT] Grid ${bidSuccess && askSuccess ? 'completo' : 'parcial'} criado para ${symbol}: BID ${bidSuccess ? '✓' : '✗'}, ASK ${askSuccess ? '✓' : '✗'}`
        );
      } else {
        Logger.error(`❌ [HFT] Falha ao criar ambas as ordens para ${symbol}. Grid não criado.`);
        return { success: false, error: `Falha ao criar ordens HFT para ${symbol}` };
      }

      Logger.info(
        `✅ [HFT] Ordens iniciais para ${symbol} colocadas e salvas no banco: BID ${bidPrice}, ASK ${askPrice}`
      );

      return { success: true };
    } catch (error) {
      Logger.error(`❌ [HFT] Erro na execução da estratégia:`, error.message);

      // Check if it's a margin error to provide better handling
      if (
        error.message &&
        (error.message.includes('INSUFFICIENT_MARGIN') ||
          error.message.includes('Insufficient margin') ||
          error.message.includes('Unable to fetch account data'))
      ) {
        Logger.warn(`⚠️ [HFT] Erro de margem detectado para ${symbol}. Bot não será encerrado.`);
        return { success: false, error: 'Margin error - operation skipped' };
      }

      // For other errors, also return instead of throwing to prevent bot crash
      Logger.warn(`⚠️ [HFT] Erro genérico na estratégia para ${symbol}. Bot continuará operando.`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Obtém orderbook com cache inteligente
   */
  async getOrderbookWithCache(symbol) {
    const now = Date.now();
    const cached = this.orderbookCache.get(symbol);

    // Verifica se o cache ainda é válido
    if (cached && now - cached.timestamp < this.orderbookCacheTimeout) {
      Logger.debug(`📋 [HFT] Usando orderbook em cache para ${symbol}`);
      return cached;
    }

    try {
      const orderbook = await this.exchange.getDepth(symbol);

      const cacheEntry = {
        bids: orderbook.bids || [],
        asks: orderbook.asks || [],
        timestamp: now,
      };

      this.orderbookCache.set(symbol, cacheEntry);
      Logger.debug(`📋 [HFT] Orderbook atualizado e cacheado para ${symbol}`);

      return cacheEntry;
    } catch (error) {
      Logger.error(`❌ [HFT] Erro crítico ao obter orderbook para ${symbol}:`, error.message);

      throw new Error(`Falha ao obter orderbook atualizado para ${symbol}: ${error.message}`);
    }
  }

  /**
   * Calcula preços otimizados baseado no orderbook real
   * Evita "Order would immediately match and take"
   */
  calculateOptimalPrices(orderbook, spreadPercent, marketInfo) {
    // Com dados normalizados da BackpackExchange:
    // bids[0] = melhor bid (maior preço de compra)
    // asks[0] = melhor ask (menor preço de venda)
    const bestBid = parseFloat(orderbook.bids[0]?.[0] || 0);
    const bestAsk = parseFloat(orderbook.asks[0]?.[0] || 0);

    if (!bestBid || !bestAsk) {
      throw new Error('Orderbook inválido: sem bid ou ask');
    }

    const spreadDecimal = spreadPercent / 100;
    const midPrice = (bestBid + bestAsk) / 2;

    // Calcula nossa posição ideal considerando o spread desejado
    let ourBidPrice = midPrice * (1 - spreadDecimal);
    let ourAskPrice = midPrice * (1 + spreadDecimal);

    // PROTEÇÃO: Garante que nossa ordem não vai "take" imediatamente
    // Nossa BID deve ser menor que o melhor bid atual
    if (ourBidPrice >= bestBid) {
      ourBidPrice = bestBid * 0.9999; // Fica 0.01% abaixo
      Logger.warn(`⚠️ [HFT] Ajustou BID para evitar immediate match: ${ourBidPrice}`);
    }

    // Nossa ASK deve ser maior que o melhor ask atual
    if (ourAskPrice <= bestAsk) {
      ourAskPrice = bestAsk * 1.0001; // Fica 0.01% acima
      Logger.warn(`⚠️ [HFT] Ajustou ASK para evitar immediate match: ${ourAskPrice}`);
    }

    // NOVO: Formata preços usando dados do mercado
    const formattedBidPrice = MarketFormatter.formatPrice(ourBidPrice, marketInfo);
    const formattedAskPrice = MarketFormatter.formatPrice(ourAskPrice, marketInfo);

    return {
      bidPrice: parseFloat(formattedBidPrice),
      askPrice: parseFloat(formattedAskPrice),
    };
  }

  /**
   * Atualiza cache do orderbook com dados do WebSocket
   */
  updateOrderbookCache(symbol, data) {
    if (data.bids && data.asks) {
      const cacheEntry = {
        bids: data.bids,
        asks: data.asks,
        timestamp: Date.now(),
      };

      this.orderbookCache.set(symbol, cacheEntry);
      Logger.debug(`📋 [HFT] Cache do orderbook atualizado via WebSocket para ${symbol}`);
    }
  }

  /**
   * Expõe orderbook cache para uso em estratégias tradicionais
   * APENAS retorna dados se estiverem atualizados - NUNCA dados antigos
   */
  getOrderbookFromCache(symbol) {
    const cached = this.orderbookCache.get(symbol);
    const now = Date.now();

    // RIGOROSO: Só retorna se dados estão frescos
    if (cached && now - cached.timestamp < this.orderbookCacheTimeout) {
      return cached;
    }

    // Log para auditoria - dados não disponíveis
    if (cached) {
      const ageSeconds = Math.round((now - cached.timestamp) / 1000);
      Logger.warn(
        `⚠️ [HFT] Orderbook para ${symbol} está desatualizado (${ageSeconds}s) - rejeitando por segurança`
      );
    } else {
      Logger.warn(`⚠️ [HFT] Nenhum orderbook em cache para ${symbol}`);
    }

    return null;
  }

  /**
   * Calcula preços seguros para entrada baseado no orderbook
   * Útil para estratégias tradicionais evitarem immediate match
   * RIGOROSO: Falha imediatamente se dados não estão disponíveis
   */
  calculateSafeEntryPrices(symbol, side, desiredSpreadPercent = 0.1) {
    const orderbook = this.getOrderbookFromCache(symbol);
    if (!orderbook) {
      Logger.error(
        `❌ [HFT] DADOS INDISPONÍVEIS - Não é possível calcular preços seguros para ${symbol}`
      );
      throw new Error(`Orderbook não disponível para ${symbol} - operação cancelada por segurança`);
    }

    const bestBid = parseFloat(orderbook.bids[0]?.[0] || 0);
    const bestAsk = parseFloat(orderbook.asks[0]?.[0] || 0);

    if (!bestBid || !bestAsk) {
      Logger.error(`❌ [HFT] ORDERBOOK INVÁLIDO - Bid: ${bestBid}, Ask: ${bestAsk} para ${symbol}`);
      throw new Error(`Orderbook inválido para ${symbol} - dados insuficientes`);
    }

    const spreadDecimal = desiredSpreadPercent / 100;

    if (side === 'BUY') {
      // Para compra: fica abaixo do melhor bid para não fazer "take"
      const safePrice = bestBid * (1 - spreadDecimal);
      Logger.info(`💰 [HFT] Preço seguro BUY para ${symbol}: ${safePrice} (bid: ${bestBid})`);
      return safePrice;
    } else if (side === 'SELL') {
      // Para venda: fica acima do melhor ask para não fazer "take"
      const safePrice = bestAsk * (1 + spreadDecimal);
      Logger.info(`💰 [HFT] Preço seguro SELL para ${symbol}: ${safePrice} (ask: ${bestAsk})`);
      return safePrice;
    }

    throw new Error(`Lado inválido: ${side}. Use 'BUY' ou 'SELL'`);
  }

  /**
   * Manipula atualizações do Orderbook via WebSocket
   * Implementa o diagrama de validação de desvio de preço E monitoramento de posições
   */
  async handleOrderbookUpdate(data, config) {
    const symbol = data.symbol;
    const grid = this.activeGrids.get(symbol);

    Logger.debug(
      `📊 [HFT] Orderbook update received for ${symbol} - checking if grid needs repositioning`
    );

    // Check if there's an active trading lock (semaphore)
    const activeLock = await this.hasActiveTradingLock(symbol, config);
    if (activeLock) {
      Logger.warn(
        `🔒 [HFT] GRID RECREATION BLOCKED for ${symbol} - trading lock active (position open). This is CORRECT behavior to prevent race conditions.`
      );
      Logger.debug(`🔒 [HFT] Lock details:`, activeLock);
      return;
    }

    // Atualiza cache do orderbook com os novos dados
    this.updateOrderbookCache(symbol, data);

    // Get the current market price for position monitoring
    const currentPrice =
      data.marketPrice ||
      (parseFloat(data.bids[0]?.[0] || 0) + parseFloat(data.asks[0]?.[0] || 0)) / 2;

    // POSITION MONITORING: Check all active positions for this symbol
    await this.onPriceUpdate(symbol, currentPrice, config);

    // REACTIVE GRID MONITORING: Check if grid needs immediate repositioning
    if (!grid) {
      Logger.debug(`⚠️ [HFT] No active grid found for ${symbol} - skipping orderbook analysis`);
      return;
    }

    Logger.debug(`🏗️ [HFT] Active grid found for ${symbol} - analyzing price range`);

    // Fast check: If we have orders but price is clearly outside range, react immediately
    if (grid.bidPrice && grid.askPrice) {
      const quickRangeCheck = currentPrice < grid.bidPrice || currentPrice > grid.askPrice;
      if (quickRangeCheck) {
        Logger.warn(
          `⚡ [HFT] FAST REACTION: Price ${currentPrice} outside order range [${grid.bidPrice}-${grid.askPrice}] for ${symbol}`
        );
        // Proceed to detailed analysis below
      }
    }

    try {
      // Step 1: Get Current Prices
      const buyOrderPrice = grid.bidPrice;
      const sellOrderPrice = grid.askPrice;

      if (!buyOrderPrice || !sellOrderPrice) return;

      // Step 2: Range Analysis - Check if price is outside order range
      const orderRange = {
        min: buyOrderPrice, // BUY order is the lower bound
        max: sellOrderPrice, // SELL order is the upper bound
      };

      const isPriceOutOfRange = currentPrice < orderRange.min || currentPrice > orderRange.max;

      Logger.debug(`🔍 [HFT] Range analysis for ${symbol}:`, {
        currentPrice,
        orderRange: `${orderRange.min} - ${orderRange.max}`,
        buyPrice: buyOrderPrice,
        sellPrice: sellOrderPrice,
        isOutOfRange: isPriceOutOfRange,
        pricePosition:
          currentPrice < orderRange.min
            ? 'BELOW_RANGE'
            : currentPrice > orderRange.max
              ? 'ABOVE_RANGE'
              : 'IN_RANGE',
      });

      // Step 3: Reactive Logic - Cancel and recreate if price is outside range
      if (isPriceOutOfRange) {
        // Immediate Reaction: Price moved out of our order range
        const position = currentPrice < orderRange.min ? 'BELOW' : 'ABOVE';
        Logger.warn(`🚨 [HFT] Price moved ${position} order range for ${symbol}!`, {
          currentPrice,
          orderRange: `${orderRange.min} - ${orderRange.max}`,
          gap:
            position === 'BELOW'
              ? `${(orderRange.min - currentPrice).toFixed(2)} below BUY order`
              : `${(currentPrice - orderRange.max).toFixed(2)} above SELL order`,
        });

        // Cancel all open orders for the pair
        await this.exchange.cancelAllOpenOrders(symbol, config.apiKey, config.apiSecret);
        Logger.info(`🗑️ [HFT] All orders for ${symbol} have been cancelled`);

        // Restart execution cycle IMMEDIATELY (no delay for max reactivity)
        Logger.info(
          `🔄 [HFT] Restarting execution cycle IMMEDIATELY for ${symbol} - price out of range`
        );

        // Remove current grid to allow reinitialization
        this.activeGrids.delete(symbol);

        // Restart strategy immediately for maximum reactivity
        const result = await this.executeHFTStrategy(symbol, grid.amount, config);
        if (result && result.blocked) {
          Logger.debug(`🔒 [HFT] Grid recreation blocked due to active trading lock for ${symbol}`);
        }
      } else {
        // Success Scenario: Price within order range
        Logger.debug(
          `✅ [HFT] Price ${currentPrice} within order range [${orderRange.min}-${orderRange.max}] for ${symbol} - orders still valid`
        );
      }
    } catch (error) {
      Logger.error(`❌ [HFT] Erro no handleOrderbookUpdate para ${symbol}:`, error.message);
    }
  }

  /**
   * Analisa a liquidez e volatilidade do orderbook para determinar estratégia de fechamento
   * @param {object} orderbook - Dados do orderbook
   * @param {number} quantity - Quantidade a ser negociada
   * @returns {object} Análise de mercado { isHighLiquidity, isHighVolatility, maxSlippage, strategy }
   */
  analyzeMarketConditions(orderbook, quantity) {
    try {
      if (!orderbook || !orderbook.bids?.[0] || !orderbook.asks?.[0]) {
        return {
          isHighLiquidity: false,
          isHighVolatility: true,
          maxSlippage: 5.0, // Conservative default
          strategy: 'CONSERVATIVE',
        };
      }

      const bestBid = parseFloat(orderbook.bids[0][0]);
      const bestAsk = parseFloat(orderbook.asks[0][0]);
      const spread = ((bestAsk - bestBid) / bestBid) * 100;

      // Calculate orderbook depth for liquidity analysis
      let bidDepth = 0,
        askDepth = 0;
      let bidLevels = 0,
        askLevels = 0;

      // Analyze bid side depth
      for (const [price, qty] of orderbook.bids.slice(0, 10)) {
        bidDepth += parseFloat(qty);
        bidLevels++;
        if (bidDepth >= quantity * 3) break; // 3x safety margin
      }

      // Analyze ask side depth
      for (const [price, qty] of orderbook.asks.slice(0, 10)) {
        askDepth += parseFloat(qty);
        askLevels++;
        if (askDepth >= quantity * 3) break; // 3x safety margin
      }

      // Liquidity analysis
      const isHighLiquidity =
        bidDepth >= quantity * 5 && askDepth >= quantity * 5 && bidLevels >= 5 && askLevels >= 5;

      // Volatility analysis based on spread
      const isHighVolatility = spread > 0.5; // > 0.5% spread indicates high volatility

      // Determine strategy and max slippage
      let strategy, maxSlippage;

      if (isHighLiquidity && !isHighVolatility) {
        strategy = 'AGGRESSIVE';
        maxSlippage = 0.5; // Allow 0.5% slippage for liquid, stable tokens
      } else if (isHighLiquidity && isHighVolatility) {
        strategy = 'MODERATE';
        maxSlippage = 1.0; // Allow 1% slippage for liquid but volatile tokens
      } else if (!isHighLiquidity && !isHighVolatility) {
        strategy = 'CONSERVATIVE';
        maxSlippage = 2.0; // Allow 2% slippage for illiquid but stable tokens
      } else {
        strategy = 'VERY_CONSERVATIVE';
        maxSlippage = 3.0; // Allow 3% slippage for illiquid and volatile tokens
      }

      Logger.debug(`📊 [HFT] Market analysis for orderbook:`, {
        spread: `${spread.toFixed(3)}%`,
        bidDepth: bidDepth.toFixed(6),
        askDepth: askDepth.toFixed(6),
        bidLevels,
        askLevels,
        isHighLiquidity,
        isHighVolatility,
        strategy,
        maxSlippage: `${maxSlippage}%`,
      });

      return {
        isHighLiquidity,
        isHighVolatility,
        maxSlippage,
        strategy,
        spread,
        bidDepth,
        askDepth,
      };
    } catch (error) {
      Logger.error(`❌ [HFT] Error analyzing market conditions:`, error.message);
      return {
        isHighLiquidity: false,
        isHighVolatility: true,
        maxSlippage: 5.0,
        strategy: 'CONSERVATIVE',
      };
    }
  }

  /**
   * Manipula eventos de trade do usuário via WebSocket
   * Agora inclui sistema de monitoramento de posições para SL/TP
   */
  async handleUserTradeUpdate(data, config) {
    const symbol = data.symbol;
    const grid = this.activeGrids.get(symbol);

    Logger.debug(`🔔 [HFT] WebSocket trade update received:`, {
      symbol: data.symbol,
      orderId: data.orderId,
      status: data.status,
      side: data.side,
      hasActiveGrid: !!grid,
    });

    // CRITICAL: Check if this is a CLOSURE ORDER being FILLED - highest priority
    if (data.status && data.status.toString().toUpperCase() === 'FILLED') {
      Logger.debug(
        `🔍 [HFT] FILLED order detected: ${data.orderId} - checking if it's a closure order`
      );
      const activeLock = await this.getTradingLock(symbol, config);

      if (activeLock) {
        Logger.debug(`🔍 [HFT] Active lock found for ${symbol}:`, {
          lockId: activeLock.id,
          metadata: activeLock.metadata,
        });

        if (activeLock.metadata) {
          try {
            const metadata = JSON.parse(activeLock.metadata);
            Logger.debug(`🔍 [HFT] Lock metadata parsed:`, {
              closureOrderId: metadata.closureOrderId,
              incomingOrderId: data.orderId,
            });

            if (metadata.closureOrderId && metadata.closureOrderId === data.orderId) {
              Logger.warn(`🎯 [HFT] CLOSURE ORDER FILLED DETECTED: ${data.orderId} for ${symbol}`);
              Logger.info(
                `🔓 [HFT] Position closure confirmed - RELEASING TRADING LOCK immediately`
              );

              // Release the trading lock - position is now closed
              await this.releaseTradingLock(symbol, config);

              Logger.info(
                `✅ [HFT] Trading lock RELEASED for ${symbol} - grid recreation now allowed`
              );
              Logger.info(`🎉 [HFT] Position fully closed and race condition protection completed`);

              // Update order status in database
              await this.updateHFTOrderStatus(data.orderId, 'FILLED', data.price, data.quantity);

              // Restart grid after position closure confirmation
              const grid = this.activeGrids.get(symbol);
              if (grid) {
                Logger.info(
                  `🔄 [HFT] Restarting grid for ${symbol} after position closure confirmation`
                );
                setTimeout(async () => {
                  const result = await this.executeHFTStrategy(symbol, grid.amount, config);
                  if (result && result.success) {
                    Logger.info(
                      `✅ [HFT] Grid recreated successfully for ${symbol} after position closure`
                    );
                  } else if (result && result.blocked) {
                    Logger.warn(
                      `🔒 [HFT] Grid recreation still blocked for ${symbol} - unexpected lock state`
                    );
                  }
                }, 1000); // Small delay to ensure lock is fully released
              }

              return; // Exit early - this was a closure order
            }
          } catch (error) {
            Logger.error(
              `❌ [HFT] Error parsing lock metadata for closure detection:`,
              error.message
            );
          }
        } else {
          Logger.debug(`🔍 [HFT] No metadata found in lock for ${symbol}`);
        }
      } else {
        Logger.debug(`🔍 [HFT] No active lock found for ${symbol} - not a closure order`);
      }
    }

    // Atualiza status da ordem no banco de dados sempre (mesmo sem grid ativo)
    if (data.orderId && data.status) {
      await this.updateHFTOrderStatus(data.orderId, data.status, data.price, data.quantity);
    }

    // Se não temos grid ativo, verifica se esta ordem pertence ao nosso bot
    if (!grid) {
      await this.handleOrphanOrderUpdate(data, config);
      return;
    }

    // Reage às mudanças de status das ordens do grid ativo
    Logger.debug(
      `🔍 [HFT] Checking if order ${data.orderId} belongs to grid. BidOrderId: ${grid.bidOrderId}, AskOrderId: ${grid.askOrderId}`
    );

    if (data.orderId === grid.bidOrderId || data.orderId === grid.askOrderId) {
      Logger.info(`✅ [HFT] Order ${data.orderId} belongs to active grid, processing...`);
      if (data.status && data.status.toString().toUpperCase() === 'FILLED') {
        Logger.warn(
          `🚨 [HFT] FILLED EVENT DETECTED - Initiating immediate position management for ${symbol}`
        );
        Logger.info(
          `💰 [HFT] Ordem ${data.orderId} para ${symbol} foi preenchida (${data.side}). Iniciando sequência de fechamento...`
        );

        const isBuy = data.side === 'BUY';

        // STEP 1: CREATE TRADING LOCK IMMEDIATELY - This is the CRITICAL operation
        // Must happen BEFORE any other operation to prevent race conditions
        Logger.warn(`🔒 [HFT] STEP 1: Creating IMMEDIATE trading lock to prevent race conditions`);
        try {
          await this.createTradingLock(symbol, config, data.orderId, {
            entryPrice: parseFloat(data.price),
            side: isBuy ? 'LONG' : 'SHORT',
            quantity: parseFloat(data.quantity),
            timestamp: Date.now(),
            reason: 'ORDER_FILLED_IMMEDIATE_LOCK',
          });
          Logger.info(
            `✅ [HFT] Trading lock created successfully for ${symbol} - grid recreation now blocked`
          );
        } catch (error) {
          Logger.error(
            `❌ [HFT] CRITICAL: Failed to create trading lock for ${symbol}:`,
            error.message
          );
          // Continue anyway to attempt position closure
        }

        // STEP 2: Cancel the other order in the market making pair
        const otherOrderId = isBuy ? grid.askOrderId : grid.bidOrderId;
        Logger.debug(
          `🔍 [HFT] STEP 2: Current grid state: BID=${grid.bidOrderId}, ASK=${grid.askOrderId}`
        );
        Logger.info(
          `🔍 [HFT] Order ${data.orderId} was filled (${data.side}), cancelling opposite order: ${otherOrderId}`
        );

        if (otherOrderId && otherOrderId !== data.orderId) {
          try {
            Logger.info(`🗑️ [HFT] Cancelling opposite order ${otherOrderId} for ${symbol}...`);
            await this.exchange.cancelOrder(symbol, otherOrderId, config.apiKey, config.apiSecret);
            Logger.info(
              `✅ [HFT] Successfully cancelled opposite order ${otherOrderId} for ${symbol}`
            );

            // Update order status in database
            await this.updateHFTOrderStatus(otherOrderId, 'CANCELED');
          } catch (error) {
            Logger.error(
              `❌ [HFT] Failed to cancel opposite order ${otherOrderId}:`,
              error.message
            );
          }
        } else {
          Logger.warn(
            `⚠️ [HFT] No valid opposite order to cancel. otherOrderId=${otherOrderId}, currentOrderId=${data.orderId}`
          );
        }

        // STEP 3: Update the filled order status in database
        await this.updateHFTOrderStatus(data.orderId, 'FILLED', data.price, data.quantity);

        // STEP 3: Create position state object
        const position = {
          symbol: symbol,
          side: isBuy ? 'LONG' : 'SHORT', // LONG for BUY fills, SHORT for SELL fills
          entryPrice: parseFloat(data.price),
          netQuantity: parseFloat(data.quantity),
          timestamp: Date.now(),
          orderId: data.orderId,
          botId: config.id,
        };

        // HFT STRATEGY: CLOSE POSITION IMMEDIATELY TO MINIMIZE RISK EXPOSURE
        Logger.warn(
          `🚀 [HFT] IMMEDIATE CLOSURE - Order filled, closing position instantly to minimize risk exposure`
        );

        try {
          // Get the current market price for immediate closure - use adaptive strategy based on market conditions
          const orderbook = await this.getOrderbookWithCache(symbol);

          if (!orderbook) {
            // No orderbook available - use fallback strategy
            Logger.warn(
              `⚠️ [HFT] No orderbook available for ${symbol}, falling back to position monitoring`
            );
            throw new Error('No orderbook data available for immediate closure');
          }

          // Analyze market conditions to determine optimal closure strategy
          const marketAnalysis = this.analyzeMarketConditions(orderbook, position.netQuantity);

          Logger.info(`🎯 [HFT] Market analysis for ${symbol}:`, {
            strategy: marketAnalysis.strategy,
            liquidity: marketAnalysis.isHighLiquidity ? 'HIGH' : 'LOW',
            volatility: marketAnalysis.isHighVolatility ? 'HIGH' : 'LOW',
            maxSlippage: `${marketAnalysis.maxSlippage}%`,
            spread: `${marketAnalysis.spread.toFixed(3)}%`,
          });

          // Determine closure price based on market conditions and strategy
          let currentMarketPrice;
          let shouldAttemptImmediate = true;

          if (marketAnalysis.strategy === 'VERY_CONSERVATIVE') {
            // For very risky conditions, skip immediate closure and use monitoring
            Logger.warn(
              `🚨 [HFT] Market conditions too risky for immediate closure (${marketAnalysis.strategy})`
            );
            Logger.warn(
              `🚨 [HFT] Spread: ${marketAnalysis.spread.toFixed(3)}%, Low liquidity detected`
            );
            shouldAttemptImmediate = false;
          } else {
            // Calculate optimal price based on strategy
            const bestBid = parseFloat(orderbook.bids[0][0]);
            const bestAsk = parseFloat(orderbook.asks[0][0]);
            const entryPrice = parseFloat(data.price);

            if (position.side === 'LONG') {
              // Selling a LONG position
              if (marketAnalysis.strategy === 'AGGRESSIVE') {
                currentMarketPrice = bestBid; // Take best bid immediately
              } else {
                // Conservative approach: check if slippage is acceptable
                const potentialSlippage = ((entryPrice - bestBid) / entryPrice) * 100;
                if (Math.abs(potentialSlippage) <= marketAnalysis.maxSlippage) {
                  currentMarketPrice = bestBid;
                } else {
                  Logger.warn(
                    `🚨 [HFT] Potential slippage too high: ${potentialSlippage.toFixed(2)}% > ${marketAnalysis.maxSlippage}%`
                  );
                  shouldAttemptImmediate = false;
                }
              }
            } else {
              // Buying to close SHORT position
              if (marketAnalysis.strategy === 'AGGRESSIVE') {
                currentMarketPrice = bestAsk; // Take best ask immediately
              } else {
                // Conservative approach: check if slippage is acceptable
                const potentialSlippage = ((bestAsk - entryPrice) / entryPrice) * 100;
                if (Math.abs(potentialSlippage) <= marketAnalysis.maxSlippage) {
                  currentMarketPrice = bestAsk;
                } else {
                  Logger.warn(
                    `🚨 [HFT] Potential slippage too high: ${potentialSlippage.toFixed(2)}% > ${marketAnalysis.maxSlippage}%`
                  );
                  shouldAttemptImmediate = false;
                }
              }
            }
          }

          if (!shouldAttemptImmediate) {
            throw new Error(
              `Market conditions unsuitable for immediate closure: ${marketAnalysis.strategy}`
            );
          }

          // Close position immediately with adaptive pricing
          Logger.warn(
            `🔒 [HFT] About to call closePosition - will update lock IMMEDIATELY with closure order ID`
          );

          const closeResult = await this.closePosition(
            position,
            currentMarketPrice,
            `IMMEDIATE_HFT_CLOSURE_${marketAnalysis.strategy}`,
            config
          );

          if (closeResult && closeResult.success) {
            Logger.info(`✅ [HFT] Position closure order placed successfully`);

            // Get closure order ID - check multiple possible properties
            const closureOrderId =
              closeResult.closeOrder?.id || closeResult.closeOrder?.orderId || closeResult.orderId;

            if (closureOrderId) {
              // IMMEDIATE SYNCHRONOUS UPDATE - no delays allowed
              const lockData = {
                entryPrice: parseFloat(data.price),
                side: isBuy ? 'LONG' : 'SHORT',
                quantity: parseFloat(data.quantity),
                timestamp: Date.now(),
                reason: 'ORDER_FILLED_AWAITING_CLOSURE',
                closureOrderId: closureOrderId,
                entryOrderId: data.orderId,
              };

              // Update the lock metadata using direct database call - ZERO DELAY
              const dbService = ConfigManagerSQLite.dbService;
              if (dbService) {
                const updateResult = await dbService.run(
                  'UPDATE trading_locks SET metadata = ? WHERE botId = ? AND symbol = ? AND lockType = ? AND status = ?',
                  [JSON.stringify(lockData), config.id, symbol, 'POSITION_OPEN', 'ACTIVE']
                );
                Logger.warn(
                  `🔒 [HFT] CRITICAL: Trading lock IMMEDIATELY UPDATED with closure order ${closureOrderId} (affected: ${updateResult.changes} rows)`
                );
              }

              Logger.warn(
                `🔒 [HFT] CRITICAL: Trading lock remains ACTIVE until closure order ${closureOrderId} is FILLED`
              );
              Logger.info(
                `⏳ [HFT] Lock will be released when closure order ${closureOrderId} receives FILLED status`
              );
            } else {
              Logger.error(
                `❌ [HFT] Could not determine closure order ID from result:`,
                closeResult
              );
              // Release lock immediately if we can't track closure order
              await this.releaseTradingLock(symbol, config);
            }
          } else {
            Logger.error(`❌ [HFT] Position closure failed:`, closeResult?.error);
            throw new Error(`Position closure failed: ${closeResult?.error}`);
          }

          // STEP 4: DO NOT RELEASE LOCK YET - Wait for position closure confirmation
          Logger.warn(
            `🔒 [HFT] STEP 4: Position closure order placed - lock remains active until closure confirmed`
          );
          Logger.info(`⏳ [HFT] Lock will be released when closure order is confirmed as FILLED`);

          // Clear grid state immediately
          if (isBuy) {
            grid.askOrderId = null;
            grid.bidOrderId = null;
          } else {
            grid.bidOrderId = null;
            grid.askOrderId = null;
          }

          // Skip the rest of the logic since position is already closed
          Logger.debug(`🔚 [HFT] Position closed and lock released - grid ready for recreation`);
          return;
        } catch (error) {
          Logger.error(`❌ [HFT] Failed to close position immediately:`, error.message);
          Logger.warn(`⚠️ [HFT] Falling back to position monitoring as safety measure`);
          // Continue with original logic as fallback
        }

        // FALLBACK LOGIC (only executed if immediate closure fails)
        // STEP 3: Calculate Stop Loss and Take Profit prices for monitoring
        if (config.maxNegativePnLStopPct && config.maxNegativePnLStopPct > 0) {
          const stopLossPercent = config.maxNegativePnLStopPct / 100;
          position.stopLossPrice = isBuy
            ? position.entryPrice * (1 - stopLossPercent) // For LONG: stop below entry
            : position.entryPrice * (1 + stopLossPercent); // For SHORT: stop above entry
        }

        if (config.minTakeProfitPct && config.minTakeProfitPct > 0) {
          const takeProfitPercent = config.minTakeProfitPct / 100;
          position.takeProfitPrice = isBuy
            ? position.entryPrice * (1 + takeProfitPercent) // For LONG: profit above entry
            : position.entryPrice * (1 - takeProfitPercent); // For SHORT: profit below entry
        }

        // STEP 4: Add position to active monitoring (FALLBACK)
        this.activePositions.set(`${symbol}_${config.id}`, position);

        Logger.warn(`⚠️ [HFT] FALLBACK: Position monitoring activated (immediate closure failed)`, {
          side: position.side,
          entryPrice: position.entryPrice,
          quantity: position.netQuantity,
          stopLoss: position.stopLossPrice,
          takeProfit: position.takeProfitPrice,
        });

        // STEP 5: Trading lock already created above - monitoring will handle closure
        Logger.warn(
          `🔒 [HFT] FALLBACK: Trading lock remains active - position monitoring will handle closure and lock release`
        );

        // Clear grid state to prevent automatic recreation
        if (isBuy) {
          grid.askOrderId = null; // Clear the opposite order
          grid.bidOrderId = null; // Clear the filled order
        } else {
          grid.bidOrderId = null; // Clear the opposite order
          grid.askOrderId = null; // Clear the filled order
        }
      } else if (data.status && data.status.toString().toUpperCase() === 'CANCELED') {
        Logger.warn(
          `⚠️ [HFT] Ordem ${data.orderId} para ${symbol} foi cancelada externamente! Status: ${data.status}`
        );

        // Identifica qual ordem foi cancelada
        const isBidOrder = data.orderId === grid.bidOrderId;
        const isAskOrder = data.orderId === grid.askOrderId;

        Logger.debug(
          `🔍 [HFT] Verificando cancelamento: isBidOrder=${isBidOrder}, isAskOrder=${isAskOrder}`
        );
        Logger.debug(
          `🔍 [HFT] Grid atual: bidOrderId=${grid.bidOrderId}, askOrderId=${grid.askOrderId}`
        );

        if (isBidOrder) {
          Logger.info(`🔄 [HFT] BID order cancelada, limpando referência e reativando grid`);
          grid.bidOrderId = null;
        }

        if (isAskOrder) {
          Logger.info(`🔄 [HFT] ASK order cancelada, limpando referência e reativando grid`);
          grid.askOrderId = null;
        }

        // Reativa o grid APENAS se não há trading lock ativo (posição aberta)
        const lockStatus = await this.hasActiveTradingLock(symbol, config);
        if (!lockStatus) {
          Logger.info(`🔄 [HFT] Iniciando reativação do grid para ${symbol}...`);
          await this.reactivateGrid(symbol, grid, config);
        } else {
          Logger.warn(
            `🔒 [HFT] CRITICAL: Grid reactivation BLOCKED for ${symbol} - trading lock active. This prevents creating conflicting orders during position closure.`
          );
          Logger.debug(`🔒 [HFT] Lock details:`, lockStatus);
        }
      } else if (data.status && data.status.toString().toUpperCase() === 'REJECTED') {
        Logger.error(
          `❌ [HFT] Ordem ${data.orderId} para ${symbol} foi rejeitada. Verificando grid.`
        );

        // Para ordens rejeitadas, tenta recriar o grid apenas se não há lock ativo
        if (!(await this.hasActiveTradingLock(symbol, config))) {
          setTimeout(async () => {
            const result = await this.executeHFTStrategy(symbol, grid.amount, config);
            if (result && result.blocked) {
              Logger.debug(
                `🔒 [HFT] Delayed grid recreation blocked due to active trading lock for ${symbol}`
              );
            }
          }, 5000);
        } else {
          Logger.info(
            `🔒 [HFT] Grid recreation blocked for ${symbol} - trading lock active (position open)`
          );
        }
      }
    } else {
      Logger.debug(`⚠️ [HFT] Order ${data.orderId} does not belong to current grid. Ignoring.`);
    }

    Logger.debug(`🔚 [HFT] Finished processing trade update for ${data.orderId}`);
  }

  /**
   * Handles order updates when no active grid exists (orphan orders)
   * This can happen when orders are cancelled externally but bot still receives updates
   */
  async handleOrphanOrderUpdate(data, config) {
    const symbol = data.symbol;

    // Check if this order belongs to our bot by checking database
    try {
      const orders = await OrdersService.getOrdersByBotId(config.id);
      const matchingOrder = orders.find(
        order => order.externalOrderId === data.orderId && order.symbol === symbol
      );

      if (!matchingOrder) {
        Logger.debug(`🔍 [HFT] Order ${data.orderId} não pertence ao bot ${config.id}, ignorando`);
        return;
      }

      Logger.warn(
        `🔔 [HFT] Received update for orphan order ${data.orderId} (status: ${data.status})`
      );

      if (data.status && data.status.toString().toUpperCase() === 'CANCELED') {
        Logger.warn(
          `⚠️ [HFT] Bot order ${data.orderId} was cancelled externally! Reactivating bot for ${symbol}`
        );

        // Reativate the entire strategy for this symbol
        await this.reactivateBotForSymbol(symbol, config);
      }
    } catch (error) {
      Logger.error(`❌ [HFT] Error checking orphan order ${data.orderId}:`, error.message);
    }
  }

  /**
   * Reactivates the grid to maintain both BID and ASK orders active
   */
  async reactivateGrid(symbol, grid, config) {
    try {
      // Check if there's an active trading lock (semaphore)
      if (await this.hasActiveTradingLock(symbol, config)) {
        Logger.info(
          `🔒 [HFT] Grid reactivation blocked for ${symbol} - trading lock active (position open).`
        );
        return;
      }

      Logger.info(`🔄 [HFT] Reactivating grid for ${symbol} to maintain both targets`);

      // Get current orderbook
      const orderbook = await this.getOrderbookWithCache(symbol);
      if (!orderbook || !orderbook.bids.length || !orderbook.asks.length) {
        throw new Error(`Orderbook inválido para reativação do ${symbol}`);
      }

      // Get market info
      const marketInfo = await this.exchange.getMarketInfo(symbol, config.apiKey, config.apiSecret);

      // Calculate optimal prices
      const { bidPrice, askPrice } = this.calculateOptimalPrices(
        orderbook,
        config.hftSpread,
        marketInfo
      );

      // Validate and adjust quantity if needed based on market requirements
      let finalAmount = grid.amount;
      if (marketInfo && marketInfo.filters && marketInfo.filters.quantity) {
        const { minQuantity, stepSize } = marketInfo.filters.quantity;
        const minQty = parseFloat(minQuantity);

        // If quantity is below minimum, use minimum quantity
        if (grid.amount < minQty) {
          finalAmount = minQty;
          Logger.warn(`⚠️ [HFT] Amount ${grid.amount} below minimum ${minQty} for ${symbol}, using minimum quantity`);
        }

        // Format quantity using market requirements with stepSize
        finalAmount = MarketFormatter.formatQuantity(finalAmount, marketInfo);
        Logger.info(`📊 [HFT] Reactivate adjusted quantity for ${symbol}: ${grid.amount} → ${finalAmount}`);
      }

      // Place missing orders with SL/TP protection
      if (!grid.bidOrderId) {
        Logger.info(`📈 [HFT] Placing new BID order for ${symbol} at ${bidPrice}`);
        const bidOrder = await this.exchange.placeOrder(
          symbol,
          'BUY',
          bidPrice,
          finalAmount,
          config.apiKey,
          config.apiSecret,
          this.createOrderOptionsWithProtection(
            orderbook,
            'BUY',
            config,
            marketInfo,
            {
              clientId: await OrderController.generateUniqueOrderId(config),
            },
            bidPrice
          )
        );

        await this.saveHFTOrderToDatabase(bidOrder, symbol, 'BUY', bidPrice, finalAmount, config);
        grid.bidOrderId = bidOrder.id;
        grid.bidPrice = bidPrice;
      }

      if (!grid.askOrderId) {
        Logger.info(`📉 [HFT] Placing new ASK order for ${symbol} at ${askPrice}`);
        const askOrder = await this.exchange.placeOrder(
          symbol,
          'SELL',
          askPrice,
          finalAmount,
          config.apiKey,
          config.apiSecret,
          this.createOrderOptionsWithProtection(
            orderbook,
            'SELL',
            config,
            marketInfo,
            {
              clientId: await OrderController.generateUniqueOrderId(config),
            },
            askPrice
          )
        );

        await this.saveHFTOrderToDatabase(askOrder, symbol, 'SELL', askPrice, finalAmount, config);
        grid.askOrderId = askOrder.id;
        grid.askPrice = askPrice;
      }

      Logger.info(`✅ [HFT] Grid reactivated for ${symbol} - both targets are now active`);
    } catch (error) {
      Logger.error(`❌ [HFT] Error reactivating grid for ${symbol}:`, error.message);

      // Fallback: restart entire strategy
      Logger.warn(`🔄 [HFT] Fallback: restarting entire strategy for ${symbol}`);
      this.activeGrids.delete(symbol);
      setTimeout(async () => {
        const result = await this.executeHFTStrategy(symbol, grid.amount, config);
        if (result && result.blocked) {
          Logger.debug(
            `🔒 [HFT] Orphan order grid recreation blocked due to active trading lock for ${symbol}`
          );
        }
      }, 3000);
    }
  }

  /**
   * Reactivates the bot for a symbol after external cancellation
   */
  async reactivateBotForSymbol(symbol, config) {
    try {
      Logger.info(`🚀 [HFT] Reactivating bot for ${symbol} after external cancellation`);

      // Cancel any remaining orders for this symbol to start fresh
      try {
        await this.exchange.cancelAllOpenOrders(symbol, config.apiKey, config.apiSecret);
      } catch (error) {
        Logger.warn(`⚠️ [HFT] Error cancelling remaining orders: ${error.message}`);
      }

      // Remove any existing grid
      this.activeGrids.delete(symbol);

      // Get the original amount from database or use default
      const existingOrders = await this.checkExistingOrdersForBot(config.id, symbol);
      const defaultAmount =
        existingOrders.length > 0 ? existingOrders[0].quantity : config.capitalPercentage || 5;

      // Restart strategy after a delay
      setTimeout(async () => {
        const result = await this.executeHFTStrategy(symbol, defaultAmount, config);
        if (result && result.blocked) {
          Logger.debug(
            `🔒 [HFT] Bot reactivation blocked due to active trading lock for ${symbol}`
          );
        }
      }, 2000);
    } catch (error) {
      Logger.error(`❌ [HFT] Error reactivating bot for ${symbol}:`, error.message);
    }
  }

  /**
   * Cancela e reposiciona as ordens
   */
  async repositionOrders(symbol, grid) {
    await this.exchange.cancelAllOpenOrders(symbol, grid.config.apiKey, grid.config.apiSecret);
    const result = await this.executeHFTStrategy(symbol, grid.amount, grid.config);
    if (result && result.blocked) {
      Logger.debug(`🔒 [HFT] Order repositioning blocked due to active trading lock for ${symbol}`);
    }
  }

  /**
   * Salva ordem HFT no banco de dados para tracking
   */
  async saveHFTOrderToDatabase(order, symbol, side, price, amount, config) {
    try {
      // Verifica se a ordem foi criada com sucesso
      const orderId = order.id || order.orderId;
      if (!orderId) {
        Logger.warn(`⚠️ [HFT] Ordem falhou, não salvando no banco: ${symbol} ${side}`);
        return null;
      }

      const orderData = {
        botId: config.id,
        externalOrderId: orderId,
        symbol: symbol,
        side: side,
        quantity: parseFloat(amount),
        price: parseFloat(price),
        orderType: 'HFT_LIMIT',
        status: 'NEW', // Start with NEW status instead of PENDING to match WebSocket events
        clientId: order.clientId || null,
        timestamp: new Date().toISOString(),
        exchangeCreatedAt: new Date().toISOString(),
      };

      // Add to cache BEFORE saving to database to handle race conditions
      this.recentOrdersCache.set(orderId, {
        timestamp: Date.now(),
        orderData: orderData,
      });

      // Use immediate execution to minimize race condition window
      await OrdersService.addOrder(orderData);
      Logger.info(
        `💾 [HFT] Ordem salva no banco IMEDIATAMENTE: ${symbol} ${side} ${amount} @ ${price} (OrderID: ${orderId})`
      );

      return orderId;
    } catch (error) {
      Logger.error(`❌ [HFT] Erro CRÍTICO ao salvar ordem no banco:`, error.message);
      // This is critical - if we can't save to DB, we have a serious race condition
      throw error; // Propagate error so caller knows about the issue
    }
  }

  /**
   * Atualiza status da ordem HFT no banco de dados
   */
  async updateHFTOrderStatus(
    orderId,
    newStatus,
    closePrice = null,
    closeQuantity = null,
    retryCount = 0
  ) {
    const maxRetries = 3;
    const retryDelay = 100; // 100ms

    try {
      // Check if order exists in recent cache first
      const cachedOrder = this.recentOrdersCache.get(orderId);
      if (cachedOrder) {
        Logger.debug(`🔍 [HFT] Ordem ${orderId} encontrada no cache, status confiável para update`);
      }

      // Atualiza status da ordem usando externalOrderId
      await OrdersService.updateOrderStatus(orderId, newStatus);
      Logger.debug(`💾 [HFT] Status da ordem atualizado no banco: ${orderId} -> ${newStatus}`);

      // Remove from cache after successful update
      if (cachedOrder) {
        this.recentOrdersCache.delete(orderId);
        Logger.debug(`🗑️ [HFT] Ordem ${orderId} removida do cache após update`);
      }
    } catch (error) {
      if (retryCount < maxRetries && error.message.includes('não encontrada')) {
        // Order not found - check cache first
        const cachedOrder = this.recentOrdersCache.get(orderId);
        if (cachedOrder) {
          Logger.warn(
            `⚠️ [HFT] Ordem ${orderId} está no cache mas não no banco (race condition detectada). Tentativa ${retryCount + 1}/${maxRetries + 1}...`
          );
        } else {
          Logger.warn(
            `⚠️ [HFT] Ordem ${orderId} não encontrada no banco nem no cache (tentativa ${retryCount + 1}/${maxRetries + 1}). Retrying in ${retryDelay}ms...`
          );
        }

        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return this.updateHFTOrderStatus(
          orderId,
          newStatus,
          closePrice,
          closeQuantity,
          retryCount + 1
        );
      } else {
        Logger.error(
          `❌ [HFT] Erro ao atualizar status da ordem no banco (após ${retryCount} tentativas):`,
          error.message
        );
      }
    }
  }

  /**
   * Clean up old entries from recent orders cache
   */
  cleanupRecentOrdersCache() {
    const now = Date.now();
    const maxAge = 60000; // 1 minute

    let cleaned = 0;
    for (const [orderId, data] of this.recentOrdersCache.entries()) {
      if (now - data.timestamp > maxAge) {
        this.recentOrdersCache.delete(orderId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      Logger.debug(`🧹 [HFT] Cache cleanup: removidas ${cleaned} ordens antigas`);
    }
  }

  /**
   * Check for existing active orders for this bot to implement order recovery
   */
  async checkExistingOrdersForBot(botId, symbol) {
    try {
      // Get all orders for this bot that are in active states (not FILLED, CANCELED, REJECTED)
      const activeStatuses = ['PENDING', 'NEW', 'PARTIALLY_FILLED'];
      const orders = await OrdersService.getOrdersByBotId(botId);

      // Filter for active orders on this symbol with active status
      const existingActiveOrders = orders.filter(
        order => order.symbol === symbol && activeStatuses.includes(order.status)
      );

      Logger.debug(
        `🔍 [HFT] Found ${existingActiveOrders.length} existing active orders for bot ${botId} on ${symbol}`
      );
      return existingActiveOrders;
    } catch (error) {
      Logger.error(`❌ [HFT] Error checking existing orders for bot ${botId}:`, error.message);
      return [];
    }
  }

  /**
   * Recover existing orders by restoring grid state and monitoring them
   */
  async recoverExistingOrders(existingOrders, symbol, config) {
    try {
      Logger.info(`🔍 [HFT] Validating ${existingOrders.length} existing orders for ${symbol}...`);

      // Separate BUY and SELL orders
      const buyOrders = existingOrders.filter(order => order.side === 'BUY');
      const sellOrders = existingOrders.filter(order => order.side === 'SELL');

      // Find the latest orders (in case there are multiple)
      const latestBuyOrder =
        buyOrders.length > 0
          ? buyOrders.reduce((latest, current) =>
              new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest
            )
          : null;

      const latestSellOrder =
        sellOrders.length > 0
          ? sellOrders.reduce((latest, current) =>
              new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest
            )
          : null;

      // Validate orders are still active on the exchange
      let validBuyOrder = null;
      let validSellOrder = null;

      if (latestBuyOrder) {
        const isActive = await this.validateOrderStatus(
          latestBuyOrder.externalOrderId,
          symbol,
          config
        );
        if (isActive) {
          validBuyOrder = latestBuyOrder;
          Logger.info(
            `✅ [HFT] BUY order ${latestBuyOrder.externalOrderId} is still active on exchange`
          );
        } else {
          Logger.warn(
            `❌ [HFT] BUY order ${latestBuyOrder.externalOrderId} is no longer active on exchange - discarding`
          );
          await this.updateHFTOrderStatus(latestBuyOrder.externalOrderId, 'CANCELED');
        }
      }

      if (latestSellOrder) {
        const isActive = await this.validateOrderStatus(
          latestSellOrder.externalOrderId,
          symbol,
          config
        );
        if (isActive) {
          validSellOrder = latestSellOrder;
          Logger.info(
            `✅ [HFT] SELL order ${latestSellOrder.externalOrderId} is still active on exchange`
          );
        } else {
          Logger.warn(
            `❌ [HFT] SELL order ${latestSellOrder.externalOrderId} is no longer active on exchange - discarding`
          );
          await this.updateHFTOrderStatus(latestSellOrder.externalOrderId, 'CANCELED');
        }
      }

      // Only recover if we have at least one valid order
      if (!validBuyOrder && !validSellOrder) {
        Logger.warn(
          `⚠️ [HFT] No valid orders found for ${symbol}. Checking for recent orders before creating new ones...`
        );

        // SAFETY CHECK: Verify there are no other recent orders to avoid duplicates
        try {
          const allOpenOrders = await orderClient.getOpenOrders(
            symbol,
            'PERP',
            config.apiKey,
            config.apiSecret
          );
          const recentOrders = allOpenOrders.filter(
            order => new Date(order.timestamp) > new Date(Date.now() - 60000) // Last 1 minute
          );

          if (recentOrders.length > 0) {
            Logger.warn(
              `⚠️ [HFT] Found ${recentOrders.length} recent orders for ${symbol}. Skipping fresh order creation to avoid duplicates.`
            );
            Logger.info(
              `📋 [HFT] Recent orders:`,
              recentOrders.map(o => `${o.id} ${o.side} ${o.status}`)
            );
            return;
          }
        } catch (error) {
          Logger.warn(`⚠️ [HFT] Could not check for recent orders: ${error.message}`);
        }

        // Start fresh strategy instead of recovering
        const orderbook = await this.getOrderbookWithCache(symbol);
        const marketInfo = await this.exchange.getMarketInfo(
          symbol,
          config.apiKey,
          config.apiSecret
        );
        const { bidPrice, askPrice } = this.calculateOptimalPrices(
          orderbook,
          config.hftSpread,
          marketInfo
        );

        const defaultAmount = existingOrders[0]?.quantity || config.capitalPercentage || 5;

        // Validate and adjust quantity if needed based on market requirements
        let finalAmount = defaultAmount;
        if (marketInfo && marketInfo.filters && marketInfo.filters.quantity) {
          const { minQuantity, stepSize } = marketInfo.filters.quantity;
          const minQty = parseFloat(minQuantity);

          // If quantity is below minimum, use minimum quantity
          if (defaultAmount < minQty) {
            finalAmount = minQty;
            Logger.warn(`⚠️ [HFT] Amount ${defaultAmount} below minimum ${minQty} for ${symbol}, using minimum quantity`);
          }

          // Format quantity using market requirements with stepSize
          finalAmount = MarketFormatter.formatQuantity(finalAmount, marketInfo);
          Logger.info(`📊 [HFT] Fresh order adjusted quantity for ${symbol}: ${defaultAmount} → ${finalAmount}`);
        }

        Logger.info(
          `🆕 [HFT] Creating fresh orders for ${symbol}: BID ${bidPrice}, ASK ${askPrice}`
        );

        const bidOrder = await this.exchange.placeOrder(
          symbol,
          'BUY',
          bidPrice,
          finalAmount,
          config.apiKey,
          config.apiSecret,
          this.createOrderOptionsWithProtection(
            orderbook,
            'BUY',
            config,
            marketInfo,
            {
              clientId: await OrderController.generateUniqueOrderId(config),
            },
            bidPrice
          )
        );

        const askOrder = await this.exchange.placeOrder(
          symbol,
          'SELL',
          askPrice,
          finalAmount,
          config.apiKey,
          config.apiSecret,
          this.createOrderOptionsWithProtection(
            orderbook,
            'SELL',
            config,
            marketInfo,
            {
              clientId: await OrderController.generateUniqueOrderId(config),
            },
            askPrice
          )
        );

        await this.saveHFTOrderToDatabase(bidOrder, symbol, 'BUY', bidPrice, defaultAmount, config);
        await this.saveHFTOrderToDatabase(
          askOrder,
          symbol,
          'SELL',
          askPrice,
          defaultAmount,
          config
        );

        this.activeGrids.set(symbol, {
          bidOrderId: bidOrder.id,
          askOrderId: askOrder.id,
          bidPrice: bidPrice,
          askPrice: askPrice,
          lastPrice: (bidPrice + askPrice) / 2,
          config: config,
          amount: defaultAmount,
        });

        Logger.info(`✅ [HFT] Fresh orders placed for ${symbol}: BID ${bidPrice}, ASK ${askPrice}`);
        return;
      }

      // Restore grid state with validated orders
      const gridState = {
        bidOrderId: validBuyOrder?.externalOrderId || null,
        askOrderId: validSellOrder?.externalOrderId || null,
        bidPrice: validBuyOrder?.price || null,
        askPrice: validSellOrder?.price || null,
        lastPrice:
          validBuyOrder && validSellOrder
            ? (parseFloat(validBuyOrder.price) + parseFloat(validSellOrder.price)) / 2
            : null,
        config: config,
        amount: validBuyOrder?.quantity || validSellOrder?.quantity || null,
      };

      this.activeGrids.set(symbol, gridState);

      Logger.info(`🔄 [HFT] Grid state recovered for ${symbol}:`, {
        bidOrderId: gridState.bidOrderId,
        askOrderId: gridState.askOrderId,
        bidPrice: gridState.bidPrice,
        askPrice: gridState.askPrice,
      });

      // Complete missing side if needed
      if (gridState.bidOrderId && !gridState.askOrderId) {
        Logger.warn(`⚠️ [HFT] Only BUY order recovered, placing missing ASK order`);
        await this.reactivateGrid(symbol, gridState, config);
      } else if (gridState.askOrderId && !gridState.bidOrderId) {
        Logger.warn(`⚠️ [HFT] Only SELL order recovered, placing missing BID order`);
        await this.reactivateGrid(symbol, gridState, config);
      }

      const validOrdersCount = (validBuyOrder ? 1 : 0) + (validSellOrder ? 1 : 0);
      Logger.info(`✅ [HFT] Successfully recovered ${validOrdersCount} valid orders for ${symbol}`);
    } catch (error) {
      Logger.error(`❌ [HFT] Error recovering existing orders for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Validates if an order is still active on the exchange
   */
  async validateOrderStatus(orderId, symbol, config) {
    try {
      Logger.info(`🔍 [HFT] Validating order ${orderId} for ${symbol}...`);

      const orderStatus = await orderClient.getOpenOrder(
        symbol,
        orderId,
        null,
        config.apiKey,
        config.apiSecret
      );

      Logger.info(`🔍 [HFT] Raw order response for ${orderId}:`, orderStatus);

      if (!orderStatus) {
        Logger.warn(`🔍 [HFT] Order ${orderId} not found on exchange (likely cancelled or filled)`);
        return false;
      }

      // Check if order is in an active state - be more permissive with status names
      const activeStatuses = [
        'PENDING',
        'NEW',
        'PARTIALLY_FILLED',
        'Open',
        'PartiallyFilled',
        'Pending',
        'Active',
        'Working',
        'Live',
        'Unfilled',
        'PartiallyFilled',
      ];
      const isActive = activeStatuses.includes(orderStatus.status);

      Logger.info(`🔍 [HFT] Order ${orderId} validation result:`, {
        status: orderStatus.status,
        isActive,
        activeStatuses,
        rawOrderData: orderStatus,
      });

      return isActive;
    } catch (error) {
      Logger.error(`❌ [HFT] Error validating order ${orderId}:`, error.message);
      Logger.error(`❌ [HFT] Error details:`, {
        error: error.message,
        stack: error.stack,
        response: error.response?.data,
      });

      // IMPORTANT: If we can't validate, assume it's ACTIVE to be safe and avoid creating duplicates
      Logger.warn(
        `⚠️ [HFT] Cannot validate order ${orderId}, assuming ACTIVE to prevent duplicates`
      );
      return true;
    }
  }

  /**
   * Real-time position monitoring via WebSocket price updates
   * Implements Stop Loss and Take Profit logic as per user requirements
   */
  async onPriceUpdate(symbol, currentPrice, config) {
    try {
      // Check all positions for this bot on this symbol
      const positionKey = `${symbol}_${config.id}`;
      const position = this.activePositions.get(positionKey);

      if (!position) return; // No position to monitor

      Logger.debug(`📊 [HFT] Monitoring position for ${symbol}:`, {
        side: position.side,
        entry: position.entryPrice,
        current: currentPrice,
        pnlPercent: `${pnlPercent.toFixed(4)}%`,
        configuredSpread: `${config.hftSpread || 0.05}%`,
        stopLoss: position.stopLossPrice,
        takeProfit: position.takeProfitPrice,
      });

      // Calculate current PnL percentage
      const pnlPercent =
        position.side === 'LONG'
          ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
          : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;

      // Check if position should be closed
      const shouldClose = await this.shouldClosePosition(
        position,
        currentPrice,
        pnlPercent,
        config
      );

      if (shouldClose.close) {
        Logger.warn(`🚨 [HFT] Position closure triggered for ${symbol}:`, {
          reason: shouldClose.reason,
          side: position.side,
          entryPrice: position.entryPrice,
          currentPrice: currentPrice,
          pnlPercent: `${pnlPercent.toFixed(4)}%`,
          configuredSpread: `${config.hftSpread || 0.05}%`,
          details: shouldClose.details,
        });

        // Close the position
        await this.closePosition(position, currentPrice, shouldClose.reason, config);

        // Remove position from monitoring
        this.activePositions.delete(positionKey);
        Logger.info(`🗑️ [HFT] Position monitoring stopped for ${symbol} - position closed`);
      } else {
        Logger.debug(
          `✅ [HFT] Position monitoring continues for ${symbol} - PnL: ${pnlPercent.toFixed(4)}%`
        );
      }
    } catch (error) {
      Logger.error(`❌ [HFT] Error in onPriceUpdate for ${symbol}:`, error.message);
    }
  }

  /**
   * Determines if a position should be closed based on SL/TP rules
   */
  async shouldClosePosition(position, currentPrice, pnlPercent, config) {
    try {
      // NOVA VALIDAÇÃO: Check slippage baseado na configuração do usuário
      // Usa o mesmo spread configurado como limite de loss/gain
      const configuredSpread = config.hftSpread || 0.05; // Spread padrão de 0.05%

      // Valida tanto para lado negativo (loss) quanto positivo (gain)
      const absSlippage = Math.abs(pnlPercent);

      if (absSlippage >= configuredSpread) {
        const reason = pnlPercent > 0 ? 'TAKE_PROFIT_SLIPPAGE' : 'STOP_LOSS_SLIPPAGE';
        const direction = pnlPercent > 0 ? 'GAIN' : 'LOSS';

        Logger.warn(`🚨 [HFT] Slippage trigger detected for ${position.symbol}:`, {
          pnlPercent: `${pnlPercent.toFixed(4)}%`,
          configuredSpread: `${configuredSpread}%`,
          direction,
          entryPrice: position.entryPrice,
          currentPrice,
          slippage: `${absSlippage.toFixed(4)}%`,
        });

        return {
          close: true,
          reason,
          details: `Slippage ${absSlippage.toFixed(4)}% exceeded configured spread ${configuredSpread}% (${direction})`,
        };
      }

      // Check Stop Loss (mantém lógica original para compatibilidade)
      if (position.stopLossPrice) {
        const shouldTriggerStopLoss =
          position.side === 'LONG'
            ? currentPrice <= position.stopLossPrice
            : currentPrice >= position.stopLossPrice;

        if (shouldTriggerStopLoss) {
          return {
            close: true,
            reason: 'STOP_LOSS',
            details: `Price ${currentPrice} hit stop loss ${position.stopLossPrice}`,
          };
        }
      }

      // Check Take Profit (mantém lógica original para compatibilidade)
      if (position.takeProfitPrice) {
        const shouldTriggerTakeProfit =
          position.side === 'LONG'
            ? currentPrice >= position.takeProfitPrice
            : currentPrice <= position.takeProfitPrice;

        if (shouldTriggerTakeProfit) {
          return {
            close: true,
            reason: 'TAKE_PROFIT',
            details: `Price ${currentPrice} hit take profit ${position.takeProfitPrice}`,
          };
        }
      }

      // Position should remain open
      return {
        close: false,
        reason: 'CONTINUE_MONITORING',
        details: `Position monitoring continues - PnL: ${pnlPercent.toFixed(2)}%`,
      };
    } catch (error) {
      Logger.error(`❌ [HFT] Error in shouldClosePosition:`, error.message);
      return { close: false, reason: 'ERROR', details: error.message };
    }
  }

  /**
   * Closes a position by placing a market order in the opposite direction
   * Implements the position closure logic for SL/TP execution
   */
  async closePosition(position, currentPrice, reason, config) {
    try {
      Logger.info(`🔥 [HFT] Closing position for ${position.symbol}:`, {
        reason,
        side: position.side,
        entryPrice: position.entryPrice,
        closePrice: currentPrice,
        quantity: position.netQuantity,
      });

      // Determine the closing order side (opposite of position side)
      const closingSide = position.side === 'LONG' ? 'SELL' : 'BUY';

      // Get market info for proper formatting
      const marketInfo = await this.exchange.getMarketInfo(
        position.symbol,
        config.apiKey,
        config.apiSecret
      );

      // Format quantity using market requirements
      const formattedQuantity = MarketFormatter.formatQuantity(position.netQuantity, marketInfo);

      // Determine order strategy based on reason (contains market analysis)
      let orderOptions = {
        clientId: await OrderController.generateUniqueOrderId(config),
        postOnly: false,
        reduceOnly: true, // This is a position closing order
      };

      // Adaptive order strategy based on market conditions
      if (reason.includes('AGGRESSIVE')) {
        // High liquidity, low volatility - use aggressive market order
        orderOptions = {
          ...orderOptions,
          orderType: 'Market',
          timeInForce: 'IOC', // Immediate or Cancel for fastest execution
        };
        Logger.info(`⚡ [HFT] Using AGGRESSIVE strategy for ${position.symbol} - Market/IOC order`);
      } else if (reason.includes('MODERATE')) {
        // High liquidity, high volatility - use market with GTC fallback
        orderOptions = {
          ...orderOptions,
          orderType: 'Market',
          timeInForce: 'GTC', // Allow partial fills over time
        };
        Logger.info(`⚡ [HFT] Using MODERATE strategy for ${position.symbol} - Market/GTC order`);
      } else if (reason.includes('CONSERVATIVE') || reason.includes('VERY_CONSERVATIVE')) {
        // Conservative strategy - always use Market orders to avoid "Order would immediately match and take" error
        // Limit orders are rejected by exchanges when they would execute immediately
        orderOptions = {
          ...orderOptions,
          orderType: 'Market',
          timeInForce: 'IOC', // Use IOC for immediate execution
        };
        Logger.info(
          `🛡️ [HFT] Using CONSERVATIVE strategy for ${position.symbol} - Market/IOC order (avoiding limit order rejection)`
        );
      } else {
        // Default fallback - standard market order
        orderOptions = {
          ...orderOptions,
          orderType: 'Market',
          timeInForce: 'IOC',
        };
        Logger.info(`🔄 [HFT] Using DEFAULT strategy for ${position.symbol} - Market/IOC order`);
      }

      // Place adaptive order to close position
      let closeOrder;

      if (orderOptions.orderType === 'Market') {
        // For market orders, don't pass price parameter
        closeOrder = await this.exchange.placeOrder(
          position.symbol,
          closingSide,
          undefined, // No price for market orders
          formattedQuantity,
          config.apiKey,
          config.apiSecret,
          orderOptions
        );
      } else {
        // For limit orders, include price
        closeOrder = await this.exchange.placeOrder(
          position.symbol,
          closingSide,
          currentPrice,
          formattedQuantity,
          config.apiKey,
          config.apiSecret,
          orderOptions
        );
      }

      // Calculate realized PnL
      const realizedPnL =
        position.side === 'LONG'
          ? (currentPrice - position.entryPrice) * position.netQuantity
          : (position.entryPrice - currentPrice) * position.netQuantity;

      const realizedPnLPercent = (realizedPnL / (position.entryPrice * position.netQuantity)) * 100;

      // Save the closing order to database
      // For market orders, use the execution price if available, otherwise use original currentPrice for logging
      const logPrice = orderOptions.orderType === 'Market' ? currentPrice : currentPrice;

      await this.saveHFTOrderToDatabase(
        closeOrder,
        position.symbol,
        closingSide,
        logPrice,
        formattedQuantity,
        config
      );

      // Log position closure details
      Logger.info(`✅ [HFT] Position closed successfully for ${position.symbol}:`, {
        reason,
        originalSide: position.side,
        closingSide,
        entryPrice: position.entryPrice,
        closePrice: logPrice,
        orderType: orderOptions.orderType,
        quantity: position.netQuantity,
        realizedPnL: realizedPnL.toFixed(6),
        realizedPnLPercent: `${realizedPnLPercent.toFixed(2)}%`,
        closeOrderId: closeOrder.id || closeOrder.orderId,
      });

      // Update the original order status if we can track it
      if (position.orderId) {
        await this.updateHFTOrderStatus(position.orderId, 'CLOSED_BY_SL_TP');
      }

      // Update the closing order status to FILLED (since it's a market order, it should execute immediately)
      const closeOrderId = closeOrder.id || closeOrder.orderId;
      if (closeOrderId) {
        await this.updateHFTOrderStatus(closeOrderId, 'FILLED', logPrice, formattedQuantity);
        Logger.info(`✅ [HFT] Closing order ${closeOrderId} marked as FILLED in database`);
      }

      // NOTE: Trading lock will be released when the closure order is confirmed as FILLED via WebSocket
      Logger.info(
        `🔓 [HFT] Position closure order placed for ${position.symbol}. Lock remains active until FILLED confirmation.`
      );

      // Grid recreation will happen automatically when the lock is released via WebSocket FILLED event

      // Return immediately to avoid timing issues - cleanup will happen elsewhere
      const result = {
        success: true,
        closeOrder,
        realizedPnL,
        realizedPnLPercent,
      };

      // Cancel any remaining orders for this symbol (cleanup) - do this asynchronously to avoid timing issues
      setImmediate(async () => {
        try {
          await this.exchange.cancelAllOpenOrders(position.symbol, config.apiKey, config.apiSecret);
          Logger.info(`🧹 [HFT] Cleanup: cancelled remaining orders for ${position.symbol}`);
        } catch (error) {
          Logger.warn(`⚠️ [HFT] Error cancelling orders during cleanup: ${error.message}`);
        }
      });

      return result;
    } catch (error) {
      Logger.error(`❌ [HFT] Error closing position for ${position.symbol}:`, error.message);

      // Return to monitoring state if closure fails
      Logger.warn(`⚠️ [HFT] Position closure failed, continuing monitoring for ${position.symbol}`);

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Valida configuração HFT dinâmica
   */
  validateHFTConfig(config) {
    if (!config.hftSpread || config.hftSpread <= 0) {
      throw new Error('Configuração hftSpread é obrigatória e deve ser > 0');
    }

    if (!config.hftRebalanceFrequency || config.hftRebalanceFrequency < 30) {
      throw new Error('Configuração hftRebalanceFrequency é obrigatória e deve ser >= 30 segundos');
    }

    if (!config.capitalPercentage || config.capitalPercentage <= 0) {
      throw new Error('Configuração capitalPercentage é obrigatória e deve ser > 0');
    }

    if (!config.hftDailyHours || config.hftDailyHours < 1 || config.hftDailyHours > 24) {
      throw new Error('Configuração hftDailyHours deve estar entre 1 e 24 horas');
    }

    if (
      !config.hftMaxPriceDeviation ||
      config.hftMaxPriceDeviation <= 0 ||
      config.hftMaxPriceDeviation > 10
    ) {
      throw new Error('Configuração hftMaxPriceDeviation deve estar entre 0.1% e 10%');
    }

    Logger.info(`✅ [HFT] Configuração dinâmica válida:`, {
      spread: `${config.hftSpread}%`,
      rebalanceFreq: `${config.hftRebalanceFrequency}s`,
      maxPriceDeviation: `${config.hftMaxPriceDeviation}%`,
      capitalPercentage: `${config.capitalPercentage}%`,
      dailyHours: `${config.hftDailyHours}h`,
    });
  }

  /**
   * Calcula volume diário estimado baseado nas configurações
   */
  calculateExpectedDailyVolume(marketPrice, totalCapital, config) {
    // Volume por ordem = (capital total * orderSize%) * preço
    const capitalPerOrder = (totalCapital * config.capitalPercentage) / 100;
    const volumePerOrder = capitalPerOrder * marketPrice;

    // Número de rebalanceamentos por dia
    const rebalancesPerHour = 3600 / config.hftRebalanceFrequency;
    const rebalancesPerDay = rebalancesPerHour * config.hftDailyHours;

    // Volume diário estimado (assumindo 50% de execução)
    const executionRate = 0.5;
    const dailyVolume = volumePerOrder * rebalancesPerDay * executionRate;

    Logger.info(`📊 [HFT] Volume diário estimado:`, {
      capitalPerOrder: `$${capitalPerOrder.toFixed(2)}`,
      volumePerOrder: `$${volumePerOrder.toFixed(2)}`,
      rebalancesPerDay: Math.floor(rebalancesPerDay),
      estimatedDailyVolume: `$${dailyVolume.toFixed(2)}`,
    });

    return {
      capitalPerOrder,
      volumePerOrder,
      rebalancesPerDay: Math.floor(rebalancesPerDay),
      estimatedDailyVolume: dailyVolume,
    };
  }

  /**
   * Cria estado inicial do grid para um símbolo com lógica dinâmica
   */
  createGridState(symbol, marketPrice, amount, config) {
    // Valida configuração antes de usar
    this.validateHFTConfig(config);

    const spread = config.hftSpread / 100; // Converte % para decimal
    const gridSpacing = marketPrice * spread;

    // Calcula quantidade por ordem baseado na configuração dinâmica
    const orderQuantity = (amount * config.capitalPercentage) / 100;

    // Calcula métricas de volume dinâmicas
    const volumeMetrics = this.calculateExpectedDailyVolume(marketPrice, amount, config);

    return {
      symbol,
      marketPrice,
      amount,
      config,
      spread,
      gridSpacing,
      orderQuantity,
      buyPrice: marketPrice - gridSpacing,
      sellPrice: marketPrice + gridSpacing,
      activeBuyOrder: null,
      activeSellOrder: null,
      executedTrades: [],
      totalVolume: 0,
      netPosition: 0,
      volumeMetrics,
      rebalanceInterval: config.hftRebalanceFrequency * 1000, // Converte para ms
      dailyHours: config.hftDailyHours,
      createdAt: new Date(),
      lastUpdate: new Date(),
      isActive: this.shouldBeActiveNow(config.hftDailyHours),
    };
  }

  /**
   * Verifica se o bot deve estar ativo no momento atual baseado nas horas diárias
   */
  shouldBeActiveNow(dailyHours) {
    if (dailyHours >= 24) return true;

    const now = new Date();
    const currentHour = now.getHours();

    // Distribui as horas de forma inteligente (evitando madrugada)
    const startHour = dailyHours <= 8 ? 9 : 6; // Começa 9h se <= 8h, senão 6h
    const endHour = (startHour + dailyHours) % 24;

    if (startHour <= endHour) {
      return currentHour >= startHour && currentHour < endHour;
    } else {
      // Caso que cruza a meia-noite
      return currentHour >= startHour || currentHour < endHour;
    }
  }

  /**
   * Coloca ordens iniciais do grid (compra e venda)
   */
  async placeInitialGridOrders(gridState) {
    try {
      Logger.info(`📦 [HFT] Colocando ordens iniciais do grid para ${gridState.symbol}`);

      // Ordem de compra (usa orderQuantity calculada dinamicamente)
      const buyOrder = await this.placeLimitOrder({
        symbol: gridState.symbol,
        side: 'Bid',
        price: gridState.buyPrice,
        quantity: gridState.orderQuantity,
        type: 'grid_buy',
      });

      // Ordem de venda (usa orderQuantity calculada dinamicamente)
      const sellOrder = await this.placeLimitOrder({
        symbol: gridState.symbol,
        side: 'Ask',
        price: gridState.sellPrice,
        quantity: gridState.orderQuantity,
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
      // Get market info to validate minimum quantity
      const marketInfo = await this.exchange.getMarketInfo(
        symbol,
        this.config.apiKey,
        this.config.apiSecret
      );

      // Validate and adjust quantity if needed
      let finalQuantity = quantity;
      if (marketInfo && marketInfo.filters && marketInfo.filters.quantity) {
        const { minQuantity, stepSize } = marketInfo.filters.quantity;
        const minQty = parseFloat(minQuantity);

        // If quantity is below minimum, use minimum quantity
        if (quantity < minQty) {
          finalQuantity = minQty;
          Logger.warn(`⚠️ [HFT] Quantity ${quantity} below minimum ${minQty} for ${symbol}, using minimum quantity`);
        }

        // Format quantity using market requirements with stepSize
        finalQuantity = MarketFormatter.formatQuantity(finalQuantity, marketInfo);
      }

      // Usa OrderBookAnalyzer para otimizar preço se disponível
      const OrderBookAnalyzer = await import('../../Utils/OrderBookAnalyzer.js');
      const optimalPrice = await OrderBookAnalyzer.default.getOptimalPrice(
        symbol,
        side === 'Bid' ? 'BUY' : 'SELL',
        price
      );

      const finalPrice = optimalPrice || price;

      Logger.debug(`📝 [HFT] Criando ordem ${type}: ${side} ${finalQuantity} ${symbol} @ ${finalPrice}`);

      const result = await this.exchange.placeOrder(
        symbol,
        side,
        finalPrice,
        finalQuantity,
        this.config.apiKey,
        this.config.apiSecret,
        { clientId: await OrderController.generateUniqueOrderId(this.config) }
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

      // Clean up active positions monitoring
      if (symbol) {
        // Remove positions for specific symbol
        const positionsToRemove = [];
        for (const [positionKey, position] of this.activePositions.entries()) {
          if (position.symbol === symbol) {
            positionsToRemove.push(positionKey);
          }
        }
        positionsToRemove.forEach(key => {
          this.activePositions.delete(key);
          Logger.info(`🗑️ [HFT] Removed position monitoring for ${key}`);
        });
      } else {
        // Clear all positions
        const positionCount = this.activePositions.size;
        this.activePositions.clear();
        Logger.info(`🗑️ [HFT] Cleared ${positionCount} active position monitors`);
      }

      // Para cache do orderbook
      if (this.orderBookCache && this.orderBookCache.disconnect) {
        await this.orderBookCache.disconnect();
      }

      // Disconnect WebSocket and cleanup subscriptions
      if (this.exchange.disconnectWebSocket) {
        await this.exchange.disconnectWebSocket();
        Logger.info('🔌 [HFT] WebSocket disconnected and subscriptions cleaned up');
      }

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
        await this.exchange.cancelOrder(
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
        executed:
          status &&
          status.status &&
          ['FILLED', 'PARTIALLYFILLED'].includes(status.status.toString().toUpperCase()),
        status: status?.status || 'Unknown',
      };
    } catch (error) {
      Logger.warn(`⚠️ [HFT] Erro ao verificar status da ordem ${order.id}:`, error.message);
      return { executed: false, status: 'Error' };
    }
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

  /**
   * Calcula preços de Stop Loss e Take Profit baseados no spread do usuário
   */
  calculateSLTPPrices(orderbook, side, config, entryPrice) {
    const bestBid = parseFloat(orderbook.bids[0][0]);
    const bestAsk = parseFloat(orderbook.asks[0][0]);

    // Usa o spread do usuário como base para SL/TP - distâncias simétricas
    const userSpread = config.hftSpread || 0.1; // Spread do usuário em %
    const basePrice = entryPrice || (side === 'BUY' ? bestAsk : bestBid);

    if (side === 'BUY') {
      // Para ordem BUY: SL abaixo do preço de entrada, TP acima
      return {
        stopLossPrice: basePrice * (1 - userSpread / 100),
        takeProfitPrice: basePrice * (1 + userSpread / 100),
      };
    } else {
      // Para ordem SELL: SL acima do preço de entrada, TP abaixo
      return {
        stopLossPrice: basePrice * (1 + userSpread / 100),
        takeProfitPrice: basePrice * (1 - userSpread / 100),
      };
    }
  }

  /**
   * Cria options com proteção SL/TP para ordem
   */
  createOrderOptionsWithProtection(
    orderbook,
    side,
    config,
    marketInfo,
    baseOptions = {},
    entryPrice = null
  ) {
    const { stopLossPrice, takeProfitPrice } = this.calculateSLTPPrices(
      orderbook,
      side,
      config,
      entryPrice
    );

    // Usa a formatação correta baseada no marketInfo do símbolo
    const priceDecimals = marketInfo.decimal_price || 1;

    return {
      ...baseOptions,
      takeProfitTriggerBy: 'LastPrice',
      takeProfitTriggerPrice: takeProfitPrice.toFixed(priceDecimals),
      takeProfitLimitPrice: takeProfitPrice.toFixed(priceDecimals),
      stopLossTriggerBy: 'LastPrice',
      stopLossTriggerPrice: stopLossPrice.toFixed(priceDecimals),
      stopLossLimitPrice: stopLossPrice.toFixed(priceDecimals),
    };
  }

  /**
   * Trading Lock Management Methods
   */

  /**
   * Check if there's an active trading lock for this bot/symbol
   */
  async hasActiveTradingLock(symbol, config) {
    try {
      const dbService = ConfigManagerSQLite.dbService;
      if (!dbService) {
        Logger.warn(`⚠️ [TRADING_LOCK] Database service not available`);
        return false;
      }
      return await dbService.hasActiveTradingLock(config.id, symbol, 'POSITION_OPEN');
    } catch (error) {
      Logger.error(`❌ [TRADING_LOCK] Error checking lock:`, error.message);
      return false;
    }
  }

  /**
   * Create a trading lock when position opens
   */
  async createTradingLock(symbol, config, positionId, metadata = null) {
    try {
      const dbService = ConfigManagerSQLite.dbService;
      if (!dbService) {
        Logger.warn(`⚠️ [TRADING_LOCK] Database service not available`);
        return false;
      }
      return await dbService.createTradingLock(
        config.id,
        symbol,
        'POSITION_OPEN',
        'Position opened - Grid suspended',
        positionId,
        metadata
      );
    } catch (error) {
      Logger.error(`❌ [TRADING_LOCK] Error creating lock:`, error.message);
      return false;
    }
  }

  /**
   * Release trading lock when position closes
   */
  async releaseTradingLock(symbol, config) {
    try {
      const dbService = ConfigManagerSQLite.dbService;
      if (!dbService) {
        Logger.warn(`⚠️ [TRADING_LOCK] Database service not available`);
        return false;
      }
      return await dbService.releaseTradingLock(config.id, symbol, 'POSITION_OPEN');
    } catch (error) {
      Logger.error(`❌ [TRADING_LOCK] Error releasing lock:`, error.message);
      return false;
    }
  }

  /**
   * Get active trading lock details
   */
  async getTradingLock(symbol, config) {
    try {
      const dbService = ConfigManagerSQLite.dbService;
      if (!dbService) {
        Logger.warn(`⚠️ [TRADING_LOCK] Database service not available`);
        return null;
      }
      return await dbService.getTradingLock(config.id, symbol, 'POSITION_OPEN');
    } catch (error) {
      Logger.error(`❌ [TRADING_LOCK] Error getting lock:`, error.message);
      return null;
    }
  }
}

export default HFTStrategy;
