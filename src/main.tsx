import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { ToastProvider, ToastViewport } from './components/ui/Toast'
import './index.css'
import App from './App.tsx'

const appRoot = document.getElementById('root')!
const toastRoot = document.getElementById('toast-root') ?? Object.assign(document.createElement('div'), { id: 'toast-root' })

if (!toastRoot.isConnected) {
  document.body.appendChild(toastRoot)
}

createRoot(toastRoot).render(<ToastViewport />)

createRoot(appRoot).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
