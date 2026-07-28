import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppBootstrap } from "./app-bootstrap";
import { ThemeProvider } from "./components/theme-provider";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
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
      <ThemeProvider>
        <AppBootstrap />
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
