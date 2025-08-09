import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BotCard } from '../components/BotCard'
import { ConfigForm } from '../components/ConfigForm'
import { ErrorModal } from '../components/ErrorModal'
import { ThemeToggle } from '../components/ThemeToggle'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Settings, Plus, Bot } from 'lucide-react'
import axios from 'axios'

const API_BASE_URL = 'http://localhost:3001'

interface BotConfig {
  id?: number
  strategyName: string
  botName: string
  apiKey: string
  apiSecret: string
  capitalPercentage: number
  time: string
  enabled: boolean
  maxNegativePnlStopPct: string | number
  minProfitPercentage: string | number
  maxSlippagePct: string | number
  executionMode: string
  // Configurações da Estratégia Híbrida de Stop Loss (ATR)
  enableHybridStopStrategy: boolean
  initialStopAtrMultiplier: number
  trailingStopAtrMultiplier: number
  partialTakeProfitAtrMultiplier: number
  partialTakeProfitPercentage: number
  enableTrailingStop: boolean
  trailingStopDistance: number
  enablePostOnly: boolean
  enableMarketFallback: boolean
  enableOrphanOrderMonitor: boolean
  enablePendingOrdersMonitor: boolean
  // Configurações de Rastreamento de Ordens
  botClientOrderId?: number
  orderCounter?: number
  // Configurações de Limite de Ordens
  maxOpenOrders: number
  // Tokens autorizados
  authorizedTokens: string[]
  // TODO: Alavancagem da conta - Removido temporariamente
  // leverageLimit: number
  // Próxima validação
  nextValidationAt?: string
}

interface BotStatus {
  id: number
  botName: string
  strategyName: string
  status: string
  startTime: string
  isRunning: boolean
  config: any
}

export function DashboardPage() {
  const [configs, setConfigs] = useState<BotConfig[]>([])
  const [botStatuses, setBotStatuses] = useState<BotStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [showConfigForm, setShowConfigForm] = useState(false)
  const [selectedStrategy, setSelectedStrategy] = useState<string>('')
  const [showCreateBot, setShowCreateBot] = useState(false)
  const [loadingBots, setLoadingBots] = useState<Record<string, boolean>>({})
  const [restartingBots, setRestartingBots] = useState<Record<string, boolean>>({})

  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: '',
    message: ''
  })

  const [strategies, setStrategies] = useState<string[]>([])
  const navigate = useNavigate()

  // Buscar estratégias disponíveis
  useEffect(() => {
    const fetchStrategies = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/strategies`)
        setStrategies(response.data.data)
      } catch (error) {
        console.error('Erro ao buscar estratégias:', error)
      }
    }
    fetchStrategies()
  }, [])

  // Buscar configurações dos bots
  useEffect(() => {
    const fetchConfigs = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/configs`)
        setConfigs(response.data.data)
      } catch (error) {
        console.error('Erro ao buscar configurações:', error)
      }
    }
    fetchConfigs()
  }, [])

  // Buscar status dos bots
  useEffect(() => {
    const fetchBotStatuses = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/bot/status`)
        setBotStatuses(response.data.data)
      } catch (error) {
        console.error('Erro ao buscar status dos bots:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchBotStatuses()

    // Atualizar status a cada 5 segundos
    const interval = setInterval(fetchBotStatuses, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleStartBot = async (botId: string) => {
    try {
      setLoadingBots(prev => ({ ...prev, [botId]: true }))
      
      await axios.post(`${API_BASE_URL}/api/bot/start`, { botId: parseInt(botId) })
      
      // Recarregar status após iniciar
      const response = await axios.get(`${API_BASE_URL}/api/bot/status`)
      setBotStatuses(response.data.data)
      
    } catch (error: any) {
      let errorMessage = 'Erro ao iniciar o bot. Tente novamente.';
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = `Erro: ${error.message}`;
      }
      
      setErrorModal({
        isOpen: true,
        title: 'Erro ao iniciar bot',
        message: errorMessage
      });
    } finally {
      setLoadingBots(prev => ({ ...prev, [botId]: false }))
    }
  }

  const handleStopBot = async (botId: string) => {
    try {
      setLoadingBots(prev => ({ ...prev, [botId]: true }))
      
      await axios.post(`${API_BASE_URL}/api/bot/stop`, { botId: parseInt(botId) })
      
      // Recarregar status após parar
      const response = await axios.get(`${API_BASE_URL}/api/bot/status`)
      setBotStatuses(response.data.data)
      
    } catch (error: any) {
      let errorMessage = 'Erro ao parar o bot. Tente novamente.';
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = `Erro: ${error.message}`;
      }
      
      setErrorModal({
        isOpen: true,
        title: 'Erro ao parar bot',
        message: errorMessage
      });
    } finally {
      setLoadingBots(prev => ({ ...prev, [botId]: false }))
    }
  }

  const handleConfigSaved = async (config: BotConfig) => {
    try {
      // Verificar se o bot estava rodando antes da atualização
      const currentStatus = botStatuses.find(s => s.strategyName === config.strategyName);
      const wasRunning = currentStatus?.isRunning || false;
      
      if (wasRunning) {
        setRestartingBots(prev => ({ ...prev, [config.strategyName]: true }));
      }
      
      // Salvar configuração na API
      const saveResponse = await axios.post(`${API_BASE_URL}/api/configs`, {
        strategyName: config.strategyName,
        config: config
      })
      
      // Se o bot estava rodando, aguardar mais tempo para garantir que reiniciou
      if (wasRunning) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Aguarda 5 segundos
      }
      
      // Recarregar configurações após salvar
      const response = await axios.get(`${API_BASE_URL}/api/configs`)
      setConfigs(response.data.data)
      
      // Recarregar status dos bots
      const statusResponse = await axios.get(`${API_BASE_URL}/api/bot/status`)
      setBotStatuses(statusResponse.data.data)
      
      // Se o bot estiver rodando, recalcular nextValidationAt
      const updatedStatus = statusResponse.data.data.find((s: any) => s.strategyName === config.strategyName);
      if (updatedStatus?.isRunning) {
        try {
          await axios.get(`${API_BASE_URL}/api/bot/${updatedStatus.id}/next-execution`);
          
          // Recarregar status novamente para pegar o novo nextValidationAt
          const finalStatusResponse = await axios.get(`${API_BASE_URL}/api/bot/status`);
          setBotStatuses(finalStatusResponse.data.data);
        } catch (error) {
          // Error handling without console logs
        }
      }
      
      // Limpar estado de reinicialização
      setRestartingBots(prev => ({ ...prev, [config.strategyName]: false }));
      
      setShowConfigForm(false)
      setSelectedStrategy('')
      
    } catch (error: any) {
      console.error('❌ Erro ao salvar configuração:', error);
      console.error('Detalhes do erro:', error.response?.data || error.message);
      
      // Limpar estado de reinicialização em caso de erro
      setRestartingBots(prev => ({ ...prev, [config.strategyName]: false }));
      
      let errorMessage = 'Erro ao salvar as configurações do bot. Tente novamente.';
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = `Erro: ${error.message}`;
      }
      
      setErrorModal({
        isOpen: true,
        title: 'Erro ao salvar configuração',
        message: errorMessage
      });
    }
  }

  const handleEditBot = (strategyName: string) => {
    setSelectedStrategy(strategyName)
    setShowConfigForm(true)
  }

  const handleCreateBot = () => {
    setShowCreateBot(true)
  }

  const handleCreateBotSaved = async (config: BotConfig) => {
    try {
      // Validar se já existe um bot com a mesma API Key
      const existingBot = configs.find(c => c.apiKey === config.apiKey && c.apiSecret === config.apiSecret)
      if (existingBot) {
        setErrorModal({
          isOpen: true,
          title: 'Bot já existe',
          message: 'Já existe um bot configurado com essas credenciais de API. Use credenciais diferentes para cada bot.'
        })
        return
      }

      // Salvar configuração na API
      await axios.post(`${API_BASE_URL}/api/configs`, {
        strategyName: config.strategyName,
        config: config
      })
      
      // Recarregar configurações após salvar
      const response = await axios.get(`${API_BASE_URL}/api/configs`)
      setConfigs(response.data.data)
      setShowCreateBot(false)
    } catch (error: any) {
      let errorMessage = 'Erro ao criar bot. Verifique suas credenciais e tente novamente.'
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error
      }
      
      setErrorModal({
        isOpen: true,
        title: 'Erro ao criar bot',
        message: errorMessage
      })
    }
  }

  const getBotStatus = (botId: number) => {
    const status = botStatuses.find(status => status.id === botId)
    return status
  }

  const handleDeleteBot = async (botId: number) => {
    try {
      const response = await axios.delete(`${API_BASE_URL}/api/configs/${botId}`)
      if (response.data.success) {
        // Remove o bot da lista
        setConfigs(prev => prev.filter(config => config.id !== botId))
        // Remove o status do bot
        setBotStatuses(prev => prev.filter(status => status.id !== botId))
      } else {
        setErrorModal({
          isOpen: true,
          title: 'Erro ao deletar bot',
          message: response.data.message || 'Erro desconhecido'
        })
      }
    } catch (error: any) {
      setErrorModal({
        isOpen: true,
        title: 'Erro ao deletar bot',
        message: error.response?.data?.message || error.message || 'Erro desconhecido'
      })
    }
  }

  const formatStrategyName = (strategyName: string) => {
    // Converte DEFAULT para Default, ALPHA_FLOW para AlphaFlow, etc.
    return strategyName
      .toLowerCase()
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full px-8 sm:px-12 lg:px-16 pt-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">BackBot Dashboard</h1>
          <p className="text-muted-foreground">Gerencie seus bots de trading</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle size="sm" variant="outline" />
        </div>
      </div>

      {/* Resource Warning */}
      <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg dark:bg-yellow-900/20 dark:border-yellow-800">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">Aviso sobre Recursos</h3>
            <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
              Cada bot ativo consome recursos do seu computador. Quanto mais bots rodando simultaneamente, 
              maior será o uso de CPU e memória. Recomendamos não exceder 3-4 bots por vez para melhor performance.
            </p>
          </div>
        </div>
      </div>

      {/* Manual Trading Warning */}
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg dark:bg-blue-900/20 dark:border-blue-800">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">Importante: Operações Fechadas Manualmente</h3>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Se você fechar uma operação manualmente na corretora, o sistema não contabilizará 
              essa operação nas estatísticas do bot. No entanto, a corretora continuará registrando normalmente o volume, 
              lucro ou perda da operação. Para manter a precisão das estatísticas, recomendamos deixar o bot gerenciar 
              completamente as operações.
            </p>
          </div>
        </div>
      </div>

      {/* Configuração Form */}
      {showConfigForm && selectedStrategy && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <div className="bg-background p-6 rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto border shadow-lg">
            <ConfigForm
              config={(() => {
                // selectedStrategy agora é o botId (string)
                const botId = parseInt(selectedStrategy);
                const foundConfig = configs.find(c => c.id === botId);
                if (foundConfig) {
                  return foundConfig;
                }
                // Fallback para configuração padrão
                return {
                  strategyName: 'DEFAULT',
                  botName: `Bot ${botId}`,
                  apiKey: '',
                  apiSecret: '',
                  capitalPercentage: 20,
                  time: '30m',
                  enabled: true, // Sempre habilitado, controle via botão Iniciar/Pausar
                  maxNegativePnlStopPct: "-10",
                  minProfitPercentage: "10",
                  maxSlippagePct: "0.5",
                  executionMode: 'REALTIME',
                  enableHybridStopStrategy: false,
                  initialStopAtrMultiplier: 2.0,
                  trailingStopAtrMultiplier: 1.5,
                  partialTakeProfitAtrMultiplier: 1.5,
                  partialTakeProfitPercentage: 50,
                  enableTrailingStop: false,
                  trailingStopDistance: 1.5,
                  enablePostOnly: true, // Sempre habilitado
                  enableMarketFallback: true, // Sempre habilitado
                  enableOrphanOrderMonitor: true, // Sempre habilitado
                  enablePendingOrdersMonitor: true, // Sempre habilitado
                  maxOpenOrders: 5, // Valor padrão
                  // leverageLimit: 10, // Valor padrão - TODO: Removido temporariamente
                  authorizedTokens: [] // Lista vazia = todos os tokens permitidos
                };
              })()}
              onSave={handleConfigSaved}
              onCancel={() => setShowConfigForm(false)}
              isEditMode={true}
            />
          </div>
        </div>
      )}

      {/* Criar Bot Form */}
      {showCreateBot && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <div className="bg-background p-6 rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto border shadow-lg">
            <ConfigForm
              config={{
                strategyName: 'DEFAULT',
                botName: '',
                apiKey: '',
                apiSecret: '',
                capitalPercentage: 20,
                time: '30m',
                enabled: true,
                maxNegativePnlStopPct: "-10",
                minProfitPercentage: "10",
                maxSlippagePct: "0.5",
                executionMode: 'REALTIME',
                enableHybridStopStrategy: false,
                initialStopAtrMultiplier: 2.0,
                trailingStopAtrMultiplier: 1.5,
                partialTakeProfitAtrMultiplier: 3.0,
                partialTakeProfitPercentage: 50,
                enableTrailingStop: false,
                trailingStopDistance: 1.5,
                enablePostOnly: true,
                enableMarketFallback: true,
                enableOrphanOrderMonitor: true,
                enablePendingOrdersMonitor: true,
                maxOpenOrders: 5,
                // leverageLimit: 10, // TODO: Removido temporariamente
                authorizedTokens: [] // Lista vazia = todos os tokens permitidos
              }}
              onSave={handleCreateBotSaved}
              onCancel={() => setShowCreateBot(false)}
              isEditMode={false}
            />
          </div>
        </div>
      )}

      {/* Botões de Ação */}
      <div className="mb-6 flex justify-end gap-4">
        {/* Botão Operações temporariamente removido para primeira versão
        <Button 
          onClick={() => navigate('/operations')} 
          variant="outline" 
          size="lg"
          className="flex items-center gap-2"
        >
          <Settings className="w-4 h-4 mr-2" />
          Operações
        </Button>
        */}
        <Button 
          onClick={handleCreateBot}
          className="flex items-center gap-2"
          size="lg"
        >
          <Plus className="h-5 w-5" />
          Criar Bot
        </Button>
      </div>

      {/* Lista de Bots Criados */}
      {configs.length === 0 ? (
        <div className="text-center py-12">
          <div className="max-w-md mx-auto">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <Bot className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">Nenhum bot criado</h3>
            <p className="text-muted-foreground">
              Clique em "Criar Bot" para configurar seu primeiro bot de trading.
            </p>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-[2400px]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-4 gap-y-6">
            {configs.map((config) => {
              const status = getBotStatus(config.id || 0)
              
              return (
                <BotCard
                  key={config.id || config.strategyName}
                  config={config}
                  isRunning={status?.isRunning || false}
                  isLoading={loadingBots[config.id?.toString() || config.strategyName] || false}
                  isRestarting={restartingBots[config.id?.toString() || config.strategyName] || false}
                  botStatus={status}
                  onStart={() => handleStartBot(config.id?.toString() || config.strategyName)}
                  onStop={() => handleStopBot(config.id?.toString() || config.strategyName)}
                  onConfigure={() => handleEditBot(config.id?.toString() || config.strategyName)}
                  onEdit={() => handleEditBot(config.id?.toString() || config.strategyName)}
                  onDelete={handleDeleteBot}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Error Modal */}
      <ErrorModal
        isOpen={errorModal.isOpen}
        onClose={() => setErrorModal({ isOpen: false, title: '', message: '' })}
        title={errorModal.title}
        message={errorModal.message}
      />
    </div>
  )
} 