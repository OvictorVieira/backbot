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
  botClientOrderId?: number;
  maxOpenOrders: number;
}

interface ConfigFormProps {
  config: BotConfig;
  onSave: (config: BotConfig) => void;
  onCancel: () => void;
  isEditMode?: boolean; // Indica se está editando um bot existente
}

export const ConfigForm: React.FC<ConfigFormProps> = ({
  config,
  onSave,
  onCancel,
  isEditMode = false
}) => {
  const [formData, setFormData] = useState<BotConfig>(config);
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
  
  // Verificar se as API keys foram alteradas no modo de edição
  const apiKeysChanged = isEditMode && (
    formData.apiKey !== config.apiKey || 
    formData.apiSecret !== config.apiSecret
  );

  // Reset validation when component mounts or config changes
  useEffect(() => {
    // Only reset if this is a new config (different from current)
    // Use a more specific comparison to avoid unnecessary resets
    const isNewConfig = config.strategyName !== formData.strategyName || 
                       config.botName !== formData.botName ||
                       config.apiKey !== formData.apiKey ||
                       config.apiSecret !== formData.apiSecret;
    
    if (isNewConfig) {
      if (isEditMode) {
        // No modo de edição, só resetar se as chaves mudaram
        if (apiKeysChanged && !apiKeysValidated) {
          setApiKeysValidated(false);
          setApiKeysTestResult(null);
        }
      } else {
        // No modo de criação, resetar sempre
        if (!apiKeysValidated) {
          setApiKeysValidated(false);
          setApiKeysTestResult(null);
        }
      }
    }
  }, [config.strategyName, config.botName, config.apiKey, config.apiSecret, 
       formData.strategyName, formData.botName, formData.apiKey, formData.apiSecret,
       isEditMode, apiKeysChanged, apiKeysValidated]);

  // Função para aplicar modo VOLUME
  const applyVolumeMode = () => {
    setFormData({
      ...formData,
      capitalPercentage: 20,
      time: '30m',
      executionMode: 'REALTIME',
      maxNegativePnlStopPct: "-10",
      minProfitPercentage: "10",
      maxSlippagePct: "0.5",
      enableHybridStopStrategy: false,
      enableTrailingStop: false,
      maxOpenOrders: 5
    });
    setSelectedMode('volume');
  };

  // Função para aplicar modo LUCRO
  const applyProfitMode = () => {
    setFormData({
      ...formData,
      capitalPercentage: 20,
      time: '30m',
      executionMode: 'REALTIME',
      maxNegativePnlStopPct: "-10",
      minProfitPercentage: "10",
      maxSlippagePct: "0.5",
      enableHybridStopStrategy: true,
      enableTrailingStop: true,
      maxOpenOrders: 5
    });
    setSelectedMode('profit');
  };

  // Função para resetar para configuração inicial
  const resetToInitial = () => {
    setFormData(config);
    setSelectedMode('none');
  };

  // Reset validation when API keys change (but keep success message)
  useEffect(() => {
    if (formData.apiKey || formData.apiSecret) {
      if (isEditMode) {
        // No modo de edição, só resetar se as chaves mudaram
        if (apiKeysChanged && !apiKeysValidated) {
          setApiKeysValidated(false);
        }
      } else {
        // No modo de criação, resetar sempre
        if (!apiKeysValidated) {
          setApiKeysValidated(false);
        }
      }
      // Don't clear the test result message - let user see it
    }
  }, [formData.apiKey, formData.apiSecret, apiKeysValidated, isEditMode, apiKeysChanged]);





  const handleInputChange = (field: keyof BotConfig, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }

    // Reset API keys validation when API keys change
    if (field === 'apiKey' || field === 'apiSecret') {
      if (isEditMode) {
        // No modo de edição, só resetar se as chaves mudaram
        if (apiKeysChanged && !apiKeysValidated) {
          setApiKeysValidated(false);
        }
      } else {
        // No modo de criação, resetar sempre
        if (!apiKeysValidated) {
          setApiKeysValidated(false);
        }
      }
      // Keep the test result message visible
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.botName || formData.botName.trim() === '') {
      newErrors.botName = 'Nome do bot é obrigatório';
    } else if (formData.botName.length < 3) {
      newErrors.botName = 'Nome do bot deve ter pelo menos 3 caracteres';
    }

    // Validar API keys se foram fornecidas
    if (formData.apiKey && formData.apiKey.length < 10) {
      newErrors.apiKey = 'API Key deve ter pelo menos 10 caracteres';
    }

    if (formData.apiSecret && formData.apiSecret.length < 10) {
      newErrors.apiSecret = 'API Secret deve ter pelo menos 10 caracteres';
    }

    // Validação de API keys
    if (formData.apiKey && formData.apiSecret) {
      if (isEditMode) {
        // No modo de edição, verificar se as API keys mudaram
        if (apiKeysChanged && !apiKeysValidated) {
          // Se mudaram, exigir validação
          newErrors.apiKey = 'Teste a API Key antes de salvar';
        }
        // Se não mudaram, permitir salvar sem validação
      } else {
        // No modo de criação, sempre exigir validação
        if (!apiKeysValidated) {
          newErrors.apiKey = 'Teste a API Key antes de salvar';
        }
      }
    }

    if (formData.capitalPercentage <= 0 || formData.capitalPercentage > 100) {
      newErrors.capitalPercentage = 'Capital deve estar entre 0 e 100%';
    }

    const maxNegativePnlStopPct = parseFloat(String(formData.maxNegativePnlStopPct));
    if (isNaN(maxNegativePnlStopPct) || maxNegativePnlStopPct >= 0) {
      newErrors.maxNegativePnlStopPct = 'Stop Loss deve ser um valor negativo';
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

    // Validação de timeframe
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
        message: 'Preencha API Key e API Secret primeiro'
      });
      setApiKeysValidated(false);
      return;
    }

    setTestingApiKeys(true);
    setApiKeysTestResult(null);

    try {
      // Testar credenciais duplicadas
      const duplicateResponse = await axios.post('http://localhost:3001/api/validate-duplicate-credentials', {
        apiKey: formData.apiKey,
        apiSecret: formData.apiSecret
      });

      if (!duplicateResponse.data.success) {
        setApiKeysTestResult({
          success: false,
          message: duplicateResponse.data.error
        });
        setApiKeysValidated(false);
        return;
      }

      // Testar validação de credenciais da Backpack
      const validationResponse = await axios.post('http://localhost:3001/api/validate-credentials', {
        apiKey: formData.apiKey,
        apiSecret: formData.apiSecret
      });

      if (validationResponse.data.success) {
        const apiKeyStatus = validationResponse.data.apiKeyStatus || 'válida';
        setApiKeysTestResult({
          success: true,
          message: `✅ API Key válida`
        });
        setApiKeysValidated(true);
      } else {
        const errorMessage = validationResponse.data.error || '❌ API Key inválida';
        const apiKeyStatus = validationResponse.data.apiKeyStatus || 'inválida';
        const hasLink = apiKeyStatus === 'inválida' || apiKeyStatus === 'com erro';
        
        setApiKeysTestResult({
          success: false,
          message: `${errorMessage} (Status: ${apiKeyStatus})`,
          hasLink: hasLink
        });
        setApiKeysValidated(false);
      }
    } catch (error: any) {
      let errorMessage = 'Erro ao testar API Key';
      let hasLink = false;
      
      if (error.response?.status === 409) {
        errorMessage = error.response.data.error;
      } else if (error.response?.status === 401) {
        errorMessage = '❌ API Key inválida';
        hasLink = true;
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
        hasLink = true;
      }
      
      setApiKeysTestResult({
        success: false,
        message: errorMessage,
        hasLink: hasLink
      });
      setApiKeysValidated(false);
    } finally {
      setTestingApiKeys(false);
    }
  };

  const handleSave = async () => {
    if (isEditMode) {
      // No modo de edição, verificar se as API keys mudaram
      if (apiKeysChanged && formData.apiKey && formData.apiSecret && !apiKeysValidated) {
        // Se mudaram e não foram validadas, mostrar erro
        setErrors(prev => ({
          ...prev,
          apiKey: 'Teste a API Key antes de salvar'
        }));
        return;
      }
    } else {
      // No modo de criação, sempre exigir validação se há API keys
      if (formData.apiKey && formData.apiSecret && !apiKeysValidated) {
        setErrors(prev => ({
          ...prev,
          apiKey: 'Teste a API Key antes de salvar'
        }));
        return;
      }
    }
    
    // Se chegou até aqui, pode salvar
    if (validateForm()) {
      setSaving(true);
      console.log('💾 Iniciando salvamento...');
      
      try {
        // Converte valores string para number antes de salvar
        const configToSave = {
          ...formData,
          maxNegativePnlStopPct: -Math.abs(parseFloat(String(formData.maxNegativePnlStopPct))), // Converte para negativo
          minProfitPercentage: parseFloat(String(formData.minProfitPercentage)),
          maxSlippagePct: parseFloat(String(formData.maxSlippagePct))
        };
        
        await onSave(configToSave);
        console.log('✅ Salvamento concluído');
      } catch (error) {
        console.error('❌ Erro durante salvamento:', error);
      } finally {
        setSaving(false);
      }
    }
  };

  const formatStrategyName = (strategyName: string) => {
    return strategyName
      .toLowerCase()
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('')
  }

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
                value={formData.apiKey}
                onChange={(e) => handleInputChange('apiKey', e.target.value)}
                className={errors.apiKey ? "border-red-500" : ""}
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
                value={formData.apiSecret}
                onChange={(e) => handleInputChange('apiSecret', e.target.value)}
                className={errors.apiSecret ? "border-red-500" : ""}
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

          {/* Test API Keys Button - Mostrar apenas quando necessário */}
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
            /* Mensagem informativa quando as chaves não foram alteradas */
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg dark:bg-green-950/20 dark:border-green-800">
              <p className="text-sm text-green-700 dark:text-green-300">
                <strong>✅ API Key válida:</strong> Sua API Key está funcionando corretamente.
                
              </p>
            </div>
          )}
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
                      <p className="max-w-xs">O limite máximo de perda por operação. Se o trade perder mais que isso, o bot fecha automaticamente para proteger seu dinheiro. Recomendado: 5-15% para começar.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id="maxNegativePnlStopPct"
                type="number"
                step="0.1"
                placeholder="Ex: 2.5"
                value={formData.maxNegativePnlStopPct}
                onChange={(e) => handleInputChange('maxNegativePnlStopPct', e.target.value)}
                className={errors.maxNegativePnlStopPct ? "border-red-500" : ""}
              />
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
                placeholder="Ex: 0.5"
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

        {/* Advanced Configuration */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Configurações Avançadas</h3>
          
          <div className="grid grid-cols-2 gap-4">
            {formData.enableHybridStopStrategy ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="initialStopAtrMultiplier">Multiplicador ATR Inicial</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">Controla quão longe o stop loss inicial fica do preço. ATR mede a volatilidade do mercado. Maior valor = stop mais distante = menos chance de ser atingido por pequenas oscilações.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Input
                  id="initialStopAtrMultiplier"
                  type="number"
                  step="0.1"
                  value={formData.initialStopAtrMultiplier}
                  onChange={(e) => handleInputChange('initialStopAtrMultiplier', Number(e.target.value))}
                />
              </div>
            ) : (
              <div className="col-span-2 p-3 bg-muted/50 rounded-lg border border-dashed">
                <p className="text-sm text-muted-foreground">
                  💡 <strong>Multiplicador ATR Inicial:</strong> Disponível apenas quando "Estratégia Híbrida de Stop Loss (ATR)" estiver habilitada.
                </p>
              </div>
            )}

            {formData.enableTrailingStop ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="trailingStopAtrMultiplier">Multiplicador ATR Trailing</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">Controla a distância do trailing stop (stop móvel). Quando o preço sobe, o stop sobe junto. Menor valor = proteção mais apertada, mas pode fechar trades em pequenas correções.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Input
                  id="trailingStopAtrMultiplier"
                  type="number"
                  step="0.1"
                  value={formData.trailingStopAtrMultiplier}
                  onChange={(e) => handleInputChange('trailingStopAtrMultiplier', Number(e.target.value))}
                />
              </div>
            ) : (
              <div className="col-span-2 p-3 bg-muted/50 rounded-lg border border-dashed">
                <p className="text-sm text-muted-foreground">
                  💡 <strong>Multiplicador ATR Trailing:</strong> Disponível apenas quando "Trailing Stop" estiver habilitado.
                </p>
              </div>
            )}

            {formData.enableHybridStopStrategy ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="partialTakeProfitAtrMultiplier">Multiplicador ATR Take Profit</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">Controla onde o bot vai fechar parte da posição para garantir lucro. Maior valor = alvo mais distante = potencial de lucro maior, mas pode demorar mais para atingir.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Input
                    id="partialTakeProfitAtrMultiplier"
                    type="number"
                    step="0.1"
                    value={formData.partialTakeProfitAtrMultiplier}
                    onChange={(e) => handleInputChange('partialTakeProfitAtrMultiplier', Number(e.target.value))}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="partialTakeProfitPercentage">Take Profit Parcial (%)</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">Quanto da posição o bot vai fechar no primeiro alvo de lucro. Por exemplo: 50% = fecha metade da posição, deixa a outra metade para buscar mais lucro.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Input
                    id="partialTakeProfitPercentage"
                    type="number"
                    value={formData.partialTakeProfitPercentage}
                    onChange={(e) => handleInputChange('partialTakeProfitPercentage', Number(e.target.value))}
                  />
                </div>
              </>
            ) : (
              <div className="col-span-2 p-3 bg-muted/50 rounded-lg border border-dashed">
                <p className="text-sm text-muted-foreground">
                  💡 <strong>Take Profit Parcial:</strong> Disponível apenas quando "Estratégia Híbrida de Stop Loss (ATR)" estiver habilitada.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Feature Toggles */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Funcionalidades</h3>
          
          {/* Configurações Sempre Ativas */}
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg dark:bg-green-900/20 dark:border-green-800">
            <h4 className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">✅ Configurações Sempre Ativas</h4>
            <div className="text-sm text-green-700 dark:text-green-300 space-y-1">
              <p>• <strong>Post Only:</strong> Força o uso de ordens limit para reduzir taxas</p>
              <p>• <strong>Market Fallback:</strong> Usa ordens de mercado se limit falhar</p>
              <p>• <strong>Monitor de Ordens Órfãs:</strong> Cancela ordens perdidas automaticamente</p>
              <p>• <strong>Monitor de Ordens Pendentes:</strong> Acompanha status das ordens em tempo real</p>
            </div>
          </div>
          
          {/* Controle do Bot */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg dark:bg-blue-900/20 dark:border-blue-800">
            <h4 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">🎮 Controle do Bot</h4>
            <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
              <p>• <strong>Iniciar/Pausar:</strong> Use o botão no card do bot para controlar a execução</p>
              <p>• <strong>Status:</strong> O badge "Executando" com efeito pulsante indica que o bot está ativo</p>
              <p>• <strong>Configuração:</strong> Clique em "Configurar" para ajustar parâmetros</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
              <input
                type="checkbox"
                checked={formData.enableHybridStopStrategy}
                onChange={(e) => handleInputChange('enableHybridStopStrategy', e.target.checked)}
                className="rounded border-gray-300"
              />
              <div className="flex items-center gap-2">
                <div>
                  <span className="text-sm font-medium">Estratégia Híbrida de Stop Loss (ATR)</span>
                  <p className="text-xs text-muted-foreground">Stop loss baseado em ATR</p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Ativa a estratégia de stop loss adaptativo baseado em ATR (Average True Range). Quando ativado, o bot usa ATR para calcular stops mais inteligentes e também habilita o Take Profit Parcial.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </label>
            <label className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
              <input
                type="checkbox"
                checked={formData.enableTrailingStop}
                onChange={(e) => handleInputChange('enableTrailingStop', e.target.checked)}
                className="rounded border-gray-300"
              />
              <div className="flex items-center gap-2">
                <div>
                  <span className="text-sm font-medium">Trailing Stop</span>
                  <p className="text-xs text-muted-foreground">Ajusta stop loss automaticamente</p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Funcionalidade inteligente que move o stop loss para cima quando o preço sobe, protegendo seus lucros. É como uma "rede de segurança" que sobe junto com o preço.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </label>
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