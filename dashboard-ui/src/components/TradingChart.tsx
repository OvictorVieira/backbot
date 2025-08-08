import { useEffect, useRef, useState } from 'react'
import { createChart, IChartApi, ISeriesApi, CandlestickData, LineData } from 'lightweight-charts'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { TrendingUp, AlertCircle, Loader2 } from 'lucide-react'

interface TradingChartProps {
  symbol: string
  className?: string
}

interface Position {
  symbol: string
  side: 'LONG' | 'SHORT'
  entryPrice: number
  stopLoss: number
  takeProfit: number
  size: number
}

interface WebSocketMessage {
  type: 'NEW_POSITION' | 'POSITION_UPDATE' | 'TRAILING_STOP_UPDATE' | 'POSITION_CLOSED'
  data: any
}

export function TradingChart({ symbol, className = '' }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [lastPrice, setLastPrice] = useState<number | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Inicializar gráfico
  useEffect(() => {
    if (!chartContainerRef.current || !symbol) return

    const container = chartContainerRef.current
    const chart = createChart(container, {
      width: container.clientWidth,
      height: Math.max(container.clientHeight, 400), // Altura mínima para responsividade
      layout: {
        background: { color: 'transparent' },
        textColor: 'hsl(var(--foreground))',
      },
      grid: {
        vertLines: { color: 'hsl(var(--border))' },
        horzLines: { color: 'hsl(var(--border))' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: 'hsl(var(--border))',
      },
      timeScale: {
        borderColor: 'hsl(var(--border))',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      wickUpColor: '#22c55e',
    })

    chartRef.current = chart
    candlestickSeriesRef.current = candlestickSeries

    // Responsividade
    const handleResize = () => {
      if (chart && container) {
        chart.applyOptions({
          width: container.clientWidth,
        })
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [symbol])

  // Carregar dados históricos
  useEffect(() => {
    if (!symbol || !candlestickSeriesRef.current) return

    setIsLoading(true)
    setError(null)

    const fetchHistoricalData = async () => {
      try {
        // Simular dados históricos (em produção, buscar da API)
        const mockData: CandlestickData[] = Array.from({ length: 100 }, (_, i) => {
          const basePrice = 50000 + Math.random() * 10000
          const open = basePrice + (Math.random() - 0.5) * 1000
          const close = open + (Math.random() - 0.5) * 1000
          const high = Math.max(open, close) + Math.random() * 500
          const low = Math.min(open, close) - Math.random() * 500
          
          return {
            time: Math.floor(Date.now() / 1000) - (100 - i) * 60,
            open,
            high,
            low,
            close,
          }
        })

        candlestickSeriesRef.current?.setData(mockData)
        setLastPrice(mockData[mockData.length - 1]?.close || null)
        setIsLoading(false)
      } catch (err) {
        setError('Erro ao carregar dados históricos')
        setIsLoading(false)
      }
    }

    fetchHistoricalData()
  }, [symbol])

  // Conectar WebSocket
  useEffect(() => {
    if (!symbol) return

    const ws = new WebSocket('ws://localhost:3001')
    wsRef.current = ws

    ws.onopen = () => {
      console.log('WebSocket conectado para TradingChart')
    }

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data)
        handleWebSocketMessage(message)
      } catch (err) {
        console.error('Erro ao processar mensagem WebSocket:', err)
      }
    }

    ws.onerror = (error) => {
      console.error('Erro WebSocket:', error)
    }

    return () => {
      ws.close()
    }
  }, [symbol])

  const handleWebSocketMessage = (message: WebSocketMessage) => {
    switch (message.type) {
      case 'NEW_POSITION':
        handleNewPosition(message.data)
        break
      case 'POSITION_UPDATE':
        handlePositionUpdate(message.data)
        break
      case 'TRAILING_STOP_UPDATE':
        handleTrailingStopUpdate(message.data)
        break
      case 'POSITION_CLOSED':
        handlePositionClosed(message.data)
        break
    }
  }

  const handleNewPosition = (position: Position) => {
    if (position.symbol !== symbol) return

    setPositions(prev => [...prev, position])
    
    // Desenhar linhas no gráfico
    if (candlestickSeriesRef.current) {
      // Linha de entrada
      candlestickSeriesRef.current.addLineSeries({
        color: '#3b82f6',
        lineWidth: 2,
        lineStyle: 1,
      }).setData([
        { time: Math.floor(Date.now() / 1000) - 60, value: position.entryPrice },
        { time: Math.floor(Date.now() / 1000) + 60, value: position.entryPrice },
      ])

      // Linha de stop loss
      candlestickSeriesRef.current.addLineSeries({
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: 1,
      }).setData([
        { time: Math.floor(Date.now() / 1000) - 60, value: position.stopLoss },
        { time: Math.floor(Date.now() / 1000) + 60, value: position.stopLoss },
      ])

      // Linha de take profit
      candlestickSeriesRef.current.addLineSeries({
        color: '#22c55e',
        lineWidth: 2,
        lineStyle: 1,
      }).setData([
        { time: Math.floor(Date.now() / 1000) - 60, value: position.takeProfit },
        { time: Math.floor(Date.now() / 1000) + 60, value: position.takeProfit },
      ])
    }
  }

  const handlePositionUpdate = (data: any) => {
    // Atualizar posições existentes
    setPositions(prev => 
      prev.map(pos => 
        pos.symbol === data.symbol ? { ...pos, ...data } : pos
      )
    )
  }

  const handleTrailingStopUpdate = (data: any) => {
    if (data.symbol !== symbol) return

    // Atualizar linha de stop loss no gráfico
    // Em implementação real, atualizaria a linha específica
  }

  const handlePositionClosed = (data: any) => {
    if (data.symbol !== symbol) return

    // Remover posição e linhas do gráfico
    setPositions(prev => prev.filter(pos => pos.symbol !== data.symbol))
  }

  if (!symbol) {
    return (
      <Card className={`w-full flex flex-col ${className}`}>
        <CardHeader className="flex-shrink-0">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Gráfico Trading
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1">
          <div className="h-full bg-muted/50 rounded-lg flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <TrendingUp className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-semibold mb-2">Selecione um símbolo</p>
              <p className="text-sm">Clique em uma posição na tabela para visualizar o gráfico</p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={`w-full flex flex-col ${className}`}>
      <CardHeader className="flex-shrink-0 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            <CardTitle className="text-lg sm:text-xl">
              {symbol}
            </CardTitle>
            {lastPrice && (
              <Badge variant="secondary" className="text-sm">
                ${lastPrice.toFixed(2)}
              </Badge>
            )}
          </div>
          
          {positions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {positions.map((pos, index) => (
                <Badge 
                  key={index}
                  variant={pos.side === 'LONG' ? 'default' : 'destructive'}
                  className="text-xs"
                >
                  {pos.side} ${pos.entryPrice.toFixed(2)}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 p-0">
        <div className="relative">
          {isLoading && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10">
              <div className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Carregando dados...</span>
              </div>
            </div>
          )}
          
          {error && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10">
              <div className="text-center">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            </div>
          )}
          
          <div 
            ref={chartContainerRef} 
            className="w-full h-full"
          />
        </div>
      </CardContent>
    </Card>
  )
} 