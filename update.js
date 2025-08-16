#!/usr/bin/env node

import axios from 'axios';
import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configurações
const GITHUB_REPO = 'ovictorvieira/backbot';
const ZIP_URL = `https://github.com/${GITHUB_REPO}/archive/refs/heads/main.zip`;
// CRÍTICO: Lista de arquivos/pastas que NUNCA devem ser removidos durante atualização
// - .env: configurações do usuário
// - src/: código fonte (será atualizado seletivamente)
// - src/persistence/: banco de dados do bot (NUNCA remover)
// - persistence/: backup alternativo do banco
// - node_modules/: dependências instaladas
// - .update_flag: flag de controle de atualização
const PRESERVE_ITEMS = ['.env', 'src/', 'src/persistence/', 'persistence/', 'node_modules/', '.update_flag'];
const BACKUP_DIR = 'backup_temp';
const TEMP_DIR = 'temp_update';
const UPDATE_FLAG_FILE = '.update_flag';

class AutoUpdater {
  constructor() {
    this.backupDir = path.join(__dirname, BACKUP_DIR);
    this.tempDir = path.join(__dirname, TEMP_DIR);
    this.extractedDir = path.join(this.tempDir, 'backbot-main');
  }

  async main() {
    console.log('🚀 Iniciando atualização automática do BackBot...');
    console.log('📦 Repositório:', GITHUB_REPO);
    console.log('🛡️ Preservando dados do usuário...');

    try {
      // Verifica se atualização já foi executada recentemente
      if (await this.checkRecentUpdate()) {
        console.log('⏸️ Atualização já foi executada recentemente (últimas 24h)');
        console.log('💡 Para forçar atualização, delete o arquivo .update_flag');
        return;
      }

      // Cria flag de atualização
      await this.createUpdateFlag();
      // 1. Backup dos dados do usuário
      await this.backupUserData();
      console.log('✅ Backup concluído');

      // 2. Download da versão mais recente
      await this.downloadLatestVersion();
      console.log('✅ Download concluído');

      // 3. Substituição dos arquivos
      await this.replaceFiles();
      console.log('✅ Arquivos atualizados');

      // 4. Restauração dos dados do usuário
      await this.restoreUserData();
      console.log('✅ Dados restaurados');

      // 5. Tarefas pós-atualização
      await this.runPostUpdateTasks();
      console.log('✅ Tarefas pós-atualização concluídas');

      console.log('\n🎉 Atualização concluída com sucesso!');
      
      // Mostra instruções para o usuário
      this.restartApplication();

    } catch (error) {
      console.error('❌ Erro durante a atualização:', error.message);
      console.log('🔄 Tentando restaurar backup...');
      
      try {
        await this.restoreUserData();
        console.log('✅ Backup restaurado com sucesso');
      } catch (restoreError) {
        console.error('❌ Erro ao restaurar backup:', restoreError.message);
        console.log('⚠️ Verifique manualmente os arquivos em:', this.backupDir);
      }
      
      process.exit(1);
    }
  }

  async backupUserData() {
    console.log('📋 Criando backup dos dados do usuário...');
    
    // Limpa backup anterior se existir
    if (await fs.pathExists(this.backupDir)) {
      await fs.remove(this.backupDir);
    }
    
    await fs.ensureDir(this.backupDir);

    for (const item of PRESERVE_ITEMS) {
      const sourcePath = path.join(__dirname, item);
      
      if (await fs.pathExists(sourcePath)) {
        const destPath = path.join(this.backupDir, item);
        await fs.copy(sourcePath, destPath);
        console.log(`  ✅ Backup: ${item}`);
      } else {
        console.log(`  ⚠️ Item não encontrado: ${item}`);
      }
    }
  }

  async downloadLatestVersion() {
    console.log('⬇️ Baixando versão mais recente...');
    
    // Limpa diretório temporário se existir
    if (await fs.pathExists(this.tempDir)) {
      await fs.remove(this.tempDir);
    }
    
    await fs.ensureDir(this.tempDir);

    try {
      const response = await axios({
        method: 'GET',
        url: ZIP_URL,
        responseType: 'arraybuffer',
        timeout: 30000, // 30 segundos
        headers: {
          'User-Agent': 'BackBot-AutoUpdater/1.0'
        }
      });

      const zipPath = path.join(this.tempDir, 'latest.zip');
      await fs.writeFile(zipPath, response.data);
      
      console.log('📦 Extraindo arquivos...');
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(this.tempDir, true);
      
      await fs.remove(zipPath); // Remove o ZIP após extração
      
    } catch (error) {
      throw new Error(`Erro ao baixar/extrair: ${error.message}`);
    }
  }

  async replaceFiles() {
    console.log('🔄 Substituindo arquivos...');
    
    if (!await fs.pathExists(this.extractedDir)) {
      throw new Error('Diretório extraído não encontrado');
    }

    // Log das configurações de preservação
    console.log('🛡️ Itens configurados para preservação:');
    PRESERVE_ITEMS.forEach(item => console.log(`  - ${item}`));

    // Lista de arquivos/pastas para preservar (não deletar)
    const preservePaths = [
      path.basename(this.backupDir),
      path.basename(this.tempDir),
      'node_modules'
    ];

    // Remove arquivos antigos (exceto os preservados)
    const currentFiles = await fs.readdir(__dirname);
    
    for (const file of currentFiles) {
      const filePath = path.join(__dirname, file);
      
      // Verifica se o arquivo/pasta deve ser preservado
      let isPreserved = false;
      
      // Verifica paths temporários
      if (preservePaths.includes(file)) {
        isPreserved = true;
      }
      
      // Verifica itens de preservação
      for (const item of PRESERVE_ITEMS) {
        const itemPath = path.join(__dirname, item);
        if (filePath === itemPath || filePath.startsWith(itemPath)) {
          isPreserved = true;
          break;
        }
        // Se é um arquivo específico (como .env)
        if (file === item.replace(/\/$/, '')) {
          isPreserved = true;
          break;
        }
        // Se é uma pasta específica (termina com /)
        if (item.endsWith('/') && file === item.replace(/\/$/, '')) {
          isPreserved = true;
          break;
        }
      }

      if (!isPreserved) {
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
          await fs.remove(filePath);
        } else {
          await fs.remove(filePath);
        }
        console.log(`  🗑️ Removido: ${file}`);
      } else {
        console.log(`  🛡️ Preservado: ${file}`);
      }
    }

    // Copia novos arquivos
    const extractedFiles = await fs.readdir(this.extractedDir);
    
    for (const file of extractedFiles) {
      const sourcePath = path.join(this.extractedDir, file);
      const destPath = path.join(__dirname, file);
      
      // Se for o diretório src/, precisa de tratamento especial
      if (file === 'src') {
        await this.updateSrcSelectively(sourcePath, destPath);
      } else {
        await fs.copy(sourcePath, destPath);
        console.log(`  ✅ Copiado: ${file}`);
      }
    }
  }

  async updateSrcSelectively(newSrcPath, destSrcPath) {
    console.log('🔄 Atualizando diretório src/ seletivamente...');
    
    // Garante que o diretório src/ existe
    await fs.ensureDir(destSrcPath);
    
    // Lista arquivos/pastas no novo src/
    const newSrcItems = await fs.readdir(newSrcPath);
    
    for (const item of newSrcItems) {
      const sourcePath = path.join(newSrcPath, item);
      const destPath = path.join(destSrcPath, item);
      
      // NUNCA substitui src/persistence/ - preserva dados do usuário
      if (item === 'persistence') {
        console.log(`  🛡️ Preservado: src/${item}/ (dados do usuário)`);
        continue;
      }
      
      // Remove o item antigo se existir (exceto persistence)
      if (await fs.pathExists(destPath)) {
        await fs.remove(destPath);
        console.log(`  🗑️ Removido: src/${item}`);
      }
      
      // Copia o novo item
      await fs.copy(sourcePath, destPath);
      console.log(`  ✅ Atualizado: src/${item}`);
    }
  }

  async restoreUserData() {
    console.log('🔄 Restaurando dados do usuário...');
    
    if (!await fs.pathExists(this.backupDir)) {
      console.log('⚠️ Diretório de backup não encontrado');
      return;
    }

    const backupFiles = await fs.readdir(this.backupDir);
    
    for (const file of backupFiles) {
      const sourcePath = path.join(this.backupDir, file);
      const destPath = path.join(__dirname, file);
      
      // Remove arquivo/diretório existente se houver
      if (await fs.pathExists(destPath)) {
        await fs.remove(destPath);
      }
      
      await fs.copy(sourcePath, destPath);
      console.log(`  ✅ Restaurado: ${file}`);
    }
  }

  async runPostUpdateTasks() {
    console.log('🔧 Executando tarefas pós-atualização...');
    
    // Instala dependências
    console.log('📦 Instalando dependências...');
    await this.runCommand('npm', ['install'], 'Instalação de dependências');
    
    // Limpa arquivos temporários
    console.log('🧹 Limpando arquivos temporários...');
    if (await fs.pathExists(this.backupDir)) {
      await fs.remove(this.backupDir);
    }
    if (await fs.pathExists(this.tempDir)) {
      await fs.remove(this.tempDir);
    }
  }

  async runCommand(command, args, description) {
    return new Promise((resolve, reject) => {
      console.log(`  🔧 ${description}...`);
      
      const child = spawn(command, args, {
        stdio: 'inherit',
        shell: true
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log(`  ✅ ${description} concluída`);
          resolve();
        } else {
          reject(new Error(`${description} falhou com código ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`Erro ao executar ${description}: ${error.message}`));
      });
    });
  }

  restartApplication() {
    console.log('✅ Atualização concluída!');
    console.log('');
    console.log('🎯 Para iniciar o bot, execute:');
    console.log('   npm start        # Dashboard + API');
    console.log('   npm run start:bot # Bot individual');
    console.log('');
    console.log('📋 Verifique o CHANGELOG.md para ver as novidades');
    
    // NÃO reinicia automaticamente para evitar loops infinitos
    // O usuário deve iniciar manualmente conforme necessário
  }

  async checkRecentUpdate() {
    const flagPath = path.join(__dirname, UPDATE_FLAG_FILE);
    
    if (!await fs.pathExists(flagPath)) {
      return false;
    }

    try {
      const flagContent = await fs.readFile(flagPath, 'utf8');
      const flagData = JSON.parse(flagContent);
      const lastUpdate = new Date(flagData.timestamp);
      const now = new Date();
      const hoursDiff = (now - lastUpdate) / (1000 * 60 * 60);
      
      // Considera atualização recente se foi nas últimas 24 horas
      return hoursDiff < 24;
    } catch (error) {
      // Se não conseguir ler o arquivo, assume que não há atualização recente
      return false;
    }
  }

  async createUpdateFlag() {
    const flagPath = path.join(__dirname, UPDATE_FLAG_FILE);
    const flagData = {
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || 'unknown'
    };
    
    await fs.writeFile(flagPath, JSON.stringify(flagData, null, 2));
  }
}

// Verifica se o script foi executado diretamente (não importado)
function isMainModule() {
  // Verifica se é o módulo principal sendo executado
  const mainScript = process.argv[1];
  const currentScript = __filename;
  
  return mainScript && (
    mainScript === currentScript ||
    mainScript.endsWith('update.js') || 
    mainScript.includes('update.js') ||
    process.argv.some(arg => arg.includes('update.js'))
  );
}

// Só executa se for chamado diretamente via npm run update ou node update.js
// E adiciona uma verificação extra para evitar execução acidental
if (isMainModule() && !process.env.DISABLE_AUTO_UPDATE) {
  console.log('🔧 Script de atualização iniciado via comando...');
  console.log('📋 Para interromper future execuções automáticas, defina DISABLE_AUTO_UPDATE=true');
  
  const updater = new AutoUpdater();
  updater.main().catch(error => {
    console.error('❌ Erro fatal:', error.message);
    process.exit(1);
  });
} else if (process.env.DISABLE_AUTO_UPDATE) {
  console.log('⏸️ Atualização automática desabilitada via DISABLE_AUTO_UPDATE');
} else {
  console.log('ℹ️ Script update.js carregado mas não executado (use: npm run update)');
}
