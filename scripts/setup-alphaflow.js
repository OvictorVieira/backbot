#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

console.log('⚙️  ALPHAFLOW SETUP WIZARD');
console.log('============================\n');

// Configurações AlphaFlow
const ALPHAFLOW_ENV_CONFIG = `
# ========================================
# ALPHAFLOW STRATEGY CONFIGURATION
# ========================================

# Estratégia
TRADING_STRATEGY=ALPHA_FLOW

# Configurações de Capital por Nível de Convicção
CAPITAL_PERCENTAGE_BRONZE=50    # 50% do capital para sinais BRONZE
CAPITAL_PERCENTAGE_SILVER=75    # 75% do capital para sinais PRATA  
CAPITAL_PERCENTAGE_GOLD=100     # 100% do capital para sinais OURO

# Configurações de Peso das Ordens (Pirâmide Invertida)
ORDER_1_WEIGHT_PCT=50           # 50% na primeira ordem
ORDER_2_WEIGHT_PCT=30           # 30% na segunda ordem
ORDER_3_WEIGHT_PCT=20           # 20% na terceira ordem

# Configurações de Stop Loss e Take Profit
MAX_NEGATIVE_PNL_STOP_PCT=4.0   # Stop loss em 4%
MIN_TAKE_PROFIT_PCT=0.5         # Take profit mínimo em 0.5%
TP_PARTIAL_PERCENTAGE=50        # 50% da posição no TP parcial

# Configurações de Validação
ENABLE_TP_VALIDATION=true       # Ativa validação de take profit
ENABLE_TRAILING_STOP=false      # Desativa trailing stop (usa TP fixo)

# Configurações de Log
LOG_TYPE=info                    # Tipo de log

# ========================================
# ADICIONE SUAS CREDENCIAIS ABAIXO:
# ========================================
# ACCOUNT1_API_KEY=sua_api_key_aqui
# ACCOUNT1_API_SECRET=sua_api_secret_aqui
`;

function checkExistingEnv() {
  const envPath = join(process.cwd(), '.env');
  
  if (existsSync(envPath)) {
    const currentEnv = readFileSync(envPath, 'utf8');
    
    // Verifica se já tem configurações AlphaFlow
    if (currentEnv.includes('TRADING_STRATEGY=ALPHA_FLOW')) {
      console.log('✅ Configurações AlphaFlow já encontradas no .env');
      return true;
    }
    
    console.log('📝 Arquivo .env encontrado. Adicionando configurações AlphaFlow...');
    
    // Adiciona as configurações AlphaFlow ao final do arquivo
    const updatedEnv = currentEnv + '\n' + ALPHAFLOW_ENV_CONFIG;
    writeFileSync(envPath, updatedEnv);
    
    console.log('✅ Configurações AlphaFlow adicionadas ao .env');
    return true;
  }
  
  return false;
}

function createNewEnv() {
  const envPath = join(process.cwd(), '.env');
  
  console.log('📝 Criando novo arquivo .env com configurações AlphaFlow...');
  
  writeFileSync(envPath, ALPHAFLOW_ENV_CONFIG);
  
  console.log('✅ Arquivo .env criado com configurações AlphaFlow');
  console.log('⚠️  IMPORTANTE: Adicione suas credenciais da API no arquivo .env');
  console.log('   • ACCOUNT1_API_KEY=sua_api_key');
  console.log('   • ACCOUNT1_API_SECRET=sua_api_secret');
}

function showNextSteps() {
  console.log('\n🎯 PRÓXIMOS PASSOS:');
  console.log('1. Edite o arquivo .env e adicione suas credenciais da API');
  console.log('2. Execute: npm run alphaflow:launch');
  console.log('3. Ou execute: npm run alphaflow (para desenvolvimento)');
  console.log('4. Ou execute: npm run alphaflow:prod (para produção)');
  console.log('\n📖 Para mais informações, consulte: ALPHAFLOW_GUIDE.md');
}

function main() {
  try {
    const hasExistingEnv = checkExistingEnv();
    
    if (!hasExistingEnv) {
      createNewEnv();
    }
    
    showNextSteps();
    
  } catch (error) {
    console.error('❌ Erro durante a configuração:', error.message);
    process.exit(1);
  }
}

main(); 