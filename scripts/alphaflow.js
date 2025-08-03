#!/usr/bin/env node

import dotenv from 'dotenv';
import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';

// Carrega variáveis de ambiente
dotenv.config();

console.log('🧠 ALPHAFLOW STRATEGY LAUNCHER');
console.log('================================\n');

// Configurações padrão para AlphaFlow
const ALPHAFLOW_CONFIG = {
  // Estratégia
  TRADING_STRATEGY: 'ALPHA_FLOW',
  
  // Configurações de Capital por Nível de Convicção
  CAPITAL_PERCENTAGE_BRONZE: '50',    // 50% do capital para sinais BRONZE
  CAPITAL_PERCENTAGE_SILVER: '75',    // 75% do capital para sinais PRATA  
  CAPITAL_PERCENTAGE_GOLD: '100',     // 100% do capital para sinais OURO
  
  // Configurações de Peso das Ordens (Pirâmide Invertida)
  ORDER_1_WEIGHT_PCT: '50',           // 50% na primeira ordem
  ORDER_2_WEIGHT_PCT: '30',           // 30% na segunda ordem
  ORDER_3_WEIGHT_PCT: '20',           // 20% na terceira ordem
  
  // Configurações de Stop Loss e Take Profit
  MAX_NEGATIVE_PNL_STOP_PCT: '4.0',   // Stop loss em 4%
  MIN_TAKE_PROFIT_PCT: '0.5',         // Take profit mínimo em 0.5%
  TP_PARTIAL_PERCENTAGE: '50',        // 50% da posição no TP parcial
  
  // Configurações de Validação
  ENABLE_TP_VALIDATION: 'true',       // Ativa validação de take profit
  ENABLE_TRAILING_STOP: 'false',      // Desativa trailing stop (usa TP fixo)
  
  // Configurações de Log
  LOG_TYPE: 'info'                    // Tipo de log
};

// Função para verificar se o arquivo .env existe
function checkEnvFile() {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    console.log('❌ Arquivo .env não encontrado!');
    console.log('   Crie um arquivo .env na raiz do projeto com suas credenciais.');
    console.log('   Exemplo:');
    console.log('   ACCOUNT1_API_KEY=sua_api_key');
    console.log('   ACCOUNT1_API_SECRET=sua_api_secret');
    process.exit(1);
  }
  return envPath;
}

// Função para configurar variáveis de ambiente
function setupAlphaFlowEnvironment() {
  console.log('⚙️  Configurando ambiente AlphaFlow...');
  
  // Define as variáveis de ambiente para AlphaFlow
  Object.entries(ALPHAFLOW_CONFIG).forEach(([key, value]) => {
    process.env[key] = value;
    console.log(`   ${key}=${value}`);
  });
  
  console.log('✅ Ambiente AlphaFlow configurado!\n');
}

// Função para mostrar informações da estratégia
function showAlphaFlowInfo() {
  console.log('🎯 Estratégia AlphaFlow Configurada:');
  console.log('   • Análise de momentum e money flow');
  console.log('   • Detecção de divergência CVD');
  console.log('   • Sinais BRONZE, PRATA e OURO');
  console.log('   • Ordens escalonadas com pirâmide invertida');
  console.log('   • Stop Loss: 4% | Take Profit: 50%');
  console.log('   • Capital escalonado por convicção\n');
}

// Função para verificar dependências
function checkDependencies() {
  console.log('🔍 Verificando dependências...');
  
  try {
    // Verifica se as dependências estão instaladas
    require.resolve('axios');
    require.resolve('technicalindicators');
    console.log('✅ Dependências OK');
  } catch (error) {
    console.log('❌ Dependências não encontradas!');
    console.log('   Execute: npm install');
    process.exit(1);
  }
}

// Função principal
async function launchAlphaFlow() {
  try {
    // Verifica arquivo .env
    checkEnvFile();
    
    // Verifica dependências
    checkDependencies();
    
    // Configura ambiente
    setupAlphaFlowEnvironment();
    
    // Mostra informações
    showAlphaFlowInfo();
    
    console.log('🚀 Iniciando AlphaFlow Strategy...\n');
    
    // Executa o bot com as configurações AlphaFlow
    const command = 'node bootstrap-app.js';
    execSync(command, { 
      stdio: 'inherit',
      env: { ...process.env, ...ALPHAFLOW_CONFIG }
    });
    
  } catch (error) {
    console.error('❌ Erro ao iniciar AlphaFlow:', error.message);
    process.exit(1);
  }
}

// Executa o script
launchAlphaFlow(); 