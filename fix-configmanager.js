#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

// Função para substituir ConfigManager por ConfigManagerSQLite
function replaceConfigManager(filePath) {
  console.log(`🔧 Corrigindo: ${filePath}`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Substituições necessárias
  const replacements = [
    // Import
    {
      from: "import ConfigManager from './src/Config/ConfigManager.js';",
      to: "import ConfigManager from './src/Config/ConfigManager.js';\nimport ConfigManagerSQLite from './src/Config/ConfigManagerSQLite.js';"
    },
    // Métodos síncronos para assíncronos
    { from: "ConfigManager.loadConfigs()", to: "await ConfigManagerSQLite.loadConfigs()" },
    { from: "ConfigManager.getBotConfigById(", to: "await ConfigManagerSQLite.getBotConfigById(" },
    { from: "ConfigManager.getBotConfigByBotName(", to: "await ConfigManagerSQLite.getBotConfigByBotName(" },
    { from: "ConfigManager.updateBotConfigById(", to: "await ConfigManagerSQLite.updateBotConfigById(" },
    { from: "ConfigManager.updateBotStatusById(", to: "await ConfigManagerSQLite.updateBotStatusById(" },
    { from: "ConfigManager.clearErrorStatus(", to: "await ConfigManagerSQLite.clearErrorStatus(" },
    { from: "ConfigManager.addBotConfig(", to: "await ConfigManagerSQLite.addBotConfig(" },
    { from: "ConfigManager.removeBotConfigById(", to: "await ConfigManagerSQLite.removeBotConfigById(" },
    { from: "ConfigManager.removeBotConfigByBotName(", to: "await ConfigManagerSQLite.removeBotConfigByBotName(" },
    { from: "ConfigManager.canStartBotById(", to: "await ConfigManagerSQLite.canStartBotById(" },
    { from: "ConfigManager.getBotStatusById(", to: "await ConfigManagerSQLite.getBotStatusById(" },
    { from: "ConfigManager.getAllStrategyNames()", to: "await ConfigManagerSQLite.getAllStrategyNames()" },
    { from: "ConfigManager.getAllBotNames()", to: "await ConfigManagerSQLite.getAllBotNames()" },
    { from: "ConfigManager.validateConfig(", to: "await ConfigManagerSQLite.validateConfig(" },
    { from: "ConfigManager.createDefaultConfig(", to: "await ConfigManagerSQLite.createDefaultConfig(" },
    { from: "ConfigManager.getNextOrderId(", to: "await ConfigManagerSQLite.getNextOrderId(" },
    { from: "ConfigManager.generateBotId()", to: "await ConfigManagerSQLite.generateBotId()" },
    { from: "ConfigManager.saveConfigs(", to: "await ConfigManagerSQLite.saveConfigs(" }
  ];
  
  let modified = false;
  replacements.forEach(replacement => {
    if (content.includes(replacement.from)) {
      content = content.replace(new RegExp(replacement.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement.to);
      modified = true;
    }
  });
  
  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Corrigido: ${filePath}`);
  } else {
    console.log(`ℹ️ Nenhuma correção necessária: ${filePath}`);
  }
}

// Arquivos para corrigir
const filesToFix = [
  'app-api.js',
  'src/Controllers/OrderController.js',
  'src/Config/ImportOrdersFromBackpack.js',
  'src/Backpack/Authenticated/History.js'
];

console.log('🔧 Iniciando correção de ConfigManager para ConfigManagerSQLite...\n');

filesToFix.forEach(file => {
  if (fs.existsSync(file)) {
    replaceConfigManager(file);
  } else {
    console.log(`⚠️ Arquivo não encontrado: ${file}`);
  }
});

console.log('\n✅ Correção concluída!');
console.log('💡 Lembre-se de:');
console.log('   1. Verificar se todas as funções que usam ConfigManagerSQLite são async');
console.log('   2. Adicionar await onde necessário');
console.log('   3. Testar os endpoints após as correções');
