import { useState, useEffect } from 'react'
import { X, CheckCircle, AlertCircle, Info, TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message: string
  timestamp: Date
  duration?: number
}

interface NotificationToastProps {
  notifications: Notification[]
  onRemove: (id: string) => void
}

const notificationIcons = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertCircle,
  info: Info,
}

const notificationColors = {
  success: 'bg-green-50 border-green-200 text-green-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
}

export function NotificationToast({ notifications, onRemove }: NotificationToastProps) {
  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}

interface NotificationItemProps {
  notification: Notification
  onRemove: (id: string) => void
}

function NotificationItem({ notification, onRemove }: NotificationItemProps) {
  const [isVisible, setIsVisible] = useState(true)
  const Icon = notificationIcons[notification.type]

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false)
      setTimeout(() => onRemove(notification.id), 300)
    }, notification.duration || 5000)

    return () => clearTimeout(timer)
  }, [notification.id, notification.duration, onRemove])

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-4 rounded-lg border shadow-lg transition-all duration-300',
        notificationColors[notification.type],
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      )}
    >
      <Icon className="w-5 h-5 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <h4 className="font-medium text-sm">{notification.title}</h4>
        <p className="text-sm mt-1 opacity-90">{notification.message}</p>
        <p className="text-xs mt-2 opacity-70">
          {notification.timestamp.toLocaleTimeString()}
        </p>
      </div>
      <button
        onClick={() => {
          setIsVisible(false)
          setTimeout(() => onRemove(notification.id), 300)
        }}
        className="text-gray-400 hover:text-gray-600 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

// Hook para gerenciar notificações
export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])

  const addNotification = (notification: Omit<Notification, 'id' | 'timestamp'>) => {
    const newNotification: Notification = {
      ...notification,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
    }
    setNotifications(prev => [...prev, newNotification])
  }

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  const addTradeNotification = (symbol: string, side: 'LONG' | 'SHORT', price: number, pnl?: number) => {
    const icon = side === 'LONG' ? TrendingUp : TrendingDown
    const color = pnl && pnl > 0 ? 'success' : pnl && pnl < 0 ? 'error' : 'info'
    
    addNotification({
      type: color,
      title: `${side} ${symbol}`,
      message: `Preço: $${price.toFixed(4)}${pnl ? ` | P&L: $${pnl.toFixed(2)}` : ''}`,
      duration: 8000,
    })
  }

  const addBotNotification = (strategyName: string, action: 'started' | 'stopped' | 'error') => {
    const type = action === 'error' ? 'error' : 'success'
    const title = action === 'started' ? 'Bot Iniciado' : action === 'stopped' ? 'Bot Parado' : 'Erro no Bot'
    
    addNotification({
      type,
      title,
      message: `Estratégia ${strategyName} ${action === 'started' ? 'iniciada' : action === 'stopped' ? 'parada' : 'com erro'}`,
      duration: 5000,
    })
  }

  return {
    notifications,
    addNotification,
    removeNotification,
    addTradeNotification,
    addBotNotification,
  }
} 