import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TredingView from './pages/treding-view'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<TredingView />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
