// Arpeggiator — plays chord progressions through the C15 engine
// Supports tempo, octave range, octave offset, and multiple chord progressions

// Chord progressions as arrays of arrays of intervals (semitones from root)
const PROGRESSIONS = {
  'I-vi-IV-V': [
    [0, 4, 7],       // C major
    [9, 12, 16],     // A minor
    [5, 9, 12],      // F major
    [7, 11, 14],     // G major
  ],
  'I-IV-vi-V': [
    [0, 4, 7],
    [5, 9, 12],
    [9, 12, 16],
    [7, 11, 14],
  ],
  'i-VI-III-VII': [
    [0, 3, 7],       // C minor
    [8, 12, 15],     // Ab major
    [3, 7, 10],      // Eb major
    [10, 14, 17],    // Bb major
  ],
  'I-V-vi-IV': [
    [0, 4, 7],
    [7, 11, 14],
    [9, 12, 16],
    [5, 9, 12],
  ],
};

export class Arpeggiator {
  constructor(bridge) {
    this.bridge = bridge;
    this.bpm = 120;
    this.octaves = 2;       // how many octaves to span
    this.octaveOffset = 0;  // base octave shift (-2 to +2)
    this.progression = 'I-vi-IV-V';
    this.playing = false;
    this._timer = null;
    this._chordIndex = 0;
    this._noteIndex = 0;
    this._currentNotes = [];
    this._lastNote = -1;
  }

  get progressionNames() {
    return Object.keys(PROGRESSIONS);
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this._chordIndex = 0;
    this._noteIndex = 0;
    this._scheduleNext();
  }

  stop() {
    this.playing = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    // Release current note
    if (this._lastNote >= 0) {
      this.bridge.noteOff(this._lastNote);
      this._lastNote = -1;
    }
  }

  _scheduleNext() {
    if (!this.playing) return;

    const msPerBeat = 60000 / this.bpm;
    // Each note gets a 16th-note duration, chord changes every bar (4 beats)
    const noteDuration = msPerBeat / 4;

    this._playNextNote();

    this._timer = setTimeout(() => this._scheduleNext(), noteDuration);
  }

  _playNextNote() {
    const chords = PROGRESSIONS[this.progression] || PROGRESSIONS['I-vi-IV-V'];

    // Release previous note
    if (this._lastNote >= 0) {
      this.bridge.noteOff(this._lastNote);
    }

    // Build arpeggiated note sequence from current chord across octaves
    const chord = chords[this._chordIndex];
    const baseNote = 48 + (this.octaveOffset * 12); // C3 as base + offset

    // Build notes across octave range
    const notes = [];
    for (let oct = 0; oct < this.octaves; oct++) {
      for (const interval of chord) {
        const note = baseNote + interval + (oct * 12);
        if (note >= 0 && note <= 127) {
          notes.push(note);
        }
      }
    }

    if (notes.length === 0) return;

    // Play the next note in sequence
    const note = notes[this._noteIndex % notes.length];
    this.bridge.noteOn(note, 0.6 + Math.random() * 0.2);
    this._lastNote = note;

    // Advance
    this._noteIndex++;
    if (this._noteIndex >= notes.length) {
      this._noteIndex = 0;
      this._chordIndex = (this._chordIndex + 1) % chords.length;
    }
  }
}
