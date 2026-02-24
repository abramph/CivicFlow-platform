import "../index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "../App.jsx";

const container = document.getElementById("root");
const root = createRoot(container);
root.render(
  React.createElement(
    HashRouter,
    null,
    React.createElement(App),
  ),
);
