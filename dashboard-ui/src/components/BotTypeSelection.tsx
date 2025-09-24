import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Bot, Zap, TrendingUp, DollarSign, Clock, Target } from 'lucide-react'

interface BotTypeSelectionProps {
  isOpen: boolean
  onClose: () => void
  onSelectType: (type: 'DEFAULT' | 'HFT') => void
}

export function BotTypeSelection({ isOpen, onClose, onSelectType }: BotTypeSelectionProps) {
  const handleSelectDefault = () => {
    onSelectType('DEFAULT')
    onClose()
  }

  const handleSelectHFT = () => {
    onSelectType('HFT')
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Bot className="h-6 w-6" />
            Escolha o Tipo de Bot
          </DialogTitle>
          <DialogDescription>
            Selecione o tipo de bot que melhor atende às suas necessidades de trading
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4 mt-6">
          {/* Default Bot Card */}
          <Card className="cursor-pointer hover:shadow-lg transition-all duration-200 border-2 hover:border-primary/50 flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <CardTitle className="text-lg">Bot Tradicional</CardTitle>
                  <CardDescription className="text-sm">Análise técnica avançada</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col flex-1">
              <div className="flex-1 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Bot clássico que usa indicadores técnicos (RSI, MACD, Stochastic) para identificar
                  oportunidades de trading com base em análise de tendências e momentum.
                </p>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Target className="h-3 w-3 text-green-500" />
                    <span>Focado em precisão e qualidade dos sinais</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Clock className="h-3 w-3 text-blue-500" />
                    <span>Operações de médio prazo (minutos a horas)</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <DollarSign className="h-3 w-3 text-purple-500" />
                    <span>Ideal para maximizar lucros</span>
                  </div>
                </div>
              </div>

              <Button
                onClick={handleSelectDefault}
                className="w-full mt-4"
                variant="default"
              >
                Criar Bot Tradicional
              </Button>
            </CardContent>
          </Card>

          {/* HFT Bot Card */}
          <Card className="cursor-pointer hover:shadow-lg transition-all duration-200 border-2 hover:border-orange-500/50 flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
                  <Zap className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <CardTitle className="text-lg text-orange-700 dark:text-orange-300">
                    Bot HFT (Volume)
                  </CardTitle>
                  <CardDescription className="text-sm">Alta frequência para airdrops</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col flex-1">
              <div className="flex-1 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Bot de alta frequência especializado em gerar volume de trading para qualificação
                  em airdrops. Executa muitas operações pequenas com spreads mínimos.
                </p>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Zap className="h-3 w-3 text-orange-500" />
                    <span>Foco em volume e frequência</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Clock className="h-3 w-3 text-green-500" />
                    <span>Operações ultrarrápidas (segundos)</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Target className="h-3 w-3 text-blue-500" />
                    <span>Ideal para farming de airdrops</span>
                  </div>
                </div>

                <div className="bg-orange-50 dark:bg-orange-900/20 p-3 rounded-lg">
                  <p className="text-xs text-orange-700 dark:text-orange-300">
                    💡 <strong>Dica:</strong> Use este modo quando quiser gerar volume para se qualificar
                    em airdrops de exchanges e protocolos DeFi.
                  </p>
                </div>
              </div>

              <Button
                onClick={handleSelectHFT}
                className="w-full mt-4 bg-orange-600 hover:bg-orange-700 text-white"
                variant="default"
              >
                Criar Bot HFT
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 p-4 bg-muted/50 rounded-lg">
          <p className="text-xs text-muted-foreground text-center">
            💡 Você pode criar quantos bots quiser de cada tipo. Cada bot pode ter configurações
            e credenciais de API diferentes.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}