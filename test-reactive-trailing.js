import ReactiveTrailingService from './src/Services/ReactiveTrailingService.js';
import Logger from './src/Utils/Logger.js';

async function testReactiveSystem() {
  Logger.info('🧪 [TEST] Iniciando teste do sistema reativo de trailing stop...');

  try {
    const service = new ReactiveTrailingService();
    
    // Configura throttling de teste
    service.setUpdateThrottle(1000); // 1 segundo para teste
    
    Logger.info('🔌 [TEST] Conectando ao WebSocket...');
    await service.connect();
    
    Logger.info('✅ [TEST] Conectado com sucesso!');

    // Callback de teste
    const testCallback = (symbol, price, data) => {
      Logger.info(`📊 [TEST] ${symbol}: Preço atualizado para $${price}`);
      console.log('Data:', JSON.stringify(data, null, 2));
    };

    // Subscribe a alguns pares de teste
    const testSymbols = ['BTC_USDC_PERP', 'ETH_USDC_PERP'];
    
    for (const symbol of testSymbols) {
      Logger.info(`📡 [TEST] Subscribing to ${symbol}...`);
      await service.subscribeSymbol(symbol, testCallback);
    }

    // Deixa rodando por 30 segundos
    Logger.info('🕐 [TEST] Monitorando por 30 segundos...');
    
    setTimeout(async () => {
      Logger.info('🛑 [TEST] Finalizando teste...');
      
      // Unsubscribe
      for (const symbol of testSymbols) {
        await service.unsubscribeSymbol(symbol);
      }
      
      // Desconecta
      service.disconnect();
      
      Logger.info('✅ [TEST] Teste concluído com sucesso!');
      process.exit(0);
    }, 30000);

  } catch (error) {
    Logger.error('❌ [TEST] Erro no teste:', error.message);
    process.exit(1);
  }
}

// Executa teste se chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
  testReactiveSystem();
}

export { testReactiveSystem };