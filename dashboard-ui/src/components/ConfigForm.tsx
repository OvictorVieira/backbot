import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Eye, EyeOff, Save, X, HelpCircle, TestTube, BarChart3, DollarSign, RotateCcw, ChevronDown } from 'lucide-react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

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
  // leverageLimit: number; // TODO: Removido temporariamente
  botClientOrderId?: number;
  maxOpenOrders: number;
  // Configurações de Validação de Sinais
  enableMomentumSignals?: boolean;
  enableRsiSignals?: boolean;
  enableStochasticSignals?: boolean;
  enableMacdSignals?: boolean;
  enableAdxSignals?: boolean;
  // Configurações de Filtros de Confirmação
  enableMoneyFlowFilter?: boolean;
  enableVwapFilter?: boolean;
  enableBtcTrendFilter?: boolean;
  // Configuração do Heikin Ashi
  enableHeikinAshi?: boolean;
  // Configuração de Confluência
  enableConfluenceMode?: boolean;
  minConfluences?: number;
  // Configurações HFT
  hftSpread?: number;
  hftDailyVolumeGoal?: number;
  hftSymbols?: string[];
  hftQuantityMultiplier?: number;
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

  
  const [formData, setFormData] = useState<BotConfig>({
    ...config,
    authorizedTokens: config.authorizedTokens || [],
    // leverageLimit: config.leverageLimit || 10, // TODO: Removido temporariamente
    maxOpenOrders: config.maxOpenOrders || 5,
    enableHybridStopStrategy: config.enableHybridStopStrategy || false,
    initialStopAtrMultiplier: config.initialStopAtrMultiplier || 2.0,
    trailingStopAtrMultiplier: config.trailingStopAtrMultiplier || 1.5,
    partialTakeProfitAtrMultiplier: config.partialTakeProfitAtrMultiplier || 1.5,
    partialTakeProfitPercentage: config.partialTakeProfitPercentage || 50,
    enableTrailingStop: config.enableTrailingStop || false,
    trailingStopDistance: config.trailingStopDistance || 1.5,
    enablePostOnly: config.enablePostOnly !== undefined ? config.enablePostOnly : true,
    enableMarketFallback: config.enableMarketFallback !== undefined ? config.enableMarketFallback : true,
    enableOrphanOrderMonitor: config.enableOrphanOrderMonitor !== undefined ? config.enableOrphanOrderMonitor : true,
    enablePendingOrdersMonitor: config.enablePendingOrdersMonitor !== undefined ? config.enablePendingOrdersMonitor : true,
    // Configurações de Validação (default: true para manter compatibilidade)
    enableMomentumSignals: config.enableMomentumSignals !== undefined ? config.enableMomentumSignals : true,
    enableRsiSignals: config.enableRsiSignals !== undefined ? config.enableRsiSignals : true,
    enableStochasticSignals: config.enableStochasticSignals !== undefined ? config.enableStochasticSignals : true,
    enableMacdSignals: config.enableMacdSignals !== undefined ? config.enableMacdSignals : true,
    enableAdxSignals: config.enableAdxSignals !== undefined ? config.enableAdxSignals : true,
    enableMoneyFlowFilter: config.enableMoneyFlowFilter !== undefined ? config.enableMoneyFlowFilter : true,
    enableVwapFilter: config.enableVwapFilter !== undefined ? config.enableVwapFilter : true,
    enableBtcTrendFilter: config.enableBtcTrendFilter !== undefined ? config.enableBtcTrendFilter : true,
    // Configurações de Confluência (default: false para manter comportamento atual)
    enableConfluenceMode: config.enableConfluenceMode !== undefined ? config.enableConfluenceMode : false,
    minConfluences: config.minConfluences !== undefined ? config.minConfluences : 2
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
    baseSymbol: string;
    quoteSymbol: string;
    marketType: string;
    orderBookState: string;
    status: string;
  }>>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [tokenSearchTerm, setTokenSearchTerm] = useState('');
  const [timeDropdownOpen, setTimeDropdownOpen] = useState(false);
  const [executionModeDropdownOpen, setExecutionModeDropdownOpen] = useState(false);

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
      const response = await axios.get(`${API_BASE_URL}/api/tokens/available`);
      
      if (response.data.success) {
        setAvailableTokens(response.data.tokens);
      } else {
        // Error handling without console logs
      }
    } catch (error) {
      // Error handling without console logs
    } finally {
      setLoadingTokens(false);
    }
  };

  // Carregar tokens disponíveis quando o componente montar
  useEffect(() => {
    fetchAvailableTokens();
  }, []);

  // Fechar dropdowns quando clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('.custom-select')) {
        setTimeDropdownOpen(false);
        setExecutionModeDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Gerenciar modo de execução quando Heikin Ashi é ativado/desativado
  useEffect(() => {
    if (formData.enableHeikinAshi) {
      // Força ON_CANDLE_CLOSE quando Heikin Ashi é habilitado
      if (formData.executionMode !== 'ON_CANDLE_CLOSE') {
        setFormData(prev => ({
          ...prev,
          executionMode: 'ON_CANDLE_CLOSE'
        }));
      }
    }
  }, [formData.enableHeikinAshi]);

  const applyVolumeMode = () => {
    setSelectedMode('volume');
    setFormData(prev => ({
      ...prev,
      capitalPercentage: 20,
      time: '15m',
      maxNegativePnlStopPct: -3, // 🔥 MUDANÇA: -10% → -3% para farmar mais volume
      minProfitPercentage: 3, // 🔥 MUDANÇA: 10% → 3% para farmar mais volume  
      maxSlippagePct: 0.5,
      executionMode: 'REALTIME',
      enableHybridStopStrategy: false,
      enableTrailingStop: false,
      maxOpenOrders: 5,
      // 🎯 CONFIGURAÇÕES DE SINAIS (padrão = habilitados)
      enableMomentumSignals: true,
      enableRsiSignals: true,
      enableStochasticSignals: true,
      enableMacdSignals: true,
      enableAdxSignals: true,
      // 📊 FILTROS DE CONFIRMAÇÃO (padrão = habilitados)
      enableMoneyFlowFilter: true,
      enableVwapFilter: true,
      enableBtcTrendFilter: true,
      // ❌ FUNCIONALIDADES AVANÇADAS (desabilitadas para volume)
      enableHeikinAshi: false, // 🔥 DESABILITADO para modo volume
      enableConfluenceMode: false, // 🔥 DESABILITADO para modo volume
      minConfluences: 2 // Valor padrão mesmo desabilitado
    }));
  };

  const applyProfitMode = () => {
    setSelectedMode('profit');
    setFormData(prev => ({
      ...prev,
      capitalPercentage: 20,
      time: '30m',
      maxNegativePnlStopPct: -10,
      minProfitPercentage: 10,
      maxSlippagePct: 0.5,
      executionMode: 'REALTIME',
      enableHybridStopStrategy: true,
      enableTrailingStop: true,
      trailingStopDistance: 1, // 🔥 PADRÃO: 1% trailing distance
      partialTakeProfitAtrMultiplier: 2.0,
      partialTakeProfitPercentage: 30, // 🔥 PADRÃO: 30% para fechamento parcial
      maxOpenOrders: 3,
      // 🎯 CONFIGURAÇÕES DE SINAIS (padrão = habilitados para máxima precisão)
      enableMomentumSignals: true,
      enableRsiSignals: true,
      enableStochasticSignals: true,
      enableMacdSignals: true,
      enableAdxSignals: true,
      // 📊 FILTROS DE CONFIRMAÇÃO (padrão = habilitados)
      enableMoneyFlowFilter: true,
      enableVwapFilter: true,
      enableBtcTrendFilter: true,
      // ✅ FUNCIONALIDADES AVANÇADAS (habilitadas para máxima segurança)
      enableHeikinAshi: true, // 🔥 HABILITADO para filtrar melhor as tendências
      enableConfluenceMode: true, // 🔥 HABILITADO com 2 indicadores mínimos
      minConfluences: 2 // 🔥 PADRÃO: 2 indicadores para confluência
    }));
  };


  const resetToInitial = () => {
    setSelectedMode('none');
    setFormData(config);
  };

  const handleInputChange = (field: keyof BotConfig, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Validação em tempo real
    const newErrors = { ...errors };
    
    // Remove erro anterior do campo
    if (newErrors[field]) {
      delete newErrors[field];
    }

    // Validação específica por campo (todos os valores são tratados como string)
    if (field === 'maxNegativePnlStopPct') {
      const numValue = parseFloat(String(value));
      if (isNaN(numValue)) {
        newErrors[field] = 'Stop Loss deve ser um número válido';
      } else if (numValue >= 0) {
        newErrors[field] = 'Stop Loss deve ser um valor negativo';
      } else if (numValue > -0.5) {
        newErrors[field] = 'Stop Loss deve ser menor que -0.5%';
      }
    } else if (field === 'capitalPercentage') {
      const numValue = parseFloat(String(value));
      if (isNaN(numValue)) {
        newErrors[field] = 'Capital deve ser um número válido';
      } else if (numValue <= 0) {
        newErrors[field] = 'Capital deve ser maior que 0%';
      } else if (numValue > 100) {
        newErrors[field] = 'Capital deve ser menor ou igual a 100%';
      }
    } else if (field === 'minProfitPercentage') {
      const numValue = parseFloat(String(value));
      if (isNaN(numValue)) {
        newErrors[field] = 'Lucro mínimo deve ser um número válido';
      } else if (numValue < 0) {
        newErrors[field] = 'Lucro mínimo deve ser maior ou igual a 0%';
      }
    } else if (field === 'maxSlippagePct') {
      const numValue = parseFloat(String(value));
      if (isNaN(numValue)) {
        newErrors[field] = 'Slippage deve ser um número válido';
      } else if (numValue < 0) {
        newErrors[field] = 'Slippage deve ser maior ou igual a 0%';
      }
    } else if (field === 'maxOpenOrders') {
      const numValue = parseFloat(String(value));
      if (isNaN(numValue)) {
        newErrors[field] = 'Máximo de ordens deve ser um número válido';
      } else if (numValue <= 0) {
        newErrors[field] = 'Máximo de ordens deve ser maior que 0';
      } else if (numValue > 50) {
        newErrors[field] = 'Máximo de ordens deve ser menor ou igual a 50';
      }
    } else if (field === 'initialStopAtrMultiplier') {
      const numValue = parseFloat(String(value));
      if (isNaN(numValue)) {
        newErrors[field] = 'Multiplicador deve ser um número válido';
      } else if (numValue <= 0) {
        newErrors[field] = 'Multiplicador deve ser maior que 0';
      }
    } else if (field === 'trailingStopAtrMultiplier') {
      const numValue = parseFloat(String(value));
      if (isNaN(numValue)) {
        newErrors[field] = 'Multiplicador deve ser um número válido';
      } else if (numValue <= 0) {
        newErrors[field] = 'Multiplicador deve ser maior que 0';
      }
    } else if (field === 'partialTakeProfitAtrMultiplier') {
      const numValue = parseFloat(String(value));
      if (isNaN(numValue)) {
        newErrors[field] = 'Multiplicador deve ser um número válido';
      } else if (numValue <= 0) {
        newErrors[field] = 'Multiplicador deve ser maior que 0';
      }
    } else if (field === 'partialTakeProfitPercentage') {
      const numValue = parseFloat(String(value));
      if (isNaN(numValue)) {
        newErrors[field] = 'Percentual deve ser um número válido';
      } else if (numValue <= 0) {
        newErrors[field] = 'Percentual deve ser maior que 0%';
      } else if (numValue > 100) {
        newErrors[field] = 'Percentual deve ser menor ou igual a 100%';
      }
    } else if (field === 'trailingStopDistance') {
      const numValue = parseFloat(String(value));
      if (isNaN(numValue)) {
        newErrors[field] = 'Distância deve ser um número válido';
      } else if (numValue <= 0) {
        newErrors[field] = 'Distância deve ser maior que 0';
      }
    // TODO: Validação de alavancagem - Removido temporariamente
    // } else if (field === 'leverageLimit') {
    //   const numValue = parseFloat(String(value));
    //   if (isNaN(numValue)) {
    //     newErrors[field] = 'Alavancagem deve ser um número válido';
    //   } else if (numValue < 1) {
    //     newErrors[field] = 'Alavancagem deve ser maior ou igual a 1x';
    //   } else if (numValue > 100) {
    //     newErrors[field] = 'Alavancagem deve ser menor ou igual a 100x';
    //   }
    }

    setErrors(newErrors);

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

  // Função para formatar porcentagem de change
  const formatChangePercent = (changePercent: string): string => {
    const num = parseFloat(changePercent);
    if (isNaN(num)) return '0.00%';
    return `${num > 0 ? '+' : ''}${(num * 100).toFixed(2)}%`;
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
    token.symbol?.toLowerCase().includes(tokenSearchTerm.toLowerCase()) ||
    token.baseSymbol?.toLowerCase().includes(tokenSearchTerm.toLowerCase())
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

    if (formData.capitalPercentage < 0 || formData.capitalPercentage > 100) {
      newErrors.capitalPercentage = 'Capital deve estar entre 0 e 100%';
    }

    // Validações já são feitas em tempo real no handleInputChange
    // Apenas verifica se há erros existentes
    if (errors.maxNegativePnlStopPct) {
      newErrors.maxNegativePnlStopPct = errors.maxNegativePnlStopPct;
    }
    if (errors.minProfitPercentage) {
      newErrors.minProfitPercentage = errors.minProfitPercentage;
    }
    if (errors.maxSlippagePct) {
      newErrors.maxSlippagePct = errors.maxSlippagePct;
    }
    if (errors.maxOpenOrders) {
      newErrors.maxOpenOrders = errors.maxOpenOrders;
    }
    if (errors.capitalPercentage) {
      newErrors.capitalPercentage = errors.capitalPercentage;
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
              const response = await axios.post(`${API_BASE_URL}/api/validate-credentials`, {
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
      // Formata os valores antes de enviar para o backend
      const formattedData = {
          ...formData,
        // Converte strings para números onde necessário
        capitalPercentage: parseFloat(String(formData.capitalPercentage)),
        // leverageLimit: parseInt(String(formData.leverageLimit)), // TODO: Removido temporariamente
        maxNegativePnlStopPct: parseFloat(String(formData.maxNegativePnlStopPct)),
          minProfitPercentage: parseFloat(String(formData.minProfitPercentage)),
        maxSlippagePct: parseFloat(String(formData.maxSlippagePct)),
        maxOpenOrders: parseInt(String(formData.maxOpenOrders)),
        initialStopAtrMultiplier: parseFloat(String(formData.initialStopAtrMultiplier)),
        trailingStopAtrMultiplier: parseFloat(String(formData.trailingStopAtrMultiplier)),
        partialTakeProfitAtrMultiplier: parseFloat(String(formData.partialTakeProfitAtrMultiplier)),
        partialTakeProfitPercentage: parseFloat(String(formData.partialTakeProfitPercentage)),
        trailingStopDistance: parseFloat(String(formData.trailingStopDistance))
      };

      // TODO: Implementar atualização de alavancagem - Removido temporariamente
      // Atualiza a alavancagem na Backpack se as credenciais estiverem disponíveis
      /*
      if (formData.apiKey && formData.apiSecret) {
        try {
          const leverageResponse = await axios.post(`${API_BASE_URL}/api/account/update-leverage`, {
            apiKey: formData.apiKey,
            apiSecret: formData.apiSecret,
            leverageLimit: formattedData.leverageLimit
          });

          if (leverageResponse.data.success) {
            // Leverage updated successfully
          } else {
            // Error updating leverage
          }
        } catch (leverageError) {
          // Error updating leverage - doesn't prevent saving
        }
      }
      */

      await onSave(formattedData);
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

  // Componente customizado para select box
  const CustomSelect = ({ 
    id, 
    value, 
    onChange, 
    options, 
    placeholder, 
    isOpen, 
    onToggle, 
    error,
    disabled = false
  }: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    placeholder: string;
    isOpen: boolean;
    onToggle: () => void;
    error?: string;
    disabled?: boolean;
  }) => {
    const selectedOption = options.find(option => option.value === value);
    
    return (
      <div className="relative custom-select">
        <div
          className={`w-full h-11 px-4 py-2.5 text-sm font-medium bg-background border border-input rounded-md shadow-sm transition-all duration-200 ${
            disabled 
              ? "opacity-50 cursor-not-allowed bg-muted" 
              : "cursor-pointer hover:border-ring focus:ring-2 focus:ring-ring focus:border-ring"
          } ${error ? "border-red-500 focus:ring-red-500 focus:border-red-500" : ""}`}
          onClick={disabled ? undefined : onToggle}
        >
          <div className="flex items-center justify-between">
            <span className={selectedOption ? "text-foreground" : "text-muted-foreground"}>
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </div>
        
        {isOpen && !disabled && (
          <div className="absolute z-50 w-full mt-1 bg-background border border-input rounded-md shadow-lg max-h-60 overflow-auto">
            {options.map((option) => (
              <div
                key={option.value}
                className={`px-4 py-3 text-sm cursor-pointer transition-colors duration-150 ${
                  option.value === value
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                onClick={() => {
                  onChange(option.value);
                  onToggle();
                }}
              >
                {option.label}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };



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

        {/* Configurações de Validação */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Configurações de Validação</h3>
          <div className="text-sm text-muted-foreground mb-4">
            Configure quais validações o bot deve usar para filtrar sinais. Por padrão, todas estão habilitadas para máxima segurança.
          </div>
          
          {/* Sinais de Entrada */}
          <div className="border rounded-lg p-4">
            <h4 className="font-medium mb-3">Sinais de Entrada</h4>
            <p className="text-xs text-muted-foreground mb-4 bg-blue-50 p-2 rounded">
              ℹ️ <strong>Ordem de Prioridade:</strong> O bot testa os indicadores nesta ordem exata. Quando um indicador gera sinal, os demais são ignorados. Use todos habilitados para máxima cobertura de oportunidades.
            </p>
            <div className="space-y-3">
              
              {/* 1. Momentum - PRIORIDADE MÁXIMA */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="enableMomentumSignals" className="font-medium">🥇 Sinais de Momentum (WaveTrend)</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">WaveTrend é o indicador PRINCIPAL do bot. Mede a velocidade e direção dos movimentos de preço identificando quando o momentum está mudando - como um "velocímetro" do mercado. Tem a maior prioridade na decisão de entrada.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    🏆 Indicador principal - Detecta mudanças de momentum com alta precisão
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="enableMomentumSignals"
                    checked={formData.enableMomentumSignals}
                    onChange={(e) => handleInputChange('enableMomentumSignals', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 focus:ring-offset-2 transition-colors"
                  />
                </div>
              </div>
              
              {/* 2. RSI - ALTA PRIORIDADE */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="enableRsiSignals" className="font-medium">🥈 Sinais de Reversão (RSI)</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">RSI detecta reversões de preço com alta precisão. Opera apenas quando RSI está em região extrema (&gt;70 sobrecomprado ou &lt;30 sobrevendido) E cruza sua média, confirmando mudança de direção. Prioridade alta após o Momentum.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    ⚡ Alta precisão - Só opera com cruzamento da média em regiões extremas
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="enableRsiSignals"
                    checked={formData.enableRsiSignals}
                    onChange={(e) => handleInputChange('enableRsiSignals', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 focus:ring-offset-2 transition-colors"
                  />
                </div>
              </div>
              
              {/* 3. Stochastic - MÉDIA PRIORIDADE */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="enableStochasticSignals" className="font-medium">🥉 Sinais de Extremos (Slow Stochastic)</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">Stochastic é como um "termômetro" que detecta zonas extremas. Opera quando K e D estão em região extrema (&gt;80 ou &lt;20) E há cruzamento entre eles, indicando possível reversão. Terceira prioridade no sistema.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    📊 Complementar - Detecta extremos com cruzamento K/D
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="enableStochasticSignals"
                    checked={formData.enableStochasticSignals}
                    onChange={(e) => handleInputChange('enableStochasticSignals', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 focus:ring-offset-2 transition-colors"
                  />
                </div>
              </div>
              
              {/* 4. MACD - MÉDIA-BAIXA PRIORIDADE */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="enableMacdSignals" className="font-medium">🏅 Sinais de Tendência (MACD)</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">MACD detecta mudanças de tendência através do cruzamento de médias móveis. Analisa o histograma para identificar momentum crescente ou decrescente. Quarta prioridade - usado quando os indicadores principais não geram sinais.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    📈 Confirmação - Detecta mudanças de tendência e momentum
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="enableMacdSignals"
                    checked={formData.enableMacdSignals}
                    onChange={(e) => handleInputChange('enableMacdSignals', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 focus:ring-offset-2 transition-colors"
                  />
                </div>
              </div>
              
              {/* 5. ADX - BAIXA PRIORIDADE */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="enableAdxSignals" className="font-medium">🎖️ Sinais de Força (ADX)</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">ADX mede a força da tendência, não a direção. Opera apenas quando ADX &gt; 25 (tendência forte) e D+ vs D- indica direção. Quinta prioridade - usado como último recurso quando outros indicadores estão neutros.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    🔍 Último recurso - Opera apenas em tendências muito fortes
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="enableAdxSignals"
                    checked={formData.enableAdxSignals}
                    onChange={(e) => handleInputChange('enableAdxSignals', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 focus:ring-offset-2 transition-colors"
                  />
                </div>
              </div>
            </div>
          </div>
          
          {/* Filtros de Confirmação */}
          <div className="border rounded-lg p-4">
            <h4 className="font-medium mb-3">Filtros de Confirmação</h4>
            <div className="space-y-3">
              
              {/* Money Flow */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="enableMoneyFlowFilter" className="font-medium">Filtro de Fluxo de Dinheiro</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">MFI (Money Flow Index) é como um "detector de movimento de dinheiro" que combina preço e volume. Ele mostra se o dinheiro está realmente entrando (compradores ativos) ou saindo (vendedores ativos) do ativo. É como contar quantas pessoas estão entrando e saindo de uma loja, não apenas olhando o preço.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Confirma se há dinheiro entrando/saindo do ativo
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="enableMoneyFlowFilter"
                    checked={formData.enableMoneyFlowFilter}
                    onChange={(e) => handleInputChange('enableMoneyFlowFilter', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 focus:ring-offset-2 transition-colors"
                  />
                </div>
              </div>
              
              {/* VWAP */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="enableVwapFilter" className="font-medium">Filtro de Preço Médio do Dia</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">VWAP (Volume Weighted Average Price) é o "preço médio verdadeiro" do dia, calculado considerando o volume de cada negociação. É como calcular o preço médio de todas as vendas de um produto, dando mais peso às vendas maiores. Ajuda a identificar se o preço atual está caro ou barato em relação ao dia.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Confirma se o preço está acima/abaixo da média do dia
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="enableVwapFilter"
                    checked={formData.enableVwapFilter}
                    onChange={(e) => handleInputChange('enableVwapFilter', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 focus:ring-offset-2 transition-colors"
                  />
                </div>
              </div>
              
              {/* BTC Trend */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="enableBtcTrendFilter" className="font-medium">Filtro de Tendência do Bitcoin</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">Bitcoin é o "rei" das criptomoedas e geralmente influencia todo o mercado. Quando Bitcoin sobe, a maioria das altcoins também sobem, e vice-versa. Este filtro garante que o bot só faça operações em altcoins quando a direção do Bitcoin está alinhada, evitando "nadar contra a correnteza" do mercado.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Só opera altcoins quando Bitcoin está favorável
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="enableBtcTrendFilter"
                    checked={formData.enableBtcTrendFilter}
                    onChange={(e) => handleInputChange('enableBtcTrendFilter', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 focus:ring-offset-2 transition-colors"
                  />
                </div>
              </div>

              {/* Heikin Ashi */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="enableHeikinAshi" className="font-medium">Filtro de Mudança de Tendência (Heikin Ashi)</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">Heikin Ashi é como um "filtro visual" que suaviza os movimentos do preço, tornando mais fácil identificar a verdadeira direção da tendência. É como ver o mercado através de óculos especiais que removem o "ruído". O bot só abrirá posições quando detectar uma mudança clara de tendência (de velas vermelhas para verdes, ou vice-versa), evitando entrar no meio de um movimento.</p>
                          <p className="max-w-xs mt-2 text-yellow-600 font-medium">⚠️ IMPORTANTE: Quando habilitado, o bot automaticamente usará modo ON_CANDLE_CLOSE e filtrará velas não fechadas para garantir decisões precisas.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Só opera quando há mudança clara de tendência nas velas
                  </p>
                  {formData.enableHeikinAshi && (
                    <p className="text-xs text-yellow-600 font-medium mt-1">
                      ⚠️ Modo ON_CANDLE_CLOSE + filtro de velas fechadas aplicado automaticamente
                    </p>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="enableHeikinAshi"
                    checked={formData.enableHeikinAshi}
                    onChange={(e) => handleInputChange('enableHeikinAshi', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 focus:ring-offset-2 transition-colors"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 🎯 CONFLUÊNCIA DE SINAIS - NOVA FUNCIONALIDADE DESTACADA */}
          <div className="border-2 border-yellow-300 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg p-4 shadow-md">
            <div className="flex items-center gap-2 mb-3">
              <div className="bg-yellow-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold">
                ⚡
              </div>
              <h4 className="font-bold text-lg text-gray-800">Confluência de Sinais</h4>
              <span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-1 rounded-full">
                NOVO!
              </span>
            </div>
            
            <div className="bg-white rounded-md p-3 mb-4 border border-yellow-200">
              <p className="text-sm text-gray-700 mb-2">
                <strong>🚀 Revolucione seu trading!</strong> Ao invés de usar apenas 1 indicador por vez, 
                a confluência combina múltiplos indicadores para sinais mais precisos e seguros.
              </p>
              <p className="text-xs text-gray-600">
                💡 <strong>Exemplo:</strong> Momentum + RSI concordando = Sinal muito mais confiável que apenas Momentum sozinho
              </p>
            </div>

            <div className="space-y-4">
              {/* Toggle Principal */}
              <div className="flex items-center justify-between p-3 bg-white rounded-md border border-gray-200">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="enableConfluenceMode" className="font-medium text-gray-800">
                      🎯 Habilitar Confluência de Sinais
                    </Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-gray-500 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-sm">
                            <strong>Modo Atual (sem confluência):</strong> Bot usa o primeiro indicador que der sinal<br/><br/>
                            <strong>Modo Confluência:</strong> Bot exige que pelo menos 2+ indicadores concordem antes de abrir posição. 
                            Muito mais seguro, mas pode ter menos sinais.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    {formData.enableConfluenceMode 
                      ? "✅ Ativo - Exige concordância entre indicadores" 
                      : "❌ Desativo - Usa prioridade individual (padrão atual)"
                    }
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="enableConfluenceMode"
                    checked={formData.enableConfluenceMode}
                    onChange={(e) => handleInputChange('enableConfluenceMode', e.target.checked)}
                    className="w-5 h-5 rounded border-gray-300 text-yellow-600 focus:ring-yellow-500 focus:ring-2 focus:ring-offset-2 transition-colors"
                  />
                </div>
              </div>

              {/* Configuração do Mínimo de Confluências */}
              {formData.enableConfluenceMode && (
                <div className="p-3 bg-white rounded-md border border-gray-200 ml-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Label htmlFor="minConfluences" className="font-medium text-gray-700">
                      📊 Mínimo de Indicadores Concordando
                    </Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-gray-500 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-sm">
                            <strong>2 indicadores:</strong> Mais sinais, menos filtros<br/>
                            <strong>3+ indicadores:</strong> Menos sinais, mas muito mais seguros<br/><br/>
                            <em>Recomendação: Comece com 2 para testar</em>
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      id="minConfluences"
                      min="2"
                      max="5"
                      step="1"
                      value={formData.minConfluences}
                      onChange={(e) => handleInputChange('minConfluences', parseInt(e.target.value))}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-thumb"
                    />
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-lg font-bold text-yellow-600">
                        {formData.minConfluences}
                      </span>
                      <span className="text-sm text-gray-600">
                        {formData.minConfluences === 2 && "Balanceado"}
                        {formData.minConfluences === 3 && "Conservador"}
                        {formData.minConfluences === 4 && "Muito Seguro"}
                        {formData.minConfluences === 5 && "Ultra Seguro"}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    ⚖️ Quanto maior o número, mais seguros mas menos frequentes serão os sinais
                  </p>
                </div>
              )}

              {!formData.enableConfluenceMode && (
                <div className="p-3 bg-gray-50 rounded-md border border-gray-200 ml-4">
                  <p className="text-sm text-gray-600">
                    💡 <strong>Dica:</strong> Habilite a confluência para sinais mais seguros. 
                    O sistema atual usa prioridade: primeiro indicador que der sinal é executado.
                  </p>
                </div>
              )}
            </div>
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
                    <p className="max-w-xs">
                      <strong>🔥 Modo VOLUME - Farming otimizado:</strong><br/>
                      • Stop Loss: -3% (era -10%)<br/>  
                      • Lucro Mínimo: +3% (era +10%)<br/>
                      • Todos indicadores habilitados<br/>
                      • Heikin Ashi e Confluência desabilitados<br/>
                      <em>Ideal para gerar muito volume com trades frequentes!</em>
                    </p>
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
                    <p className="max-w-xs">
                      <strong>💎 Modo LUCRO - Configuração profissional:</strong><br/>
                      • Stop Loss: -10% (seguro)<br/>
                      • Lucro Mínimo: +10% (conservador)<br/>
                      • Trailing Distance: 1% (otimizado)<br/>
                      • Fechamento Parcial: 30%<br/>
                      • Todos indicadores habilitados<br/>
                      • ✅ Heikin Ashi ativo<br/>
                      • ✅ Confluência ativa (2+ indicadores)<br/>
                      <em>Configuração ultra segura para lucros máximos!</em>
                    </p>
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
              <div className="flex items-center justify-between">
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
                <span className="text-sm text-muted-foreground">Max: 100%</span>
              </div>
              
              {/* Input numérico com botões +/- */}
              <div className="relative">
                <div className="flex items-center border border-input rounded-md bg-background">
                  <button
                    type="button"
                    onClick={() => {
                      const currentValue = parseFloat(String(formData.capitalPercentage)) || 20;
                      const newValue = Math.max(1, currentValue - 1);
                      handleInputChange('capitalPercentage', newValue.toString());
                    }}
                    className="px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    -
                  </button>
              <Input
                id="capitalPercentage"
                    type="text"
                value={formData.capitalPercentage}
                    onChange={(e) => handleInputChange('capitalPercentage', e.target.value)}
                    className={`border-0 text-center focus-visible:ring-0 ${errors.capitalPercentage ? "text-red-500" : ""}`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const currentValue = parseFloat(String(formData.capitalPercentage)) || 20;
                      const newValue = Math.min(100, currentValue + 1);
                      handleInputChange('capitalPercentage', newValue.toString());
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
                    value={parseFloat(String(formData.capitalPercentage)) || 20}
                    onChange={(e) => handleInputChange('capitalPercentage', e.target.value)}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                    style={{
                      background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((parseFloat(String(formData.capitalPercentage)) || 20) - 1) / 99 * 100}%, #e5e7eb ${((parseFloat(String(formData.capitalPercentage)) || 20) - 1) / 99 * 100}%, #e5e7eb 100%)`
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

            {/* TODO: Implementar alavancagem da conta - Removido temporariamente
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label htmlFor="leverageLimit">Alavancagem da Conta</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">A alavancagem da sua conta na Backpack. Determina quanto capital você pode usar para trades. Ex: 10x = $1000 pode fazer trades de $10.000. Recomendado: 5-20x para começar.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <span className="text-sm text-muted-foreground">Max: 50</span>
              </div>
              
              <div className="relative">
                <div className="flex items-center border border-input rounded-md bg-background">
                  <button
                    type="button"
                    onClick={() => {
                      const currentValue = parseFloat(String(formData.leverageLimit)) || 10;
                      const newValue = Math.max(1, currentValue - 1);
                      handleInputChange('leverageLimit', newValue.toString());
                    }}
                    className="px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    -
                  </button>
                  <Input
                    id="leverageLimit"
                    type="text"
                    value={formData.leverageLimit}
                    onChange={(e) => handleInputChange('leverageLimit', e.target.value)}
                    className={`border-0 text-center focus-visible:ring-0 ${errors.leverageLimit ? "text-red-500" : ""}`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const currentValue = parseFloat(String(formData.leverageLimit)) || 10;
                      const newValue = Math.min(50, currentValue + 1);
                      handleInputChange('leverageLimit', newValue.toString());
                    }}
                    className="px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="relative">
                  <input
                    type="range"
                    min="1"
                    max="50"
                    value={parseFloat(String(formData.leverageLimit)) || 10}
                    onChange={(e) => handleInputChange('leverageLimit', e.target.value)}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                    style={{
                      background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((parseFloat(String(formData.leverageLimit)) || 10) - 1) / 49 * 100}%, #e5e7eb ${((parseFloat(String(formData.leverageLimit)) || 10) - 1) / 49 * 100}%, #e5e7eb 100%)`
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1x</span>
                  <span>50x</span>
                </div>
              </div>
              
              {errors.leverageLimit && <p className="text-sm text-red-500">{errors.leverageLimit}</p>}
            </div>
            */}

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
              <CustomSelect
                id="time"
                value={formData.time}
                onChange={(value) => handleInputChange('time', value)}
                options={[
                  { value: '5m', label: '5 minutos' },
                  { value: '15m', label: '15 minutos' },
                  { value: '30m', label: '30 minutos' },
                  { value: '1h', label: '1 hora' },
                  { value: '2h', label: '2 horas' },
                  { value: '3h', label: '3 horas' },
                  { value: '4h', label: '4 horas' },
                  { value: '1d', label: '1 dia' }
                ]}
                placeholder="Selecione o timeframe"
                isOpen={timeDropdownOpen}
                onToggle={() => setTimeDropdownOpen(!timeDropdownOpen)}
                error={errors.time}
              />
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
              <CustomSelect
                id="executionMode"
                value={formData.executionMode}
                onChange={(value) => handleInputChange('executionMode', value)}
                options={[
                  { value: 'REALTIME', label: 'REALTIME (60 segundos)' },
                  { value: 'ON_CANDLE_CLOSE', label: 'ON_CANDLE_CLOSE (fechamento de vela)' }
                ]}
                placeholder="Selecione o modo de execução"
                isOpen={executionModeDropdownOpen}
                onToggle={() => setExecutionModeDropdownOpen(!executionModeDropdownOpen)}
                error={errors.executionMode}
                disabled={formData.enableHeikinAshi}
              />
              {errors.executionMode && <p className="text-sm text-red-500">{errors.executionMode}</p>}
              {formData.enableHeikinAshi && (
                <p className="text-xs text-blue-600 font-medium">
                  ⚠️ Modo automaticamente definido como ON_CANDLE_CLOSE (Heikin Ashi ativo)
                </p>
              )}
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
                type="text"
                placeholder="Ex: -0.5, -1, -10"
                value={formData.maxNegativePnlStopPct}
                onChange={(e) => handleInputChange('maxNegativePnlStopPct', e.target.value)}
                className={errors.maxNegativePnlStopPct ? "border-red-500" : ""}
              />
              {errors.maxNegativePnlStopPct && <p className="text-sm text-red-500">{errors.maxNegativePnlStopPct}</p>}
            </div>

            <div className={`space-y-2 ${formData.enableTrailingStop ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2">
                <Label htmlFor="minProfitPercentage" className={formData.enableTrailingStop ? 'text-muted-foreground' : ''}>
                  Lucro Mínimo (%)
                  {formData.enableTrailingStop && (
                    <span className="text-xs text-orange-600 dark:text-orange-400 ml-1">(Desabilitado - Trailing Stop Ativo)</span>
                  )}
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className={`h-4 w-4 ${formData.enableTrailingStop ? 'text-muted-foreground/50' : 'text-muted-foreground'} cursor-help`} />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        {formData.enableTrailingStop ? (
                          <span>
                            <strong>⚠️ Trailing Stop Ativo:</strong> O lucro mínimo é controlado automaticamente pelo Trailing Stop. Esta configuração não é usada quando o Trailing Stop está habilitado.
                          </span>
                        ) : (
                          "O lucro mínimo necessário para fechar uma posição automaticamente. Para farming de volume, use valores baixos (0.1-1%). Para trading tradicional, use valores maiores (2-10%)."
                        )}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id="minProfitPercentage"
                type="text"
                placeholder="Ex: 10"
                value={formData.minProfitPercentage}
                onChange={(e) => handleInputChange('minProfitPercentage', e.target.value)}
                disabled={formData.enableTrailingStop}
                className={`${errors.minProfitPercentage ? "border-red-500" : ""} ${formData.enableTrailingStop ? 'bg-muted cursor-not-allowed' : ''}`}
              />
              {formData.enableTrailingStop && (
                <div className="p-2 bg-orange-50 border border-orange-200 rounded-lg dark:bg-orange-950/20 dark:border-orange-800">
                  <p className="text-xs text-orange-700 dark:text-orange-300">
                    <strong>ℹ️ Info:</strong> Com Trailing Stop ativo, o lucro é controlado automaticamente pela distância configurada no trailing. O valor acima é mantido para referência, mas não será usado.
                  </p>
                </div>
              )}
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
                type="text"
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
                type="text"
                placeholder="Ex: 5"
                value={formData.maxOpenOrders}
                onChange={(e) => handleInputChange('maxOpenOrders', e.target.value)}
                className={errors.maxOpenOrders ? "border-red-500" : ""}
              />
              {errors.maxOpenOrders && <p className="text-sm text-red-500">{errors.maxOpenOrders}</p>}
            </div>
          </div>
        </div>

        {/* Configurações Avançadas */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Configurações Avançadas</h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Estratégia Híbrida de Stop Loss */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                <Label htmlFor="enableHybridStopStrategy">Estratégia Híbrida de Stop Loss</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                      <p className="max-w-xs">Usa ATR (Average True Range) para calcular stop loss dinamicamente baseado na volatilidade do mercado. Mais preciso que stop loss fixo.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="enableHybridStopStrategy"
                  checked={formData.enableHybridStopStrategy}
                  onChange={(e) => handleInputChange('enableHybridStopStrategy', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 focus:ring-offset-2 transition-colors"
                />
                <Label htmlFor="enableHybridStopStrategy" className="text-sm font-medium cursor-pointer">
                  Habilitar Estratégia Híbrida
                </Label>
              </div>
              </div>

            {/* Trailing Stop */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                <Label htmlFor="enableTrailingStop">Trailing Stop</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                      <p className="max-w-xs">Stop loss que se move automaticamente para proteger lucros. Acompanha o preço quando está em lucro.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="enableTrailingStop"
                  checked={formData.enableTrailingStop}
                  onChange={(e) => handleInputChange('enableTrailingStop', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 focus:ring-offset-2 transition-colors"
                />
                <Label htmlFor="enableTrailingStop" className="text-sm font-medium cursor-pointer">
                  Habilitar Trailing Stop
                </Label>
              </div>
              </div>

            {/* Fechamento Parcial da Posição */}
            <div className={`space-y-2 ${!formData.enableHybridStopStrategy ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-2">
                <Label htmlFor="partialTakeProfitAtrMultiplier" className={!formData.enableHybridStopStrategy ? 'text-muted-foreground' : ''}>
                  Fechamento Parcial da Posição (ATR)
                </Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                      <HelpCircle className={`h-4 w-4 ${!formData.enableHybridStopStrategy ? 'text-muted-foreground/50' : 'text-muted-foreground'} cursor-help`} />
                        </TooltipTrigger>
                        <TooltipContent>
                      <p className="max-w-xs">Multiplicador do ATR para calcular quando fechar parte da posição automaticamente. Fecha uma parte quando atinge este valor de lucro.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Input
                    id="partialTakeProfitAtrMultiplier"
                type="text"
                placeholder="Ex: 3.0"
                    value={formData.partialTakeProfitAtrMultiplier}
                onChange={(e) => handleInputChange('partialTakeProfitAtrMultiplier', e.target.value)}
                disabled={!formData.enableHybridStopStrategy}
                className={`${errors.partialTakeProfitAtrMultiplier ? "border-red-500" : ""} ${!formData.enableHybridStopStrategy ? 'bg-muted cursor-not-allowed' : ''}`}
                  />
              {errors.partialTakeProfitAtrMultiplier && <p className="text-sm text-red-500">{errors.partialTakeProfitAtrMultiplier}</p>}
                </div>

            {/* Quantidade a Fechar */}
            <div className={`space-y-2 ${!formData.enableHybridStopStrategy ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-2">
                <Label htmlFor="partialTakeProfitPercentage" className={!formData.enableHybridStopStrategy ? 'text-muted-foreground' : ''}>
                  Quantidade a Fechar (%)
                </Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                      <HelpCircle className={`h-4 w-4 ${!formData.enableHybridStopStrategy ? 'text-muted-foreground/50' : 'text-muted-foreground'} cursor-help`} />
                        </TooltipTrigger>
                        <TooltipContent>
                      <p className="max-w-xs">Percentual da posição que será fechada automaticamente. Ex: 50% = fecha metade da posição quando atingir o lucro definido.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Input
                    id="partialTakeProfitPercentage"
                type="text"
                placeholder="Ex: 50"
                    value={formData.partialTakeProfitPercentage}
                onChange={(e) => handleInputChange('partialTakeProfitPercentage', e.target.value)}
                disabled={!formData.enableHybridStopStrategy}
                className={`${errors.partialTakeProfitPercentage ? "border-red-500" : ""} ${!formData.enableHybridStopStrategy ? 'bg-muted cursor-not-allowed' : ''}`}
              />
              {errors.partialTakeProfitPercentage && <p className="text-sm text-red-500">{errors.partialTakeProfitPercentage}</p>}
        </div>

            {/* Stop Loss Inicial */}
            <div className={`space-y-2 ${!formData.enableHybridStopStrategy ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2">
                <Label htmlFor="initialStopAtrMultiplier" className={!formData.enableHybridStopStrategy ? 'text-muted-foreground' : ''}>
                  Stop Loss Inicial (ATR)
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className={`h-4 w-4 ${!formData.enableHybridStopStrategy ? 'text-muted-foreground/50' : 'text-muted-foreground'} cursor-help`} />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Multiplicador do ATR para calcular o stop loss inicial. Valores maiores = stop loss mais distante do preço de entrada.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
            </div>
              <Input
                id="initialStopAtrMultiplier"
                type="text"
                placeholder="Ex: 2.0"
                value={formData.initialStopAtrMultiplier}
                onChange={(e) => handleInputChange('initialStopAtrMultiplier', e.target.value)}
                disabled={!formData.enableHybridStopStrategy}
                className={`${errors.initialStopAtrMultiplier ? "border-red-500" : ""} ${!formData.enableHybridStopStrategy ? 'bg-muted cursor-not-allowed' : ''}`}
              />
              {errors.initialStopAtrMultiplier && <p className="text-sm text-red-500">{errors.initialStopAtrMultiplier}</p>}
          </div>
          
            {/* Distância do Trailing Stop */}
            <div className={`space-y-2 ${!formData.enableTrailingStop ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2">
                <Label htmlFor="trailingStopDistance" className={!formData.enableTrailingStop ? 'text-muted-foreground' : ''}>
                  Distância do Trailing (ATR)
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className={`h-4 w-4 ${!formData.enableTrailingStop ? 'text-muted-foreground/50' : 'text-muted-foreground'} cursor-help`} />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Distância em ATR que o trailing stop mantém do preço atual. Valores menores = trailing mais próximo do preço.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id="trailingStopDistance"
                type="text"
                placeholder="Ex: 1.5"
                value={formData.trailingStopDistance}
                onChange={(e) => handleInputChange('trailingStopDistance', e.target.value)}
                disabled={!formData.enableTrailingStop}
                className={`${errors.trailingStopDistance ? "border-red-500" : ""} ${!formData.enableTrailingStop ? 'bg-muted cursor-not-allowed' : ''}`}
              />
              {errors.trailingStopDistance && <p className="text-sm text-red-500">{errors.trailingStopDistance}</p>}
                </div>

            {/* Multiplicador ATR do Trailing Stop */}
            <div className={`space-y-2 ${!formData.enableTrailingStop ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2">
                <Label htmlFor="trailingStopAtrMultiplier" className={!formData.enableTrailingStop ? 'text-muted-foreground' : ''}>
                  Multiplicador do Trailing (ATR)
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className={`h-4 w-4 ${!formData.enableTrailingStop ? 'text-muted-foreground/50' : 'text-muted-foreground'} cursor-help`} />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Multiplicador do ATR para calcular o trailing stop. Valores menores = trailing mais próximo do preço atual.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id="trailingStopAtrMultiplier"
                type="text"
                placeholder="Ex: 1.5"
                value={formData.trailingStopAtrMultiplier}
                onChange={(e) => handleInputChange('trailingStopAtrMultiplier', e.target.value)}
                disabled={!formData.enableTrailingStop}
                className={`${errors.trailingStopAtrMultiplier ? "border-red-500" : ""} ${!formData.enableTrailingStop ? 'bg-muted cursor-not-allowed' : ''}`}
              />
              {errors.trailingStopAtrMultiplier && <p className="text-sm text-red-500">{errors.trailingStopAtrMultiplier}</p>}
            </div>
          </div>
        </div>

        {/* Configurações HFT */}
        {formData.strategyName === 'HFT' && (
          <div className="space-y-4 border-t pt-4">
            <h3 className="text-lg font-medium text-orange-700">Configurações HFT (High-Frequency Trading)</h3>
            <div className="text-sm text-muted-foreground mb-4">
              Configure os parâmetros específicos para negociação de alta frequência focada em airdrop e volume.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* HFT Spread */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="hftSpread">Spread HFT (%)</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">Distância percentual entre ordens de compra e venda no grid. Spreads menores = mais execuções mas menor lucro por trade.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Input
                  id="hftSpread"
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  max="0.05"
                  placeholder="0.001"
                  value={formData.hftSpread || 0.001}
                  onChange={(e) => handleInputChange('hftSpread', parseFloat(e.target.value))}
                  className={errors.hftSpread ? "border-red-500" : ""}
                />
                {errors.hftSpread && <p className="text-sm text-red-500">{errors.hftSpread}</p>}
              </div>

              {/* Meta de Volume Diário */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="hftDailyVolumeGoal">Meta Volume Diário ($)</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">Volume diário alvo em USD para maximizar pontos de airdrop. O bot ajustará a frequência de trades para atingir esta meta.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Input
                  id="hftDailyVolumeGoal"
                  type="number"
                  min="100"
                  step="100"
                  placeholder="10000"
                  value={formData.hftDailyVolumeGoal || 10000}
                  onChange={(e) => handleInputChange('hftDailyVolumeGoal', parseFloat(e.target.value))}
                  className={errors.hftDailyVolumeGoal ? "border-red-500" : ""}
                />
                {errors.hftDailyVolumeGoal && <p className="text-sm text-red-500">{errors.hftDailyVolumeGoal}</p>}
              </div>

              {/* Multiplicador de Quantidade */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="hftQuantityMultiplier">Multiplicador de Quantidade</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">Percentual da quantidade normal a ser usado nas ordens HFT. Valores menores = mais ordens, menos exposição por ordem.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Input
                  id="hftQuantityMultiplier"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="1"
                  placeholder="0.1"
                  value={formData.hftQuantityMultiplier || 0.1}
                  onChange={(e) => handleInputChange('hftQuantityMultiplier', parseFloat(e.target.value))}
                  className={errors.hftQuantityMultiplier ? "border-red-500" : ""}
                />
                {errors.hftQuantityMultiplier && <p className="text-sm text-red-500">{errors.hftQuantityMultiplier}</p>}
              </div>

              {/* Símbolos HFT */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="hftSymbols">Símbolos para HFT</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">Lista de símbolos separados por vírgula para negociação HFT. Foque em pares com taxas maker baixas.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Input
                  id="hftSymbols"
                  type="text"
                  placeholder="SOL_USDC_PERP,BTC_USDC_PERP,ETH_USDC_PERP"
                  value={formData.hftSymbols?.join(',') || 'SOL_USDC_PERP,BTC_USDC_PERP,ETH_USDC_PERP'}
                  // @ts-ignore
                  onChange={(e) => handleInputChange('hftSymbols', e.target.value.split(',').map(s => s.trim()).filter(s => s))}
                  className={errors.hftSymbols ? "border-red-500" : ""}
                />
                {errors.hftSymbols && <p className="text-sm text-red-500">{errors.hftSymbols}</p>}
              </div>
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <div className="text-orange-600 mt-0.5">⚠️</div>
                <div className="text-sm text-orange-700">
                  <strong>Aviso:</strong> O modo HFT é experimental e focado em airdrop. Use apenas com capital que pode perder.
                  Os indicadores técnicos tradicionais são desabilitados neste modo.
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex gap-2">
        <Button 
          onClick={handleSave} 
          disabled={saving || (isEditMode ? (apiKeysChanged && !apiKeysValidated) : !apiKeysValidated)}
          className={`flex items-center gap-2 transition-all duration-300 ${
            saving 
              ? 'bg-blue-600 hover:bg-blue-700 shadow-lg scale-105 animate-pulse text-white' 
              : ''
          }`}
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              <span className="animate-pulse">Salvando...</span>
              <div className="flex space-x-1 ml-2">
                <div className="w-1 h-1 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-1 h-1 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-1 h-1 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
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
        <Button 
          variant="outline" 
          onClick={onCancel} 
          disabled={saving} 
          className={`flex items-center gap-2 transition-all duration-300 ${
            saving ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          <X className="h-4 w-4" />
          Cancelar
        </Button>
      </CardFooter>
    </Card>
  );
};
