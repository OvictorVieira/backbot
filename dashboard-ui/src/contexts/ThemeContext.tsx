import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Inicializar tema diretamente do localStorage
  const getInitialTheme = (): Theme => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('backbot-theme') as Theme
      console.log('🔍 Carregando tema do localStorage:', savedTheme)
      if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark')) {
        return savedTheme
      }
    }
    return 'light' // Tema padrão
  }

  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  // Aplicar tema ao documento
  useEffect(() => {
    const root = window.document.documentElement
    
    root.classList.remove('light', 'dark')
    root.classList.add(theme)
    
    // Salvar no localStorage apenas se não for a primeira renderização
    if (typeof window !== 'undefined') {
      const currentSavedTheme = localStorage.getItem('backbot-theme')
      if (currentSavedTheme !== theme) {
        console.log('💾 Salvando tema no localStorage:', theme)
        localStorage.setItem('backbot-theme', theme)
      }
    }
  }, [theme])

  const toggleTheme = () => {
    setThemeState(prev => prev === 'light' ? 'dark' : 'light')
  }

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme)
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
} 