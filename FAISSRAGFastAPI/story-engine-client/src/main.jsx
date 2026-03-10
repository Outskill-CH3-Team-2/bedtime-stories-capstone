import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import StoryEngineClient from "./StoryEngineClient"

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <StoryEngineClient />
  </StrictMode>
)
