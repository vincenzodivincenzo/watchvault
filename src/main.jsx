import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
// Brand fonts (Google Fonts, bundled locally via Fontsource — works offline)
import "@fontsource-variable/fraunces";
import "@fontsource-variable/fraunces/wght-italic.css";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

// Default before the library (and its theme setting) loads.
document.documentElement.dataset.theme = "light";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
