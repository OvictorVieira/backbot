import React from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Trash2, X } from 'lucide-react';

interface DeleteBotModalProps {
  isOpen: boolean;
  botName: string;
  botId: number;
  onConfirm: (botId: number) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const DeleteBotModal: React.FC<DeleteBotModalProps> = ({
  isOpen,
  botName,
  botId,
  onConfirm,
  onCancel,
  isLoading = false
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900/20 rounded-full">
              <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <CardTitle className="text-lg">Deletar Bot</CardTitle>
              <CardDescription>
                Esta ação não pode ser desfeita
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pb-4">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Você está prestes a deletar o bot <strong>"{botName}"</strong>.
            </p>
            
            <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                    Atenção!
                  </p>
                  <ul className="text-yellow-700 dark:text-yellow-300 space-y-1 text-xs">
                    <li>• Todas as configurações do bot serão perdidas</li>
                    <li>• Histórico de ordens será removido</li>
                    <li>• Dados de trailing stop serão apagados</li>
                    <li>• Se o bot estiver rodando, será parado automaticamente</li>
                  </ul>
                </div>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Digite <strong>"{botName}"</strong> para confirmar:
            </p>
            
            <input
              type="text"
              placeholder={`Digite "${botName}"`}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              id="confirm-delete-input"
            />
          </div>
        </CardContent>

        <CardFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1"
          >
            <X className="h-4 w-4 mr-2" />
            Cancelar
          </Button>
          
          <Button
            variant="destructive"
            onClick={() => {
              const input = document.getElementById('confirm-delete-input') as HTMLInputElement;
              if (input && input.value === botName) {
                onConfirm(botId);
              } else {
                input?.focus();
                input?.classList.add('border-red-500', 'ring-2', 'ring-red-500');
                setTimeout(() => {
                  input?.classList.remove('border-red-500', 'ring-2', 'ring-red-500');
                }, 2000);
              }
            }}
            disabled={isLoading}
            className="flex-1"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Deletando...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                Deletar Bot
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};
