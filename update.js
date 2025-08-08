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
const PRESERVE_ITEMS = ['.env', 'persistence/', 'node_modules/'];
const BACKUP_DIR = 'backup_temp';
const TEMP_DIR = 'temp_update';

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
      console.log('🔄 Reiniciando aplicação...');
      
      // Reinicia a aplicação
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

    // Lista de arquivos/pastas para preservar (não deletar)
    const preservePaths = [
      this.backupDir,
      this.tempDir,
      'node_modules'
    ];

    // Remove arquivos antigos (exceto os preservados)
    const currentFiles = await fs.readdir(__dirname);
    
    for (const file of currentFiles) {
      const filePath = path.join(__dirname, file);
      const isPreserved = preservePaths.some(preserve => 
        filePath.includes(preserve) || 
        PRESERVE_ITEMS.some(item => filePath.includes(item))
      );

      if (!isPreserved) {
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
          await fs.remove(filePath);
        } else {
          await fs.remove(filePath);
        }
        console.log(`  🗑️ Removido: ${file}`);
      }
    }

    // Copia novos arquivos
    const extractedFiles = await fs.readdir(this.extractedDir);
    
    for (const file of extractedFiles) {
      const sourcePath = path.join(this.extractedDir, file);
      const destPath = path.join(__dirname, file);
      
      await fs.copy(sourcePath, destPath);
      console.log(`  ✅ Copiado: ${file}`);
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
    console.log('🔄 Reiniciando aplicação...');
    
    // Reinicia o processo atual
    process.on('exit', () => {
      spawn(process.argv.shift(), process.argv, {
        cwd: process.cwd(),
        detached: true,
        stdio: 'inherit'
      });
    });
    
    process.exit(0);
  }
}

// Executa a atualização
const updater = new AutoUpdater();
updater.main().catch(error => {
  console.error('❌ Erro fatal:', error.message);
  process.exit(1);
});
