import { Moon, Sun } from 'lucide-react'
import { Button } from './ui/button'
import { useTheme } from '../contexts/ThemeContext'

interface ThemeToggleProps {
  className?: string
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

export function ThemeToggle({ 
  className = '', 
  variant = 'outline',
  size = 'default'
}: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <Button
      variant={variant}
      size={size}
      onClick={toggleTheme}
      className={`transition-all duration-200 ${className}`}
      title={`Mudar para tema ${theme === 'light' ? 'escuro' : 'claro'}`}
    >
      {theme === 'light' ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Sun className="h-4 w-4" />
      )}
      {size !== 'icon' && (
        <span className="ml-2">
          {theme === 'light' ? 'Escuro' : 'Claro'}
        </span>
      )}
    </Button>
  )
} 