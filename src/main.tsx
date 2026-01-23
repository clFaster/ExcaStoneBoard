import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Import Excalidraw styles
import "@excalidraw/excalidraw/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
