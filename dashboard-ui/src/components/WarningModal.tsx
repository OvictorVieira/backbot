import React from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  onEdit?: () => void;
}

export const WarningModal: React.FC<WarningModalProps> = ({
  isOpen,
  onClose,
  title,
  message,
  onEdit
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-background p-6 rounded-lg w-full max-w-md border shadow-lg">
        <div className="text-center">
          {/* Warning Icon */}
          <div className="mx-auto mb-4 w-16 h-16 bg-yellow-100 dark:bg-yellow-900/20 rounded-full flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-yellow-600 dark:text-yellow-400" />
          </div>

          {/* Title */}
          <h3 className="text-lg font-semibold text-yellow-600 dark:text-yellow-400 mb-2">
            {title}
          </h3>

          {/* Message */}
          <p className="text-sm text-muted-foreground mb-6">
            {message}
          </p>

          {/* Buttons */}
          <div className="flex gap-3 justify-center">
            {onEdit && (
              <Button
                onClick={onEdit}
                className="bg-yellow-600 hover:bg-yellow-700 text-white"
              >
                Editar Bot
              </Button>
            )}
            <Button
              onClick={onClose}
              variant="outline"
            >
              Entendi
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};