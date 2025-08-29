import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import semver from 'semver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class VersionChecker {
  constructor() {
    this.localPackagePath = path.join(__dirname, '../../package.json');
    this.remotePackageUrl =
      'https://raw.githubusercontent.com/ovictorvieira/backbot/main/package.json';
  }

  /**
   * Obtém a versão local do package.json
   * @returns {string} Versão local
   */
  getLocalVersion() {
    try {
      const packageJson = JSON.parse(fs.readFileSync(this.localPackagePath, 'utf8'));
      return packageJson.version;
    } catch (error) {
      console.error('❌ Erro ao ler versão local:', error.message);
      return null;
    }
  }

  /**
   * Obtém a versão remota do GitHub
   * @returns {Promise<string>} Versão remota
   */
  async getRemoteVersion() {
    try {
      const response = await axios.get(this.remotePackageUrl, {
        timeout: 10000, // 10 segundos
        headers: {
          'User-Agent': 'BackBot-VersionChecker/1.0',
        },
      });

      const packageJson = response.data;
      return packageJson.version;
    } catch (error) {
      console.error('❌ Erro ao obter versão remota:', error.message);
      return null;
    }
  }

  /**
   * Verifica se há uma atualização disponível
   * @returns {Promise<boolean>} true se há atualização, false caso contrário
   */
  async isUpdateAvailable() {
    try {
      const localVersion = this.getLocalVersion();
      const remoteVersion = await this.getRemoteVersion();

      if (!localVersion || !remoteVersion) {
        console.log('⚠️ Não foi possível determinar as versões');
        return false;
      }

      console.log(`📋 Versão local: ${localVersion}`);
      console.log(`📋 Versão remota: ${remoteVersion}`);

      const hasUpdate = semver.gt(remoteVersion, localVersion);

      if (hasUpdate) {
        console.log(`🎉 Nova versão disponível: ${remoteVersion}`);
      } else {
        console.log('✅ Você está na versão mais recente');
      }

      return hasUpdate;
    } catch (error) {
      console.error('❌ Erro ao verificar atualizações:', error.message);
      return false;
    }
  }

  /**
   * Obtém informações detalhadas sobre as versões
   * @returns {Promise<Object>} Informações das versões
   */
  async getVersionInfo() {
    try {
      const localVersion = this.getLocalVersion();
      const remoteVersion = await this.getRemoteVersion();

      if (!localVersion || !remoteVersion) {
        return {
          success: false,
          error: 'Não foi possível determinar as versões',
        };
      }

      const hasUpdate = semver.gt(remoteVersion, localVersion);
      const isBehind = semver.lt(localVersion, remoteVersion);
      const isAhead = semver.gt(localVersion, remoteVersion);
      const isEqual = semver.eq(localVersion, remoteVersion);

      return {
        success: true,
        localVersion,
        remoteVersion,
        hasUpdate,
        isBehind,
        isAhead,
        isEqual,
        difference: hasUpdate ? semver.diff(remoteVersion, localVersion) : null,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Verifica se a versão local é válida
   * @returns {boolean} true se a versão é válida
   */
  isLocalVersionValid() {
    const localVersion = this.getLocalVersion();
    return localVersion && semver.valid(localVersion);
  }

  /**
   * Compara duas versões
   * @param {string} version1 Primeira versão
   * @param {string} version2 Segunda versão
   * @returns {number} -1 se version1 < version2, 0 se iguais, 1 se version1 > version2
   */
  compareVersions(version1, version2) {
    return semver.compare(version1, version2);
  }

  /**
   * Obtém a diferença entre duas versões
   * @param {string} version1 Primeira versão
   * @param {string} version2 Segunda versão
   * @returns {string} Tipo de diferença (major, minor, patch, etc.)
   */
  getVersionDifference(version1, version2) {
    return semver.diff(version1, version2);
  }
}

export default VersionChecker;
