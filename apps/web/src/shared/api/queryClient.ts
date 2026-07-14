import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,          // don't retry auth failures
      refetchOnWindowFocus: false,
    },
  },
});
