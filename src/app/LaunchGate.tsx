import { useEffect, useState } from 'react'

interface LaunchGateProps {
  readonly continuing: boolean
  readonly soundAvailable: boolean
  readonly soundEnabled: boolean
  readonly onBegin: () => void
  readonly onToggleSound: () => void
  readonly onResetPrototype: () => void
}

function readCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  )
}

/** Desktop/mouse sessions get accurate control copy instead of the touch hint. */
function useCoarsePointer(): boolean {
  const [coarsePointer, setCoarsePointer] = useState(readCoarsePointer)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return
    }

    const query = window.matchMedia('(pointer: coarse)')
    const update = () => setCoarsePointer(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return coarsePointer
}

export function LaunchGate({
  continuing,
  soundAvailable,
  soundEnabled,
  onBegin,
  onToggleSound,
  onResetPrototype,
}: LaunchGateProps) {
  const coarsePointer = useCoarsePointer()

  return (
    <section className="launch-gate" aria-label="Shoot the Moon opening">
      <div className="launch-gate__horizon" aria-hidden="true">
        <div className="launch-gate__horizon-surface" />
        <div className="launch-gate__horizon-relief" />
      </div>
      <div className="launch-gate__frame" aria-hidden="true">
        <span className="launch-gate__corner launch-gate__corner--tl" />
        <span className="launch-gate__corner launch-gate__corner--tr" />
        <span className="launch-gate__corner launch-gate__corner--bl" />
        <span className="launch-gate__corner launch-gate__corner--br" />
        <span className="launch-gate__telemetry launch-gate__telemetry--left">
          LUNAR NEARSIDE · SECTOR 0
        </span>
        <span className="launch-gate__telemetry launch-gate__telemetry--right">
          {continuing ? 'OUTPOST ACTIVE' : 'STANDBY'}
        </span>
      </div>
      <div className="launch-gate__content">
        <div className="launch-gate__rule" aria-hidden="true" />
        <span className="launch-gate__kicker">AN AUTHORED LUNAR HOSTILITY</span>
        <h1 className="launch-gate__title">
          <span>SHOOT</span>
          <span>THE MOON</span>
        </h1>
        <div className="launch-gate__designation">
          <span className="launch-gate__designation-rule" aria-hidden="true" />
          <strong>FIRST STRIKE</strong>
          <span className="launch-gate__designation-rule" aria-hidden="true" />
        </div>
        <p className="launch-gate__lede">
          Two supervillains claimed one Moon.
          <br />
          You built first—and fired first.
        </p>
        <div className="launch-gate__actions">
          <button className="launch-gate__begin" type="button" onClick={onBegin}>
            {continuing ? 'CONTINUE' : 'BEGIN INVASION'}
          </button>
          <div className="launch-gate__utilities">
            <button
              className="launch-gate__sound"
              type="button"
              onClick={onToggleSound}
              disabled={!soundAvailable}
            >
              {soundAvailable ? `SOUND ${soundEnabled ? 'ON' : 'OFF'}` : 'SOUND UNAVAILABLE'}
            </button>
            {continuing ? (
              <button
                className="launch-gate__reset"
                type="button"
                onClick={onResetPrototype}
              >
                NEW GAME
              </button>
            ) : null}
          </div>
        </div>
        <small className="launch-gate__hint">
          {coarsePointer ? 'TOUCH · DRAG · PINCH' : 'CLICK · DRAG · SCROLL TO ZOOM'}
        </small>
      </div>
    </section>
  )
}
