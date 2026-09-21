import { useEffect, useRef, useState } from 'react'
import { PROMPT_TYPE_LABEL, type PromptDisplayType } from '../types'

const SECTORS: PromptDisplayType[] = [
  'truth',
  'dare',
  'truth',
  'dare',
  'truth',
  'dare',
  'truth',
  'dare',
]
const SECTOR_DEG = 360 / SECTORS.length
const SPIN_MS = 1800
const EXTRA_TURNS = 4

function landIndex(id: string, type: PromptDisplayType) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i) * (i + 1)) % 997
  const matches = SECTORS.map((t, i) => (t === type ? i : -1)).filter((i) => i >= 0)
  return matches[hash % matches.length] ?? 0
}

function targetDeg(id: string, type: PromptDisplayType) {
  const i = landIndex(id, type)
  const center = i * SECTOR_DEG + SECTOR_DEG / 2
  return EXTRA_TURNS * 360 + (360 - center)
}

interface TruthDareWheelProps {
  promptId: string
  displayType: PromptDisplayType
  onSettled: () => void
}

export function TruthDareWheel({
  promptId,
  displayType,
  onSettled,
}: TruthDareWheelProps) {
  const [deg, setDeg] = useState(0)
  const settledRef = useRef(onSettled)
  const target = targetDeg(promptId, displayType)

  useEffect(() => {
    settledRef.current = onSettled
  }, [onSettled])

  useEffect(() => {
    const kick = requestAnimationFrame(() => setDeg(target))
    const done = window.setTimeout(() => settledRef.current(), SPIN_MS)
    return () => {
      cancelAnimationFrame(kick)
      window.clearTimeout(done)
    }
  }, [target])

  return (
    <div
      className="td-wheel-overlay"
      data-wheel="1"
      data-wheel-state="spinning"
      role="dialog"
      aria-label="转盘抽题"
    >
      <div className="td-wheel-pointer" aria-hidden />
      <div
        className="td-wheel-disc"
        data-wheel-disc="1"
        style={{ transform: `rotate(${deg}deg)` }}
      >
        {SECTORS.map((type, i) => (
          <span
            key={`${type}-${i}`}
            className="td-wheel-label"
            style={{ transform: `rotate(${i * SECTOR_DEG + SECTOR_DEG / 2}deg)` }}
          >
            {PROMPT_TYPE_LABEL[type]}
          </span>
        ))}
      </div>
      <p className="hint">转盘抽题</p>
      <button
        type="button"
        className="btn ghost compact"
        data-wheel-skip="1"
        onClick={onSettled}
      >
        跳过
      </button>
    </div>
  )
}
