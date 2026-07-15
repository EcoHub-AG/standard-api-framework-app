import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { StoreProvider } from "./store";
import { initStorage } from "./lib/storage";
import "./index.css";

// Hydrate the encrypted vault before mounting so the store reads from it.
initStorage().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <StoreProvider>
        <App />
      </StoreProvider>
    </React.StrictMode>
  );
});
