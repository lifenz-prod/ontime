import { BrowserRouter } from 'react-router-dom';
import { ChakraProvider } from '@chakra-ui/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import ErrorBoundary from './common/components/error-boundary/ErrorBoundary';
import IdentifyOverlay from './common/components/identify-overlay/IdentifyOverlay';
import { AppContextProvider } from './common/context/AppContext';
import { ontimeQueryClient } from './common/queryClient';
import { connectSocket } from './common/utils/socket';
import theme from './theme/theme';
import { TranslationProvider } from './translation/TranslationProvider';
import AppRouter from './AppRouter';
import { baseURI } from './externals';

connectSocket();

function App() {
  return (
    <ChakraProvider disableGlobalStyle resetCSS theme={theme}>
      <QueryClientProvider client={ontimeQueryClient}>
        <AppContextProvider>
          <BrowserRouter basename={baseURI}>
            <div className='App' style={{ width: '100%', maxWidth: '100vw', overflowX: 'hidden' }}>
              <ErrorBoundary>
                <TranslationProvider>
                  <IdentifyOverlay />
                  <AppRouter />
                </TranslationProvider>
              </ErrorBoundary>
              <ReactQueryDevtools initialIsOpen={false} />
            </div>
            <ErrorBoundary>
              <div id='identify-portal' />
            </ErrorBoundary>
          </BrowserRouter>
        </AppContextProvider>
      </QueryClientProvider>
    </ChakraProvider>
  );
}

export default App;
