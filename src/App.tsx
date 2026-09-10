import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/Home'
import { RoomPage } from './pages/Room'
import { StubToolPage } from './pages/StubTool'
import { SoloChipsPage } from './pages/SoloChips'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/r/:roomCode" element={<RoomPage />} />
        <Route path="/tools/chips" element={<SoloChipsPage />} />
        <Route path="/tools/random" element={<StubToolPage tool="random" />} />
        <Route path="/tools/timer" element={<StubToolPage tool="timer" />} />
        <Route path="/tools/split" element={<StubToolPage tool="split" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
