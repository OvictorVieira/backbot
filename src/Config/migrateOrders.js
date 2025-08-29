import fs from 'fs';
import path from 'path';
import DatabaseService from '../Services/DatabaseService.js';
import OrdersService from '../Services/OrdersService.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Script para migrar ordens do arquivo JSON para o SQLite
 */
class OrdersMigrator {
  constructor() {
    this.jsonFile = path.join(process.cwd(), 'persistence', 'bot_orders.json');
    this.backupDir = path.join(process.cwd(), 'persistence', 'backups');
  }

  /**
   * Executa a migração completa
   */
  async migrate() {
    try {
      console.log('🚀 [MIGRATOR] Iniciando migração de ordens do JSON para SQLite...');

      // 1. Inicializa o banco de dados
      console.log('🔧 [MIGRATOR] Inicializando banco de dados...');
      const dbService = new DatabaseService();
      await dbService.init();
      OrdersService.init(dbService);

      // 2. Verifica se o arquivo JSON existe
      if (!fs.existsSync(this.jsonFile)) {
        console.log('ℹ️ [MIGRATOR] Arquivo JSON não existe, nada para migrar');
        return { success: true, migratedCount: 0 };
      }

      // 3. Carrega ordens do JSON
      console.log('📄 [MIGRATOR] Carregando ordens do JSON...');
      const jsonData = this.loadJsonData();
      const orders = jsonData.orders || [];

      if (orders.length === 0) {
        console.log('ℹ️ [MIGRATOR] Nenhuma ordem para migrar');
        return { success: true, migratedCount: 0 };
      }

      console.log(`📊 [MIGRATOR] Encontradas ${orders.length} ordens para migrar`);

      // 4. Cria backup do arquivo JSON
      await this.createBackup();

      // 5. Migra as ordens
      const result = await this.migrateOrders(orders);

      // 6. Exibe estatísticas
      this.showStatistics(result);

      return result;
    } catch (error) {
      console.error('❌ [MIGRATOR] Erro durante a migração:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Carrega dados do arquivo JSON
   */
  loadJsonData() {
    try {
      const data = fs.readFileSync(this.jsonFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      throw new Error(`Erro ao carregar arquivo JSON: ${error.message}`);
    }
  }

  /**
   * Cria backup do arquivo JSON
   */
  async createBackup() {
    try {
      // Cria diretório de backup se não existir
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.backupDir, `bot_orders_backup_${timestamp}.json`);

      fs.copyFileSync(this.jsonFile, backupFile);
      console.log(`💾 [MIGRATOR] Backup criado: ${backupFile}`);

      return backupFile;
    } catch (error) {
      console.warn(`⚠️ [MIGRATOR] Erro ao criar backup: ${error.message}`);
      return null;
    }
  }

  /**
   * Migra as ordens para o SQLite
   */
  async migrateOrders(orders) {
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors = [];

    console.log('🔄 [MIGRATOR] Iniciando migração das ordens...');

    for (const order of orders) {
      try {
        // Verifica se a ordem já existe no SQLite
        const existingOrder = await OrdersService.getOrderByExternalId(order.externalOrderId);

        if (existingOrder) {
          skippedCount++;
          console.log(`⏭️ [MIGRATOR] Ordem ${order.externalOrderId} já existe, pulando`);
        } else {
          // Adiciona a ordem ao SQLite
          await OrdersService.addOrder(order);
          migratedCount++;

          if (migratedCount % 100 === 0) {
            console.log(
              `📊 [MIGRATOR] Progresso: ${migratedCount}/${orders.length} ordens migradas`
            );
          }
        }
      } catch (error) {
        errorCount++;
        const errorMsg = `Erro ao migrar ordem ${order.externalOrderId}: ${error.message}`;
        errors.push(errorMsg);
        console.error(`❌ [MIGRATOR] ${errorMsg}`);
      }
    }

    return {
      success: true,
      totalOrders: orders.length,
      migratedCount,
      skippedCount,
      errorCount,
      errors,
    };
  }

  /**
   * Exibe estatísticas da migração
   */
  showStatistics(result) {
    console.log('\n📊 [MIGRATOR] Estatísticas da Migração:');
    console.log('═'.repeat(50));
    console.log(`📈 Total de ordens: ${result.totalOrders}`);
    console.log(`✅ Ordens migradas: ${result.migratedCount}`);
    console.log(`⏭️ Ordens puladas (já existiam): ${result.skippedCount}`);
    console.log(`❌ Erros: ${result.errorCount}`);

    if (result.errors.length > 0) {
      console.log('\n🚨 Erros encontrados:');
      result.errors.slice(0, 5).forEach(error => {
        console.log(`  - ${error}`);
      });
      if (result.errors.length > 5) {
        console.log(`  ... e mais ${result.errors.length - 5} erros`);
      }
    }

    if (result.migratedCount > 0) {
      console.log('\n💡 Próximos passos:');
      console.log('  1. Verifique se as ordens foram migradas corretamente');
      console.log('  2. Teste as funcionalidades que usam SQLite');
      console.log('  3. Se tudo estiver funcionando, você pode remover o arquivo JSON');
      console.log(`  4. Backup disponível em: ${this.backupDir}`);
    }
  }

  /**
   * Verifica se a migração foi bem-sucedida
   */
  async verifyMigration() {
    try {
      console.log('\n🔍 [MIGRATOR] Verificando migração...');

      // Conta ordens no JSON
      const jsonData = this.loadJsonData();
      const jsonCount = jsonData.orders?.length || 0;

      // Conta ordens no SQLite
      const sqliteOrders = await OrdersService.getAllOrders();
      const sqliteCount = sqliteOrders.length;

      console.log(`📊 [MIGRATOR] Ordens no JSON: ${jsonCount}`);
      console.log(`📊 [MIGRATOR] Ordens no SQLite: ${sqliteCount}`);

      if (sqliteCount >= jsonCount) {
        console.log('✅ [MIGRATOR] Migração verificada com sucesso!');
        return true;
      } else {
        console.log(
          '⚠️ [MIGRATOR] Migração incompleta - algumas ordens podem não ter sido migradas'
        );
        return false;
      }
    } catch (error) {
      console.error('❌ [MIGRATOR] Erro ao verificar migração:', error.message);
      return false;
    }
  }
}

// Executa a migração se o script for chamado diretamente
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const migrator = new OrdersMigrator();

  migrator
    .migrate()
    .then(result => {
      if (result.success) {
        console.log('\n🎉 [MIGRATOR] Migração concluída com sucesso!');
        process.exit(0);
      } else {
        console.error('\n💥 [MIGRATOR] Migração falhou!');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n💥 [MIGRATOR] Erro inesperado:', error.message);
      process.exit(1);
    });
}

export default OrdersMigrator;
