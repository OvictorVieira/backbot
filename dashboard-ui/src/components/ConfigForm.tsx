import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Eye, EyeOff, Save, X, HelpCircle, TestTube, BarChart3, DollarSign, RotateCcw } from 'lucide-react';
import axios from 'axios';

interface BotConfig {
  id?: number;
  botName: string;
  strategyName: string;
  apiKey: string;
  apiSecret: string;
  capitalPercentage: number;
  time: string;
  enabled: boolean;
  executionMode: string;
  maxNegativePnlStopPct: string | number;
  minProfitPercentage: string | number;
  maxSlippagePct: string | number;
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
  authorizedTokens: string[];
  botClientOrderId?: number;
  maxOpenOrders: number;
}

interface ConfigFormProps {
  config: BotConfig;
  onSave: (config: BotConfig) => void;
  onCancel: () => void;
  isEditMode?: boolean;
}

export const ConfigForm: React.FC<ConfigFormProps> = ({
  config,
  onSave,
  onCancel,
  isEditMode = false
}) => {
  console.log('🔍 [ConfigForm] Config recebido:', config);
  console.log('🔍 [ConfigForm] isEditMode:', isEditMode);
  
  const [formData, setFormData] = useState<BotConfig>({
    ...config,
    authorizedTokens: config.authorizedTokens || [],
    maxOpenOrders: config.maxOpenOrders || 5,
    enableHybridStopStrategy: config.enableHybridStopStrategy || false,
    initialStopAtrMultiplier: config.initialStopAtrMultiplier || 2.0,
    trailingStopAtrMultiplier: config.trailingStopAtrMultiplier || 1.5,
    partialTakeProfitAtrMultiplier: config.partialTakeProfitAtrMultiplier || 3.0,
    partialTakeProfitPercentage: config.partialTakeProfitPercentage || 50,
    enableTrailingStop: config.enableTrailingStop || false,
    trailingStopDistance: config.trailingStopDistance || 1.5,
    enablePostOnly: config.enablePostOnly !== undefined ? config.enablePostOnly : true,
    enableMarketFallback: config.enableMarketFallback !== undefined ? config.enableMarketFallback : true,
    enableOrphanOrderMonitor: config.enableOrphanOrderMonitor !== undefined ? config.enableOrphanOrderMonitor : true,
    enablePendingOrdersMonitor: config.enablePendingOrdersMonitor !== undefined ? config.enablePendingOrdersMonitor : true
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiKeysValidated, setApiKeysValidated] = useState(false);
  const [testingApiKeys, setTestingApiKeys] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'none' | 'volume' | 'profit'>('none');
  const [apiKeysTestResult, setApiKeysTestResult] = useState<{
    success: boolean;
    message: string;
    hasLink?: boolean;
  } | null>(null);
  const [availableTokens, setAvailableTokens] = useState<Array<{
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    status: string;
    volume24h: string;
  }>>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [tokenSearchTerm, setTokenSearchTerm] = useState('');

  // Atualizar formData quando config mudar
  useEffect(() => {
    const shouldReset = !isEditMode || 
                       (isEditMode && (config.apiKey !== formData.apiKey || config.apiSecret !== formData.apiSecret));
    
    if (shouldReset) {
      setFormData(config);
    }
  }, [config.strategyName, config.botName, config.apiKey, config.apiSecret]);
  
  const apiKeysChanged = isEditMode && (
    formData.apiKey !== config.apiKey || 
    formData.apiSecret !== config.apiSecret
  );

  // Função para buscar tokens disponíveis
  const fetchAvailableTokens = async () => {
    try {
      setLoadingTokens(true);
      const response = await axios.get('http://localhost:3001/api/tokens/available');
      
      if (response.data.success) {
        setAvailableTokens(response.data.tokens);
        console.log(`✅ [ConfigForm] ${response.data.total} tokens carregados`);
      } else {
        console.error('❌ [ConfigForm] Erro ao buscar tokens:', response.data.error);
      }
    } catch (error) {
      console.error('❌ [ConfigForm] Erro ao buscar tokens:', error.message);
    } finally {
      setLoadingTokens(false);
    }
  };

  // Carregar tokens disponíveis quando o componente montar
  useEffect(() => {
    fetchAvailableTokens();
  }, []);

  const applyVolumeMode = () => {
    setSelectedMode('volume');
    setFormData(prev => ({
      ...prev,
      capitalPercentage: 20,
      time: '15m',
      maxNegativePnlStopPct: -10,
      minProfitPercentage: 10,
      maxSlippagePct: 0.5,
      executionMode: 'REALTIME',
      enableHybridStopStrategy: false,
      enableTrailingStop: false,
      maxOpenOrders: 5
    }));
  };

  const applyProfitMode = () => {
    setSelectedMode('profit');
    setFormData(prev => ({
      ...prev,
      capitalPercentage: 15,
      time: '1h',
      maxNegativePnlStopPct: -10,
      minProfitPercentage: 5,
      maxSlippagePct: 1.0,
      executionMode: 'ON_CANDLE_CLOSE',
      enableHybridStopStrategy: true,
      enableTrailingStop: true,
      maxOpenOrders: 3
    }));
  };

  const resetToInitial = () => {
    setSelectedMode('none');
    setFormData(config);
  };

  const handleInputChange = (field: keyof BotConfig, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }

    if (field === 'apiKey' || field === 'apiSecret') {
      if (isEditMode) {
        if (apiKeysChanged && !apiKeysValidated) {
          setApiKeysValidated(false);
        }
      } else {
        if (!apiKeysValidated) {
          setApiKeysValidated(false);
        }
      }
    }
  };

  // Função para adicionar token à lista de autorizados
  const addTokenToAuthorized = (symbol: string) => {
    if (!formData.authorizedTokens.includes(symbol)) {
      setFormData(prev => ({
        ...prev,
        authorizedTokens: [...prev.authorizedTokens, symbol]
      }));
    }
  };

  // Função para remover token da lista de autorizados
  const removeTokenFromAuthorized = (symbol: string) => {
    setFormData(prev => ({
      ...prev,
      authorizedTokens: prev.authorizedTokens.filter(token => token !== symbol)
    }));
  };

  // Função para formatar volume de forma legível
  const formatVolume = (volume: string): string => {
    const num = parseFloat(volume);
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    } else {
      return num.toLocaleString();
    }
  };

  // Função para limpar todos os tokens autorizados (permitir todos)
  const clearAuthorizedTokens = () => {
    setFormData(prev => ({
      ...prev,
      authorizedTokens: []
    }));
  };

  // Filtrar tokens baseado no termo de busca
  const filteredTokens = availableTokens.filter(token =>
    token.symbol.toLowerCase().includes(tokenSearchTerm.toLowerCase()) ||
    token.baseAsset.toLowerCase().includes(tokenSearchTerm.toLowerCase())
  );

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.botName || formData.botName.trim() === '') {
      newErrors.botName = 'Nome do bot é obrigatório';
    } else if (formData.botName.length < 3) {
      newErrors.botName = 'Nome do bot deve ter pelo menos 3 caracteres';
    }

    if (formData.apiKey && formData.apiKey.length < 10) {
      newErrors.apiKey = 'API Key deve ter pelo menos 10 caracteres';
    }

    if (formData.apiSecret && formData.apiSecret.length < 10) {
      newErrors.apiSecret = 'API Secret deve ter pelo menos 10 caracteres';
    }

    if (formData.apiKey && formData.apiSecret) {
      if (isEditMode) {
        if (apiKeysChanged && !apiKeysValidated) {
          newErrors.apiKey = 'Teste a API Key antes de salvar';
        }
      } else {
        if (!apiKeysValidated) {
          newErrors.apiKey = 'Teste a API Key antes de salvar';
        }
      }
    }

    if (formData.capitalPercentage <= 0 || formData.capitalPercentage > 100) {
      newErrors.capitalPercentage = 'Capital deve estar entre 0 e 100%';
    }

    const maxNegativePnlStopPct = parseFloat(String(formData.maxNegativePnlStopPct));
    if (isNaN(maxNegativePnlStopPct)) {
      newErrors.maxNegativePnlStopPct = 'Stop Loss deve ser um número válido';
    } else if (maxNegativePnlStopPct >= 0) {
      newErrors.maxNegativePnlStopPct = 'Stop Loss deve ser um valor negativo (ex: -10)';
    } else if (maxNegativePnlStopPct > -1) {
      newErrors.maxNegativePnlStopPct = 'Stop Loss deve ser menor que -1%';
    }

    const minProfitPercentage = parseFloat(String(formData.minProfitPercentage));
    if (isNaN(minProfitPercentage) || minProfitPercentage < 0) {
      newErrors.minProfitPercentage = 'Lucro mínimo deve ser maior ou igual a zero';
    }

    const maxSlippagePct = parseFloat(String(formData.maxSlippagePct));
    if (isNaN(maxSlippagePct) || maxSlippagePct < 0) {
      newErrors.maxSlippagePct = 'Slippage máximo deve ser maior ou igual a zero';
    }

    if (formData.maxOpenOrders <= 0 || formData.maxOpenOrders > 50) {
      newErrors.maxOpenOrders = 'Máximo de ordens deve estar entre 1 e 50';
    }

    // Validação obrigatória para tokens autorizados
    if (!formData.authorizedTokens || formData.authorizedTokens.length === 0) {
      newErrors.authorizedTokens = 'Selecione pelo menos 1 token para operar';
    }

    const validTimeframes = ['5m', '15m', '30m', '1h', '2h', '3h', '4h', '1d'];
    if (!validTimeframes.includes(formData.time)) {
      newErrors.time = 'Timeframe inválido. Use apenas: 5m, 15m, 30m, 1h, 2h, 3h, 4h, 1d';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleTestApiKeys = async () => {
    if (!formData.apiKey || !formData.apiSecret) {
      setApiKeysTestResult({
        success: false,
        message: 'Por favor, preencha tanto a API Key quanto a API Secret.',
        hasLink: false
      });
      return;
    }

    setTestingApiKeys(true);
    setApiKeysTestResult(null);

    try {
      const response = await axios.post('http://localhost:3001/api/test-api-keys', {
        apiKey: formData.apiKey,
        apiSecret: formData.apiSecret
      });

      if (response.data.success) {
        setApiKeysValidated(true);
        setApiKeysTestResult({
          success: true,
          message: '✅ API Keys válidas! Suas credenciais estão funcionando corretamente.',
          hasLink: false
        });
      } else {
        setApiKeysValidated(false);
        setApiKeysTestResult({
          success: false,
          message: `❌ API Keys inválidas: ${response.data.message}`,
          hasLink: true
        });
      }
    } catch (error: any) {
      setApiKeysValidated(false);
      setApiKeysTestResult({
        success: false,
        message: `❌ Erro ao testar API Keys: ${error.response?.data?.message || error.message}`,
        hasLink: true
      });
    } finally {
      setTestingApiKeys(false);
    }
  };

  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    setSaving(true);
    try {
      await onSave(formData);
    } catch (error) {
      console.error('Erro ao salvar configuração:', error);
    } finally {
      setSaving(false);
    }
  };

  const formatStrategyName = (strategyName: string) => {
    return strategyName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  };

  console.log('🔍 [ConfigForm] Renderizando componente...');
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-center">
          {isEditMode ? 'Editar Bot' : 'Configurar Bot'} {formatStrategyName(config.strategyName)}
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
                    <p className="max-w-xs">Dê um nome único para identificar este bot. Útil quando você tiver múltiplos bots rodando.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Input
              id="botName"
              type="text"
              placeholder="Ex: Meu Bot Principal"
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
                    <p className="max-w-xs">Sua chave de API da Backpack Exchange. É como uma senha que permite ao bot fazer trades em sua conta. Você pode encontrá-la nas configurações da sua conta Backpack.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="relative">
              <Input
                id="apiKey"
                type={showApiKey ? "text" : "password"}
                value={formData.apiKey || ''}
                onChange={(e) => handleInputChange('apiKey', e.target.value)}
                className={errors.apiKey ? "border-red-500" : ""}
                placeholder="Digite sua API Key"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
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
                    <p className="max-w-xs">Sua chave secreta da Backpack Exchange. É como uma segunda senha de segurança. Nunca compartilhe com ninguém e mantenha-a segura.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="relative">
              <Input
                id="apiSecret"
                type={showApiSecret ? "text" : "password"}
                value={formData.apiSecret || ''}
                onChange={(e) => handleInputChange('apiSecret', e.target.value)}
                className={errors.apiSecret ? "border-red-500" : ""}
                placeholder="Digite sua API Secret"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowApiSecret(!showApiSecret)}
              >
                {showApiSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {errors.apiSecret && <p className="text-sm text-red-500">{errors.apiSecret}</p>}
          </div>

          {/* Test API Keys Button */}
          {(!isEditMode || apiKeysChanged) ? (
            <div className="space-y-2">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg dark:bg-blue-950/20 dark:border-blue-800">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  <strong>⚠️ Importante:</strong> Teste sua API Key antes de salvar para garantir que é válida.
                </p>
              </div>
              <Button
                type="button"
                variant="default"
                onClick={handleTestApiKeys}
                disabled={testingApiKeys}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3"
              >
                {testingApiKeys ? (
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

              {/* API Keys Test Result */}
              {apiKeysTestResult && (
                <div className={`p-3 rounded-lg border ${
                  apiKeysTestResult.success 
                    ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800' 
                    : 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800'
                }`}>
                  <p className={`text-sm ${
                    apiKeysTestResult.success 
                      ? 'text-green-700 dark:text-green-300' 
                      : 'text-red-700 dark:text-red-300'
                  }`}>
                    {apiKeysTestResult.message}
                    {apiKeysTestResult.hasLink && (
                      <span className="block mt-2">
                        <a 
                          href="https://backpack.exchange/portfolio/settings/api-keys" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline"
                        >
                          Clique aqui
                        </a> para verificar suas API Keys na Backpack Exchange.
                      </span>
                    )}
                  </p>
                </div>
              )}

              {/* Validation Status */}
              {formData.apiKey && formData.apiSecret && (
                <div className="flex items-center gap-2 text-sm">
                  <div className={`w-2 h-2 rounded-full ${
                    apiKeysValidated ? 'bg-green-500' : 'bg-gray-300'
                  }`} />
                  <span className={apiKeysValidated ? 'text-green-600' : 'text-gray-500'}>
                    {apiKeysValidated ? 'API Key válida' : 'API Key não validada'}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg dark:bg-green-950/20 dark:border-green-800">
              <p className="text-sm text-green-700 dark:text-green-300">
                <strong>✅ API Key válida:</strong> Sua API Key está funcionando corretamente.
              </p>
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
                onClick={clearAuthorizedTokens}
                className="text-xs px-3 py-1 h-8"
                disabled={formData.authorizedTokens.length === 0}
              >
                Limpar Seleção
              </Button>
            </div>
          </div>
          
          <div className="space-y-4">
            {/* Campo de busca */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="tokenSearch">Buscar Tokens</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Busque e selecione os tokens que o bot deve operar. Deixe vazio para permitir todos os tokens disponíveis.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id="tokenSearch"
                type="text"
                placeholder="Digite para buscar tokens (ex: BTC, ETH, SOL)..."
                value={tokenSearchTerm}
                onChange={(e) => setTokenSearchTerm(e.target.value)}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                💡 Dica: Clique nos tokens para selecionar. Você deve escolher pelo menos 1 token.
              </p>
            </div>

            {/* Status de carregamento */}
            {loadingTokens && (
              <div className="flex items-center gap-2 text-sm text-blue-600">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
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
                      const isSelected = formData.authorizedTokens.includes(token.symbol);
                      return (
                        <div
                          key={token.symbol}
                          className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                            isSelected 
                              ? 'bg-blue-50 border border-blue-200 dark:bg-blue-950/20 dark:border-blue-800' 
                              : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                          }`}
                          onClick={() => isSelected 
                            ? removeTokenFromAuthorized(token.symbol)
                            : addTokenToAuthorized(token.symbol)
                          }
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full border-2 ${
                              isSelected 
                                ? 'bg-blue-500 border-blue-500' 
                                : 'border-gray-300'
                            }`} />
                            <div>
                              <div className="font-medium text-sm">
                                {token.symbol.replace('_USDC_PERP', '')}-PERP
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {token.baseAsset} • Volume 24h: ${formatVolume(token.volume24h || '0')}
                              </div>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {isSelected ? 'Selecionado' : 'Clique para selecionar'}
                          </div>
                        </div>
                      );
                    })
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
                        type="button"
                        onClick={() => removeTokenFromAuthorized(token)}
                        className="ml-1 hover:text-blue-600 dark:hover:text-blue-300"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mensagem informativa */}
            {formData.authorizedTokens.length === 0 && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg dark:bg-yellow-950/20 dark:border-yellow-800">
                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                  <strong>⚠️ Selecione tokens:</strong> Você deve selecionar pelo menos 1 token para que o bot possa operar.
                </p>
              </div>
            )}

            {/* Exibição de erro */}
            {errors.authorizedTokens && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg dark:bg-red-950/20 dark:border-red-800">
                <p className="text-sm text-red-700 dark:text-red-300">
                  <strong>❌ Erro:</strong> {errors.authorizedTokens}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Trading Configuration */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Configurações de Trading</h3>
            
            {/* Botões de Modo de Configuração */}
            <div className="flex gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={applyVolumeMode}
                      className={`bg-white hover:bg-gray-50 border-gray-200 text-gray-700 hover:text-gray-900 text-xs px-3 py-1 h-8 flex items-center gap-1 ${
                        selectedMode === 'volume' ? 'ring-2 ring-blue-500 ring-offset-2' : ''
                      }`}
                    >
                      <BarChart3 className="h-3 w-3" />
                      VOLUME
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">Configurações básicas para foco em volume de trades. Stop loss simples e lucro mínimo baixo para mais oportunidades.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={applyProfitMode}
                      className={`bg-white hover:bg-gray-50 border-gray-200 text-gray-700 hover:text-gray-900 text-xs px-3 py-1 h-8 flex items-center gap-1 ${
                        selectedMode === 'profit' ? 'ring-2 ring-green-500 ring-offset-2' : ''
                      }`}
                    >
                      <DollarSign className="h-3 w-3" />
                      LUCRO
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">Configurações avançadas para foco em lucro. Trailing stop, estratégia híbrida e lucro mínimo alto para proteger ganhos.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={resetToInitial}
                      className="bg-white hover:bg-gray-50 border-gray-200 text-gray-700 hover:text-gray-900 text-xs px-3 py-1 h-8 flex items-center gap-1"
                    >
                      <RotateCcw className="h-3 w-3" />
                      RESET
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">Volta todas as configurações para o estado inicial do modal, permitindo começar do zero.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="capitalPercentage">Percentual do Capital (%)</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Quanto do seu dinheiro o bot vai usar por operação. Por exemplo: 20% significa que se você tem $1000, o bot vai usar $200 por trade. Recomendado: 10-30% para começar.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id="capitalPercentage"
                type="number"
                placeholder="Ex: 10"
                value={formData.capitalPercentage}
                onChange={(e) => handleInputChange('capitalPercentage', Number(e.target.value))}
                className={errors.capitalPercentage ? "border-red-500" : ""}
              />
              {errors.capitalPercentage && <p className="text-sm text-red-500">{errors.capitalPercentage}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="time">Timeframe</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Como o bot "olha" o mercado. 5m = analisa a cada 5 minutos, 1h = a cada hora. Quanto menor o tempo, mais trades o bot faz, mas também mais risco. Para iniciantes, recomendo 30m ou 1h.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <select
                id="time"
                value={formData.time}
                onChange={(e) => handleInputChange('time', e.target.value)}
                className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${errors.time ? "border-red-500" : ""}`}
              >
                <option value="5m">5 minutos</option>
                <option value="15m">15 minutos</option>
                <option value="30m">30 minutos</option>
                <option value="1h">1 hora</option>
                <option value="2h">2 horas</option>
                <option value="3h">3 horas</option>
                <option value="4h">4 horas</option>
                <option value="1d">1 dia</option>
              </select>
              {errors.time && <p className="text-sm text-red-500">{errors.time}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="executionMode">Modo de Execução</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        <strong>REALTIME:</strong> Bot analisa a cada 60 segundos, ideal para estratégias que precisam de resposta rápida.<br/><br/>
                        <strong>ON_CANDLE_CLOSE:</strong> Bot analisa apenas no fechamento de cada vela (baseado no timeframe), ideal para estratégias que precisam de confirmação completa da vela. ALPHA_FLOW usa este modo automaticamente.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <select
                id="executionMode"
                value={formData.executionMode}
                onChange={(e) => handleInputChange('executionMode', e.target.value)}
                className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${errors.executionMode ? "border-red-500" : ""}`}
              >
                <option value="REALTIME">REALTIME (60 segundos)</option>
                <option value="ON_CANDLE_CLOSE">ON_CANDLE_CLOSE (fechamento de vela)</option>
              </select>
              {errors.executionMode && <p className="text-sm text-red-500">{errors.executionMode}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="maxNegativePnlStopPct">Stop Loss (%)</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">O limite máximo de perda por operação. Se o trade perder mais que isso, o bot fecha automaticamente para proteger seu dinheiro. Use valores negativos (ex: -10, -15, -20). Recomendado: -5% a -15% para começar.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id="maxNegativePnlStopPct"
                type="number"
                step="0.1"
                placeholder="Ex: -10"
                value={formData.maxNegativePnlStopPct}
                onChange={(e) => handleInputChange('maxNegativePnlStopPct', e.target.value)}
                className={errors.maxNegativePnlStopPct ? "border-red-500" : ""}
              />
              <p className="text-xs text-muted-foreground">
                💡 Dica: Use valores negativos (ex: -10, -15, -20). Quanto mais negativo, maior o risco.
              </p>
              {errors.maxNegativePnlStopPct && <p className="text-sm text-red-500">{errors.maxNegativePnlStopPct}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="minProfitPercentage">Lucro Mínimo (%)</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">O lucro mínimo necessário para fechar uma posição automaticamente. Para farming de volume, use valores baixos (0.1-1%). Para trading tradicional, use valores maiores (2-10%).</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id="minProfitPercentage"
                type="number"
                step="0.1"
                placeholder="Ex: 10"
                value={formData.minProfitPercentage}
                onChange={(e) => handleInputChange('minProfitPercentage', e.target.value)}
                className={errors.minProfitPercentage ? "border-red-500" : ""}
              />
              {errors.minProfitPercentage && <p className="text-sm text-red-500">{errors.minProfitPercentage}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="maxSlippagePct">Slippage Máximo (%)</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">O slippage máximo permitido para executar uma ordem. Se o preço mudar mais que isso entre o sinal e a execução, a ordem é cancelada. Recomendado: 0.5-2% para começar.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id="maxSlippagePct"
                type="number"
                step="0.1"
                placeholder="Ex: 0.5"
                value={formData.maxSlippagePct}
                onChange={(e) => handleInputChange('maxSlippagePct', e.target.value)}
                className={errors.maxSlippagePct ? "border-red-500" : ""}
              />
              {errors.maxSlippagePct && <p className="text-sm text-red-500">{errors.maxSlippagePct}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="maxOpenOrders">Máximo de Ordens Ativas</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Quantidade máxima de ordens que o bot pode ter abertas simultaneamente. Isso ajuda a controlar o risco e evitar sobre-exposição. Recomendado: 3-10 para começar.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id="maxOpenOrders"
                type="number"
                min="1"
                max="50"
                placeholder="Ex: 5"
                value={formData.maxOpenOrders}
                onChange={(e) => handleInputChange('maxOpenOrders', Number(e.target.value))}
                className={errors.maxOpenOrders ? "border-red-500" : ""}
              />
              {errors.maxOpenOrders && <p className="text-sm text-red-500">{errors.maxOpenOrders}</p>}
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex gap-2">
        <Button 
          onClick={handleSave} 
          disabled={saving || (isEditMode ? (apiKeysChanged && !apiKeysValidated) : !apiKeysValidated)}
          className="flex items-center gap-2"
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              Salvando...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {isEditMode && apiKeysChanged && !apiKeysValidated
                ? 'Teste a API Key primeiro' 
                : !apiKeysValidated && !isEditMode
                ? 'Teste a API Key primeiro'
                : 'Salvar Configuração'
              }
            </>
          )}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving} className="flex items-center gap-2">
          <X className="h-4 w-4" />
          Cancelar
        </Button>
      </CardFooter>
    </Card>
  );
};
