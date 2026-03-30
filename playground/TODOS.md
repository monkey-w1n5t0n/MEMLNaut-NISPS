

## synth view Immersive UI
- [x] add hover tooltip for each parameter slider (canvas tooltip follows mouse, shows name/value/range/curve)
- [x] hovering on the name of a module/group at the top should open a little drawer panel that allows us to set
	- [x] minimum and maximum values for each parameter (dual-thumb range slider)
	- [x] a curve parameter that's normalised and goes between logarithmic and exponential, with a little graph to visualise, to skew the distribution in either direction (per-param draggable canvas + group master curve with relative adjustment)
	- [x] mute toggle per parameter (removes from NISPS, replaces with fixed value slider)
- [x] if the audio engine hasn't been initialised yet, the play button at the top left should be pulsing and have an orange highlight
