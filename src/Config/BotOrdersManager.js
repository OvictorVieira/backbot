import fs from 'fs';
import path from 'path';
import OrdersService from '../Services/OrdersService.js';
import Logger from '../Utils/Logger.js';

class BotOrdersManager {
  constructor() {
    this.ordersFile = path.join(process.cwd(), 'persistence', 'bot_orders.json');
  }

  /**
   * Inicializa o sistema (método assíncrono para SQLite)
   */
  async initialize() {
    try {
      // Tenta carregar do SQLite primeiro
      if (OrdersService.dbService && OrdersService.dbService.isInitialized()) {
        Logger.info(`✅ [BOT_ORDERS] Inicializando com SQLite database`);
        const orders = await OrdersService.getAllOrders();
        this.orders = { orders: orders || [] };
        Logger.info(`📊 [BOT_ORDERS] Ordens carregadas do SQLite: ${this.orders.orders.length}`);
      } else {
        console.log(`ℹ️ [BOT_ORDERS] SQLite não disponível, usando JSON`);
        // Recarrega do JSON para garantir que temos os dados mais recentes
        this.orders = this.loadOrdersFromJson();
      }
    } catch (error) {
      console.error('❌ [BOT_ORDERS] Erro ao inicializar com SQLite:', error.message);
      console.log(`⚠️ [BOT_ORDERS] Continuando com JSON`);
      // Recarrega do JSON como fallback
      this.orders = this.loadOrdersFromJson();
    }
  }

  /**
   * Carrega as ordens do SQLite (com fallback para JSON)
   */
  async loadOrders() {
    try {
      // Se já temos ordens carregadas, retorna elas
      if (this.orders && this.orders.orders) {
        return this.orders;
      }

      // Tenta carregar do SQLite primeiro
      if (OrdersService.dbService && OrdersService.dbService.isInitialized()) {
        console.log(`✅ [LOAD_ORDERS] Usando SQLite database`);
        const orders = await OrdersService.getAllOrders();
        this.orders = { orders: orders || [] };
        return this.orders;
      } else {
        // Fallback para JSON se SQLite não estiver disponível
        console.log(`⚠️ [LOAD_ORDERS] SQLite não disponível, usando JSON fallback`);
        this.orders = this.loadOrdersFromJson();
        return this.orders;
      }
    } catch (error) {
      console.error('❌ Erro ao carregar ordens do SQLite:', error.message);
      console.log(`⚠️ [LOAD_ORDERS] Fallback para JSON`);
      this.orders = this.loadOrdersFromJson();
      return this.orders;
    }
  }

  /**
   * Carrega as ordens do arquivo JSON (fallback)
   */
  loadOrdersFromJson() {
    try {
      if (fs.existsSync(this.ordersFile)) {
        const data = fs.readFileSync(this.ordersFile, 'utf8');
        return JSON.parse(data);
      } else {
        return { orders: [] };
      }
    } catch (error) {
      console.error('❌ Erro ao carregar ordens do JSON:', error.message);
      return { orders: [] };
    }
  }

  /**
   * Salva as ordens no SQLite (com fallback para JSON)
   */
  async saveOrders() {
    try {
      if (OrdersService.dbService && OrdersService.dbService.isInitialized()) {
        console.log(`✅ [SAVE_ORDERS] Ordens já estão no SQLite`);
        return;
      } else {
        // Fallback para JSON se SQLite não estiver disponível
        console.log(`⚠️ [SAVE_ORDERS] SQLite não disponível, usando JSON fallback`);
        this.saveOrdersToJson();
      }
    } catch (error) {
      console.error('❌ Erro ao salvar ordens no SQLite:', error.message);
      console.log(`⚠️ [SAVE_ORDERS] Fallback para JSON`);
      this.saveOrdersToJson();
    }
  }

  /**
   * Salva as ordens no arquivo JSON (fallback)
   */
  saveOrdersToJson() {
    try {
      const dir = path.dirname(this.ordersFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.ordersFile, JSON.stringify(this.orders, null, 2));
      console.log(`💾 Ordens salvas em JSON: ${this.ordersFile}`);
    } catch (error) {
      console.error('❌ Erro ao salvar ordens no JSON:', error.message);
    }
  }

  /**
   * Adiciona uma nova ordem do bot
   * @param {number} botId - ID do bot
   * @param {string} externalOrderId - ID da ordem na exchange
   * @param {string} symbol - Símbolo da ordem
   * @param {string} side - Lado da ordem (BUY/SELL)
   * @param {number} quantity - Quantidade
   * @param {number} price - Preço
   * @param {string} orderType - Tipo da ordem (MARKET/LIMIT)
   */
  async addOrder(
    botId,
    externalOrderId,
    symbol,
    side,
    quantity,
    price,
    orderType,
    exchangeCreatedAt = null,
    clientId = null
  ) {
    const order = {
      botId,
      externalOrderId,
      symbol,
      side,
      quantity,
      price,
      orderType,
      timestamp: new Date().toISOString(),
      status: 'PENDING', // Status inicial da ordem
      clientId: clientId, // Client Order ID da exchange
      exchangeCreatedAt: exchangeCreatedAt, // Timestamp de criação na exchange
      fills: [], // Array para armazenar fills da ordem
      totalFilledQuantity: 0, // Quantidade total preenchida
      averageFillPrice: 0, // Preço médio dos fills
      closePrice: null, // Preço de fechamento (quando aplicável)
      closeTime: null, // Timestamp de fechamento
      closeQuantity: null, // Quantidade fechada
      closeType: null, // Tipo de fechamento (MANUAL, AUTO, STOP_LOSS, TAKE_PROFIT)
      pnl: null, // PnL da ordem (quando fechada)
    };

    try {
      // Tenta salvar no SQLite primeiro
      if (OrdersService.dbService && OrdersService.dbService.isInitialized()) {
        await OrdersService.addOrder(order);
        console.log(
          `📝 [BOT_ORDERS] Ordem registrada no SQLite: Bot ${botId} -> Order ${externalOrderId} (${symbol} ${side} ${quantity})`
        );
      } else {
        // Fallback para JSON se SQLite não estiver disponível
        this.orders.orders.push(order);
        this.saveOrdersToJson();
        console.log(
          `📝 [BOT_ORDERS] Ordem registrada no JSON: Bot ${botId} -> Order ${externalOrderId} (${symbol} ${side} ${quantity})`
        );
      }
    } catch (error) {
      console.error('❌ Erro ao adicionar ordem:', error.message);
      // Fallback para JSON
      this.orders.orders.push(order);
      this.saveOrdersToJson();
    }
  }

  /**
   * Busca todas as ordens de um bot específico
   * @param {number} botId - ID do bot
   * @returns {Array} Lista de ordens do bot
   */
  async getBotOrders(botId) {
    try {
      // Tenta buscar do SQLite primeiro
      if (OrdersService.dbService && OrdersService.dbService.isInitialized()) {
        console.log(`🔍 [BOT_ORDERS] Buscando ordens do SQLite para Bot ${botId}`);
        const orders = await OrdersService.getOrdersByBotId(botId);
        console.log(
          `🔍 [BOT_ORDERS] Ordens encontradas no SQLite para Bot ${botId}: ${orders.length}`
        );
        return orders;
      } else {
        // Fallback para JSON se SQLite não estiver disponível
        console.log(`🔍 [BOT_ORDERS] Buscando ordens do JSON para Bot ${botId}`);
        console.log(
          `🔍 [BOT_ORDERS] Total de ordens no sistema JSON: ${this.orders.orders.length}`
        );
        const botOrders = this.orders.orders.filter(order => order.botId === botId);
        console.log(
          `🔍 [BOT_ORDERS] Ordens encontradas no JSON para Bot ${botId}: ${botOrders.length}`
        );
        return botOrders;
      }
    } catch (error) {
      console.error('❌ Erro ao buscar ordens do SQLite:', error.message);
      // Fallback para JSON
      const botOrders = this.orders.orders.filter(order => order.botId === botId);
      return botOrders;
    }
  }

  /**
   * Busca uma ordem específica pelo externalOrderId
   * @param {string} externalOrderId - ID da ordem na exchange
   * @returns {Object|null} Ordem encontrada ou null
   */
  async getOrderByExternalId(externalOrderId) {
    try {
      // Tenta buscar do SQLite primeiro
      if (OrdersService.dbService && OrdersService.dbService.isInitialized()) {
        const order = await OrdersService.getOrderByExternalId(externalOrderId);
        return order;
      } else {
        // Fallback para JSON
        return this.orders.orders.find(order => order.externalOrderId === externalOrderId) || null;
      }
    } catch (error) {
      console.error('❌ Erro ao buscar ordem do SQLite:', error.message);
      // Fallback para JSON
      return this.orders.orders.find(order => order.externalOrderId === externalOrderId) || null;
    }
  }

  /**
   * Verifica se uma ordem pertence a um bot
   * @param {string} externalOrderId - ID da ordem na exchange
   * @param {number} botId - ID do bot
   * @returns {boolean} True se a ordem pertence ao bot
   */
  async isOrderFromBot(externalOrderId, botId) {
    const order = await this.getOrderByExternalId(externalOrderId);
    return order && order.botId === botId;
  }

  /**
   * Remove uma ordem (quando cancelada ou expirada)
   * @param {string} externalOrderId - ID da ordem na exchange
   */
  async removeOrder(externalOrderId) {
    try {
      // Tenta remover do SQLite primeiro
      if (OrdersService.dbService && OrdersService.dbService.isInitialized()) {
        await OrdersService.removeOrderByExternalId(externalOrderId);
        console.log(`🗑️ [BOT_ORDERS] Ordem removida do SQLite: ${externalOrderId}`);
      } else {
        // Fallback para JSON
        const index = this.orders.orders.findIndex(
          order => order.externalOrderId === externalOrderId
        );
        if (index !== -1) {
          const removedOrder = this.orders.orders.splice(index, 1)[0];
          this.saveOrdersToJson();
          console.log(
            `🗑️ [BOT_ORDERS] Ordem removida do JSON: ${externalOrderId} (Bot ${removedOrder.botId})`
          );
        }
      }
    } catch (error) {
      console.error('❌ Erro ao remover ordem:', error.message);
      // Fallback para JSON
      const index = this.orders.orders.findIndex(
        order => order.externalOrderId === externalOrderId
      );
      if (index !== -1) {
        const removedOrder = this.orders.orders.splice(index, 1)[0];
        this.saveOrdersToJson();
        console.log(
          `🗑️ [BOT_ORDERS] Ordem removida do JSON (fallback): ${externalOrderId} (Bot ${removedOrder.botId})`
        );
      }
    }
  }

  /**
   * Atualiza uma ordem existente
   * @param {string} externalOrderId - ID da ordem na exchange
   * @param {Object} updates - Campos a serem atualizados
   */
  async updateOrder(externalOrderId, updates) {
    try {
      // Tenta atualizar no SQLite primeiro
      if (OrdersService.dbService && OrdersService.dbService.isInitialized()) {
        await OrdersService.updateOrderByExternalId(externalOrderId, updates);
        console.log(`✏️ [BOT_ORDERS] Ordem atualizada no SQLite: ${externalOrderId}`);
      } else {
        // Fallback para JSON
        const order = this.orders.orders.find(o => o.externalOrderId === externalOrderId);
        if (order) {
          Object.assign(order, updates);
          order.lastUpdated = new Date().toISOString();
          this.saveOrdersToJson();
          console.log(`✏️ [BOT_ORDERS] Ordem atualizada no JSON: ${externalOrderId}`);
        }
      }
    } catch (error) {
      console.error('❌ Erro ao atualizar ordem:', error.message);
      // Fallback para JSON
      const order = this.orders.orders.find(o => o.externalOrderId === externalOrderId);
      if (order) {
        Object.assign(order, updates);
        order.lastUpdated = new Date().toISOString();
        this.saveOrdersToJson();
        console.log(`✏️ [BOT_ORDERS] Ordem atualizada no JSON (fallback): ${externalOrderId}`);
      }
    }
  }

  /**
   * Obtém estatísticas das ordens de um bot
   * @param {number} botId - ID do bot
   * @returns {Object} Estatísticas das ordens
   */
  async getBotOrderStats(botId) {
    try {
      const botOrders = await this.getBotOrders(botId);

      // Separa ordens por status
      // CORREÇÃO: Ordens PENDING no banco não são necessariamente ordens abertas na corretora
      // Devemos contar apenas ordens que realmente estão abertas (FILLED que ainda não fecharam)
      const openOrders = botOrders.filter(
        order => order.status === 'FILLED' && (!order.closeTime || order.closeTime === '')
      );
      const closedOrders = botOrders.filter(
        order =>
          order.status === 'CLOSED' ||
          (order.status === 'FILLED' && order.closeTime && order.closeTime !== '')
      );

      // Calcula PnL total
      const totalPnl = closedOrders.reduce((sum, order) => {
        return sum + (order.pnl || 0);
      }, 0);

      // Calcula win rate
      const winningTrades = closedOrders.filter(order => (order.pnl || 0) > 0).length;
      const losingTrades = closedOrders.filter(order => (order.pnl || 0) < 0).length;
      const winRate = closedOrders.length > 0 ? (winningTrades / closedOrders.length) * 100 : 0;

      // Total Trades = apenas trades fechados com PnL (wins + losses)
      const totalTrades = winningTrades + losingTrades;

      return {
        totalOrders: botOrders.length,
        totalTrades: totalTrades, // CORRIGIDO: apenas trades com PnL
        openOrders: openOrders.length,
        closedOrders: closedOrders.length,
        buyOrders: botOrders.filter(order => order.side === 'BUY').length,
        sellOrders: botOrders.filter(order => order.side === 'SELL').length,
        symbols: [...new Set(botOrders.map(order => order.symbol))],
        firstOrder: botOrders.length > 0 ? botOrders[0].timestamp : null,
        lastOrder: botOrders.length > 0 ? botOrders[botOrders.length - 1].timestamp : null,
        totalPnl: totalPnl,
        winningTrades: winningTrades,
        losingTrades: losingTrades,
        winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0, // CORRIGIDO: usa totalTrades
        averagePnl: totalTrades > 0 ? totalPnl / totalTrades : 0, // CORRIGIDO: usa totalTrades
      };
    } catch (error) {
      console.error('❌ Erro ao obter estatísticas:', error.message);
      return {
        totalOrders: 0,
        totalTrades: 0, // ADICIONADO: campo totalTrades no fallback
        openOrders: 0,
        closedOrders: 0,
        buyOrders: 0,
        sellOrders: 0,
        symbols: [],
        firstOrder: null,
        lastOrder: null,
        totalPnl: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        averagePnl: 0,
      };
    }
  }

  /**
   * Limpa ordens antigas (opcional - para manutenção)
   * @param {number} daysOld - Número de dias para considerar como "antiga"
   */
  async cleanOldOrders(daysOld = 30) {
    try {
      // Tenta limpar do SQLite primeiro
      if (OrdersService.dbService && OrdersService.dbService.isInitialized()) {
        const removedCount = await OrdersService.cleanupOldOrders(daysOld);
        console.log(`🧹 [BOT_ORDERS] ${removedCount} ordens antigas removidas do SQLite`);
        return removedCount;
      } else {
        // Fallback para JSON
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);

        const initialCount = this.orders.orders.length;
        this.orders.orders = this.orders.orders.filter(order => {
          return new Date(order.timestamp) > cutoffDate;
        });

        const removedCount = initialCount - this.orders.orders.length;
        if (removedCount > 0) {
          this.saveOrdersToJson();
          console.log(`🧹 [BOT_ORDERS] ${removedCount} ordens antigas removidas do JSON`);
        }
        return removedCount;
      }
    } catch (error) {
      console.error('❌ Erro ao limpar ordens antigas:', error.message);
      return 0;
    }
  }

  /**
   * Migra ordens do JSON para o SQLite
   * @returns {number} Número de ordens migradas
   */
  async migrateToSqlite() {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        console.log(`⚠️ [MIGRATION] SQLite não está disponível`);
        return 0;
      }

      if (!fs.existsSync(this.ordersFile)) {
        console.log(`ℹ️ [MIGRATION] Arquivo JSON não existe, nada para migrar`);
        return 0;
      }

      // Carrega ordens do JSON
      const jsonData = this.loadOrdersFromJson();
      const orders = jsonData.orders || [];

      if (orders.length === 0) {
        console.log(`ℹ️ [MIGRATION] Nenhuma ordem para migrar`);
        return 0;
      }

      console.log(
        `🚀 [MIGRATION] Iniciando migração de ${orders.length} ordens do JSON para SQLite`
      );

      let migratedCount = 0;
      let errorCount = 0;

      for (const order of orders) {
        try {
          // Verifica se a ordem já existe no SQLite
          const existingOrder = await OrdersService.getOrderByExternalId(order.externalOrderId);
          if (!existingOrder) {
            await OrdersService.addOrder(order);
            migratedCount++;
          } else {
            console.log(
              `ℹ️ [MIGRATION] Ordem ${order.externalOrderId} já existe no SQLite, pulando`
            );
          }
        } catch (error) {
          console.error(
            `❌ [MIGRATION] Erro ao migrar ordem ${order.externalOrderId}:`,
            error.message
          );
          errorCount++;
        }
      }

      console.log(
        `✅ [MIGRATION] Migração concluída: ${migratedCount} ordens migradas, ${errorCount} erros`
      );

      if (migratedCount > 0) {
        // Cria backup do arquivo JSON original
        const backupFile = this.ordersFile.replace(
          '.json',
          '_backup_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'
        );
        fs.copyFileSync(this.ordersFile, backupFile);
        console.log(`💾 [MIGRATION] Backup do JSON criado: ${backupFile}`);
      }

      return migratedCount;
    } catch (error) {
      console.error('❌ Erro na migração:', error.message);
      return 0;
    }
  }
}

// Cria a instância
const botOrdersManager = new BotOrdersManager();

// Função para inicializar quando necessário
async function initializeBotOrdersManager() {
  if (botOrdersManager && typeof botOrdersManager.initialize === 'function') {
    await botOrdersManager.initialize();
  }
}

// Exporta tanto a instância quanto a função de inicialização
export { initializeBotOrdersManager };
export default botOrdersManager;
