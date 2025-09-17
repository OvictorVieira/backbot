import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Checkbox } from './ui/checkbox'
import { Textarea } from './ui/textarea'
import { AlertCircle, Info, Zap, DollarSign, Target, Clock } from 'lucide-react'
import { Alert, AlertDescription } from './ui/alert'

interface HFTBotConfig {
  id?: number
  botName: string
  apiKey: string
  apiSecret: string
  strategyName: 'HFT'
  // HFT specific configs
  hftSpread: number // em %
  hftDailyVolumeGoal: number // em USD
  hftSymbols: string[]
  capitalPercentage: number
  hftQuantityMultiplier: number
  leverage: number
  enabled: boolean
}

interface HFTConfigFormProps {
  config?: HFTBotConfig
  onSave: (config: HFTBotConfig) => void
  onCancel: () => void
  isEditMode: boolean
}

const DEFAULT_HFT_SYMBOLS = ['SOL_USDC_PERP', 'BTC_USDC_PERP', 'ETH_USDC_PERP']
const AVAILABLE_SYMBOLS = [
  'BTC_USDC_PERP',
  'ETH_USDC_PERP',
  'SOL_USDC_PERP',
  'AVAX_USDC_PERP',
  'MATIC_USDC_PERP',
  'LINK_USDC_PERP',
  'DOT_USDC_PERP',
  'ADA_USDC_PERP'
]

export function HFTConfigForm({ config, onSave, onCancel, isEditMode }: HFTConfigFormProps) {
  const [formData, setFormData] = useState<HFTBotConfig>({
    botName: config?.botName || '',
    apiKey: config?.apiKey || '',
    apiSecret: config?.apiSecret || '',
    strategyName: 'HFT',
    hftSpread: config?.hftSpread || 0.1, // 0.1% default
    hftDailyVolumeGoal: config?.hftDailyVolumeGoal || 10000, // $10k default
    hftSymbols: config?.hftSymbols || DEFAULT_HFT_SYMBOLS,
    capitalPercentage: config?.capitalPercentage || 5, // 5% para HFT
    hftQuantityMultiplier: config?.hftQuantityMultiplier || 0.1, // 10% do normal
    leverage: config?.leverage || 1, // Sem alavancagem por padrão
    enabled: config?.enabled ?? true,
    ...(config?.id && { id: config.id })
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

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

    if (formData.hftSpread <= 0 || formData.hftSpread > 5) {
      newErrors.hftSpread = 'Spread deve estar entre 0.01% e 5%'
    }

    if (formData.hftDailyVolumeGoal <= 0) {
      newErrors.hftDailyVolumeGoal = 'Meta de volume deve ser maior que 0'
    }

    if (formData.capitalPercentage <= 0 || formData.capitalPercentage > 20) {
      newErrors.capitalPercentage = 'Capital deve estar entre 0.1% e 20%'
    }

    if (formData.hftSymbols.length === 0) {
      newErrors.hftSymbols = 'Selecione pelo menos um símbolo'
    }

    setErrors(newErrors)

    if (Object.keys(newErrors).length === 0) {
      onSave(formData)
    }
  }

  const handleSymbolToggle = (symbol: string) => {
    setFormData(prev => ({
      ...prev,
      hftSymbols: prev.hftSymbols.includes(symbol)
        ? prev.hftSymbols.filter(s => s !== symbol)
        : [...prev.hftSymbols, symbol]
    }))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
          <Zap className="h-5 w-5 text-orange-600 dark:text-orange-400" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">
            {isEditMode ? 'Editar Bot HFT' : 'Criar Bot HFT (Volume)'}
          </h2>
          <p className="text-sm text-muted-foreground">
            Configuração especializada para geração de volume de trading
          </p>
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>Bot HFT:</strong> Focado em gerar alto volume com operações de baixo risco para
          qualificação em airdrops. Usa spreads pequenos e executa muitas operações.
        </AlertDescription>
      </Alert>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Configurações Básicas */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Target className="h-5 w-5" />
              Configurações Básicas
            </CardTitle>
            <CardDescription>
              Informações básicas e credenciais de API
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="botName">Nome do Bot</Label>
              <Input
                id="botName"
                value={formData.botName}
                onChange={(e) => setFormData(prev => ({ ...prev, botName: e.target.value }))}
                placeholder="Ex: HFT Bot Airdrop SOL"
                className={errors.botName ? 'border-red-500' : ''}
              />
              {errors.botName && <p className="text-sm text-red-500 mt-1">{errors.botName}</p>}
            </div>

            <div>
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder="Sua API Key da Backpack"
                className={errors.apiKey ? 'border-red-500' : ''}
              />
              {errors.apiKey && <p className="text-sm text-red-500 mt-1">{errors.apiKey}</p>}
            </div>

            <div>
              <Label htmlFor="apiSecret">API Secret</Label>
              <Input
                id="apiSecret"
                type="password"
                value={formData.apiSecret}
                onChange={(e) => setFormData(prev => ({ ...prev, apiSecret: e.target.value }))}
                placeholder="Seu API Secret da Backpack"
                className={errors.apiSecret ? 'border-red-500' : ''}
              />
              {errors.apiSecret && <p className="text-sm text-red-500 mt-1">{errors.apiSecret}</p>}
            </div>
          </CardContent>
        </Card>

        {/* Configurações HFT */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Zap className="h-5 w-5" />
              Configurações HFT
            </CardTitle>
            <CardDescription>
              Parâmetros específicos para trading de alta frequência
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="hftSpread">Spread (%)</Label>
                <Input
                  id="hftSpread"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="5"
                  value={formData.hftSpread}
                  onChange={(e) => setFormData(prev => ({ ...prev, hftSpread: parseFloat(e.target.value) || 0 }))}
                  className={errors.hftSpread ? 'border-red-500' : ''}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Diferença entre compra e venda (0.1% recomendado)
                </p>
                {errors.hftSpread && <p className="text-sm text-red-500">{errors.hftSpread}</p>}
              </div>

              <div>
                <Label htmlFor="capitalPercentage">Capital por Operação (%)</Label>
                <Input
                  id="capitalPercentage"
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="20"
                  value={formData.capitalPercentage}
                  onChange={(e) => setFormData(prev => ({ ...prev, capitalPercentage: parseFloat(e.target.value) || 0 }))}
                  className={errors.capitalPercentage ? 'border-red-500' : ''}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  % do capital total por operação (5% recomendado)
                </p>
                {errors.capitalPercentage && <p className="text-sm text-red-500">{errors.capitalPercentage}</p>}
              </div>
            </div>

            <div>
              <Label htmlFor="hftDailyVolumeGoal">Meta de Volume Diário (USD)</Label>
              <Input
                id="hftDailyVolumeGoal"
                type="number"
                min="100"
                value={formData.hftDailyVolumeGoal}
                onChange={(e) => setFormData(prev => ({ ...prev, hftDailyVolumeGoal: parseInt(e.target.value) || 0 }))}
                className={errors.hftDailyVolumeGoal ? 'border-red-500' : ''}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Volume total em USD que o bot deve gerar por dia
              </p>
              {errors.hftDailyVolumeGoal && <p className="text-sm text-red-500">{errors.hftDailyVolumeGoal}</p>}
            </div>
          </CardContent>
        </Card>

        {/* Seleção de Símbolos */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <DollarSign className="h-5 w-5" />
              Símbolos para Trading
            </CardTitle>
            <CardDescription>
              Selecione os pares de trading que o bot deve operar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {AVAILABLE_SYMBOLS.map((symbol) => (
                <div key={symbol} className="flex items-center space-x-2">
                  <Checkbox
                    id={symbol}
                    checked={formData.hftSymbols.includes(symbol)}
                    onCheckedChange={() => handleSymbolToggle(symbol)}
                  />
                  <Label htmlFor={symbol} className="text-sm font-medium">
                    {symbol.replace('_USDC_PERP', '')}
                  </Label>
                </div>
              ))}
            </div>
            {errors.hftSymbols && <p className="text-sm text-red-500 mt-2">{errors.hftSymbols}</p>}
            <p className="text-xs text-muted-foreground mt-2">
              Recomendamos começar com 2-3 símbolos de alta liquidez como BTC, ETH e SOL
            </p>
          </CardContent>
        </Card>

        {/* Configurações Avançadas */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5" />
              Configurações Avançadas
            </CardTitle>
            <CardDescription>
              Parâmetros adicionais para otimização
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="hftQuantityMultiplier">Multiplicador de Quantidade</Label>
                <Input
                  id="hftQuantityMultiplier"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="1"
                  value={formData.hftQuantityMultiplier}
                  onChange={(e) => setFormData(prev => ({ ...prev, hftQuantityMultiplier: parseFloat(e.target.value) || 0 }))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Fração da quantidade normal (0.1 = 10%)
                </p>
              </div>

              <div>
                <Label htmlFor="leverage">Alavancagem</Label>
                <Select
                  value={formData.leverage.toString()}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, leverage: parseInt(value) }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1x (Sem alavancagem)</SelectItem>
                    <SelectItem value="2">2x</SelectItem>
                    <SelectItem value="3">3x</SelectItem>
                    <SelectItem value="5">5x</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Alavancagem recomendada: 1x para maior segurança
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Warning sobre HFT */}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>⚠️ Importante:</strong> HFT bots executam operações automaticamente com alta frequência.
            Certifique-se de que suas configurações estão corretas e comece com valores baixos para testar.
          </AlertDescription>
        </Alert>

        {/* Botões */}
        <div className="flex gap-3 pt-4">
          <Button type="submit" className="flex-1 bg-orange-600 hover:bg-orange-700">
            {isEditMode ? 'Salvar Alterações' : 'Criar Bot HFT'}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  )
}