import Logger from '../Utils/Logger.js';

/**
 * FeatureToggleService - Gerencia feature toggles via banco de dados
 *
 * Permite controlar features da aplicação sem necessidade de deploy
 */
class FeatureToggleService {
  static dbService = null;
  static cache = new Map();
  static cacheTimeout = 30000; // 30 segundos de cache
  static lastCacheUpdate = 0;

  /**
   * Inicializa o serviço com o DatabaseService
   */
  static initialize(dbService) {
    this.dbService = dbService;
    Logger.info('🎛️ [FEATURE_TOGGLES] Service initialized');
  }

  /**
   * Verifica se uma feature está habilitada
   * @param {string} featureName - Nome da feature
   * @returns {boolean} - True se habilitada
   */
  static async isEnabled(featureName) {
    try {
      // Check cache first
      if (this.isCacheValid() && this.cache.has(featureName)) {
        return this.cache.get(featureName);
      }

      // Load from database
      await this.loadToggles();

      return this.cache.get(featureName) || false;
    } catch (error) {
      Logger.error(`❌ [FEATURE_TOGGLES] Error checking feature ${featureName}:`, error.message);
      // Default to false on error for safety
      return false;
    }
  }

  /**
   * Habilita uma feature
   * @param {string} featureName - Nome da feature
   * @param {string} description - Descrição da feature
   */
  static async enable(featureName, description = '') {
    try {
      await this.setToggle(featureName, true, description);
      Logger.info(`✅ [FEATURE_TOGGLES] Feature '${featureName}' enabled`);
    } catch (error) {
      Logger.error(`❌ [FEATURE_TOGGLES] Error enabling feature ${featureName}:`, error.message);
      throw error;
    }
  }

  /**
   * Desabilita uma feature
   * @param {string} featureName - Nome da feature
   */
  static async disable(featureName) {
    try {
      await this.setToggle(featureName, false);
      Logger.info(`🔒 [FEATURE_TOGGLES] Feature '${featureName}' disabled`);
    } catch (error) {
      Logger.error(`❌ [FEATURE_TOGGLES] Error disabling feature ${featureName}:`, error.message);
      throw error;
    }
  }

  /**
   * Define o estado de uma feature toggle
   * @param {string} featureName - Nome da feature
   * @param {boolean} enabled - Estado desejado
   * @param {string} description - Descrição da feature
   */
  static async setToggle(featureName, enabled, description = '') {
    if (!this.dbService) {
      throw new Error('FeatureToggleService not initialized');
    }

    try {
      const sql = `
        INSERT INTO feature_toggles (feature_name, enabled, description, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(feature_name) DO UPDATE SET
          enabled = excluded.enabled,
          description = CASE WHEN excluded.description != '' THEN excluded.description ELSE description END,
          updated_at = excluded.updated_at
      `;

      await this.dbService.run(sql, [featureName, enabled ? 1 : 0, description]);

      // Update cache
      this.cache.set(featureName, enabled);
    } catch (error) {
      Logger.error(`❌ [FEATURE_TOGGLES] Error setting toggle ${featureName}:`, error.message);
      throw error;
    }
  }

  /**
   * Carrega todas as toggles do banco para o cache
   */
  static async loadToggles() {
    if (!this.dbService) {
      throw new Error('FeatureToggleService not initialized');
    }

    try {
      const sql = 'SELECT feature_name, enabled FROM feature_toggles';
      const rows = await this.dbService.getAll(sql);

      // Clear and update cache
      this.cache.clear();
      for (const row of rows) {
        this.cache.set(row.feature_name, row.enabled === 1);
      }

      this.lastCacheUpdate = Date.now();

      Logger.debug(`🎛️ [FEATURE_TOGGLES] Loaded ${rows.length} toggles to cache`);
    } catch (error) {
      Logger.error('❌ [FEATURE_TOGGLES] Error loading toggles:', error.message);
      throw error;
    }
  }

  /**
   * Lista todas as feature toggles
   * @returns {Array} - Lista de toggles com informações
   */
  static async getAllToggles() {
    if (!this.dbService) {
      throw new Error('FeatureToggleService not initialized');
    }

    try {
      const sql = `
        SELECT feature_name, enabled, description, created_at, updated_at
        FROM feature_toggles
        ORDER BY feature_name
      `;

      const rows = await this.dbService.getAll(sql);

      return rows.map(row => ({
        name: row.feature_name,
        enabled: row.enabled === 1,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      Logger.error('❌ [FEATURE_TOGGLES] Error getting all toggles:', error.message);
      throw error;
    }
  }

  /**
   * Remove uma feature toggle
   * @param {string} featureName - Nome da feature
   */
  static async removeToggle(featureName) {
    if (!this.dbService) {
      throw new Error('FeatureToggleService not initialized');
    }

    try {
      const sql = 'DELETE FROM feature_toggles WHERE feature_name = ?';
      await this.dbService.run(sql, [featureName]);

      // Remove from cache
      this.cache.delete(featureName);

      Logger.info(`🗑️ [FEATURE_TOGGLES] Feature '${featureName}' removed`);
    } catch (error) {
      Logger.error(`❌ [FEATURE_TOGGLES] Error removing toggle ${featureName}:`, error.message);
      throw error;
    }
  }

  /**
   * Verifica se o cache ainda é válido
   */
  static isCacheValid() {
    return Date.now() - this.lastCacheUpdate < this.cacheTimeout;
  }

  /**
   * Invalida o cache forçando reload do banco
   */
  static invalidateCache() {
    this.cache.clear();
    this.lastCacheUpdate = 0;
    Logger.debug('🎛️ [FEATURE_TOGGLES] Cache invalidated');
  }

  /**
   * Inicializa toggles padrão do sistema
   */
  static async initializeDefaultToggles() {
    try {
      // Apenas HFT_MODE toggle - sempre falso no startup
      const hftToggle = {
        name: 'HFT_MODE',
        enabled: false,
        description: 'Controla se o modo HFT (High-Frequency Trading) está ativo',
      };

      // Always ensure HFT_MODE exists and is set to false on startup
      await this.setToggle(hftToggle.name, false, hftToggle.description);
      Logger.info(`🎛️ [FEATURE_TOGGLES] Initialized default toggle: ${hftToggle.name} = false`);
    } catch (error) {
      Logger.error('❌ [FEATURE_TOGGLES] Error initializing default toggles:', error.message);
      throw error;
    }
  }
}

export default FeatureToggleService;
