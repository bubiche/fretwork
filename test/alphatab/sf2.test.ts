import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { exposePresetAtPrograms } from '../../src/alphatab/sf2'

const SOUNDFONT_DIR = join(__dirname, '../../public/soundfont')
const classical = new Uint8Array(readFileSync(join(SOUNDFONT_DIR, 'classical_guitar.sf2')))
const sonivox = new Uint8Array(readFileSync(join(SOUNDFONT_DIR, 'sonivox.sf2')))

const GUITAR_PROGRAMS = [24, 25, 26, 27, 28, 29, 30, 31]

// ---- independent mini reader (deliberately not reusing the transform's internals) ----

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8)
}
function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}
function tag(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
}

type Pdta = Record<string, Uint8Array>

/** All sub-chunks of the pdta LIST, keyed by chunk id, as data slices. */
function readPdta(sf2: Uint8Array): Pdta {
  expect(tag(sf2, 0)).toBe('RIFF')
  expect(tag(sf2, 8)).toBe('sfbk')
  const fileEnd = 8 + u32(sf2, 4)
  expect(fileEnd).toBe(sf2.length)
  let o = 12
  while (o < fileEnd) {
    const id = tag(sf2, o)
    const size = u32(sf2, o + 4)
    if (id === 'LIST' && tag(sf2, o + 8) === 'pdta') {
      const out: Pdta = {}
      let p = o + 12
      const end = o + 8 + size
      while (p < end) {
        const sid = tag(sf2, p)
        const ssz = u32(sf2, p + 4)
        out[sid] = sf2.subarray(p + 8, p + 8 + ssz)
        p += 8 + ssz + (ssz & 1)
      }
      return out
    }
    o += 8 + size + (size & 1)
  }
  throw new Error('no pdta')
}

/** Byte offset of the pdta LIST chunk header. */
function pdtaStart(sf2: Uint8Array): number {
  let o = 12
  while (o < sf2.length) {
    if (tag(sf2, o) === 'LIST' && tag(sf2, o + 8) === 'pdta') return o
    o += 8 + u32(sf2, o + 4) + (u32(sf2, o + 4) & 1)
  }
  throw new Error('no pdta')
}

type Preset = { name: string; program: number; bank: number; bagNdx: number }

function readPresets(pdta: Pdta): Preset[] {
  const phdr = pdta.phdr
  const presets: Preset[] = []
  for (let o = 0; o < phdr.length; o += 38) {
    presets.push({
      name: String.fromCharCode(...phdr.subarray(o, o + 20)).replace(/\0.*$/, ''),
      program: u16(phdr, o + 20),
      bank: u16(phdr, o + 22),
      bagNdx: u16(phdr, o + 24),
    })
  }
  return presets
}

/** The fully-resolved zone contents (generator + modulator record bytes) of preset `i`. */
function presetZones(pdta: Pdta, presets: Preset[], i: number): { gens: string; mods: string }[] {
  const zones: { gens: string; mods: string }[] = []
  for (let bag = presets[i].bagNdx; bag < presets[i + 1].bagNdx; bag++) {
    const genStart = u16(pdta.pbag, bag * 4)
    const genEnd = u16(pdta.pbag, (bag + 1) * 4)
    const modStart = u16(pdta.pbag, bag * 4 + 2)
    const modEnd = u16(pdta.pbag, (bag + 1) * 4 + 2)
    zones.push({
      gens: Array.from(pdta.pgen.subarray(genStart * 4, genEnd * 4)).join(','),
      mods: Array.from(pdta.pmod.subarray(modStart * 10, modEnd * 10)).join(','),
    })
  }
  return zones
}

describe('exposePresetAtPrograms', () => {
  const out = exposePresetAtPrograms(classical, GUITAR_PROGRAMS)
  const pdta = readPdta(out)
  const presets = readPresets(pdta)

  it('exposes the preset at every requested program, same bank/name, plus EOP', () => {
    expect(presets).toHaveLength(GUITAR_PROGRAMS.length + 1)
    for (let i = 0; i < GUITAR_PROGRAMS.length; i++) {
      expect(presets[i].program).toBe(GUITAR_PROGRAMS[i])
      expect(presets[i].bank).toBe(0)
      expect(presets[i].name).toBe('Classical guitar')
    }
  })

  it('gives every clone the same zones (generators + modulators) as the original', () => {
    const orig = readPdta(classical)
    const origZones = presetZones(orig, readPresets(orig), 0)
    expect(origZones.length).toBeGreaterThan(0)
    for (let i = 0; i < GUITAR_PROGRAMS.length; i++) {
      expect(presetZones(pdta, presets, i)).toEqual(origZones)
    }
  })

  it('keeps terminal records consistent (delimiting indices match chunk sizes)', () => {
    const k = GUITAR_PROGRAMS.length
    const zoneCount = presets[1].bagNdx - presets[0].bagNdx
    expect(presets[k].bagNdx).toBe(k * zoneCount) // EOP
    expect(pdta.pbag.length).toBe((k * zoneCount + 1) * 4)
    const totalGens = u16(pdta.pbag, k * zoneCount * 4)
    const totalMods = u16(pdta.pbag, k * zoneCount * 4 + 2)
    expect(pdta.pgen.length).toBe((totalGens + 1) * 4)
    expect(pdta.pmod.length).toBe((totalMods + 1) * 10)
    // terminal pgen/pmod records are all zero
    expect(Array.from(pdta.pgen.subarray(totalGens * 4))).toEqual([0, 0, 0, 0])
    expect(Array.from(pdta.pmod.subarray(totalMods * 10))).toEqual(new Array(10).fill(0))
  })

  it('leaves samples, instruments and metadata byte-identical', () => {
    const orig = readPdta(classical)
    // (Buffer.compare, not toEqual: deep-equality on multi-MB typed arrays OOMs the test worker.)
    const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0
    for (const id of ['inst', 'ibag', 'igen', 'imod', 'shdr']) {
      expect(same(pdta[id], orig[id]), id).toBe(true)
    }
    // Everything before the pdta LIST (INFO + the whole sample data block) is untouched.
    expect(same(out.subarray(12, pdtaStart(out)), classical.subarray(12, pdtaStart(classical)))).toBe(true)
  })

  it('grows the file by exactly the cloned record bytes and keeps the RIFF size honest', () => {
    const orig = readPdta(classical)
    const k = GUITAR_PROGRAMS.length
    const zoneCount = readPresets(orig)[1].bagNdx
    const totalGens = u16(orig.pbag, zoneCount * 4)
    const totalMods = u16(orig.pbag, zoneCount * 4 + 2)
    const delta = (k - 1) * (38 + zoneCount * 4 + totalGens * 4 + totalMods * 10)
    expect(out.length).toBe(classical.length + delta)
    expect(8 + u32(out, 4)).toBe(out.length) // asserted in readPdta too, but make it explicit
  })

  it('rejects multi-preset fonts', () => {
    expect(() => exposePresetAtPrograms(sonivox, GUITAR_PROGRAMS)).toThrow(/single-preset/)
  })

  it('rejects bad program numbers and empty lists', () => {
    expect(() => exposePresetAtPrograms(classical, [])).toThrow()
    expect(() => exposePresetAtPrograms(classical, [128])).toThrow()
    expect(() => exposePresetAtPrograms(classical, [-1])).toThrow()
    expect(() => exposePresetAtPrograms(classical, [1.5])).toThrow()
  })
})
