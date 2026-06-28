/* Console 2.0 — SplitStage: input and output given EQUAL prominence, side by
   side. Left half = the Manifold (input), right half = the OutputStage (output
   field). Both fully interactive; neither dominates. */
function SplitStage({ pos, onMove, noiseCap, pins, follow, onLongPress, params, values, onChange }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      <div style={{ flex: 1, position: 'relative', borderRight: '1px solid var(--line)', minWidth: 0 }}>
        <window.Manifold pos={pos} onMove={onMove} noiseCap={noiseCap} pins={pins} follow={follow} onLongPress={onLongPress} />
      </div>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <window.OutputStage params={params} values={values} onChange={onChange} compact />
      </div>
    </div>
  );
}
window.SplitStage = SplitStage;
