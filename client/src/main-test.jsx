import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AppTest from './App-test.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppTest />
  </StrictMode>,
)
