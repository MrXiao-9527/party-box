/**
 * Durable room snapshot for Node relay (survives process restart).
 *
 * Env:
 *   PARTY_BOX_DATA_DIR  directory for rooms.json (default: <cwd>/data)
 *
 * Prefer Cloudflare Worker + Durable Object in production; this is the
 * Node / VPS fallback so QA is not wiped by `node server/index.mjs` remount.
 */

import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR =
  process.env.PARTY_BOX_DATA_DIR || path.join(process.cwd(), 'data')
const SNAPSHOT_FILE = path.join(DATA_DIR, 'rooms.json')

export function dataDir() {
  return DATA_DIR
}

export function snapshotPath() {
  return SNAPSHOT_FILE
}

/**
 * @returns {Record<string, { data: object, touchedAt: number }>}
 */
export function loadSnapshot() {
  try {
    const raw = fs.readFileSync(SNAPSHOT_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && parsed.rooms) {
      return parsed.rooms
    }
    return {}
  } catch (e) {
    if (e && e.code === 'ENOENT') return {}
    console.error('[relay persist] load failed', e)
    return {}
  }
}

/**
 * Atomic write of full room map.
 * @param {Record<string, { data: object, touchedAt: number }>} rooms
 */
export function saveSnapshot(rooms) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const payload = JSON.stringify(
    { version: 1, savedAt: Date.now(), rooms },
    null,
    0,
  )
  const tmp = `${SNAPSHOT_FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, payload, 'utf8')
  fs.renameSync(tmp, SNAPSHOT_FILE)
}
