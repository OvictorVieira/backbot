import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { TradingChart } from '../components/TradingChart'
import { PendingOrders } from '../components/PendingOrders'
import { ThemeToggle } from '../components/ThemeToggle'
import { ArrowLeft, Activity, Clock } from 'lucide-react'
import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

interface Position {
  symbol: string
  side: 'LONG' | 'SHORT'
  size: number
  entryPrice: number
  currentPrice: number
  pnl: number
  pnlPercentage: number
  stopLoss: number
  takeProfit: number
  strategyName: string
}

interface BotStatus {
  strategyName: string
  isRunning: boolean
  lastUpdate: string
  positions: Position[]
  pnl: number
}

interface PendingOrder {
  id: string
  symbol: string
  side: 'LONG' | 'SHORT'
  type: 'LIMIT' | 'STOP_LIMIT'
  size: number
  price: number
  status: 'PENDING' | 'PARTIALLY_FILLED' | 'CANCELLED'
  strategyName: string
  createdAt: Date
  timeInForce: 'GTC' | 'IOC' | 'FOK'
}

export function OperationsPage() {
  const [botStatuses, setBotStatuses] = useState<BotStatus[]>([])
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'positions' | 'orders'>('positions')
  const navigate = useNavigate()

  // Buscar status dos bots e dados de operações
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Buscar status dos bots
        const statusResponse = await axios.get(`${API_BASE_URL}/api/bot/status`)
        setBotStatuses(statusResponse.data.data)
        
        // Buscar posições abertas
        const positionsResponse = await axios.get(`${API_BASE_URL}/api/positions`)
        const positions = positionsResponse.data.data
        
        // Buscar ordens pendentes
        const ordersResponse = await axios.get(`${API_BASE_URL}/api/orders`)
        const orders = ordersResponse.data.data
        
        setPositions(positions)
        setPendingOrders(orders)
      } catch (error) {
        console.error('Erro ao buscar dados:', error)
      } finally {
        setLoading(false)
      }
    }
    
    fetchData()

    // Atualizar dados a cada 3 segundos
    const interval = setInterval(fetchData, 3000)
    return () => clearInterval(interval)
  }, [])

  // Usar posições da API
  const allPositions = positions

  const handlePositionClick = (symbol: string) => {
    setSelectedSymbol(symbol)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando operações...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full px-8 sm:px-12 lg:px-16 pt-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex justify-between items-start mb-4">
          <Button onClick={() => navigate('/')} variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <ThemeToggle size="sm" variant="outline" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Operações</h1>
          <p className="text-muted-foreground">Monitoramento em tempo real</p>
        </div>
      </div>

      {/* Gráfico Trading */}
      <TradingChart symbol={selectedSymbol} className="mb-8 h-[60vh] sm:h-[54vh] lg:h-[50vh]" />

      {/* Seção de Trades e Ordens com Abas */}
      <Card className="mb-8 h-[35vh] sm:h-[40vh] lg:h-[35vh] flex flex-col">
        <CardHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle>Trades e Ordens</CardTitle>
            <div className="flex gap-2">
              <Button
                variant={activeTab === 'positions' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveTab('positions')}
                className="flex items-center gap-2"
              >
                <Activity className="w-4 h-4" />
                Posições {allPositions.length > 0 && `(${allPositions.length})`}
              </Button>
              <Button
                variant={activeTab === 'orders' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveTab('orders')}
                className="flex items-center gap-2"
              >
                <Clock className="w-4 h-4" />
                Ordens Pendentes {pendingOrders.length > 0 && `(${pendingOrders.length})`}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col">
          {activeTab === 'positions' ? (
            // Conteúdo das Posições Ativas
            <div className="flex-1 flex items-center justify-center">
              {allPositions.length === 0 ? (
                <div className="text-center text-muted-foreground">
                  <Activity className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-semibold mb-2">Nenhuma posição ativa</p>
                  <p className="text-sm">Inicie seus bots para ver as posições aqui</p>
                </div>
              ) : (
                <div className="flex-1 overflow-x-auto">
                  <div className="min-w-full h-full">
                    {/* Cabeçalho responsivo */}
                    <div className="hidden lg:grid lg:grid-cols-10 gap-2 p-2 border-b font-medium text-sm">
                      <div>Símbolo</div>
                      <div>Estratégia</div>
                      <div>Lado</div>
                      <div>Tamanho</div>
                      <div>Preço Entrada</div>
                      <div>Preço Atual</div>
                      <div>P&L</div>
                      <div>P&L %</div>
                      <div>Stop Loss</div>
                      <div>Take Profit</div>
                    </div>
                    
                    {/* Linhas responsivas */}
                    {allPositions.map((position, index) => (
                      <div 
                        key={`${position.strategyName}-${position.symbol}-${index}`}
                        className={`border-b hover:bg-muted/50 cursor-pointer ${
                          selectedSymbol === position.symbol ? 'bg-primary/10' : ''
                        }`}
                        onClick={() => handlePositionClick(position.symbol)}
                      >
                        {/* Desktop: Grid layout */}
                        <div className="hidden lg:grid lg:grid-cols-10 gap-2 p-2 text-sm">
                          <div className="font-medium">{position.symbol}</div>
                          <div>{position.strategyName}</div>
                          <div>
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              position.side === 'LONG' 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {position.side}
                            </span>
                          </div>
                          <div>{position.size}</div>
                          <div>${position.entryPrice.toFixed(4)}</div>
                          <div>${position.currentPrice.toFixed(4)}</div>
                          <div className={`font-medium ${
                            position.pnl >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            ${position.pnl.toFixed(2)}
                          </div>
                          <div className={`font-medium ${
                            position.pnlPercentage >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {position.pnlPercentage >= 0 ? '+' : ''}{position.pnlPercentage.toFixed(2)}%
                          </div>
                          <div>${position.stopLoss.toFixed(4)}</div>
                          <div>${position.takeProfit.toFixed(4)}</div>
                        </div>
                        
                        {/* Mobile: Card layout */}
                        <div className="md:hidden p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-lg">{position.symbol}</span>
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              position.side === 'LONG' 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {position.side}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-muted-foreground">Estratégia:</span>
                              <div>{position.strategyName}</div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Tamanho:</span>
                              <div>{position.size}</div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Entrada:</span>
                              <div>${position.entryPrice.toFixed(4)}</div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Atual:</span>
                              <div>${position.currentPrice.toFixed(4)}</div>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-muted-foreground text-sm">P&L:</span>
                              <div className={`font-medium ${
                                position.pnl >= 0 ? 'text-green-600' : 'text-red-600'
                              }`}>
                                ${position.pnl.toFixed(2)}
                              </div>
                            </div>
                            <div>
                              <span className="text-muted-foreground text-sm">P&L %:</span>
                              <div className={`font-medium ${
                                position.pnlPercentage >= 0 ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {position.pnlPercentage >= 0 ? '+' : ''}{position.pnlPercentage.toFixed(2)}%
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-muted-foreground">Stop Loss:</span>
                              <div>${position.stopLoss.toFixed(4)}</div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Take Profit:</span>
                              <div>${position.takeProfit.toFixed(4)}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // Conteúdo das Ordens Pendentes
            <div className="flex-1 flex items-center justify-center">
              {pendingOrders.length === 0 ? (
                <div className="text-center text-muted-foreground">
                  <Clock className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-semibold mb-2">Nenhuma ordem pendente</p>
                  <p className="text-sm">As ordens limit aparecerão aqui quando criadas</p>
                </div>
              ) : (
                <div className="w-full">
                  <PendingOrders orders={pendingOrders} />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
} 