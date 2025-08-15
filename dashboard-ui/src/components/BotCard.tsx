import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play, Edit, Square, Trash2, RefreshCw } from 'lucide-react';
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
}


interface NextExecution {
  botId: number;
  botName: string;
  executionMode: string;
  timeframe: string;
  nextExecutionMs: number;
  nextExecutionDate: string;
  nextExecutionFormatted: string;
}

interface BotCardProps {
  config: BotConfig;
  isRunning: boolean;
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
  isRunning,
  isLoading = false,
  isRestarting = false,
  botStatus,
  onStart,
  onStop,
  onEdit,
  onDelete,
  onForceSync
}) => {
  const [nextExecution, setNextExecution] = useState<NextExecution | null>(null);
  const [countdown, setCountdown] = useState<string>('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isForceSyncing, setIsForceSyncing] = useState(false);

  // Calcular próximo tempo de execução baseado no nextValidationAt do status
  useEffect(() => {
    if (!isRunning || !botStatus?.config?.nextValidationAt) {
      setNextExecution(null);
      return;
    }

    // Usa o nextValidationAt do status do bot
    // O backend agora salva em UTC corretamente
    const nextValidationDate = new Date(botStatus.config.nextValidationAt);

    const now = Date.now();
    const diff = nextValidationDate.getTime() - now;

    // Se já passou do tempo, não mostra countdown
    if (diff <= 0) {
      setNextExecution(null);
      return;
    }

    // Cria objeto nextExecution baseado no nextValidationAt
    const nextExec = {
      botId: config.id || 0,
      botName: config.botName,
      executionMode: config.executionMode || 'REALTIME',
      timeframe: config.time || '5m',
      nextExecutionMs: diff,
      nextExecutionDate: nextValidationDate.toISOString(),
      nextExecutionFormatted: nextValidationDate.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      })
    };

    setNextExecution(nextExec);
  }, [config.id, isRunning, botStatus?.config?.nextValidationAt]);

  // Atualizar countdown a cada segundo
  useEffect(() => {
    if (!nextExecution || !isRunning) {
      setCountdown('');
      return;
    }

    const updateCountdown = () => {
      const now = Date.now();
      const nextExec = new Date(nextExecution.nextExecutionDate).getTime();
      const diff = nextExec - now;

      // Se a diferença for muito pequena (menos de 5 segundos), aguardar nova atualização
      if (diff <= 5000 && diff > 0) {
        setCountdown('Aguarde...');
        return;
      }

      if (diff <= 0) {
        setCountdown('Executando...');
        return;
      }

      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      const newCountdown = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      setCountdown(newCountdown);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [nextExecution, isRunning]);

  const getStatusBadge = () => {
    if (!config.enabled) {
      return <div className="w-3 h-3 bg-gray-400 rounded-full"></div>;
    }
    if (isRestarting) {
      return (
        <div className="w-3 h-3 bg-orange-500 rounded-full animate-spin"></div>
      );
    }
    if (isRunning) {
      return (
        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
      );
    }
    return <div className="w-3 h-3 bg-gray-400 rounded-full"></div>;
  };


  const handleDeleteBot = async (botId: number) => {
    setIsDeleting(true);
    try {
      await onDelete(botId);
      setShowDeleteModal(false);
    } catch (error) {
      console.error('Erro ao deletar bot:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleForceSync = async () => {
    if (!config.id) return;

    setIsForceSyncing(true);
    try {
      await onForceSync(config.id);
      // Atualizar estatísticas após o sync
      setTimeout(() => {
        window.location.reload(); // Força refresh das estatísticas
      }, 2000);
    } catch (error) {
      console.error('Erro ao fazer force sync:', error);
    } finally {
      setIsForceSyncing(false);
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

    if (isRunning) {
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
    <Card className={`w-full min-w-[280px] max-w-xs sm:max-w-sm ${isRestarting ? 'ring-2 ring-orange-500 ring-opacity-50 animate-pulse' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm sm:text-base truncate">{config.botName}</CardTitle>
            <p className="text-xs text-muted-foreground truncate">{config.strategyName}</p>
          </div>
          <div className="flex-shrink-0 ml-2">
            {getStatusBadge()}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
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
          {config.enableTrailingStop && !config.enableHybridStopStrategy && (
            <div className="border-t pt-2">
              <div className="text-xs font-medium mb-2 text-green-600">Configurações Trailing Stop</div>
              <div className="text-xs">
                <span className="font-medium">Distância:</span>
                <p className="text-muted-foreground">{config.trailingStopDistance}%</p>
              </div>
            </div>
          )}

          {/* Status de próxima atualização */}
          {isRunning && (
            <div className="text-xs text-muted-foreground border-t pt-2">
              {countdown && countdown !== '' ? (
                <span>
                  Próxima Atualização em: <span className="font-bold text-blue-600 dark:text-blue-400">{countdown}</span>
                </span>
              ) : botStatus?.config?.nextValidationAt ? (
                <span>
                  Próxima Atualização em: <span className="font-bold text-blue-600 dark:text-blue-400">Calculando...</span>
                </span>
              ) : (
                <span>Aguardando próxima execução...</span>
              )}
            </div>
          )}
        </div>

        {/* Status das Funcionalidades */}
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
        </div>

        {/* Tokens Ativos */}
        {config.authorizedTokens && config.authorizedTokens.length > 0 && (
          <div className="border-t pt-3">
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
      </CardContent>

      <CardFooter className="pt-2">
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
          <div className="relative group flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleForceSync}
              disabled={isForceSyncing || !config.id}
              className="flex items-center gap-1 sm:gap-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20 text-xs sm:text-sm"
            >
              <RefreshCw className={`h-3 w-3 sm:h-4 sm:w-4 ${isForceSyncing ? 'animate-spin' : ''}`} />
            </Button>
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black text-white text-xs rounded p-2 w-48 z-10 pointer-events-none">
              Force Sync: Sincroniza imediatamente as ordens do bot com a corretora
            </div>
          </div>
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