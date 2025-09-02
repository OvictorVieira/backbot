import WebSocket from 'ws';
import Logger from '../Utils/Logger.js';

class ReactiveTrailingService {
  constructor() {
    this.ws = null;
    this.subscribedSymbols = new Set();
    this.priceCallbacks = new Map(); // symbol -> callback function
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // 1 segundo inicial
    this.isConnected = false;
    this.heartbeatInterval = null;
    
    // Throttling para evitar spam de atualizações
    this.lastUpdate = new Map(); // symbol -> timestamp
    this.updateThrottle = 2000; // 2 segundos mínimo entre atualizações
  }

  /**
   * Conecta ao WebSocket da Backpack
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket('wss://ws.backpack.exchange');
        
        this.ws.on('open', () => {
          Logger.info('🔌 [REACTIVE_TRAILING] WebSocket conectado com sucesso');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code, reason) => {
          Logger.warn(`🔌 [REACTIVE_TRAILING] WebSocket fechado: ${code} - ${reason}`);
          this.isConnected = false;
          this.stopHeartbeat();
          this.handleReconnect();
        });

        this.ws.on('error', (error) => {
          Logger.error('❌ [REACTIVE_TRAILING] Erro no WebSocket:', error.message);
          this.isConnected = false;
          reject(error);
        });

        // Timeout de conexão
        setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('Timeout na conexão WebSocket'));
          }
        }, 10000);

      } catch (error) {
        Logger.error('❌ [REACTIVE_TRAILING] Erro ao conectar WebSocket:', error.message);
        reject(error);
      }
    });
  }

  /**
   * Processa mensagens recebidas do WebSocket
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      
      // Resposta de subscription
      if (message.result && message.id) {
        Logger.debug(`✅ [REACTIVE_TRAILING] Subscription confirmada: ID ${message.id}`);
        return;
      }

      // Dados de ticker/bookTicker
      if (message.stream && message.data) {
        const [streamType, symbol] = message.stream.split('.');
        
        if (streamType === 'bookTicker' || streamType === 'ticker') {
          this.handlePriceUpdate(symbol, message.data, streamType);
        }
      }

    } catch (error) {
      Logger.error('❌ [REACTIVE_TRAILING] Erro ao processar mensagem:', error.message);
    }
  }

  /**
   * Processa atualizações de preço com throttling
   */
  handlePriceUpdate(symbol, data, streamType) {
    const now = Date.now();
    const lastUpdateTime = this.lastUpdate.get(symbol) || 0;
    
    // Throttling - só processa se passou tempo suficiente
    if (now - lastUpdateTime < this.updateThrottle) {
      return;
    }

    this.lastUpdate.set(symbol, now);

    // Extrai preço dependendo do tipo de stream
    let currentPrice;
    if (streamType === 'bookTicker') {
      // BookTicker tem bid/ask, usa média ou mark price se disponível
      currentPrice = data.markPrice || ((parseFloat(data.bidPrice) + parseFloat(data.askPrice)) / 2);
    } else if (streamType === 'ticker') {
      // Ticker tem price direto
      currentPrice = parseFloat(data.price || data.lastPrice);
    }

    if (currentPrice && this.priceCallbacks.has(symbol)) {
      Logger.debug(`📊 [REACTIVE_TRAILING] ${symbol}: Preço atualizado para ${currentPrice}`);
      
      // Chama callback do trailing stop para este símbolo
      const callback = this.priceCallbacks.get(symbol);
      try {
        callback(symbol, currentPrice, data);
      } catch (error) {
        Logger.error(`❌ [REACTIVE_TRAILING] Erro no callback para ${symbol}:`, error.message);
      }
    }
  }

  /**
   * Subscribe a um símbolo para receber atualizações de preço
   */
  async subscribeSymbol(symbol, callback) {
    if (!this.isConnected) {
      throw new Error('WebSocket não conectado');
    }

    // Registra callback
    this.priceCallbacks.set(symbol, callback);
    this.subscribedSymbols.add(symbol);

    // Subscribe ao bookTicker (melhor para trailing stop)
    const subscribeMessage = {
      method: 'subscribe',
      params: [`bookTicker.${symbol}`],
      id: Date.now()
    };

    Logger.info(`📡 [REACTIVE_TRAILING] Subscribing to ${symbol}...`);
    this.ws.send(JSON.stringify(subscribeMessage));
  }

  /**
   * Unsubscribe de um símbolo
   */
  async unsubscribeSymbol(symbol) {
    if (!this.isConnected || !this.subscribedSymbols.has(symbol)) {
      return;
    }

    const unsubscribeMessage = {
      method: 'unsubscribe',
      params: [`bookTicker.${symbol}`],
      id: Date.now()
    };

    Logger.info(`📡 [REACTIVE_TRAILING] Unsubscribing from ${symbol}...`);
    this.ws.send(JSON.stringify(unsubscribeMessage));
    
    this.priceCallbacks.delete(symbol);
    this.subscribedSymbols.delete(symbol);
    this.lastUpdate.delete(symbol);
  }

  /**
   * Subscribe a múltiplos símbolos de uma vez
   */
  async subscribeMultipleSymbols(symbols, callback) {
    if (!this.isConnected) {
      throw new Error('WebSocket não conectado');
    }

    const streams = symbols.map(symbol => `bookTicker.${symbol}`);
    
    // Registra callbacks para todos os símbolos
    symbols.forEach(symbol => {
      this.priceCallbacks.set(symbol, callback);
      this.subscribedSymbols.add(symbol);
    });

    const subscribeMessage = {
      method: 'subscribe',
      params: streams,
      id: Date.now()
    };

    Logger.info(`📡 [REACTIVE_TRAILING] Subscribing to ${symbols.length} symbols: ${symbols.join(', ')}`);
    this.ws.send(JSON.stringify(subscribeMessage));
  }

  /**
   * Heartbeat para manter conexão viva
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        Logger.debug('💓 [REACTIVE_TRAILING] Heartbeat enviado');
      }
    }, 30000); // 30 segundos
  }

  /**
   * Para heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Lógica de reconexão automática
   */
  async handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      Logger.error('❌ [REACTIVE_TRAILING] Máximo de tentativas de reconexão atingido');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Backoff exponencial

    Logger.info(`🔄 [REACTIVE_TRAILING] Tentativa de reconexão ${this.reconnectAttempts}/${this.maxReconnectAttempts} em ${delay}ms`);

    setTimeout(async () => {
      try {
        await this.connect();
        
        // Re-subscribe aos símbolos anteriores
        if (this.subscribedSymbols.size > 0) {
          const symbols = Array.from(this.subscribedSymbols);
          Logger.info(`🔄 [REACTIVE_TRAILING] Re-subscribing to ${symbols.length} symbols`);
          
          const streams = symbols.map(symbol => `bookTicker.${symbol}`);
          const subscribeMessage = {
            method: 'subscribe',
            params: streams,
            id: Date.now()
          };
          
          this.ws.send(JSON.stringify(subscribeMessage));
        }
        
      } catch (error) {
        Logger.error('❌ [REACTIVE_TRAILING] Falha na reconexão:', error.message);
        this.handleReconnect(); // Tenta novamente
      }
    }, delay);
  }

  /**
   * Desconecta do WebSocket
   */
  disconnect() {
    Logger.info('🔌 [REACTIVE_TRAILING] Desconectando WebSocket...');
    
    this.stopHeartbeat();
    this.isConnected = false;
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    // Limpa dados
    this.subscribedSymbols.clear();
    this.priceCallbacks.clear();
    this.lastUpdate.clear();
    this.reconnectAttempts = 0;
  }

  /**
   * Getter para status de conexão
   */
  get connected() {
    return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Configura throttle de atualizações
   */
  setUpdateThrottle(milliseconds) {
    this.updateThrottle = milliseconds;
    Logger.info(`⚡ [REACTIVE_TRAILING] Update throttle configurado para ${milliseconds}ms`);
  }
}

export default ReactiveTrailingService;