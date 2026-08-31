interface LaunchGateProps {
  readonly continuing: boolean
  readonly soundAvailable: boolean
  readonly soundEnabled: boolean
  readonly onBegin: () => void
  readonly onToggleSound: () => void
}

export function LaunchGate({
  continuing,
  soundAvailable,
  soundEnabled,
  onBegin,
  onToggleSound,
}: LaunchGateProps) {
  return (
    <section className="launch-gate" aria-label="Shoot the Moon opening">
      <div className="launch-gate__rule" aria-hidden="true" />
      <span className="launch-gate__kicker">AN AUTHORED LUNAR HOSTILITY</span>
      <h1>
        <span>SHOOT</span>
        <span>THE MOON</span>
      </h1>
      <strong>FIRST STRIKE</strong>
      <p>
        Two supervillains claimed one Moon.
        <br />
        You built first—and fired first.
      </p>
      <button className="launch-gate__begin" type="button" onClick={onBegin}>
        {continuing ? 'CONTINUE' : 'BEGIN INVASION'}
      </button>
      <button
        className="launch-gate__sound"
        type="button"
        onClick={onToggleSound}
        disabled={!soundAvailable}
      >
        {soundAvailable ? `SOUND ${soundEnabled ? 'ON' : 'OFF'}` : 'SOUND UNAVAILABLE'}
      </button>
      <small>TOUCH · DRAG · PINCH</small>
    </section>
  )
}

