import Logger from './Logger.js';
import RiskManager from '../Risk/RiskManager.js';

/**
 * Centralizador de cálculos de quantidade para ordens
 * ÚNICO PONTO que calcula volumes e garante que capitalPercentage seja SEMPRE respeitado
 * Evita duplicação de lógica e garante consistência nos tamanhos de posição
 */
class QuantityCalculator {
  /**
   * 🎯 MÉTODO PRINCIPAL - Calcula quantidade respeitando RIGOROSAMENTE o capitalPercentage
   * Este é o ÚNICO método que deve ser usado para calcular tamanho de posições
   * @param {number} entryPrice - Preço de entrada
   * @param {object} marketInfo - Informações do mercado (decimal_quantity, stepSize, etc)
   * @param {object} config - Configuração do bot (capitalPercentage, etc)
   * @param {object} account - Dados da conta (capitalAvailable)
   * @param {string} market - Símbolo do mercado (para logs)
   * @returns {object} { quantity: string, orderValue: number, volumeUSD: number, isValid: boolean, error?: string }
   */
  static calculatePositionSize(entryPrice, marketInfo, config, account, market = 'UNKNOWN') {
    try {
      // 🔒 GARANTIA ABSOLUTA: Calcula volume baseado no capitalPercentage
      const volumeUSD = RiskManager.calculateInvestmentAmount(account.capitalAvailable, config);

      Logger.info(
        `🎯 [POSITION_SIZE] ${market}: Capital($${account.capitalAvailable.toFixed(2)}) × ${config?.capitalPercentage || 'padrão'}% = Volume($${volumeUSD.toFixed(2)})`
      );

      // Chama método interno de cálculo
      const result = this._calculateOrderQuantityInternal(
        volumeUSD,
        entryPrice,
        marketInfo,
        market
      );

      // Adiciona informação do volume calculado
      return {
        ...result,
        volumeUSD,
        capitalPercentage: config?.capitalPercentage || 1,
      };
    } catch (error) {
      const errorMsg = `Erro no cálculo de tamanho de posição: ${error.message}`;
      Logger.error(`❌ [POSITION_SIZE] ${market}: ${errorMsg}`);
      return { quantity: '0', orderValue: 0, volumeUSD: 0, isValid: false, error: errorMsg };
    }
  }

  /**
   * 🎯 MÉTODO PARA ORDENS ESCALONADAS - Distribui capital respeitando capitalPercentage
   * @param {Array} entryPrices - Preços de entrada para cada ordem
   * @param {Array} weights - Pesos percentuais [50, 30, 20]
   * @param {object} marketInfo - Informações do mercado
   * @param {object} config - Configuração do bot
   * @param {object} account - Dados da conta
   * @param {string} market - Símbolo do mercado
   * @returns {Array} Array com ordens validadas
   */
  static calculateScaledPositions(
    entryPrices,
    weights,
    marketInfo,
    config,
    account,
    market = 'UNKNOWN'
  ) {
    try {
      // 🔒 GARANTIA ABSOLUTA: Calcula volume total baseado no capitalPercentage
      const totalVolumeUSD = RiskManager.calculateInvestmentAmount(
        account.capitalAvailable,
        config
      );

      Logger.info(
        `🎯 [SCALED_POSITIONS] ${market}: Capital($${account.capitalAvailable.toFixed(2)}) × ${config?.capitalPercentage || 'padrão'}% = Volume Total($${totalVolumeUSD.toFixed(2)})`
      );

      const orders = [];
      let remainingVolume = totalVolumeUSD;

      for (let i = 0; i < entryPrices.length; i++) {
        const weight = weights[i];
        const entryPrice = entryPrices[i];
        const isLastOrder = i === weights.length - 1;

        // Para última ordem, usa volume restante para evitar erros de arredondamento
        const orderVolume = isLastOrder ? remainingVolume : (totalVolumeUSD * weight) / 100;

        const result = this._calculateOrderQuantityInternal(
          orderVolume,
          entryPrice,
          marketInfo,
          `${market}_${i + 1}`
        );

        if (result.isValid) {
          orders.push({
            orderNumber: i + 1,
            weight: weight,
            price: entryPrice,
            quantity: result.quantity,
            orderValue: result.orderValue,
            targetVolume: orderVolume,
          });

          if (!isLastOrder) {
            remainingVolume -= result.orderValue;
          }
        } else {
          Logger.warn(`⚠️ [SCALED_POSITIONS] ${market}: Ordem ${i + 1} rejeitada: ${result.error}`);
        }
      }

      const totalCalculatedValue = orders.reduce((sum, order) => sum + order.orderValue, 0);
      Logger.info(
        `✅ [SCALED_POSITIONS] ${market}: ${orders.length}/${entryPrices.length} ordens validadas - Total: $${totalCalculatedValue.toFixed(2)} (${config?.capitalPercentage || 'padrão'}%)`
      );

      return orders;
    } catch (error) {
      Logger.error(`❌ [SCALED_POSITIONS] ${market}: ${error.message}`);
      return [];
    }
  }

  /**
   * 🔧 MÉTODO INTERNO - Calcula quantidade com volume pré-definido (NÃO USAR DIRETAMENTE)
   * @param {number} volumeUSD - Volume em USD para a ordem
   * @param {number} entryPrice - Preço de entrada
   * @param {object} marketInfo - Informações do mercado
   * @param {string} market - Símbolo do mercado
   * @returns {object} Resultado do cálculo
   */
  static _calculateOrderQuantityInternal(volumeUSD, entryPrice, marketInfo, market = 'UNKNOWN') {
    try {
      // Validações básicas
      if (!volumeUSD || volumeUSD <= 0) {
        const error = `Volume USD inválido: ${volumeUSD}`;
        Logger.error(`❌ [QUANTITY_CALC] ${market}: ${error}`);
        return { quantity: '0', orderValue: 0, isValid: false, error };
      }

      if (!entryPrice || entryPrice <= 0) {
        const error = `Preço de entrada inválido: ${entryPrice}`;
        Logger.error(`❌ [QUANTITY_CALC] ${market}: ${error}`);
        return { quantity: '0', orderValue: 0, isValid: false, error };
      }

      const decimalQuantity = marketInfo?.decimal_quantity || 8;
      const stepSize = marketInfo?.stepSize_quantity || 0;

      if (decimalQuantity < 0 || decimalQuantity > 18) {
        const error = `Decimal quantity inválido: ${decimalQuantity}`;
        Logger.error(`❌ [QUANTITY_CALC] ${market}: ${error}`);
        return { quantity: '0', orderValue: 0, isValid: false, error };
      }

      // Log do cálculo de quantidade
      Logger.debug(
        `[QUANTITY_CALC] ${market} - Volume: $${volumeUSD.toFixed(2)}, Price: $${entryPrice.toFixed(6)}, StepSize: ${stepSize}`
      );

      // Cálculo principal: Volume USD / Preço = Quantidade
      const rawQuantity = volumeUSD / entryPrice;

      // 🎯 APLICA VALIDAÇÃO DE QUANTIDADE MÍNIMA PRIMEIRO (como no HFT)
      let adjustedQuantity = rawQuantity;

      // 1. Aplica minQuantity se disponível
      if (marketInfo?.minQuantity) {
        const minQty = parseFloat(marketInfo.minQuantity);
        if (rawQuantity < minQty) {
          Logger.debug(
            `⚠️ [QUANTITY_CALC] ${market}: Quantidade ${rawQuantity.toFixed(8)} abaixo do mínimo ${minQty}, usando quantidade mínima`
          );
          adjustedQuantity = minQty;
        }
      }

      // 2. Aplica stepSize se disponível
      if (stepSize && stepSize > 0) {
        // Garante que seja múltiplo do stepSize, mas mantém pelo menos a quantidade mínima
        const stepAdjusted = Math.floor(adjustedQuantity / stepSize) * stepSize;

        // Se o stepSize zeraria a quantidade e temos minQuantity, usa a minQuantity
        if (stepAdjusted <= 0 && marketInfo?.minQuantity) {
          adjustedQuantity = parseFloat(marketInfo.minQuantity);
          Logger.debug(
            `⚠️ [QUANTITY_CALC] ${market}: stepSize zeraria quantidade, mantendo minQuantity ${adjustedQuantity}`
          );
        } else {
          adjustedQuantity = stepAdjusted;
        }
      }

      // 🎯 CORREÇÃO INTELIGENTE: Limita decimais mas mantém precisão necessária
      // Para evitar "decimal too long", usa máximo 4 decimais ou o limite do mercado
      const maxSafeDecimals = Math.min(4, decimalQuantity);
      let formattedQuantity = adjustedQuantity.toFixed(maxSafeDecimals);

      // Remove zeros desnecessários no final (0.1000 → 0.1)
      formattedQuantity = parseFloat(formattedQuantity).toString();
      const finalQuantity = parseFloat(formattedQuantity);

      Logger.debug(
        `🔧 [QUANTITY_CALC] ${market}: Decimais limitados a ${maxSafeDecimals} (mercado: ${decimalQuantity})`
      );
      Logger.debug(
        `🔧 [QUANTITY_CALC] ${market}: ${adjustedQuantity.toFixed(8)} → ${formattedQuantity}`
      );

      // Validação final
      if (finalQuantity <= 0) {
        const error = `Quantidade calculada inválida: ${finalQuantity}`;
        Logger.error(`❌ [QUANTITY_CALC] ${market}: ${error}`);
        return { quantity: '0', orderValue: 0, isValid: false, error };
      }

      // Calcula valor real da ordem (pode diferir ligeiramente devido ao arredondamento)
      const actualOrderValue = finalQuantity * entryPrice;

      Logger.debug(
        `[QUANTITY_CALC] ${market}: Final quantity: ${finalQuantity}, Value: $${actualOrderValue.toFixed(2)}`
      );

      // Log detalhado do cálculo
      Logger.debug(
        `📊 [QUANTITY_CALC] ${market}: Volume($${volumeUSD.toFixed(2)}) ÷ Preço($${entryPrice.toFixed(6)}) = ${finalQuantity} (${decimalQuantity} decimais) = Valor Real($${actualOrderValue.toFixed(2)})`
      );

      // Verifica se há discrepância significativa entre volume solicitado e real
      const discrepancy = Math.abs(volumeUSD - actualOrderValue);
      const discrepancyPercent = (discrepancy / volumeUSD) * 100;

      if (discrepancyPercent > 5) {
        Logger.debug(
          `⚠️ [QUANTITY_CALC] ${market}: Discrepância de ${discrepancyPercent.toFixed(2)}% entre volume solicitado($${volumeUSD.toFixed(2)}) e real($${actualOrderValue.toFixed(2)})`
        );
      }

      return {
        quantity: formattedQuantity, // Já está com máximo 1 casa decimal
        orderValue: actualOrderValue,
        isValid: true,
        rawQuantity,
        discrepancy: discrepancyPercent,
      };
    } catch (error) {
      const errorMsg = `Erro no cálculo de quantidade: ${error.message}`;
      Logger.error(`❌ [QUANTITY_CALC] ${market}: ${errorMsg}`);
      return { quantity: '0', orderValue: 0, isValid: false, error: errorMsg };
    }
  }

  /**
   * 🗑️ MÉTODO DEPRECADO - Usar calculateScaledPositions() no lugar
   * Calcula múltiplas quantidades para ordens escalonadas (AlphaFlow)
   * @param {number} totalVolumeUSD - Volume total em USD
   * @param {number} entryPrice - Preço de entrada
   * @param {number} decimalQuantity - Casas decimais
   * @param {Array} weights - Array com pesos percentuais [50, 30, 20]
   * @param {string} market - Símbolo do mercado
   * @returns {Array} Array de objetos com quantity, orderValue para cada ordem
   * @deprecated Usar calculateScaledPositions() que calcula volume internamente
   */
  static calculateScaledOrders(
    totalVolumeUSD,
    entryPrice,
    decimalQuantity,
    weights = [50, 30, 20],
    market = 'UNKNOWN'
  ) {
    try {
      Logger.warn(
        `⚠️ [QUANTITY_CALC] ${market}: Método calculateScaledOrders DEPRECADO. Use calculateScaledPositions()`
      );

      // Valida pesos
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      if (Math.abs(totalWeight - 100) > 0.1) {
        Logger.debug(`⚠️ [QUANTITY_CALC] ${market}: Pesos não somam 100%: ${totalWeight}%`);
      }

      const orders = [];
      let remainingVolume = totalVolumeUSD;

      weights.forEach((weight, index) => {
        const isLastOrder = index === weights.length - 1;

        // Para última ordem, usa volume restante para evitar erros de arredondamento
        const orderVolume = isLastOrder ? remainingVolume : (totalVolumeUSD * weight) / 100;

        const result = this._calculateOrderQuantityInternal(
          orderVolume,
          entryPrice,
          { decimal_quantity: decimalQuantity },
          `${market}_${index + 1}`
        );

        orders.push({
          orderNumber: index + 1,
          weight: weight,
          targetVolume: orderVolume,
          ...result,
        });

        if (!isLastOrder) {
          remainingVolume -= result.orderValue;
        }
      });

      // Log do resumo
      const totalCalculatedValue = orders.reduce((sum, order) => sum + order.orderValue, 0);
      Logger.debug(
        `📊 [QUANTITY_CALC] ${market}: ${orders.length} ordens escalonadas - Volume Total: $${totalVolumeUSD.toFixed(2)} → Real: $${totalCalculatedValue.toFixed(2)}`
      );

      return orders;
    } catch (error) {
      Logger.error(`❌ [QUANTITY_CALC] ${market}: Erro em ordens escalonadas: ${error.message}`);
      return [];
    }
  }

  /**
   * Valida se uma quantidade está dentro dos limites permitidos
   * @param {string|number} quantity - Quantidade a validar
   * @param {object} marketInfo - Informações do mercado (min/max)
   * @param {string} market - Símbolo do mercado
   * @returns {object} { isValid: boolean, error?: string }
   */
  static validateQuantityLimits(quantity, marketInfo, market = 'UNKNOWN') {
    try {
      const numQuantity = parseFloat(quantity);

      if (isNaN(numQuantity) || numQuantity <= 0) {
        return { isValid: false, error: `Quantidade inválida: ${quantity}` };
      }

      // Valida quantidade mínima
      if (marketInfo?.minQuantity && numQuantity < parseFloat(marketInfo.minQuantity)) {
        return {
          isValid: false,
          error: `Quantidade ${quantity} menor que mínimo ${marketInfo.minQuantity}`,
        };
      }

      // Valida quantidade máxima
      if (marketInfo?.maxQuantity && numQuantity > parseFloat(marketInfo.maxQuantity)) {
        return {
          isValid: false,
          error: `Quantidade ${quantity} maior que máximo ${marketInfo.maxQuantity}`,
        };
      }

      // Valida step size (incremento mínimo)
      if (marketInfo?.stepSize_quantity) {
        const stepSize = parseFloat(marketInfo.stepSize_quantity);
        const remainder = Math.abs(numQuantity % stepSize);
        const tolerance = stepSize / 10000; // Tolerância mais flexível baseada no stepSize
        if (remainder > tolerance && stepSize - remainder > tolerance) {
          return {
            isValid: false,
            error: `Quantidade ${quantity} não é múltiplo do step size ${stepSize} (resto: ${remainder.toFixed(8)})`,
          };
        }
      }

      Logger.debug(`✅ [QUANTITY_CALC] ${market}: Quantidade ${quantity} validada com sucesso`);
      return { isValid: true };
    } catch (error) {
      return { isValid: false, error: `Erro na validação: ${error.message}` };
    }
  }

  /**
   * 🗑️ MÉTODO DEPRECADO - Usar calculatePositionSize() no lugar
   * Método de conveniência que calcula E valida quantidade
   * @param {number} volumeUSD - Volume em USD
   * @param {number} entryPrice - Preço de entrada
   * @param {object} marketInfo - Informações do mercado
   * @param {string} market - Símbolo do mercado
   * @returns {object} Resultado completo com validação
   * @deprecated Usar calculatePositionSize() que calcula volume internamente
   */
  static calculateAndValidateQuantity(volumeUSD, entryPrice, marketInfo, market = 'UNKNOWN') {
    Logger.warn(
      `⚠️ [QUANTITY_CALC] ${market}: Método calculateAndValidateQuantity DEPRECADO. Use calculatePositionSize()`
    );

    // Calcula quantidade
    const calculation = this._calculateOrderQuantityInternal(
      volumeUSD,
      entryPrice,
      marketInfo,
      market
    );

    if (!calculation.isValid) {
      return calculation;
    }

    // Valida limites do mercado
    const validation = this.validateQuantityLimits(calculation.quantity, marketInfo, market);

    if (!validation.isValid) {
      return {
        ...calculation,
        isValid: false,
        error: validation.error,
      };
    }

    return calculation;
  }
}

export default QuantityCalculator;
