import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { AlertCircle, TestTube, Search, X, HelpCircle, Zap, Plus } from 'lucide-react'
import { Alert, AlertDescription } from './ui/alert'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

interface HFTBotConfig {
  id?: number
  botName: string
  apiKey: string
  apiSecret: string
  strategyName: 'HFT'
  // HFT specific configs for airdrop farming
  hftSpread: number
  hftRebalanceFrequency: number // em segundos (30, 60, 120)
  hftDailyHours: number // horas ativas por dia (8, 12, 16, 24)
  hftMaxPriceDeviation: number // % desvio máximo de preço antes de cancelar ordens
  capitalPercentage: number
  enabled: boolean
  // Traditional fields that HFT also needs
  authorizedTokens: string[]
}

interface HFTConfigFormProps {
  config?: HFTBotConfig
  onSave: (config: HFTBotConfig) => void
  onCancel: () => void
  isEditMode: boolean
}

export function HFTConfigForm({ config, onSave, onCancel, isEditMode }: HFTConfigFormProps) {
  const [formData, setFormData] = useState<HFTBotConfig>({
    botName: config?.botName || '',
    apiKey: config?.apiKey || '',
    apiSecret: config?.apiSecret || '',
    strategyName: 'HFT',
    hftSpread: config?.hftSpread || 0.05, // 0.05% spread padrão
    hftRebalanceFrequency: config?.hftRebalanceFrequency || 60, // 1 minuto padrão
    hftDailyHours: config?.hftDailyHours || 16, // 16 horas ativas padrão
    hftMaxPriceDeviation: config?.hftMaxPriceDeviation || 2, // 2% desvio máximo padrão
    capitalPercentage: config?.capitalPercentage || 5,
    enabled: config?.enabled ?? true,
    authorizedTokens: config?.authorizedTokens || [],
    ...(config?.id && { id: config.id })
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [apiTestResult, setApiTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [isTestingApi, setIsTestingApi] = useState(false)
  const [availableTokens, setAvailableTokens] = useState<any[]>([])
  const [loadingTokens, setLoadingTokens] = useState(false)
  const [tokenSearchTerm, setTokenSearchTerm] = useState('')
  const [saving, setSaving] = useState(false)
  const [apiKeysChanged, setApiKeysChanged] = useState(false)
  const [apiKeysValidated, setApiKeysValidated] = useState(isEditMode)

  // Fetch available tokens on component mount
  useEffect(() => {
    const fetchAvailableTokens = async () => {
      try {
        setLoadingTokens(true);
        const response = await axios.get(`${API_BASE_URL}/api/tokens/available`);

        if (response.data.success) {
          setAvailableTokens(response.data.tokens);
        }
      } catch (error) {
        // Error handling
      } finally {
        setLoadingTokens(false);
      }
    };

    fetchAvailableTokens();
  }, []);

  // Track API keys changes in edit mode
  useEffect(() => {
    if (isEditMode && config) {
      const keysChanged = formData.apiKey !== config.apiKey || formData.apiSecret !== config.apiSecret;
      setApiKeysChanged(keysChanged);
      if (keysChanged) {
        setApiKeysValidated(false);
        setApiTestResult(null);
      }
    }
  }, [formData.apiKey, formData.apiSecret, config, isEditMode]);

  // Test API Keys function
  const handleTestApiKeys = async () => {
    if (!formData.apiKey || !formData.apiSecret) {
      setApiTestResult({
        success: false,
        message: 'Por favor, preencha API Key e API Secret antes de testar.'
      });
      return;
    }

    setIsTestingApi(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/api/validate-credentials`, {
        apiKey: formData.apiKey,
        apiSecret: formData.apiSecret
      });

      if (response.data.success) {
        setApiTestResult({
          success: true,
          message: 'API Keys válidas! Conexão estabelecida com sucesso.'
        });
        setApiKeysValidated(true);
      } else {
        setApiTestResult({
          success: false,
          message: response.data.error || 'Erro ao testar API Keys.'
        });
      }
    } catch (error: any) {
      setApiTestResult({
        success: false,
        message: error.response?.data?.error || 'Erro ao conectar com a API.'
      });
    } finally {
      setIsTestingApi(false);
    }
  };

  // Token management functions
  const addTokenToAuthorized = (symbol: string) => {
    if (!formData.authorizedTokens.includes(symbol)) {
      setFormData(prev => ({
        ...prev,
        authorizedTokens: [...prev.authorizedTokens, symbol]
      }));
    }
  };

  const removeTokenFromAuthorized = (symbol: string) => {
    setFormData(prev => ({
      ...prev,
      authorizedTokens: prev.authorizedTokens.filter(token => token !== symbol)
    }));
  };

  // Filter tokens based on search term
  const filteredTokens = availableTokens.filter(token =>
    token.symbol?.toLowerCase().includes(tokenSearchTerm.toLowerCase()) ||
    token.baseSymbol?.toLowerCase().includes(tokenSearchTerm.toLowerCase())
  );

  // Format functions
  const formatChangePercent = (value: string) => {
    const num = parseFloat(value);
    return num >= 0 ? `+${num.toFixed(2)}%` : `${num.toFixed(2)}%`;
  };

  const formatVolume = (value: string) => {
    const num = parseFloat(value);
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toFixed(0);
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true);

    const newErrors: Record<string, string> = {}

    // Validações
    if (!formData.botName.trim()) {
      newErrors.botName = 'Nome do bot é obrigatório'
    }

    if (!formData.apiKey.trim()) {
      newErrors.apiKey = 'API Key é obrigatória'
    }

    if (!formData.apiSecret.trim()) {
      newErrors.apiSecret = 'API Secret é obrigatória'
    }

    if (formData.hftSpread <= 0 || formData.hftSpread > 1) {
      newErrors.hftSpread = 'Spread deve estar entre 0.01% e 1%'
    }

    if (formData.hftRebalanceFrequency < 30 || formData.hftRebalanceFrequency > 300) {
      newErrors.hftRebalanceFrequency = 'Frequência deve estar entre 30 e 300 segundos'
    }


    if (formData.hftDailyHours < 1 || formData.hftDailyHours > 24) {
      newErrors.hftDailyHours = 'Horas ativas deve estar entre 1 e 24 horas'
    }

    if (formData.hftMaxPriceDeviation <= 0 || formData.hftMaxPriceDeviation > 10) {
      newErrors.hftMaxPriceDeviation = 'Desvio máximo deve estar entre 0.1% e 10%'
    }

    if (formData.capitalPercentage <= 0 || formData.capitalPercentage > 20) {
      newErrors.capitalPercentage = 'Capital deve estar entre 0.1% e 20%'
    }

    if (formData.authorizedTokens.length === 0) {
      newErrors.authorizedTokens = 'Selecione pelo menos um token'
    }

    // Validate API was tested (only if not in edit mode or if keys changed)
    if (!isEditMode) {
      // Creation mode: always require API test
      if (!apiTestResult || !apiTestResult.success) {
        newErrors.apiKey = 'Teste a API Key antes de continuar'
      }
    } else if (apiKeysChanged) {
      // Edit mode with changed keys: require API test
      if (!apiTestResult || !apiTestResult.success) {
        newErrors.apiKey = 'Teste a API Key após alterá-las'
      }
    }

    setErrors(newErrors)

    if (Object.keys(newErrors).length === 0) {
      try {
        await onSave(formData);
      } catch (error) {
        console.error('Erro ao salvar configuração:', error);
      } finally {
        setSaving(false);
      }
    } else {
      setSaving(false);
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-center">
          {isEditMode ? 'Editar Bot HFT' : 'Configurar Bot HFT'}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Bot Name Configuration */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Identificação do Bot</h3>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="botName">Nome do Bot</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">Dê um nome único para identificar este bot HFT. Útil quando você tiver múltiplos bots rodando.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Input
              id="botName"
              type="text"
              placeholder="Ex: HFT Bot Airdrop SOL"
              value={formData.botName}
              onChange={(e) => handleInputChange('botName', e.target.value)}
              className={errors.botName ? "border-red-500" : ""}
            />
            {errors.botName && <p className="text-sm text-red-500">{errors.botName}</p>}
          </div>
        </div>

        {/* API Configuration */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Configurações da API</h3>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="apiKey">API Key</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">Sua API Key da Backpack Exchange. Necessária para o bot executar operações.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Input
              id="apiKey"
              type="password"
              placeholder="Sua API Key da Backpack"
              value={formData.apiKey}
              onChange={(e) => handleInputChange('apiKey', e.target.value)}
              className={errors.apiKey ? "border-red-500" : ""}
            />
            {errors.apiKey && <p className="text-sm text-red-500">{errors.apiKey}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="apiSecret">API Secret</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">Seu API Secret da Backpack Exchange. Mantenha seguro e não compartilhe.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Input
              id="apiSecret"
              type="password"
              placeholder="Seu API Secret da Backpack"
              value={formData.apiSecret}
              onChange={(e) => handleInputChange('apiSecret', e.target.value)}
              className={errors.apiSecret ? "border-red-500" : ""}
            />
            {errors.apiSecret && <p className="text-sm text-red-500">{errors.apiSecret}</p>}
          </div>

          {/* Test API Button */}
          <Button
            type="button"
            onClick={handleTestApiKeys}
            disabled={isTestingApi || !formData.apiKey || !formData.apiSecret || (isEditMode && !apiKeysChanged)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3"
          >
            {isTestingApi ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Testando API Keys...
              </>
            ) : (
              <>
                <TestTube className="h-4 w-4 mr-2" />
                🔐 Testar API Key
              </>
            )}
          </Button>

          {/* API Test Result */}
          {apiTestResult && (
            <div className={`p-3 rounded-lg border ${
              apiTestResult.success
                ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-950/20 dark:border-green-800 dark:text-green-300'
                : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-300'
            }`}>
              <p className="text-sm">{apiTestResult.message}</p>
            </div>
          )}
        </div>

        {/* Seção de Tokens Autorizados */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Tokens Autorizados</h3>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={formData.authorizedTokens.length === 0}
                onClick={() => setFormData(prev => ({ ...prev, authorizedTokens: [] }))}
              >
                Limpar Todos
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {/* Campo de busca */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="tokenSearch">Buscar Tokens:</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Selecione os tokens que o bot HFT pode negociar. Recomendamos tokens de alta liquidez.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="tokenSearch"
                  type="text"
                  placeholder="Digite o nome do token..."
                  value={tokenSearchTerm}
                  onChange={(e) => setTokenSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>


            {/* Loading tokens */}
            {loadingTokens && (
              <div className="flex items-center justify-center p-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-current mr-2"></div>
                Carregando tokens disponíveis...
              </div>
            )}

            {/* Lista de tokens disponíveis */}
            {!loadingTokens && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {filteredTokens.length} tokens encontrados
                  </span>
                  <span className={`font-medium ${
                    formData.authorizedTokens.length === 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-green-600 dark:text-green-400'
                  }`}>
                    {formData.authorizedTokens.length} selecionados
                    {formData.authorizedTokens.length === 0 && ' (mínimo 1)'}
                  </span>
                </div>

                <div className="max-h-60 overflow-y-auto border rounded-lg p-2 space-y-1">
                  {filteredTokens.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Nenhum token encontrado
                    </p>
                  ) : (
                    filteredTokens.map((token) => {
                      // Verificar se o token tem as propriedades necessárias
                      if (!token.symbol || !token.baseSymbol) {
                        return null; // Pular tokens inválidos
                      }

                      const isSelected = formData.authorizedTokens.includes(token.symbol);
                      // @ts-ignore
                      const changePercent = parseFloat(token.priceChangePercent24h || '0');
                      const changeColor = changePercent > 0
                        ? 'text-green-600 dark:text-green-400'
                        : changePercent < 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-gray-600 dark:text-gray-400';

                      return (
                        <div
                          key={token.symbol}
                          className={`flex items-center justify-between p-3 rounded cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-blue-50 border border-blue-200 dark:bg-blue-950/20 dark:border-blue-800'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                          }`}
                          onClick={() => isSelected
                            ? removeTokenFromAuthorized(token.symbol)
                            : addTokenToAuthorized(token.symbol)
                          }
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full border-2 ${
                              isSelected
                                ? 'bg-blue-500 border-blue-500'
                                : 'border-gray-300'
                            }`} />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <div className="font-medium text-sm">
                                  {token.symbol.replace('_USDC_PERP', '')}-PERP
                                </div>
                                <div className={`text-xs font-medium ${changeColor}`}>
                                  {/* @ts-ignore */}
                                  {formatChangePercent(token.priceChangePercent24h || '0')}
                                </div>
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {/* @ts-ignore */}
                                Vol: {formatVolume(token.quoteVolume24h || '0')} USDC
                              </div>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {isSelected ? '✓ Selecionado' : 'Clique para selecionar'}
                          </div>
                        </div>
                      );
                    }).filter(Boolean) // Remover tokens inválidos (null)
                  )}
                </div>
              </div>
            )}

            {/* Tokens selecionados */}
            {formData.authorizedTokens.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Tokens Selecionados:</Label>
                <div className="flex flex-wrap gap-2">
                  {formData.authorizedTokens.map((token) => (
                    <div
                      key={token}
                      className="flex items-center gap-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 px-2 py-1 rounded-full text-xs"
                    >
                      <span>{token.replace('_USDC_PERP', '')}-PERP</span>
                      <button
                        onClick={() => removeTokenFromAuthorized(token)}
                        className="hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {errors.authorizedTokens && <p className="text-sm text-red-500">{errors.authorizedTokens}</p>}

            {/* Info Cards - Moved below tokens list with full width */}
            <div className="space-y-3 mt-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg dark:bg-blue-950/20 dark:border-blue-800">
                <h4 className="font-medium text-blue-800 dark:text-blue-300 mb-2">💡 Dica de Liquidez</h4>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Para HFT, escolha tokens com alto volume (BTC, ETH, SOL) para melhor execução e spreads menores.
                </p>
              </div>
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg dark:bg-orange-950/20 dark:border-orange-800">
                <h4 className="font-medium text-orange-800 dark:text-orange-300 mb-2">⚡ Alavancagem Máxima</h4>
                <p className="text-sm text-orange-700 dark:text-orange-300">
                  BTC, ETH e SOL: até 50x | Outros tokens: até 10x
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Configurações HFT */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-medium">Configurações de Volume para Airdrop</h3>
            <div className="px-2 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded text-xs font-medium">
              OTIMIZADO PARA FARMING
            </div>
          </div>

          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg dark:bg-amber-950/20 dark:border-amber-800">
            <h4 className="font-medium text-amber-800 dark:text-amber-300 mb-2">🎯 Estratégia Inteligente</h4>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              As configurações abaixo são otimizadas para gerar máximo volume com mínimo risco,
              simulando atividade de trading consistente para qualificação em airdrops.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="hftSpread">Spread Mínimo (%)</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Spread mínimo entre compra/venda. Menor = mais execuções. Recomendado: 0.05% para alta frequência.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Select value={formData.hftSpread.toString()} onValueChange={(value) => handleInputChange('hftSpread', parseFloat(value))}>
                <SelectTrigger className={errors.hftSpread ? 'border-red-500' : ''}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[10000]">
                  <SelectItem value="0.01">0.01% - Ultra Agressivo</SelectItem>
                  <SelectItem value="0.03">0.03% - Muito Agressivo</SelectItem>
                  <SelectItem value="0.05">0.05% - Agressivo (Recomendado)</SelectItem>
                  <SelectItem value="0.1">0.1% - Moderado</SelectItem>
                  <SelectItem value="0.2">0.2% - Conservador</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Menor spread = mais volume gerado
              </p>
              {errors.hftSpread && <p className="text-sm text-red-500">{errors.hftSpread}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="hftRebalanceFrequency">Frequência de Rebalanceamento</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Com que frequência o bot reajusta as ordens. Menor = mais transações.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Select value={formData.hftRebalanceFrequency.toString()} onValueChange={(value) => handleInputChange('hftRebalanceFrequency', parseInt(value))}>
                <SelectTrigger className={errors.hftRebalanceFrequency ? 'border-red-500' : ''}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[10000]">
                  <SelectItem value="30">30 segundos - Máxima Frequência</SelectItem>
                  <SelectItem value="60">1 minuto - Alta Frequência (Recomendado)</SelectItem>
                  <SelectItem value="120">2 minutos - Frequência Moderada</SelectItem>
                  <SelectItem value="180">3 minutos - Frequência Baixa</SelectItem>
                  <SelectItem value="300">5 minutos - Mínima Frequência</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Menor tempo = mais transações por dia
              </p>
              {errors.hftRebalanceFrequency && <p className="text-sm text-red-500">{errors.hftRebalanceFrequency}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="hftMaxPriceDeviation">Max Price Deviation (%)</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Tolerância de movimento de preço antes que o bot cancele e reposicione as ordens. Essencial para lógica reativa do bot HFT.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Select value={formData.hftMaxPriceDeviation.toString()} onValueChange={(value) => handleInputChange('hftMaxPriceDeviation', parseFloat(value))}>
                <SelectTrigger className={errors.hftMaxPriceDeviation ? 'border-red-500' : ''}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[10000]">
                  <SelectItem value="0.5">0.5% - Ultra Sensível</SelectItem>
                  <SelectItem value="1">1% - Muito Sensível</SelectItem>
                  <SelectItem value="2">2% - Sensível (Recomendado)</SelectItem>
                  <SelectItem value="3">3% - Moderado</SelectItem>
                  <SelectItem value="5">5% - Tolerante</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Menor % = mais cancelamentos e reposicionamentos
              </p>
              {errors.hftMaxPriceDeviation && <p className="text-sm text-red-500">{errors.hftMaxPriceDeviation}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="hftDailyHours">Horas Ativas por Dia</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Quantas horas o bot fica ativo por dia. Simula comportamento humano mais realista.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Select value={formData.hftDailyHours.toString()} onValueChange={(value) => handleInputChange('hftDailyHours', parseInt(value))}>
                <SelectTrigger className={errors.hftDailyHours ? 'border-red-500' : ''}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[10000]">
                  <SelectItem value="8">8 horas - Meio período</SelectItem>
                  <SelectItem value="12">12 horas - Três quartos</SelectItem>
                  <SelectItem value="16">16 horas - Quase integral (Recomendado)</SelectItem>
                  <SelectItem value="20">20 horas - Quase 24h</SelectItem>
                  <SelectItem value="24">24 horas - Integral (Suspeito)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                16h simula trader ativo mais natural
              </p>
              {errors.hftDailyHours && <p className="text-sm text-red-500">{errors.hftDailyHours}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label htmlFor="capitalPercentage">Capital Total do Bot (%)</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">Percentual TOTAL da sua conta que este bot HFT pode usar. Exemplo: 10% = bot pode usar 10% do capital total da conta.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <span className="text-sm text-muted-foreground">Max: 100%</span>
              </div>

              {/* Input numérico com botões +/- */}
              <div className="relative">
                <div className="flex items-center border border-input rounded-md bg-background">
                  <button
                    type="button"
                    onClick={() => {
                      const currentValue = parseFloat(String(formData.capitalPercentage)) || 5;
                      const newValue = Math.max(1, currentValue - 1);
                      handleInputChange('capitalPercentage', newValue);
                    }}
                    className="px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    -
                  </button>
                  <Input
                    id="capitalPercentage"
                    type="text"
                    value={formData.capitalPercentage}
                    onChange={(e) => handleInputChange('capitalPercentage', parseFloat(e.target.value) || 0)}
                    className={`border-0 text-center focus-visible:ring-0 ${errors.capitalPercentage ? "text-red-500" : ""}`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const currentValue = parseFloat(String(formData.capitalPercentage)) || 5;
                      const newValue = Math.min(100, currentValue + 1);
                      handleInputChange('capitalPercentage', newValue);
                    }}
                    className="px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Slider */}
              <div className="space-y-2">
                <div className="relative">
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={parseFloat(String(formData.capitalPercentage)) || 5}
                    onChange={(e) => handleInputChange('capitalPercentage', parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                    style={{
                      background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((parseFloat(String(formData.capitalPercentage)) || 5) - 1) / 99 * 100}%, #e5e7eb ${((parseFloat(String(formData.capitalPercentage)) || 5) - 1) / 99 * 100}%, #e5e7eb 100%)`
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1%</span>
                  <span>100%</span>
                </div>
              </div>

              {errors.capitalPercentage && <p className="text-sm text-red-500">{errors.capitalPercentage}</p>}
            </div>
          </div>
        </div>

        {/* Configurações Avançadas */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Configurações Avançadas</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg dark:bg-green-950/20 dark:border-green-800">
              <h4 className="font-medium text-green-800 dark:text-green-300 mb-2">📈 Volume Dinâmico</h4>
              <p className="text-sm text-green-700 dark:text-green-300">
                O volume diário é calculado automaticamente baseado no seu saldo disponível,
                configurações escolhidas e condições de mercado. Sem metas fixas irreais!
              </p>
            </div>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg dark:bg-blue-950/20 dark:border-blue-800">
              <h4 className="font-medium text-blue-800 dark:text-blue-300 mb-2">📊 Alavancagem Automática</h4>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                A alavancagem será obtida automaticamente da sua conta na Backpack Exchange via API.
                O tamanho das posições será calculado com base na alavancagem configurada na exchange.
              </p>
            </div>
          </div>
        </div>

        {/* Warning sobre HFT */}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>⚠️ Importante:</strong> HFT bots executam operações automaticamente com alta frequência.
            Certifique-se de que suas configurações estão corretas e comece com valores baixos para testar.
          </AlertDescription>
        </Alert>

        {/* Botões */}
        <div className="flex gap-2">
          <Button
            type="submit"
            onClick={handleSubmit}
            disabled={saving || (isEditMode ? (apiKeysChanged && !apiKeysValidated) : !apiKeysValidated)}
            className="bg-orange-600 hover:bg-orange-700 text-white flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                Salvando...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4" />
                {isEditMode ? 'Salvar Alterações' : 'Criar Bot HFT'}
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="flex items-center gap-2"
          >
            <X className="h-4 w-4" />
            Cancelar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}