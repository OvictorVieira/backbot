import Order from '../Backpack/Authenticated/Order.js';
import BotOrdersManager, { initializeBotOrdersManager } from './BotOrdersManager.js';
import ConfigManager from './ConfigManager.js';

class ImportOrdersFromBackpack {
  
  /**
   * Importa ordens ativas e pendentes da Backpack para o sistema de persistência
   * @param {number} botId - ID do bot
   * @param {Object} config - Configuração do bot
   */
  static async importActiveOrders(botId, config) {
    try {
      console.log(`🔄 [IMPORT_ORDERS] Iniciando importação de ordens ativas para Bot ${botId}...`);
      
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios');
      }

      // Busca ordens ativas da Backpack
      const activeOrders = await Order.getOpenOrders(null, "PERP", config.apiKey, config.apiSecret);
      
      if (!activeOrders || activeOrders.length === 0) {
        console.log(`ℹ️ [IMPORT_ORDERS] Nenhuma ordem ativa encontrada para Bot ${botId}`);
        return {
          success: true,
          imported: 0,
          message: 'Nenhuma ordem ativa encontrada'
        };
      }

      console.log(`📊 [IMPORT_ORDERS] Encontradas ${activeOrders.length} ordens ativas na Backpack`);

      let importedCount = 0;
      const importedOrders = [];

      for (const order of activeOrders) {
        try {
          // Verifica se a ordem tem quantidade > 0
          const quantity = parseFloat(order.quantity);
          if (quantity <= 0) {
            continue;
          }

          // Determina o lado da ordem
          const side = order.side === 'Bid' ? 'BUY' : 'SELL';
          
          // Determina o tipo da ordem
          const orderType = order.orderType || 'LIMIT';

          // Registra a ordem no sistema de persistência
          await BotOrdersManager.addOrder(
            botId,
            order.orderId,
            order.symbol,
            side,
            quantity,
            parseFloat(order.price),
            orderType
          );

          importedOrders.push({
            id: order.orderId,
            symbol: order.symbol,
            side: side,
            quantity: quantity,
            price: parseFloat(order.price),
            orderType: orderType,
            status: order.status
          });

          importedCount++;
          console.log(`✅ [IMPORT_ORDERS] Ordem ${order.symbol} (${side} ${quantity}) importada`);

        } catch (orderError) {
          console.error(`❌ [IMPORT_ORDERS] Erro ao importar ordem ${order.symbol}:`, orderError.message);
        }
      }

      console.log(`🎉 [IMPORT_ORDERS] Importação concluída: ${importedCount} ordens importadas para Bot ${botId}`);

      return {
        success: true,
        imported: importedCount,
        orders: importedOrders,
        message: `${importedCount} ordens importadas com sucesso`
      };

    } catch (error) {
      console.error(`❌ [IMPORT_ORDERS] Erro na importação:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Importa ordens de todos os bots
   */
  static async importAllBotsOrders() {
    try {
      console.log(`🔄 [IMPORT_ORDERS_ALL] Iniciando importação para todos os bots...`);
      
      const configs = await ConfigManagerSQLite.loadConfigs();
      const enabledBots = configs.filter(config => config.enabled);
      
      if (enabledBots.length === 0) {
        console.log(`ℹ️ [IMPORT_ORDERS_ALL] Nenhum bot habilitado encontrado`);
        return;
      }

      const results = [];

      for (const config of enabledBots) {
        try {
          console.log(`\n📋 [IMPORT_ORDERS_ALL] Processando Bot ${config.id}: ${config.botName}`);
          
          const result = await this.importActiveOrders(config.id, config);
          results.push({
            botId: config.id,
            botName: config.botName,
            ...result
          });

        } catch (botError) {
          console.error(`❌ [IMPORT_ORDERS_ALL] Erro no Bot ${config.id}:`, botError.message);
          results.push({
            botId: config.id,
            botName: config.botName,
            success: false,
            error: botError.message
          });
        }
      }

      // Resumo final
      const successfulImports = results.filter(r => r.success);
      const totalImported = successfulImports.reduce((sum, r) => sum + (r.imported || 0), 0);

      console.log(`\n📊 [IMPORT_ORDERS_ALL] Resumo da importação:`);
      console.log(`   • Bots processados: ${results.length}`);
      console.log(`   • Bots com sucesso: ${successfulImports.length}`);
      console.log(`   • Total de ordens importadas: ${totalImported}`);

      return {
        success: true,
        totalBots: results.length,
        successfulBots: successfulImports.length,
        totalImported: totalImported,
        results: results
      };

    } catch (error) {
      console.error(`❌ [IMPORT_ORDERS_ALL] Erro geral:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Mostra detalhes das ordens ativas
   */
  static async showActiveOrders(botId, config) {
    try {
      console.log(`📊 [ORDERS] Buscando ordens ativas para Bot ${botId}...`);
      
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios');
      }

      const orders = await Order.getOpenOrders(null, "PERP", config.apiKey, config.apiSecret);
      
      if (!orders || orders.length === 0) {
        console.log(`ℹ️ [ORDERS] Nenhuma ordem ativa encontrada`);
        return {
          success: true,
          totalOrders: 0,
          orders: []
        };
      }

      const activeOrders = orders.filter(order => parseFloat(order.quantity) > 0);
      
      console.log(`📊 [ORDERS] Encontradas ${activeOrders.length} ordens ativas:`);
      
      for (const order of activeOrders) {
        console.log(`   • ${order.symbol}: ${order.quantity} @ ${order.price} (${order.side})`);
      }

      return {
        success: true,
        totalOrders: activeOrders.length,
        orders: activeOrders
      };

    } catch (error) {
      console.error(`❌ [ORDERS] Erro ao buscar ordens:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Limpa ordens antigas do sistema
   */
  static async cleanOldOrders(daysOld = 30) {
    try {
      console.log(`🧹 [CLEANUP] Limpando ordens com mais de ${daysOld} dias...`);
      
      const result = await BotOrdersManager.cleanOldOrders(daysOld);
      
      console.log(`✅ [CLEANUP] Limpeza concluída: ${result} ordens removidas`);
      
      return { success: true, removed: result };
    } catch (error) {
      console.error(`❌ [CLEANUP] Erro na limpeza:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Mostra estatísticas das ordens
   */
  static async showStats() {
    try {
      console.log(`📊 [STATS] Gerando estatísticas das ordens...`);
      
      // Busca estatísticas de todos os bots
      const configs = await ConfigManagerSQLite.loadConfigs();
      const statsByBot = {};
      let totalOrders = 0;

      for (const config of configs) {
        const stats = await BotOrdersManager.getBotOrderStats(config.id);
        statsByBot[config.botName] = stats;
        totalOrders += stats.totalOrders;
      }
      
      const result = {
        totalOrders,
        ordersByBot: statsByBot,
        ordersByType: {}, // Será preenchido se necessário
        ordersBySide: {}  // Será preenchido se necessário
      };
      
      console.log(`📊 [STATS] Estatísticas:`);
      console.log(`   • Total de ordens: ${totalOrders}`);
      console.log(`   • Ordens por bot:`, Object.keys(statsByBot).length);
      
      return result;
    } catch (error) {
      console.error(`❌ [STATS] Erro ao gerar estatísticas:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default ImportOrdersFromBackpack;
