import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Clock, AlertCircle } from 'lucide-react'

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

interface PendingOrdersProps {
  orders: PendingOrder[]
  className?: string
}

export function PendingOrders({ orders, className = '' }: PendingOrdersProps) {
  if (orders.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Ordens Limit Pendentes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-semibold mb-2">Nenhuma ordem pendente</p>
            <p className="text-sm">As ordens limit aparecerão aqui quando criadas</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Badge className="bg-yellow-100 text-yellow-800">Pendente</Badge>
      case 'PARTIALLY_FILLED':
        return <Badge className="bg-blue-100 text-blue-800">Parcial</Badge>
      case 'CANCELLED':
        return <Badge className="bg-red-100 text-red-800">Cancelada</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'LIMIT':
        return <Badge className="bg-green-100 text-green-800">Limit</Badge>
      case 'STOP_LIMIT':
        return <Badge className="bg-purple-100 text-purple-800">Stop Limit</Badge>
      default:
        return <Badge variant="secondary">{type}</Badge>
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Ordens Limit Pendentes ({orders.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="min-w-full">
            {/* Cabeçalho responsivo */}
            <div className="hidden md:grid md:grid-cols-8 gap-2 p-2 border-b font-medium text-sm">
              <div>Símbolo</div>
              <div>Estratégia</div>
              <div>Lado</div>
              <div>Tipo</div>
              <div>Tamanho</div>
              <div>Preço</div>
              <div>Status</div>
              <div>Tempo</div>
            </div>
            
            {/* Linhas responsivas */}
            {orders.map((order) => (
              <div 
                key={order.id}
                className="border-b hover:bg-muted/50 transition-colors"
              >
                {/* Desktop: Grid layout */}
                <div className="hidden md:grid md:grid-cols-8 gap-2 p-2 text-sm">
                  <div className="font-medium">{order.symbol}</div>
                  <div>{order.strategyName}</div>
                  <div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      order.side === 'LONG' 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {order.side}
                    </span>
                  </div>
                  <div>{getTypeBadge(order.type)}</div>
                  <div>{order.size}</div>
                  <div>${order.price.toFixed(4)}</div>
                  <div>{getStatusBadge(order.status)}</div>
                  <div className="text-xs text-muted-foreground">
                    {order.createdAt.toLocaleTimeString()}
                  </div>
                </div>
                
                {/* Mobile: Card layout */}
                <div className="md:hidden p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-lg">{order.symbol}</span>
                    <div className="flex gap-1">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        order.side === 'LONG' 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {order.side}
                      </span>
                      {getTypeBadge(order.type)}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Estratégia:</span>
                      <div>{order.strategyName}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Tamanho:</span>
                      <div>{order.size}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Preço:</span>
                      <div>${order.price.toFixed(4)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status:</span>
                      <div>{getStatusBadge(order.status)}</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Criada: {order.createdAt.toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
} 