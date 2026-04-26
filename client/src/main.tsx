import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { useAuthStore } from "./store/authStore.ts";

function Root() {
  const init = useAuthStore((s) => s.init);
  const signIn = useAuthStore((s) => s.signIn);

  useEffect(() => {
    const unsubscribe = init();
    return unsubscribe;
  }, [init]);

  // Ensure every visitor has a Firebase anonymous identity immediately
  useEffect(() => {
    signIn();
  }, [signIn]);

  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
