import WebSocket from 'ws';
import Markets from '../Backpack/Public/Markets.js';
import Logger from './Logger.js';

/**
 * Cache em memória do orderbook com atualizações via WebSocket
 *
 * Mantém orderbook local sincronizado para decisões instantâneas do HFT
 * - Cache em RAM para latência mínima
 * - Inicialização via REST API (snapshot)
 * - Atualizações via WebSocket (deltas)
 * - Não persiste em disco
 */
class OrderBookCache {
  constructor() {
    this.markets = new Markets();
    this.cache = new Map(); // symbol -> orderbook
    this.websockets = new Map(); // symbol -> ws connection
    this.isInitialized = false;
    this.heartbeatInterval = null;
  }

  /**
   * Inicializa cache para um símbolo
   */
  async initialize(symbol) {
    try {
      Logger.info(`📚 [ORDERBOOK_CACHE] Inicializando cache para ${symbol}`);

      // 1. Obtém snapshot inicial via REST
      await this.loadInitialSnapshot(symbol);

      // 2. Conecta WebSocket para atualizações
      await this.connectWebSocket(symbol);

      this.isInitialized = true;
      Logger.info(`✅ [ORDERBOOK_CACHE] Cache inicializado para ${symbol}`);
    } catch (error) {
      Logger.error(`❌ [ORDERBOOK_CACHE] Erro ao inicializar cache:`, error.message);
      throw error;
    }
  }

  /**
   * Carrega snapshot inicial do orderbook via REST API
   */
  async loadInitialSnapshot(symbol) {
    try {
      Logger.debug(`📷 [ORDERBOOK_CACHE] Carregando snapshot inicial para ${symbol}`);

      const depth = await this.markets.getDepth(symbol);
      if (!depth || !depth.bids || !depth.asks) {
        throw new Error(`Snapshot inválido para ${symbol}`);
      }

      // Armazena no cache
      this.cache.set(symbol, {
        symbol,
        bids: depth.bids,
        asks: depth.asks,
        lastUpdate: Date.now(),
        updateCount: 0,
      });

      Logger.debug(
        `📚 [ORDERBOOK_CACHE] Snapshot carregado: ${depth.bids.length} bids, ${depth.asks.length} asks`
      );
    } catch (error) {
      Logger.error(`❌ [ORDERBOOK_CACHE] Erro ao carregar snapshot:`, error.message);
      throw error;
    }
  }

  /**
   * Conecta WebSocket para atualizações em tempo real
   */
  async connectWebSocket(symbol) {
    try {
      Logger.debug(`🔌 [ORDERBOOK_CACHE] Conectando WebSocket para ${symbol}`);

      const wsUrl = this.getWebSocketUrl();
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        Logger.info(`🔗 [ORDERBOOK_CACHE] WebSocket conectado para ${symbol}`);

        // Subscreve ao canal do orderbook
        const subscribeMessage = {
          method: 'SUBSCRIBE',
          params: [`${symbol.toLowerCase()}@depth`],
          id: Date.now(),
        };

        ws.send(JSON.stringify(subscribeMessage));
        Logger.debug(`📡 [ORDERBOOK_CACHE] Subscrito ao canal ${symbol}@depth`);
      });

      ws.on('message', data => {
        try {
          this.processWebSocketMessage(symbol, data);
        } catch (error) {
          Logger.error(`❌ [ORDERBOOK_CACHE] Erro ao processar mensagem WS:`, error.message);
        }
      });

      ws.on('error', error => {
        Logger.error(`❌ [ORDERBOOK_CACHE] Erro WebSocket:`, error.message);
        this.handleWebSocketError(symbol, error);
      });

      ws.on('close', (code, reason) => {
        Logger.warn(`⚠️ [ORDERBOOK_CACHE] WebSocket fechado (${code}): ${reason}`);
        this.handleWebSocketClose(symbol, code, reason);
      });

      // Armazena conexão
      this.websockets.set(symbol, ws);

      // Inicia heartbeat se necessário
      this.startHeartbeat();
    } catch (error) {
      Logger.error(`❌ [ORDERBOOK_CACHE] Erro ao conectar WebSocket:`, error.message);
      throw error;
    }
  }

  /**
   * Processa mensagens do WebSocket
   */
  processWebSocketMessage(symbol, data) {
    try {
      const message = JSON.parse(data.toString());

      // Ignora mensagens de confirmação e ping/pong
      if (message.id || message.result !== undefined || message.method === 'ping') {
        return;
      }

      // Processa atualizações do orderbook
      if (message.stream && message.stream.includes('@depth')) {
        this.updateOrderbook(symbol, message.data);
      }
    } catch (error) {
      Logger.error(`❌ [ORDERBOOK_CACHE] Erro ao processar mensagem:`, error.message);
    }
  }

  /**
   * Atualiza orderbook local com dados do WebSocket
   */
  updateOrderbook(symbol, data) {
    try {
      const orderbook = this.cache.get(symbol);
      if (!orderbook) {
        Logger.warn(`⚠️ [ORDERBOOK_CACHE] Cache não encontrado para ${symbol}`);
        return;
      }

      // Atualiza bids se fornecidos
      if (data.bids && Array.isArray(data.bids)) {
        this.updateOrderbookSide(orderbook.bids, data.bids, true);
      }

      // Atualiza asks se fornecidos
      if (data.asks && Array.isArray(data.asks)) {
        this.updateOrderbookSide(orderbook.asks, data.asks, false);
      }

      // Atualiza metadados
      orderbook.lastUpdate = Date.now();
      orderbook.updateCount++;

      // Log de debug ocasional
      if (orderbook.updateCount % 100 === 0) {
        Logger.debug(
          `📊 [ORDERBOOK_CACHE] ${symbol}: ${orderbook.updateCount} atualizações processadas`
        );
      }
    } catch (error) {
      Logger.error(`❌ [ORDERBOOK_CACHE] Erro ao atualizar orderbook:`, error.message);
    }
  }

  /**
   * Atualiza um lado do orderbook (bids ou asks)
   */
  updateOrderbookSide(currentSide, updates, isBids) {
    for (const update of updates) {
      const [price, quantity] = update;
      const priceFloat = parseFloat(price);
      const quantityFloat = parseFloat(quantity);

      if (quantityFloat === 0) {
        // Remove price level
        const index = currentSide.findIndex(level => parseFloat(level[0]) === priceFloat);
        if (index !== -1) {
          currentSide.splice(index, 1);
        }
      } else {
        // Update or add price level
        const index = currentSide.findIndex(level => parseFloat(level[0]) === priceFloat);
        if (index !== -1) {
          currentSide[index] = [price, quantity];
        } else {
          currentSide.push([price, quantity]);
        }
      }
    }

    // Ordena e mantém apenas top levels
    if (isBids) {
      currentSide.sort((a, b) => parseFloat(b[0]) - parseFloat(a[0])); // Descendente
    } else {
      currentSide.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])); // Ascendente
    }

    // Mantém apenas top 20 levels para performance
    if (currentSide.length > 20) {
      currentSide.splice(20);
    }
  }

  /**
   * Obtém orderbook do cache
   */
  getOrderbook(symbol) {
    const orderbook = this.cache.get(symbol);
    if (!orderbook) {
      Logger.warn(`⚠️ [ORDERBOOK_CACHE] Orderbook não encontrado para ${symbol}`);
      return null;
    }

    // Verifica se dados estão atualizados (máximo 10 segundos)
    const now = Date.now();
    if (now - orderbook.lastUpdate > 10000) {
      Logger.warn(
        `⚠️ [ORDERBOOK_CACHE] Dados desatualizados para ${symbol} (${now - orderbook.lastUpdate}ms)`
      );
    }

    return orderbook;
  }

  /**
   * Obtém melhor bid/ask
   */
  getBestPrices(symbol) {
    const orderbook = this.getOrderbook(symbol);
    if (!orderbook || !orderbook.bids.length || !orderbook.asks.length) {
      return null;
    }

    return {
      bestBid: parseFloat(orderbook.bids[0][0]),
      bestAsk: parseFloat(orderbook.asks[0][0]),
      bidSize: parseFloat(orderbook.bids[0][1]),
      askSize: parseFloat(orderbook.asks[0][1]),
      spread: parseFloat(orderbook.asks[0][0]) - parseFloat(orderbook.bids[0][0]),
      midPrice: (parseFloat(orderbook.bids[0][0]) + parseFloat(orderbook.asks[0][0])) / 2,
    };
  }

  /**
   * Inicia heartbeat para manter conexões ativas
   */
  startHeartbeat() {
    if (this.heartbeatInterval) {
      return; // Já iniciado
    }

    this.heartbeatInterval = setInterval(() => {
      for (const [symbol, ws] of this.websockets) {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.ping();
          } catch (error) {
            Logger.warn(`⚠️ [ORDERBOOK_CACHE] Erro ao enviar ping para ${symbol}:`, error.message);
          }
        }
      }
    }, 30000); // Ping a cada 30 segundos

    Logger.debug(`💓 [ORDERBOOK_CACHE] Heartbeat iniciado`);
  }

  /**
   * Para heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      Logger.debug(`💔 [ORDERBOOK_CACHE] Heartbeat parado`);
    }
  }

  /**
   * Trata erros de WebSocket
   */
  handleWebSocketError(symbol, error) {
    Logger.error(`❌ [ORDERBOOK_CACHE] WebSocket error para ${symbol}:`, error.message);

    // Tenta reconectar após 5 segundos
    setTimeout(() => {
      this.reconnectWebSocket(symbol);
    }, 5000);
  }

  /**
   * Trata fechamento de WebSocket
   */
  handleWebSocketClose(symbol, code, reason) {
    Logger.warn(`⚠️ [ORDERBOOK_CACHE] WebSocket fechado para ${symbol} (${code}): ${reason}`);

    // Remove da lista de conexões
    this.websockets.delete(symbol);

    // Tenta reconectar se não foi fechamento intencional
    if (code !== 1000) {
      setTimeout(() => {
        this.reconnectWebSocket(symbol);
      }, 3000);
    }
  }

  /**
   * Reconecta WebSocket
   */
  async reconnectWebSocket(symbol) {
    try {
      Logger.info(`🔄 [ORDERBOOK_CACHE] Tentando reconectar WebSocket para ${symbol}`);

      // Remove conexão antiga se existir
      const oldWs = this.websockets.get(symbol);
      if (oldWs) {
        oldWs.close();
        this.websockets.delete(symbol);
      }

      // Conecta novamente
      await this.connectWebSocket(symbol);
    } catch (error) {
      Logger.error(`❌ [ORDERBOOK_CACHE] Erro ao reconectar WebSocket:`, error.message);
    }
  }

  /**
   * Desconecta e limpa cache
   */
  async disconnect(symbol = null) {
    try {
      Logger.info(
        `🔌 [ORDERBOOK_CACHE] Desconectando${symbol ? ` ${symbol}` : ' todos os símbolos'}`
      );

      const symbolsToDisconnect = symbol ? [symbol] : Array.from(this.websockets.keys());

      for (const sym of symbolsToDisconnect) {
        const ws = this.websockets.get(sym);
        if (ws) {
          ws.close(1000, 'Normal closure');
          this.websockets.delete(sym);
        }
        this.cache.delete(sym);
      }

      // Para heartbeat se não há mais conexões
      if (this.websockets.size === 0) {
        this.stopHeartbeat();
        this.isInitialized = false;
      }

      Logger.info(`✅ [ORDERBOOK_CACHE] Desconectado com sucesso`);
    } catch (error) {
      Logger.error(`❌ [ORDERBOOK_CACHE] Erro ao desconectar:`, error.message);
    }
  }

  /**
   * Obtém URL do WebSocket da Backpack
   */
  getWebSocketUrl() {
    // URL do WebSocket da Backpack Exchange
    return 'wss://ws.backpack.exchange/';
  }

  /**
   * Obtém estatísticas do cache
   */
  getStats() {
    const stats = {
      isInitialized: this.isInitialized,
      symbolCount: this.cache.size,
      activeConnections: this.websockets.size,
      symbols: [],
    };

    for (const [symbol, orderbook] of this.cache) {
      stats.symbols.push({
        symbol,
        bidsCount: orderbook.bids.length,
        asksCount: orderbook.asks.length,
        lastUpdate: new Date(orderbook.lastUpdate).toISOString(),
        updateCount: orderbook.updateCount,
        age: Date.now() - orderbook.lastUpdate,
      });
    }

    return stats;
  }
}

export default OrderBookCache;
