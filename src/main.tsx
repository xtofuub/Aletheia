import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppBootstrap } from "@/app-bootstrap";
import { ThemeProvider } from "@/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DirectSearchProgressProvider } from "@/hooks/use-direct-search-progress";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 15_000,
    },
  },
});

const root = document.getElementById("root");

if (!root) {
  throw new Error("Aletheia root element is missing");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <DirectSearchProgressProvider>
        <ThemeProvider>
          <TooltipProvider>
            <AppBootstrap />
          </TooltipProvider>
        </ThemeProvider>
      </DirectSearchProgressProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
