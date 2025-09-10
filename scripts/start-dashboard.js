#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Carrega .env do diretório raiz
const envPath = resolve(__dirname, '../.env');
let apiPort = '3001';
let frontendPort = '5173';

try {
  const envContent = readFileSync(envPath, 'utf-8');
  const envLines = envContent.split('\n');

  for (const line of envLines) {
    const [key, value] = line.split('=');
    if (key === 'API_PORT') {
      apiPort = value || '3001';
    }
    if (key === 'FRONTEND_PORT') {
      frontendPort = value || '5173';
    }
  }
} catch (error) {
  console.log('⚠️  Arquivo .env não encontrado, usando portas padrão');
}

console.log(`🔧 [DASHBOARD] API Port: ${apiPort}`);
console.log(`🔧 [DASHBOARD] Frontend Port: ${frontendPort}`);

// Cria as variáveis de ambiente
const env = {
  ...process.env,
  FRONTEND_PORT: frontendPort,
  VITE_API_BASE_URL: `http://localhost:${apiPort}`,
};

try {
  // Instala dependências e executa o dev server
  execSync('npm install', {
    cwd: resolve(__dirname, '../dashboard-ui'),
    stdio: 'inherit',
    env,
  });

  execSync('npm run dev', {
    cwd: resolve(__dirname, '../dashboard-ui'),
    stdio: 'inherit',
    env,
  });
} catch (error) {
  console.error('❌ Erro ao executar dashboard:', error.message);
  process.exit(1);
}
