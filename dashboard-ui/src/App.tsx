import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { NotificationToast, useNotifications } from './components/NotificationToast'
import { DashboardPage } from './pages/DashboardPage'
import { OperationsPage } from './pages/OperationsPage'
import './index.css'

function App() {
  const { notifications, removeNotification } = useNotifications()

  return (
    <ThemeProvider>
      <Router>
        <div className="min-h-screen bg-background">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            {/* Rota de Operações temporariamente removida para primeira versão
            <Route path="/operations" element={<OperationsPage />} />
            */}
          </Routes>
          <NotificationToast 
            notifications={notifications} 
            onRemove={removeNotification} 
          />
        </div>
      </Router>
    </ThemeProvider>
  )
}

export default App
