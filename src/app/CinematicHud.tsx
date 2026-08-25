import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'

interface CinematicHudProps {
  readonly phase: ExperiencePhase
  readonly site: LandingSite | null
  readonly onClaim: () => void
  readonly onClear: () => void
  readonly onReturn: () => void
}

function formatCoordinate(valueRad: number, positive: string, negative: string) {
  const degrees = Math.abs((valueRad * 180) / Math.PI)
  const direction = valueRad < 0 ? negative : positive
  return {
    value: degrees.toFixed(3) + '°',
    direction,
  }
}

function formatAltitude(heightM: number): string {
  const rounded = Math.round(heightM)
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

function phaseLabel(phase: ExperiencePhase): string {
  switch (phase) {
    case 'orbit':
      return 'ORBITAL RECONNAISSANCE'
    case 'selected':
      return 'LANDING VECTOR ACQUIRED'
    case 'approach':
      return 'INVASION CAPSULE INBOUND'
    case 'landed':
      return 'LANDING SITE CLAIMED'
    case 'returning':
      return 'RETURNING TO ORBIT'
  }
}

export function CinematicHud({
  phase,
  site,
  onClaim,
  onClear,
  onReturn,
}: CinematicHudProps) {
  const latitude =
    site === null
      ? null
      : formatCoordinate(site.location.latitudeRad, 'N', 'S')
  const longitude =
    site === null
      ? null
      : formatCoordinate(site.location.longitudeRad, 'E', 'W')

  return (
    <div className="hud" aria-live="polite">
      <header className="hud-header">
        <div className="brand-lockup">
          <span className="brand-kicker">SHOOT THE MOON</span>
          <strong>MOON CORE</strong>
        </div>
        <span className="phase-label">{phaseLabel(phase)}</span>
      </header>

      {site === null ? (
        <div className="orbit-instruction">
          <span>DRAG TO ORBIT</span>
          <i aria-hidden="true" />
          <span>PINCH TO ZOOM</span>
          <i aria-hidden="true" />
          <span>TAP TO MARK</span>
        </div>
      ) : (
        <section
          className={'site-panel site-panel--' + phase}
          data-latitude-rad={site.location.latitudeRad}
          data-longitude-rad={site.location.longitudeRad}
          aria-label="Selected lunar landing site"
        >
          <div className="site-panel__eyebrow">
            <span className="signal-dot" aria-hidden="true" />
            {phase === 'landed' ? 'VILLAIN FOOTHOLD' : 'CANDIDATE SITE'}
          </div>
          <div className="coordinate-grid">
            <div>
              <span>LATITUDE</span>
              <strong>{latitude?.value}</strong>
              <b>{latitude?.direction}</b>
            </div>
            <div>
              <span>LONGITUDE</span>
              <strong>{longitude?.value}</strong>
              <b>{longitude?.direction}</b>
            </div>
          </div>
          <div className="datum-line">
            MEAN SPHERE · ALT {formatAltitude(site.location.heightM)} M
          </div>

          {phase === 'selected' ? (
            <div className="site-actions">
              <button className="claim-button" type="button" onClick={onClaim}>
                <span>CLAIM LANDING SITE</span>
                <span aria-hidden="true">SITE 01</span>
              </button>
              <button className="text-button" type="button" onClick={onClear}>
                CLEAR SITE
              </button>
            </div>
          ) : null}

          {phase === 'approach' ? (
            <button className="text-button" type="button" onClick={onReturn}>
              ABORT DESCENT
            </button>
          ) : null}

          {phase === 'landed' ? (
            <button className="return-button" type="button" onClick={onReturn}>
              RETURN TO ORBIT
            </button>
          ) : null}
        </section>
      )}
    </div>
  )
}
