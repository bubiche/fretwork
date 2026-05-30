import { model } from '@coderline/alphatab'

/**
 * The full circle of fifths as selectable key signatures (owner choice: complete, not curated).
 * `KeySignature` is the number of sharps/flats (−7..+7 fifths); `KeySignatureType` is Major/Minor.
 * 15 majors + their 15 relative minors = 30 entries, grouped major-first then minor. The label is
 * the key name; the relative minor for `fifths` is the major three semitones below (same accidentals).
 */
export type KeySignatureOption = {
  label: string
  fifths: model.KeySignature
  type: model.KeySignatureType
}

const MAJOR_NAMES: Record<number, string> = {
  [-7]: 'C♭', [-6]: 'G♭', [-5]: 'D♭', [-4]: 'A♭', [-3]: 'E♭', [-2]: 'B♭', [-1]: 'F',
  [0]: 'C', [1]: 'G', [2]: 'D', [3]: 'A', [4]: 'E', [5]: 'B', [6]: 'F♯', [7]: 'C♯',
}
const MINOR_NAMES: Record<number, string> = {
  [-7]: 'A♭', [-6]: 'E♭', [-5]: 'B♭', [-4]: 'F', [-3]: 'C', [-2]: 'G', [-1]: 'D',
  [0]: 'A', [1]: 'E', [2]: 'B', [3]: 'F♯', [4]: 'C♯', [5]: 'G♯', [6]: 'D♯', [7]: 'A♯',
}

const FIFTHS: model.KeySignature[] = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7]

export const KEY_SIGNATURE_OPTIONS: KeySignatureOption[] = [
  ...FIFTHS.map((f) => ({ label: `${MAJOR_NAMES[f]} major`, fifths: f, type: model.KeySignatureType.Major })),
  ...FIFTHS.map((f) => ({ label: `${MINOR_NAMES[f]} minor`, fifths: f, type: model.KeySignatureType.Minor })),
]
