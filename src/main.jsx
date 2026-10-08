import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import App from './App'
import { supabaseConfigurationError } from './lib/supabase'
import './index.css'
import './styles/premium-finance.css'
import { initializeTheme } from './lib/theme'

initializeTheme()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {supabaseConfigurationError ? (
      <main className="min-h-screen grid place-items-center px-5">
        <section className="card w-full max-w-md" role="alert">
          <h1 className="text-2xl font-bold m-0">ANGIE TECH</h1>
          <p className="mt-4 text-muted">No se pudo conectar la aplicación.</p>
          <p className="mt-2 text-sm">{supabaseConfigurationError}</p>
          <p className="mt-2 text-sm">Copia <code>.env.example</code> a <code>.env</code>, completa <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> y reinicia el servidor.</p>
        </section>
      </main>
    ) : (
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    )}
  </React.StrictMode>,
)
