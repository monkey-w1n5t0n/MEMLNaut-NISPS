// Arpeggiator Worker — runs note scheduling on a dedicated thread
// for reliable timing independent of main thread load.
// Posts noteOn/noteOff messages back to the main thread, which forwards them
// through the active SynthEngine. This decouples the worker from C15's
// SharedArrayBuffer ring buffer so any engine can be used.

// Cmin7 inversions: root [0,3,7,10], 1st [3,7,10,12], 2nd [7,10,12,15], 3rd [10,12,15,19]
const CMIN7_INVERSIONS = [
  [0, 3, 7, 10],
  [3, 7, 10, 12],
  [7, 10, 12, 15],
  [10, 12, 15, 19],
];

const PROGRESSIONS = {
  'Cmin7-rand': null, // special case: random inversions
  'I-vi-IV-V': [[0,4,7],[9,12,16],[5,9,12],[7,11,14]],
  'I-IV-vi-V': [[0,4,7],[5,9,12],[9,12,16],[7,11,14]],
  'i-VI-III-VII': [[0,3,7],[8,12,15],[3,7,10],[10,14,17]],
  'I-V-vi-IV': [[0,4,7],[7,11,14],[9,12,16],[5,9,12]],
};

// Arpeggiator state
let playing = false;
let bpm = 120;
let octaves = 2;
let octaveOffset = 0;
let progression = 'Cmin7-rand';
let direction = 'updown'; // 'up' or 'updown'
let chordIndex = 0;
let noteIndex = 0;
let ascending = true; // for updown mode
let currentInversion = null; // cached Cmin7 inversion for current cycle
let lastNote = -1;
let timer = null;

function scheduleNext() {
  if (!playing) return;
  const msPerBeat = 60000 / bpm;
  const noteDuration = msPerBeat / 4; // 16th notes
  playNextNote();
  timer = setTimeout(scheduleNext, noteDuration);
}

function getChordNotes() {
  const baseNote = 48 + (octaveOffset * 12);

  if (progression === 'Cmin7-rand') {
    // Pick a random inversion once per cycle, cache until next chord advance
    if (!currentInversion) {
      currentInversion = CMIN7_INVERSIONS[Math.floor(Math.random() * CMIN7_INVERSIONS.length)];
    }
    const inv = currentInversion;
    const notes = [];
    for (let oct = 0; oct < octaves; oct++) {
      for (const interval of inv) {
        const note = baseNote + interval + (oct * 12);
        if (note >= 0 && note <= 127) notes.push(note);
      }
    }
    return notes;
  }

  const chords = PROGRESSIONS[progression] || PROGRESSIONS['I-vi-IV-V'];
  const chord = chords[chordIndex];
  const notes = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const interval of chord) {
      const note = baseNote + interval + (oct * 12);
      if (note >= 0 && note <= 127) notes.push(note);
    }
  }
  return notes;
}

function advanceIndex(notes) {
  const chords = PROGRESSIONS[progression];
  const chordCount = (progression === 'Cmin7-rand') ? 1 : (chords ? chords.length : 1);

  if (direction === 'updown' && notes.length > 1) {
    if (ascending) {
      noteIndex++;
      if (noteIndex >= notes.length) {
        ascending = false;
        noteIndex = notes.length - 2; // bounce back, skip the top note
      }
    } else {
      noteIndex--;
      if (noteIndex <= 0) {
        ascending = true;
        noteIndex = 0;
        chordIndex = (chordIndex + 1) % chordCount;
        currentInversion = null; // pick new random inversion next cycle
      }
    }
  } else {
    // up only
    noteIndex++;
    if (noteIndex >= notes.length) {
      noteIndex = 0;
      chordIndex = (chordIndex + 1) % chordCount;
      currentInversion = null; // pick new random inversion next cycle
    }
  }
}

function playNextNote() {
  // Release previous note
  if (lastNote >= 0) {
    postMessage({ type: 'noteOff', data: { note: lastNote } });
  }

  const notes = getChordNotes();
  if (notes.length === 0) return;

  const note = notes[Math.min(noteIndex, notes.length - 1)];
  const velocity = 0.6 + Math.random() * 0.2;
  postMessage({ type: 'noteOn', data: { note, velocity } });
  lastNote = note;

  advanceIndex(notes);
}

function start() {
  if (playing) return;
  playing = true;
  chordIndex = 0;
  noteIndex = 0;
  ascending = true;
  currentInversion = null;
  scheduleNext();
  postMessage({ type: 'state', data: { playing: true } });
}

function stop() {
  playing = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (lastNote >= 0) {
    postMessage({ type: 'noteOff', data: { note: lastNote } });
    lastNote = -1;
  }
  postMessage({ type: 'state', data: { playing: false } });
}

// Handle messages from main thread
self.onmessage = (e) => {
  const { type, data } = e.data;
  switch (type) {
    case 'start':
      start();
      break;
    case 'stop':
      stop();
      break;
    case 'set':
      if (data && 'bpm' in data) bpm = data.bpm;
      if (data && 'octaves' in data) octaves = data.octaves;
      if (data && 'octaveOffset' in data) octaveOffset = data.octaveOffset;
      if (data && 'progression' in data) progression = data.progression;
      if (data && 'direction' in data) direction = data.direction;
      break;
  }
};
