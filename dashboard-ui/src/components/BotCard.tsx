import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, Settings, Eye, EyeOff, TrendingUp, TrendingDown, DollarSign, Activity, Edit, Square, HelpCircle, Trash2, RefreshCw } from 'lucide-react';
import axios from 'axios';
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
  // Próxima validação
  nextValidationAt?: string;
}

interface TradingStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitRatio: string | number; // Pode ser "∞" ou número
  totalPnl: number;
  openPositions: number;
  lastUpdated: string;
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
  onConfigure: (strategyName: string) => void;
  onEdit: (strategyName: string) => void;
  onDelete: (botId: number) => void;
  onForceSync: (botId: number) => void;
}

// Componente de Skeleton para Estatísticas
const TradingStatsSkeleton = () => (
  <div className="space-y-2">
    <div className="flex items-center gap-2">
      <div className="h-4 w-4 bg-blue-500 rounded animate-pulse" />
      <div className="h-4 w-32 bg-muted rounded animate-pulse" />
    </div>

    <div className="grid grid-cols-2 gap-2 text-xs">
      <div className="bg-blue-50 dark:bg-blue-950/20 p-2 rounded">
        <div className="flex items-center gap-1 mb-1">
          <div className="h-3 w-3 bg-green-600 rounded animate-pulse" />
          <div className="h-3 w-20 bg-muted rounded animate-pulse" />
        </div>
        <div className="h-4 w-8 bg-green-600 rounded animate-pulse" />
      </div>

      <div className="bg-red-50 dark:bg-red-950/20 p-2 rounded">
        <div className="flex items-center gap-1 mb-1">
          <div className="h-3 w-3 bg-red-600 rounded animate-pulse" />
          <div className="h-3 w-20 bg-muted rounded animate-pulse" />
        </div>
        <div className="h-4 w-8 bg-red-600 rounded animate-pulse" />
      </div>

      <div className="bg-purple-50 dark:bg-purple-950/20 p-2 rounded">
        <div className="flex items-center gap-1 mb-1">
          <div className="h-3 w-3 bg-purple-600 rounded animate-pulse" />
          <div className="h-3 w-16 bg-muted rounded animate-pulse" />
        </div>
        <div className="h-4 w-12 bg-purple-600 rounded animate-pulse" />
      </div>

      <div className="bg-orange-50 dark:bg-orange-950/20 p-2 rounded">
        <div className="flex items-center gap-1 mb-1">
          <div className="h-3 w-3 bg-orange-600 rounded animate-pulse" />
          <div className="h-3 w-20 bg-muted rounded animate-pulse" />
        </div>
        <div className="h-4 w-16 bg-orange-600 rounded animate-pulse" />
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3 text-xs">
      <div>
        <div className="h-3 w-20 bg-muted rounded animate-pulse mb-1" />
        <div className="h-3 w-4 bg-muted rounded animate-pulse" />
      </div>
      <div>
        <div className="h-3 w-24 bg-muted rounded animate-pulse mb-1" />
        <div className="h-3 w-4 bg-muted rounded animate-pulse" />
      </div>
    </div>

    <div className="h-3 w-32 bg-muted rounded animate-pulse" />
  </div>
);

export const BotCard: React.FC<BotCardProps> = ({
  config,
  isRunning,
  isLoading = false,
  isRestarting = false,
  botStatus,
  onStart,
  onStop,
  onConfigure,
  onEdit,
  onDelete,
  onForceSync
}) => {
  const [showApiKey, setShowApiKey] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [tradingStats, setTradingStats] = useState<TradingStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [nextExecution, setNextExecution] = useState<NextExecution | null>(null);
  const [countdown, setCountdown] = useState<string>('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isForceSyncing, setIsForceSyncing] = useState(false);

  // Buscar estatísticas de trading do novo endpoint
  useEffect(() => {
    const fetchTradingStats = async () => {
      if (!config.id) return;

      setLoadingStats(true);
      try {
        const response = await axios.get(`http://localhost:3001/api/bot/summary?botId=${config.id}`);
        if (response.data.success) {
          const data = response.data.data;
          setTradingStats({
            totalTrades: data.statistics.totalTrades,
            winningTrades: data.statistics.winningTrades,
            losingTrades: data.statistics.losingTrades,
            winRate: data.statistics.winRate,
            profitRatio: data.statistics.profitRatio,
            totalPnl: data.performance.totalPnl,
            openPositions: data.statistics.openPositions,
            lastUpdated: data.lastUpdated
          });
          setHasLoadedOnce(true);
        }
      } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
      } finally {
        setLoadingStats(false);
      }
    };

    fetchTradingStats();

    // Atualizar a cada 30 segundos
    const interval = setInterval(fetchTradingStats, 30000);
    return () => clearInterval(interval);
  }, [config.id]);

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

  // Função para formatar o Profit Ratio
  const formatProfitRatio = (profitRatio: string | number) => {
    if (profitRatio === "∞" || profitRatio === "Infinity") {
      return "∞";
    }
    if (typeof profitRatio === 'number') {
      return profitRatio.toFixed(2);
    }
    return profitRatio.toString();
  };

  const formatWinRate = (winRate: number) => {
    return winRate.toFixed(2);
  };

  // Função para determinar a cor do Win Rate
  const getWinRateColor = (winRate: number) => {
    if (winRate >= 50) {
      return 'text-green-600';
    } else if (winRate >= 30) {
      return 'text-orange-600';
    } else {
      return 'text-red-600';
    }
  };

  // Função para determinar a cor do Profit Factor
  const getProfitFactorColor = (profitRatio: string | number) => {
    if (profitRatio === "∞" || profitRatio === "Infinity") {
      return 'text-green-600';
    }

    if (typeof profitRatio === 'number') {
      if (profitRatio >= 2.0) {
        return 'text-green-600';
      } else if (profitRatio >= 1.0) {
        return 'text-orange-600';
      } else {
        return 'text-red-600';
      }
    }

    // Se for string, tentar converter para número
    const numValue = parseFloat(profitRatio.toString());
    if (!isNaN(numValue)) {
      if (numValue >= 2.0) {
        return 'text-green-600';
      } else if (numValue >= 1.0) {
        return 'text-orange-600';
      } else {
        return 'text-red-600';
      }
    }

    return 'text-red-600'; // Fallback
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
    <Card className={`w-full max-w-sm ${isRestarting ? 'ring-2 ring-orange-500 ring-opacity-50 animate-pulse' : ''}`}>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs sm:text-sm">
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
          <div className="sm:col-span-2">
            <span className="font-medium">Modo Execução:</span>
            <p className="text-muted-foreground text-xs">
              {config.executionMode === 'REALTIME' ? 'REALTIME (60s)' : 'ON_CANDLE_CLOSE'}
            </p>
          </div>
          <div>
            <span className="font-medium">Max Ordens:</span>
            <p className="text-muted-foreground">{config.maxOpenOrders}</p>
          </div>
        </div>



        {/* Estatísticas de Trading */}
        {!hasLoadedOnce && loadingStats ? (
          <TradingStatsSkeleton />
        ) : tradingStats && hasLoadedOnce ? (
          <div className="space-y-2">
            {/*<div className="flex items-center gap-2">*/}
            {/*  <Activity className="h-4 w-4 text-blue-500" />*/}
            {/*  <span className="font-medium text-sm">Estatísticas de Trading</span>*/}
            {/*</div>*/}

            {/*<div className="grid grid-cols-2 gap-1 sm:gap-2 text-xs">*/}
            {/*  <div className="bg-blue-50 dark:bg-blue-950/20 p-2 rounded">*/}
            {/*    <div className="flex items-center gap-1 mb-1">*/}
            {/*      <TrendingUp className="h-3 w-3 text-green-600" />*/}
            {/*      <span className="font-medium">Trades Ganhos</span>*/}
            {/*      <div className="relative group">*/}
            {/*        <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help hover:text-blue-500" />*/}
            {/*        <div className="absolute bottom-full left-0 mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black text-white text-xs rounded p-2 w-48 z-10 pointer-events-none">*/}
            {/*          Número total de operações que resultaram em lucro. Trades com P&L positivo.*/}
            {/*        </div>*/}
            {/*      </div>*/}
            {/*    </div>*/}
            {/*    <p className="text-green-600 font-bold">{tradingStats.winningTrades}</p>*/}
            {/*  </div>*/}

            {/*  <div className="bg-red-50 dark:bg-red-950/20 p-2 rounded">*/}
            {/*    <div className="flex items-center gap-1 mb-1">*/}
            {/*      <TrendingDown className="h-3 w-3 text-red-600" />*/}
            {/*      <span className="font-medium">Trades Perdidos</span>*/}
            {/*      <div className="relative group">*/}
            {/*        <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help hover:text-red-500" />*/}
            {/*        <div className="absolute bottom-full left-0 mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black text-white text-xs rounded p-2 w-48 z-10 pointer-events-none">*/}
            {/*          Número total de operações que resultaram em prejuízo. Trades com P&L negativo.*/}
            {/*        </div>*/}
            {/*      </div>*/}
            {/*    </div>*/}
            {/*    <p className="text-red-600 font-bold">{tradingStats.losingTrades}</p>*/}
            {/*  </div>*/}

            {/*  <div className="bg-purple-50 dark:bg-purple-950/20 p-2 rounded">*/}
            {/*    <div className="flex items-center gap-1 mb-1">*/}
            {/*      <DollarSign className="h-3 w-3 text-purple-600" />*/}
            {/*      <span className="font-medium">Win Rate</span>*/}
            {/*      <div className="relative group">*/}
            {/*        <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help hover:text-purple-500" />*/}
            {/*        <div className="absolute bottom-full left-0 mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black text-white text-xs rounded p-2 w-48 z-10 pointer-events-none">*/}
            {/*          Percentual de trades lucrativos em relação ao total de operações realizadas.*/}
            {/*        </div>*/}
            {/*      </div>*/}
            {/*    </div>*/}
            {/*    <p className={`font-bold ${getWinRateColor(tradingStats.winRate)}`}>{formatWinRate(tradingStats.winRate)}%</p>*/}
            {/*  </div>*/}

            {/*  <div className="bg-orange-50 dark:bg-orange-950/20 p-2 rounded">*/}
            {/*    <div className="flex items-center gap-1 mb-1">*/}
            {/*      <DollarSign className="h-3 w-3 text-orange-600" />*/}
            {/*      <span className="font-medium">Profit Factor</span>*/}
            {/*      <div className="relative group">*/}
            {/*        <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help hover:text-orange-500" />*/}
            {/*        <div className="absolute bottom-full left-0 mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black text-white text-xs rounded p-2 w-48 z-10 pointer-events-none">*/}
            {/*          Razão entre ganhos e perdas. Infinito = sem perdas, valores &gt; 1 = lucrativo.*/}
            {/*        </div>*/}
            {/*      </div>*/}
            {/*    </div>*/}
            {/*    <p className={`font-bold ${getProfitFactorColor(tradingStats.profitRatio)}`}>*/}
            {/*      {formatProfitRatio(tradingStats.profitRatio)}*/}
            {/*    </p>*/}
            {/*  </div>*/}
            {/*</div>*/}

            {/*<div className="grid grid-cols-2 gap-3 text-xs">*/}
            {/*  <div>*/}
            {/*    <div className="flex items-center gap-1">*/}
            {/*      <span className="font-medium">Total Trades:</span>*/}
            {/*      <div className="relative group">*/}
            {/*        <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help hover:text-blue-500" />*/}
            {/*        <div className="absolute bottom-full left-0 mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black text-white text-xs rounded p-2 w-48 z-10 pointer-events-none">*/}
            {/*          Número total de operações realizadas pelo bot desde o início.*/}
            {/*        </div>*/}
            {/*      </div>*/}
            {/*    </div>*/}
            {/*    <p className="text-muted-foreground">{tradingStats.totalTrades}</p>*/}
            {/*  </div>*/}
            {/*  <div>*/}
            {/*    <div className="flex items-center gap-1">*/}
            {/*      <span className="font-medium">Posições Abertas:</span>*/}
            {/*      <div className="relative group">*/}
            {/*        <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help hover:text-blue-500" />*/}
            {/*        <div className="absolute bottom-full left-0 mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black text-white text-xs rounded p-2 w-48 z-10 pointer-events-none">*/}
            {/*          Número de posições atualmente abertas no mercado.*/}
            {/*        </div>*/}
            {/*      </div>*/}
            {/*    </div>*/}
            {/*    <p className="text-muted-foreground">{tradingStats.openPositions}</p>*/}
            {/*  </div>*/}
            {/*</div>*/}

            <div className="text-xs text-muted-foreground">
              {(() => {
                if (isRunning && countdown && countdown !== '') {
                  return (
                    <span>
                      Próxima Atualização em: <span className="font-bold text-blue-600 dark:text-blue-400">{countdown}</span>
                    </span>
                  );
                } else if (isRunning && botStatus?.config?.nextValidationAt) {
                  return (
                    <span>
                      Próxima Atualização em: <span className="font-bold text-blue-600 dark:text-blue-400">Calculando...</span>
                    </span>
                  );
                } else {
                  return (
                    <span>
                      Última atualização: {tradingStats ? new Date(tradingStats.lastUpdated).toLocaleTimeString() : 'N/A'}
                    </span>
                  );
                }
              })()}
            </div>
          </div>
        ) : null}

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
            <span className="truncate">Stop Loss Híbrdo</span>
          </div>
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${config.enableMarketFallback ? 'bg-green-500' : 'bg-gray-300'}`} />
            <span className="truncate">Market Orders Fallback</span>
          </div>
        </div>
      </CardContent>

      <CardFooter className="pt-2">
        <div className="flex gap-2 w-full">
          {getActionButton()}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(config.strategyName)}
            className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm"
          >
            <Edit className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Editar</span>
          </Button>
          <div className="relative group">
            <Button
              variant="outline"
              size="sm"
              onClick={handleForceSync}
              disabled={isForceSyncing || !config.id}
              className="flex items-center gap-1 sm:gap-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20 text-xs sm:text-sm"
            >
              <RefreshCw className={`h-3 w-3 sm:h-4 sm:w-4 ${isForceSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Sync</span>
            </Button>
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black text-white text-xs rounded p-2 w-48 z-10 pointer-events-none">
              Force Sync: Sincroniza imediatamente as ordens do bot com a corretora
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteModal(true)}
            className="flex items-center gap-1 sm:gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 text-xs sm:text-sm"
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