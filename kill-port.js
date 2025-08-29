#!/usr/bin/env node

import { execSync } from 'child_process';

const PORT = process.argv[2] || 3001;

console.log(`🔍 Verificando processos na porta ${PORT}...`);

try {
  const command =
    process.platform === 'win32' ? `netstat -ano | findstr :${PORT}` : `lsof -ti:${PORT}`;

  const result = execSync(command, { encoding: 'utf8', stdio: 'pipe' });

  if (result.trim()) {
    console.log(`⚠️ Porta ${PORT} está sendo usada. Encerrando processos...`);

    if (process.platform === 'win32') {
      // Windows
      const lines = result.trim().split('\n');
      const pids = lines.map(line => line.trim().split(/\s+/).pop()).filter(pid => pid);
      pids.forEach(pid => {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          console.log(`✅ Processo ${pid} encerrado`);
        } catch (err) {
          console.log(`⚠️ Não foi possível encerrar processo ${pid}`);
        }
      });
    } else {
      // Linux/macOS
      const pids = result
        .trim()
        .split('\n')
        .filter(pid => pid);
      pids.forEach(pid => {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
          console.log(`✅ Processo ${pid} encerrado`);
        } catch (err) {
          console.log(`⚠️ Não foi possível encerrar processo ${pid}`);
        }
      });
    }

    console.log(`✅ Porta ${PORT} liberada`);
  } else {
    console.log(`✅ Porta ${PORT} já está livre`);
  }
} catch (error) {
  console.log(`ℹ️ Nenhum processo encontrado na porta ${PORT}`);
}
