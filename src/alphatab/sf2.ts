/**
 * Minimal SoundFont2 binary surgery for single-instrument fonts.
 *
 * Problem: the classical guitar SoundFont ships exactly one preset at bank 0 / program 0, but
 * alphaTab's synth resolves presets by *exact* bank+program match (no fallback) — a guitar track
 * playing GM program 24/25 would be silent. Fix: clone the preset header (and its zone records,
 * which are range-delimited by the *next* header, so they can't be shared) once per target program.
 * Sample data and instruments are untouched and not duplicated — clones are a few hundred bytes.
 *
 * SF2 refresher (all little-endian, inside the RIFF `pdta` LIST):
 *   phdr — 38-byte preset headers; record k's zones are pbag[k.wBagNdx .. (k+1).wBagNdx). A
 *          terminal "EOP" record closes the list.
 *   pbag — 4-byte zone records {wGenNdx, wModNdx}, same next-record delimiting into pgen/pmod.
 *   pgen — 4-byte generators (the instrument reference is a generator *value*, copy-safe).
 *   pmod — 10-byte modulators.
 */

const PHDR_SIZE = 38
const PBAG_SIZE = 4
const PGEN_SIZE = 4
const PMOD_SIZE = 10

function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8)
}

function setU16(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff
  b[o + 1] = (v >> 8) & 0xff
}

function tag(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
}

type Chunk = { id: string; start: number; dataStart: number; size: number }

/** Walk sibling RIFF chunks in [from, to). Chunks are word-aligned (odd sizes get a pad byte). */
function readChunks(b: Uint8Array, from: number, to: number): Chunk[] {
  const chunks: Chunk[] = []
  let o = from
  while (o + 8 <= to) {
    const size = u32(b, o + 4)
    chunks.push({ id: tag(b, o), start: o, dataStart: o + 8, size })
    o += 8 + size + (size & 1)
  }
  return chunks
}

function chunkHeader(id: string, size: number): Uint8Array {
  const h = new Uint8Array(8)
  for (let i = 0; i < 4; i++) h[i] = id.charCodeAt(i)
  h[4] = size & 0xff
  h[5] = (size >> 8) & 0xff
  h[6] = (size >> 16) & 0xff
  h[7] = (size >> 24) & 0xff
  return h
}

/**
 * Returns a copy of `sf2` whose single preset is exposed at every MIDI program in `programs`
 * (same bank). Throws if the font doesn't contain exactly one preset — this transform is only
 * meant for single-instrument fonts where "which program?" has an unambiguous answer.
 */
export function exposePresetAtPrograms(sf2: Uint8Array, programs: readonly number[]): Uint8Array {
  if (programs.length === 0) throw new Error('programs must be non-empty')
  for (const p of programs) {
    if (!Number.isInteger(p) || p < 0 || p > 127) throw new Error(`invalid MIDI program ${p}`)
  }
  if (tag(sf2, 0) !== 'RIFF' || tag(sf2, 8) !== 'sfbk') throw new Error('not an sf2/sf3 file')

  const top = readChunks(sf2, 12, 8 + u32(sf2, 4))
  const pdta = top.find((c) => c.id === 'LIST' && tag(sf2, c.dataStart) === 'pdta')
  if (!pdta) throw new Error('missing pdta LIST')
  const sub = readChunks(sf2, pdta.dataStart + 4, pdta.dataStart + pdta.size)
  const byId = new Map(sub.map((c) => [c.id, c]))
  const phdr = byId.get('phdr')
  const pbag = byId.get('pbag')
  const pgen = byId.get('pgen')
  const pmod = byId.get('pmod')
  if (!phdr || !pbag || !pgen || !pmod) throw new Error('missing preset chunks')

  // Exactly one preset record + the EOP terminal.
  if (phdr.size !== 2 * PHDR_SIZE) {
    throw new Error(`expected a single-preset SoundFont, found ${phdr.size / PHDR_SIZE - 1} presets`)
  }
  const presetBagStart = u16(sf2, phdr.dataStart + 24)
  const zoneCount = u16(sf2, phdr.dataStart + PHDR_SIZE + 24) - presetBagStart
  if (presetBagStart !== 0 || zoneCount <= 0) throw new Error('unexpected preset zone layout')
  if (pbag.size !== (zoneCount + 1) * PBAG_SIZE) throw new Error('unexpected pbag size')
  // Totals come from the terminal records' indices (= count of "real" records before them).
  const genCount = u16(sf2, pbag.dataStart + zoneCount * PBAG_SIZE)
  const modCount = u16(sf2, pbag.dataStart + zoneCount * PBAG_SIZE + 2)
  if (pgen.size !== (genCount + 1) * PGEN_SIZE) throw new Error('unexpected pgen size')
  if (pmod.size !== (modCount + 1) * PMOD_SIZE) throw new Error('unexpected pmod size')

  const k = programs.length

  // phdr: K copies of the preset record (new program + shifted bag index), then the EOP record.
  const newPhdr = new Uint8Array((k + 1) * PHDR_SIZE)
  for (let i = 0; i < k; i++) {
    newPhdr.set(sf2.subarray(phdr.dataStart, phdr.dataStart + PHDR_SIZE), i * PHDR_SIZE)
    setU16(newPhdr, i * PHDR_SIZE + 20, programs[i])
    setU16(newPhdr, i * PHDR_SIZE + 24, i * zoneCount)
  }
  newPhdr.set(sf2.subarray(phdr.dataStart + PHDR_SIZE, phdr.dataStart + 2 * PHDR_SIZE), k * PHDR_SIZE)
  setU16(newPhdr, k * PHDR_SIZE + 24, k * zoneCount)

  // pbag: K copies of the zone records with gen/mod indices shifted per copy, then a terminal.
  const newPbag = new Uint8Array((k * zoneCount + 1) * PBAG_SIZE)
  for (let i = 0; i < k; i++) {
    for (let z = 0; z < zoneCount; z++) {
      const src = pbag.dataStart + z * PBAG_SIZE
      const dst = (i * zoneCount + z) * PBAG_SIZE
      setU16(newPbag, dst, u16(sf2, src) + i * genCount)
      setU16(newPbag, dst + 2, u16(sf2, src + 2) + i * modCount)
    }
  }
  setU16(newPbag, k * zoneCount * PBAG_SIZE, k * genCount)
  setU16(newPbag, k * zoneCount * PBAG_SIZE + 2, k * modCount)

  // pgen/pmod: K verbatim copies of the records, then an all-zero terminal record.
  const newPgen = new Uint8Array((k * genCount + 1) * PGEN_SIZE)
  const newPmod = new Uint8Array((k * modCount + 1) * PMOD_SIZE)
  for (let i = 0; i < k; i++) {
    newPgen.set(sf2.subarray(pgen.dataStart, pgen.dataStart + genCount * PGEN_SIZE), i * genCount * PGEN_SIZE)
    newPmod.set(sf2.subarray(pmod.dataStart, pmod.dataStart + modCount * PMOD_SIZE), i * modCount * PMOD_SIZE)
  }

  // Reassemble: copy every chunk verbatim except the four rebuilt ones inside pdta.
  const replacements = new Map<string, Uint8Array>([
    ['phdr', newPhdr],
    ['pbag', newPbag],
    ['pgen', newPgen],
    ['pmod', newPmod],
  ])
  const pdtaParts: Uint8Array[] = []
  for (const c of sub) {
    const data = replacements.get(c.id)
    if (data) {
      pdtaParts.push(chunkHeader(c.id, data.length), data)
    } else {
      // Includes the original pad byte for odd-sized chunks.
      pdtaParts.push(sf2.subarray(c.start, c.dataStart + c.size + (c.size & 1)))
    }
  }
  const pdtaSize = 4 + pdtaParts.reduce((n, p) => n + p.length, 0) // +4 for the 'pdta' form tag

  const parts: Uint8Array[] = []
  for (const c of top) {
    if (c === pdta) {
      parts.push(chunkHeader('LIST', pdtaSize))
      parts.push(new Uint8Array([0x70, 0x64, 0x74, 0x61])) // 'pdta'
      parts.push(...pdtaParts)
    } else {
      parts.push(sf2.subarray(c.start, c.dataStart + c.size + (c.size & 1)))
    }
  }

  const bodySize = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(12 + bodySize)
  out.set(chunkHeader('RIFF', 4 + bodySize)) // +4 for the 'sfbk' form tag
  out.set(new Uint8Array([0x73, 0x66, 0x62, 0x6b]), 8) // 'sfbk'
  let o = 12
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
