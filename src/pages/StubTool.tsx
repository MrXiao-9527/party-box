import { useNavigate } from 'react-router-dom'

const COPY: Record<string, { title: string; body: string }> = {
  random: {
    title: '随机',
    body: '抽签 / 掷点工具稍后接入。可先开一桌用筹码，进房后再回来。',
  },
  timer: {
    title: '计时',
    body: '回合计时与沙漏稍后接入。标记为「可稍后进房」。',
  },
  split: {
    title: '分账',
    body: 'AA / 比例分账稍后接入。当前切片专注筹码桌。',
  },
}

export function StubToolPage({ tool }: { tool: 'random' | 'timer' | 'split' }) {
  const navigate = useNavigate()
  const c = COPY[tool]
  return (
    <div className="page stub">
      <p className="eyebrow">工具墙</p>
      <h1>{c.title}</h1>
      <p className="hint">{c.body}</p>
      <span className="badge">可稍后进房</span>
      <div className="cta-row" style={{ marginTop: '1.5rem' }}>
        <button type="button" className="btn ghost" onClick={() => navigate('/')}>
          回首页
        </button>
        <button type="button" className="btn primary" onClick={() => navigate('/')}>
          开一桌
        </button>
      </div>
    </div>
  )
}
