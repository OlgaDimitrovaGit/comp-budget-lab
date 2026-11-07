import { createRoot } from "react-dom/client";
import "./src/styles.css";
import { Route } from "./src/routes/index.tsx";
const C = Route.options.component;
createRoot(document.getElementById("root")).render(<C />);
