import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/Home'
import { RoomPage } from './pages/Room'
import { StubToolPage } from './pages/StubTool'
import { ToolChipPage } from './pages/ToolChip'
import { ToolUndercoverPage } from './pages/ToolUndercover'
import { ToolTruthDarePage } from './pages/ToolTruthDare'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/r/:roomCode" element={<RoomPage />} />
        <Route path="/tools/chip" element={<ToolChipPage />} />
        <Route path="/tools/chips" element={<Navigate to="/tools/chip" replace />} />
        <Route path="/tools/undercover" element={<ToolUndercoverPage />} />
        <Route path="/tools/truthDare" element={<ToolTruthDarePage />} />
        <Route path="/tools/random" element={<StubToolPage tool="random" />} />
        <Route path="/tools/timer" element={<StubToolPage tool="timer" />} />
        <Route path="/tools/split" element={<StubToolPage tool="split" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
