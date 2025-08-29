/**
 * Script para monitorar cache de ordens e estatísticas
 */

import OrdersCache from './src/Utils/OrdersCache.js';
import CachedOrdersService from './src/Utils/CachedOrdersService.js';

function displayCacheStats() {
  const stats = CachedOrdersService.getCacheStats();

  console.log('\n🎯 CACHE STATISTICS');
  console.log('='.repeat(50));
  console.log(`Total Entries: ${stats.totalEntries}/${stats.maxEntries}`);
  console.log(`Cache Timeout: ${stats.cacheTimeout}ms (${Math.floor(stats.cacheTimeout / 1000)}s)`);
  console.log('');

  if (stats.entries.length === 0) {
    console.log('📭 No cache entries found');
    return;
  }

  stats.entries.forEach(entry => {
    const status = entry.isValid ? '✅ Valid' : '❌ Expired';
    const symbols = entry.symbols.length > 0 ? entry.symbols.join(', ') : 'ALL';

    console.log(`🔑 ${entry.key}: ${status}`);
    console.log(`   Orders: ${entry.ordersCount}`);
    console.log(`   Symbols: ${symbols}`);
    console.log(`   Age: ${entry.ageSeconds}s`);
    console.log('');
  });
}

// Monitor contínuo
console.log('🚀 Starting Cache Monitor...');
console.log('Press Ctrl+C to exit');

setInterval(() => {
  displayCacheStats();
}, 5000);

// Primeira exibição
displayCacheStats();
