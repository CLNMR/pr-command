import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {BaseStyles, ThemeProvider} from '@primer/react'
import '@primer/primitives/dist/css/primitives.css'
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'
import './styles.css'
import {App} from './App'

const queryClient = new QueryClient({
  defaultOptions: {queries: {retry: 1, refetchOnWindowFocus: true}},
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider colorMode="auto">
      <BaseStyles>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </BaseStyles>
    </ThemeProvider>
  </StrictMode>,
)
