import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play, Edit, Square, Trash2, Zap, Activity } from 'lucide-react';
import { DeleteBotModal } from './DeleteBotModal';

interface BotConfig {
  id?: number;
  strategyName: string;
  botName: string;
  apiKey: string;
  apiSecret: string;
  capitalPercentage: number;
  time: string;
  enabled: boolean;
  maxNegativePnlStopPct: string | number;
  minProfitPercentage: string | number;
  maxSlippagePct: string | number;
  executionMode: string;
  // Configurações da Estratégia Híbrida de Stop Loss (ATR)
  enableHybridStopStrategy: boolean;
  initialStopAtrMultiplier: number;
  trailingStopAtrMultiplier: number;
  partialTakeProfitAtrMultiplier: number;
  partialTakeProfitPercentage: number;
  enableTrailingStop: boolean;
  trailingStopDistance: number;
  enablePostOnly: boolean;
  enableMarketFallback: boolean;
  enableOrphanOrderMonitor: boolean;
  enablePendingOrdersMonitor: boolean;
  // Configurações de Limite de Ordens
  maxOpenOrders: number;
  // Tokens autorizados
  authorizedTokens?: string[];
  // Próxima validação
  nextValidationAt?: string;
  // Configurações de Validação de Sinais
  enableMomentumSignals?: boolean;
  enableRsiSignals?: boolean;
  enableStochasticSignals?: boolean;
  enableMacdSignals?: boolean;
  enableAdxSignals?: boolean;
  // Configurações de Filtros de Confirmação
  enableMoneyFlowFilter?: boolean;
  enableVwapFilter?: boolean;
  enableBtcTrendFilter?: boolean;
  // Configuração do Heikin Ashi
  enableHeikinAshi?: boolean;
  // Configuração de Confluência
  enableConfluenceMode?: boolean;
  minConfluences?: number;
  // Configurações HFT
  hftSpread?: number;
  hftRebalanceFrequency?: number;
  hftOrderSize?: number;
  hftDailyHours?: number;
  hftMaxPriceDeviation?: number;
}



interface BotCardProps {
  config: BotConfig;
  // REMOVIDO: isRunning - usar config.status === 'running'
  isLoading?: boolean;
  isRestarting?: boolean; // Novo estado para reinicialização
  botStatus?: any; // Status completo do bot incluindo nextValidationAt
  onStart: (strategyName: string) => void;
  onStop: (strategyName: string) => void;
  onEdit: (strategyName: string) => void;
  onDelete: (botId: number) => void;
  onForceSync: (botId: number) => void;
}


export const BotCard: React.FC<BotCardProps> = ({
  config,
  isLoading = false,
  isRestarting = false,
  botStatus,
  onStart,
  onStop,
  onEdit,
  onDelete,
}) => {
  // Calcula isRunning baseado no botStatus
  const actualIsRunning = botStatus?.status === 'running';

  const [countdown, setCountdown] = useState<string>('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Determina se é bot HFT ou Traditional
  const isHFTBot = config.strategyName === 'HFT';

  // Componente para renderizar flag do tipo de bot
  const getBotTypeFlag = () => {
    if (isHFTBot) {
      return (
        <div className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded-full text-xs font-medium">
          <Zap className="h-3 w-3" />
          HFT
        </div>
      );
    } else {
      return (
        <div className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs font-medium">
          <Activity className="h-3 w-3" />
          TRADICIONAL
        </div>
      );
    }
  };

  // Cálculo direto e simplificado do countdown
  useEffect(() => {
    if (!actualIsRunning) {
      setCountdown('');
      return;
    }

    const updateCountdown = () => {
      // Se não tem nextValidationAt, mostra estado de aguardo
      if (!botStatus?.config?.nextValidationAt) {
        setCountdown('Aguardando dados...');
        return;
      }

      try {
        const nextValidationDate = new Date(botStatus.config.nextValidationAt);
        const now = Date.now();
        const diff = nextValidationDate.getTime() - now;


        // Se já passou do tempo recentemente, está executando
        if (diff <= 0) {
          setCountdown('Executando...');
          return;
        }

        // Se faltam menos de 5 segundos, mostra aguarde
        if (diff <= 5000) {
          setCountdown('Aguarde...');
          return;
        }

        // Calcula countdown normal
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        const newCountdown = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        setCountdown(newCountdown);

      } catch (error) {
        console.warn('Erro ao calcular countdown:', error);
        setCountdown('Calculando...');
      }
    };

    // Atualiza imediatamente
    updateCountdown();

    // Timeout para evitar "Calculando..." travado por mais de 3 segundos
    const timeoutId = setTimeout(() => {
      if (countdown === 'Calculando...') {
        setCountdown('Aguardando dados...');
      }
    }, 3000);

    // Atualiza a cada segundo
    const interval = setInterval(updateCountdown, 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeoutId);
    };
  }, [actualIsRunning, botStatus?.config?.nextValidationAt, countdown]);

  const getStatusBadge = () => {
    if (!config.enabled) {
      return <div className="w-3 h-3 bg-gray-400 rounded-full"></div>;
    }
    if (isRestarting) {
      return (
        <div className="w-3 h-3 bg-orange-500 rounded-full animate-spin"></div>
      );
    }
    if (actualIsRunning) {
      return (
        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
      );
    }
    return <div className="w-3 h-3 bg-gray-400 rounded-full"></div>;
  };


  const handleDeleteBot = async (botId: number) => {
    setIsDeleting(true);
    try {
      onDelete(botId);
      setShowDeleteModal(false);
    } catch (error) {
      console.error('Erro ao deletar bot:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const getActionButton = () => {
    // Se está reiniciando, mostrar botão "Reiniciando..."
    if (isRestarting) {
      return (
        <Button
          variant="default"
          size="sm"
          disabled={true}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white"
        >
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
          Reiniciando...
        </Button>
      );
    }

    if (actualIsRunning) {
      return (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onStop(config.strategyName)}
          disabled={isLoading}
          className="flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              Parando...
            </>
          ) : (
            <>
              <Square className="h-4 w-4" />
              Pausar
            </>
          )}
        </Button>
      );
    }

    // Se não está rodando, mostrar botão "Iniciar"
    return (
      <Button
        variant="default"
        size="sm"
        onClick={() => onStart(config.strategyName)}
        disabled={isLoading}
        className="flex items-center gap-2"
      >
        {isLoading ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            Iniciando...
          </>
        ) : (
          <>
            <Play className="h-4 w-4" />
            Iniciar
          </>
        )}
      </Button>
    );
  };

  return (
    <Card className={`w-full min-w-[280px] max-w-xs sm:max-w-sm h-full flex flex-col ${isRestarting ? 'ring-2 ring-orange-500 ring-opacity-50 animate-pulse' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <CardTitle className="text-sm sm:text-base truncate">{config.botName}</CardTitle>
              {getBotTypeFlag()}
            </div>
            <p className="text-xs text-muted-foreground truncate">{config.strategyName}</p>
          </div>
          <div className="flex-shrink-0 ml-2">
            {getStatusBadge()}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 flex-1">
        {/* Status de Reinicialização */}
        {isRestarting && (
          <div className="bg-orange-50 border border-orange-200 rounded-md p-3 mb-3">
            <div className="flex items-center gap-2 text-orange-800">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-600"></div>
              <span className="text-sm font-medium">Reiniciando bot...</span>
            </div>
            <p className="text-xs text-orange-600 mt-1">
              O bot está sendo atualizado e reiniciado. Aguarde um momento.
            </p>
          </div>
        )}

        {/* Configurações Básicas */}
        <div className="space-y-3">
          {isHFTBot ? (
            // Configurações HFT
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="font-medium">Capital:</span>
                <p className="text-muted-foreground">{config.capitalPercentage}%</p>
              </div>
              <div>
                <span className="font-medium">Spread:</span>
                <p className="text-muted-foreground">{config.hftSpread}%</p>
              </div>
              <div>
                <span className="font-medium">Rebalanceamento:</span>
                <p className="text-muted-foreground">{config.hftRebalanceFrequency}s</p>
              </div>
              <div>
                <span className="font-medium">Ordem Size:</span>
                <p className="text-muted-foreground">{config.hftOrderSize}%</p>
              </div>
              <div>
                <span className="font-medium">Horas Ativas:</span>
                <p className="text-muted-foreground">{config.hftDailyHours}h</p>
              </div>
              <div>
                <span className="font-medium">Max Deviation:</span>
                <p className="text-muted-foreground">{config.hftMaxPriceDeviation}%</p>
              </div>
            </div>
          ) : (
            // Configurações Tradicionais
            <>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="font-medium">Capital:</span>
                  <p className="text-muted-foreground">{config.capitalPercentage}%</p>
                </div>
                <div>
                  <span className="font-medium">Timeframe:</span>
                  <p className="text-muted-foreground">{config.time}</p>
                </div>
                <div>
                  <span className="font-medium">Stop Loss:</span>
                  <p className="text-muted-foreground">{config.maxNegativePnlStopPct}%</p>
                </div>
                <div>
                  <span className="font-medium">Lucro Mínimo:</span>
                  <p className="text-muted-foreground">{config.minProfitPercentage}%</p>
                </div>
                <div>
                  <span className="font-medium">Max Slippage:</span>
                  <p className="text-muted-foreground">{config.maxSlippagePct}%</p>
                </div>
                <div>
                  <span className="font-medium">Max Ordens:</span>
                  <p className="text-muted-foreground">{config.maxOpenOrders}</p>
                </div>
              </div>

              <div className="text-xs">
                <span className="font-medium">Modo Execução:</span>
                <p className="text-muted-foreground">
                  {config.executionMode === 'REALTIME' ? 'REALTIME (60s)' : 'ON_CANDLE_CLOSE'}
                </p>
              </div>
            </>
          )}

          {/* Configurações específicas do bot tradicional */}
          {!isHFTBot && (
            <>
              {/* Configurações de Stop Loss Híbrido */}
              {config.enableHybridStopStrategy && (
                <div className="border-t pt-2">
                  <div className="text-xs font-medium mb-2 text-blue-600">Configurações ATR (Stop Loss Híbrido)</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="font-medium">Stop ATR:</span>
                      <p className="text-muted-foreground">{config.initialStopAtrMultiplier}x</p>
                    </div>
                    <div>
                      <span className="font-medium">Trailing ATR:</span>
                      <p className="text-muted-foreground">{config.trailingStopAtrMultiplier}x</p>
                    </div>
                    <div>
                      <span className="font-medium">TP ATR:</span>
                      <p className="text-muted-foreground">{config.partialTakeProfitAtrMultiplier}x</p>
                    </div>
                    <div>
                      <span className="font-medium">TP Parcial:</span>
                      <p className="text-muted-foreground">{config.partialTakeProfitPercentage}%</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Configurações de Trailing Stop */}
              {config.enableTrailingStop && (
                <div className="border-t pt-2">
                  <div className="text-xs font-medium mb-2 text-green-600">Configurações Trailing Stop</div>
                  <div className="text-xs">
                    <span className="font-medium">Distância:</span>
                    <p className="text-muted-foreground">{config.trailingStopDistance}%</p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Tokens Ativos */}
          {config.authorizedTokens && config.authorizedTokens.length > 0 && (
              <div className="border-t pt-2">
                <div className="text-xs font-medium mb-2">Tokens Ativos</div>
                <div className="flex flex-wrap gap-1">
                  {config.authorizedTokens.slice(0, 4).map((token, index) => {
                    // Cores alternadas para diferentes tokens
                    const colorClasses = [
                      'bg-blue-50 text-blue-700 border-blue-200',
                      'bg-green-50 text-green-700 border-green-200',
                      'bg-purple-50 text-purple-700 border-purple-200',
                      'bg-orange-50 text-orange-700 border-orange-200',
                      'bg-indigo-50 text-indigo-700 border-indigo-200',
                      'bg-pink-50 text-pink-700 border-pink-200'
                    ];
                    const colorClass = colorClasses[index % colorClasses.length];

                    // Extrai apenas a parte do token antes do underscore (se houver) e limita a 4 caracteres
                    const baseToken = token.split('_')[0];
                    const truncatedToken = baseToken.length > 4 ? baseToken.substring(0, 4) : baseToken;

                    return (
                        <span
                            key={token}
                            className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${colorClass}`}
                        >
                      {truncatedToken}
                    </span>
                    );
                  })}
                  {config.authorizedTokens.length > 4 && (
                      <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border bg-gray-50 text-gray-700 border-gray-200">
                    +{config.authorizedTokens.length - 4}
                  </span>
                  )}
                </div>
              </div>
          )}

          {/* Status de próxima atualização */}
          {actualIsRunning && (
            <div className="text-xs text-muted-foreground border-t pt-2">
              <span>
                Próxima Atualização em: {' '}
                <span className={`font-bold ${
                  countdown.includes(':')
                    ? 'text-blue-600 dark:text-blue-400'
                    : countdown === 'Executando...'
                    ? 'text-orange-600 dark:text-orange-400'
                    : 'text-yellow-600 dark:text-yellow-400'
                }`}>
                  {countdown || 'Aguardando próxima execução...'}
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Status das Funcionalidades - Apenas para bots tradicionais */}
        {!isHFTBot && (
          <div className="grid grid-cols-2 gap-1 text-xs">
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${config.enableTrailingStop ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="truncate">Trailing Stop</span>
            </div>
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${config.enablePostOnly ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="truncate">Post Only Limit Orders</span>
            </div>
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${config.enableHybridStopStrategy ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="truncate">Stop Loss Híbrido</span>
            </div>
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${config.enableMarketFallback ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="truncate">Market Orders Fallback</span>
            </div>
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${config.enableRsiSignals ? 'bg-purple-500' : 'bg-gray-300'}`} />
              <span className="truncate">Sinais RSI</span>
            </div>
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${config.enableHeikinAshi ? 'bg-blue-500' : 'bg-gray-300'}`} />
              <span className="truncate">Filtro Heikin Ashi</span>
            </div>
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${config.enableConfluenceMode ? 'bg-yellow-500' : 'bg-gray-300'}`} />
              <span className="truncate">
                {config.enableConfluenceMode
                  ? `Confluência (${config.minConfluences || 2}+ sinais)`
                  : 'Confluência Desabilitada'
                }
              </span>
            </div>
          </div>
        )}

        {/* Funcionalidades específicas do HFT */}
        {isHFTBot && (
          <div className="grid grid-cols-2 gap-1 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              <span className="truncate">WebSocket Real-time</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="truncate">Grid Trading</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="truncate">Auto Rebalanceamento</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-purple-500" />
              <span className="truncate">Market Making</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-yellow-500" />
              <span className="truncate">Price Deviation Control</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-indigo-500" />
              <span className="truncate">High Frequency Execution</span>
            </div>
          </div>
        )}

      </CardContent>

      <CardFooter className="pt-2 mt-auto">
        <div className="flex gap-1 sm:gap-2 w-full">
          {getActionButton()}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(config.strategyName)}
            className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm flex-shrink-0"
          >
            <Edit className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Editar</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteModal(true)}
            className="flex items-center gap-1 sm:gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 text-xs sm:text-sm flex-shrink-0"
          >
            <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
          </Button>
        </div>
      </CardFooter>

      <DeleteBotModal
        isOpen={showDeleteModal}
        botName={config.botName}
        botId={config.id || 0}
        onConfirm={handleDeleteBot}
        onCancel={() => setShowDeleteModal(false)}
        isLoading={isDeleting}
      />
    </Card>
  );
};