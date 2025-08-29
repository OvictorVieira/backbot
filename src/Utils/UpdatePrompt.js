import VersionChecker from '../Services/VersionChecker.js';
import readline from 'readline';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class UpdatePrompt {
  constructor() {
    this.versionChecker = new VersionChecker();
    this.rl = null;
  }

  /**
   * Cria interface readline para interação com usuário
   */
  createInterface() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Fecha interface readline
   */
  closeInterface() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  /**
   * Faz uma pergunta ao usuário e retorna a resposta
   */
  async askQuestion(question) {
    return new Promise(resolve => {
      this.rl.question(question, answer => {
        resolve(answer.trim().toLowerCase());
      });
    });
  }

  /**
   * Executa o script de atualização
   */
  async runUpdate() {
    return new Promise((resolve, reject) => {
      console.log('\n🔄 Iniciando processo de atualização...\n');

      const updateScript = path.join(__dirname, '../../update.js');
      const child = spawn('node', [updateScript], {
        stdio: 'inherit',
        shell: true,
      });

      child.on('close', code => {
        if (code === 0) {
          console.log('\n✅ Atualização concluída com sucesso!');
          resolve(true);
        } else {
          console.error('\n❌ Erro durante a atualização');
          reject(new Error(`Processo de atualização falhou com código ${code}`));
        }
      });

      child.on('error', error => {
        reject(new Error(`Erro ao executar atualização: ${error.message}`));
      });
    });
  }

  /**
   * Verifica se há atualização disponível e pergunta ao usuário
   */
  async checkAndPromptUpdate() {
    try {
      console.log('🔍 Verificando se há atualizações disponíveis...\n');

      const versionInfo = await this.versionChecker.getVersionInfo();

      if (!versionInfo.success) {
        console.log('⚠️ Não foi possível verificar atualizações');
        console.log('📋 Continuando com a execução normal...\n');
        return false;
      }

      const { localVersion, remoteVersion, hasUpdate } = versionInfo;

      console.log(`📦 Versão atual: ${localVersion}`);
      console.log(`🌐 Versão disponível: ${remoteVersion}`);

      if (!hasUpdate) {
        console.log('✅ Você está na versão mais recente!\n');
        return false;
      }

      // Há atualização disponível
      console.log(`\n🎉 NOVA VERSÃO DISPONÍVEL: v${remoteVersion}`);
      console.log('════════════════════════════════════════');

      // Determina o tipo de atualização
      if (versionInfo.difference) {
        const updateType = this.getUpdateTypeDescription(versionInfo.difference);
        console.log(`🔄 Tipo de atualização: ${updateType}`);
      }

      this.createInterface();

      console.log('\n📋 Para ver as novidades, consulte o CHANGELOG.md');
      const answer = await this.askQuestion('\n❓ Deseja atualizar agora? (Y/n): ');

      this.closeInterface();

      // Trata a resposta (Y/yes/sim são aceitos como sim, qualquer outra coisa é não)
      const shouldUpdate =
        answer === '' || answer === 'y' || answer === 'yes' || answer === 'sim' || answer === 's';

      if (shouldUpdate) {
        await this.runUpdate();
        console.log('\n🎯 Reinicie o comando npm start para usar a nova versão');
        process.exit(0);
      } else {
        console.log('\n⏭️ Atualização ignorada, continuando com a versão atual...\n');
        return false;
      }
    } catch (error) {
      console.error('❌ Erro ao verificar atualizações:', error.message);
      console.log('📋 Continuando com a execução normal...\n');
      return false;
    }
  }

  /**
   * Retorna descrição amigável do tipo de atualização
   */
  getUpdateTypeDescription(difference) {
    switch (difference) {
      case 'major':
        return '🚀 Atualização MAJOR (mudanças significativas)';
      case 'minor':
        return '✨ Atualização MINOR (novas funcionalidades)';
      case 'patch':
        return '🔧 Atualização PATCH (correções e melhorias)';
      case 'prerelease':
        return '🧪 Versão PRÉ-LANÇAMENTO';
      default:
        return `📋 Atualização ${difference.toUpperCase()}`;
    }
  }

  /**
   * Método de entrada principal - verifica atualizações de forma não-intrusiva
   */
  static async checkForUpdates() {
    const prompt = new UpdatePrompt();

    try {
      await prompt.checkAndPromptUpdate();
    } catch (error) {
      console.error('❌ Erro inesperado na verificação de atualizações:', error.message);
      console.log('📋 Continuando com a execução normal...\n');
    } finally {
      prompt.closeInterface();
    }
  }
}

export default UpdatePrompt;
