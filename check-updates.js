#!/usr/bin/env node

/**
 * Script de verificação de atualizações executado antes do npm start
 * Verifica se há nova versão disponível e oferece a opção de atualizar
 */

import UpdatePrompt from './src/Utils/UpdatePrompt.js';

async function main() {
  console.log('🤖 BackBot - Verificação de Atualizações');
  console.log('═══════════════════════════════════════\n');

  try {
    // Verifica e oferece atualização se disponível
    await UpdatePrompt.checkForUpdates();

    // Se chegou até aqui, continua com a execução normal
    console.log('🚀 Iniciando BackBot...\n');
  } catch (error) {
    console.error('❌ Erro durante verificação de atualizações:', error.message);
    console.log('📋 Continuando com a execução normal...\n');
  }
}

// Executa apenas se for chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Erro fatal:', error.message);
    process.exit(1);
  });
}
