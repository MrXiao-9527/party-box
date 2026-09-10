/**
 * Start relay + Vite together for local cross-device QA.
 * Usage: npm run dev:all
 */
import { spawn } from 'node:child_process'

const kids = []

function run(name, command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: false,
  })
  child.on('exit', (code) => {
    console.log(`[${name}] exited ${code}`)
    for (const k of kids) k.kill('SIGTERM')
    process.exit(code ?? 1)
  })
  kids.push(child)
}

run('relay', 'node', ['server/index.mjs'], { PORT: '45322' })
run('vite', 'npx', ['vite', '--host', '127.0.0.1', '--port', '45321'])

process.on('SIGINT', () => {
  for (const k of kids) k.kill('SIGTERM')
  process.exit(0)
})
