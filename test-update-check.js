#!/usr/bin/env node

/**
 * Script de teste para verificar o funcionamento da verificação de atualizações
 */

import UpdatePrompt from './src/Utils/UpdatePrompt.js';
import VersionChecker from './src/Services/VersionChecker.js';

async function testUpdateCheck() {
  console.log('🧪 Testando sistema de verificação de atualizações\n');
  
  try {
    // Testa o VersionChecker primeiro
    const versionChecker = new VersionChecker();
    
    console.log('1️⃣ Testando VersionChecker...');
    const localVersion = versionChecker.getLocalVersion();
    console.log(`   📦 Versão local: ${localVersion}`);
    
    const remoteVersion = await versionChecker.getRemoteVersion();
    console.log(`   🌐 Versão remota: ${remoteVersion}`);
    
    const versionInfo = await versionChecker.getVersionInfo();
    console.log(`   ✅ Informações obtidas:`, {
      hasUpdate: versionInfo.hasUpdate,
      difference: versionInfo.difference
    });
    
    console.log('\n2️⃣ Testando UpdatePrompt...');
    
    // Simula verificação (sem prompt interativo)
    const prompt = new UpdatePrompt();
    const versionInfoPrompt = await prompt.versionChecker.getVersionInfo();
    
    if (versionInfoPrompt.success && versionInfoPrompt.hasUpdate) {
      console.log(`   🎉 Nova versão detectada: ${versionInfoPrompt.remoteVersion}`);
      console.log(`   🔄 Tipo: ${prompt.getUpdateTypeDescription(versionInfoPrompt.difference)}`);
    } else {
      console.log('   ✅ Nenhuma atualização disponível');
    }
    
    console.log('\n✅ Testes concluídos com sucesso!');
    console.log('\n💡 Para testar o prompt interativo, execute:');
    console.log('   node check-updates.js');
    
  } catch (error) {
    console.error('❌ Erro durante os testes:', error.message);
    process.exit(1);
  }
}

// Executa apenas se for chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
  testUpdateCheck().catch(error => {
    console.error('❌ Erro fatal:', error.message);
    process.exit(1);
  });
}