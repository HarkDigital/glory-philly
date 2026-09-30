import { brickPixels, galvPixels, runToEnd, walnutPixels, type BrickJob } from './gen'

/*
 * ROOM KIT texture worker: builds the heavy per-pixel maps (walnut, brick, galvanized sheet)
 * off the main thread and hands the byte arrays back (transferred, no copy).
 * textures.ts owns it; if it can't start, the same generators run on the
 * main thread in ~8 ms slices.
 */

export type TexJobBody = { kind: 'walnut'; N: number } | { kind: 'brick'; job: BrickJob } | { kind: 'galv' }
export type TexJob = TexJobBody & { id: number }

// (typed by hand: the project's lib is DOM, and the webworker lib clashes with it)
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<TexJob>) => void) | null
  postMessage(msg: unknown, transfer?: Transferable[]): void
}

ctx.onmessage = (e: MessageEvent<TexJob>) => {
  const m = e.data
  try {
    const out = m.kind === 'walnut' ? runToEnd(walnutPixels(m.N)) : m.kind === 'galv' ? runToEnd(galvPixels()) : runToEnd(brickPixels(m.job))
    ctx.postMessage({ id: m.id, out }, [out.C.buffer, out.D.buffer])
  } catch (err) {
    ctx.postMessage({ id: m.id, error: String(err) })
  }
}
