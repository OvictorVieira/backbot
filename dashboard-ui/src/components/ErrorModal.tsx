import React from 'react';
import { X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
}

export const ErrorModal: React.FC<ErrorModalProps> = ({
  isOpen,
  onClose,
  title,
  message
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-background p-6 rounded-lg w-full max-w-md border shadow-lg">
        <div className="text-center">
          {/* Error Icon */}
          <div className="mx-auto mb-4 w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
            <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
          </div>
          
          {/* Title */}
          <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">
            {title}
          </h3>
          
          {/* Message */}
          <p className="text-sm text-muted-foreground mb-6">
            {message}
          </p>
          
          {/* Button */}
          <Button 
            onClick={onClose}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}; 