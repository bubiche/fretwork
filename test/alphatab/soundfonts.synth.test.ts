import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Settings, importer, midi, synth } from '@coderline/alphatab'
import { exposePresetAtPrograms } from '../../src/alphatab/sf2'

/**
 * End-to-end acceptance of the layered-soundfont scheme through alphaTab's REAL synth (offline
 * audio exporter): the patched classical font must parse (Hydra), resolve at the GM guitar
 * programs, and produce audible samples — while drums/metronome fall through to sonivox. The
 * structural tests in sf2.test.ts can't prove any of that; this is the part that was previously
 * only verifiable by ear.
 */

const SOUNDFONT_DIR = join(__dirname, '../../public/soundfont')
const classicalRaw = new Uint8Array(readFileSync(join(SOUNDFONT_DIR, 'classical_guitar.sf2')))
// sf2 rather than sf3 to keep the test independent of alphaTab's vorbis decoding.
const sonivox = new Uint8Array(readFileSync(join(SOUNDFONT_DIR, 'sonivox.sf2')))

const GUITAR_PROGRAMS = [24, 25, 26, 27, 28, 29, 30, 31]
const classicalPatched = exposePresetAtPrograms(classicalRaw, GUITAR_PROGRAMS)

/** One 4/4 bar of quarter notes (string 3, fret 3) on the given GM program. */
const NOTES_TEX = (program: number) => `\\instrument ${program}\n.\n3.3.4 3.3.4 3.3.4 3.3.4 |`
/** One bar of silence — with the metronome up, anything audible IS the metronome. */
const REST_TEX = '.\nr.1 |'

function midiFromTex(tex: string): midi.MidiFile {
  const imp = new importer.AlphaTexImporter()
  imp.logErrors = false
  const settings = new Settings()
  imp.initFromString(tex, settings)
  const score = imp.readScore()
  const file = new midi.MidiFile()
  new midi.MidiFileGenerator(score, settings, new midi.AlphaSynthMidiFileHandler(file)).generate()
  return file
}

/** AlphaSynth only uses the output for realtime playback; the offline exporter never touches it. */
function makeSynth(): synth.AlphaSynth {
  const noopEmitter = { on() {}, off() {} }
  const output = {
    sampleRate: 44100,
    ready: noopEmitter,
    sampleRequest: noopEmitter,
    samplesPlayed: noopEmitter,
    open() {},
  }
  return new synth.AlphaSynth(output as unknown as synth.ISynthOutput, 500)
}

async function renderAll(
  soundFonts: Uint8Array[],
  tex: string,
  metronomeVolume = 0
): Promise<Float32Array> {
  const options = new synth.AudioExportOptions()
  options.soundFonts = soundFonts
  options.metronomeVolume = metronomeVolume
  const exporter = makeSynth().exportAudio(options, midiFromTex(tex), [], new Map())
  const chunks: Float32Array[] = []
  for (;;) {
    const chunk = await exporter.render(1000)
    if (!chunk) break
    chunks.push(chunk.samples)
  }
  const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    all.set(c, o)
    o += c.length
  }
  return all
}

function peak(samples: Float32Array): number {
  let max = 0
  for (const s of samples) max = Math.max(max, Math.abs(s))
  return max
}

describe('layered soundfont playback through the real synth', () => {
  it('unpatched classical font is SILENT on guitar programs (the bug being fixed)', async () => {
    const samples = await renderAll([classicalRaw], NOTES_TEX(24))
    expect(samples.length).toBeGreaterThan(0)
    expect(peak(samples)).toBe(0)
  })

  it('patched classical font sounds on every GM guitar program', async () => {
    for (const program of GUITAR_PROGRAMS) {
      expect(peak(await renderAll([classicalPatched], NOTES_TEX(program))), `program ${program}`).toBeGreaterThan(0.01)
    }
  })

  it('layered (sonivox + classical on top): guitar comes from the classical font', async () => {
    // The synth resolves presets last-import-wins, so the classical font must be loaded LAST.
    const layered = await renderAll([sonivox, classicalPatched], NOTES_TEX(24))
    const sonivoxOnly = await renderAll([sonivox], NOTES_TEX(24))
    const classicalOnly = await renderAll([classicalPatched], NOTES_TEX(24))
    expect(peak(layered)).toBeGreaterThan(0.01)
    // Same notes, different samples than sonivox alone — and identical to the classical font
    // alone — proves the last-loaded font won the guitar program. The cheap scalar check first:
    // a failing toEqual spends ~14 min pretty-printing the 150k-sample diff.
    expect(peak(layered)).toBe(peak(classicalOnly))
    expect(layered.length).toBe(classicalOnly.length)
    expect(layered).toEqual(classicalOnly)
    expect(layered).not.toEqual(sonivoxOnly)
  })

  it('layered: the metronome still ticks (falls back to sonivox percussion)', async () => {
    const withMetronome = await renderAll([sonivox, classicalPatched], REST_TEX, 1)
    expect(peak(withMetronome)).toBeGreaterThan(0.01)
    // and silence without it, so the sound really is the metronome
    const without = await renderAll([sonivox, classicalPatched], REST_TEX, 0)
    expect(peak(without)).toBe(0)
  })

  it('sonivox alone still sounds (default path regression check)', async () => {
    expect(peak(await renderAll([sonivox], NOTES_TEX(25)))).toBeGreaterThan(0.01)
  })
})
