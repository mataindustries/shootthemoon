import { OCTOGONALS } from '../content/octogonals.ts'
import { DEFENSE_FIRE_END_MS, DEFENSE_WINDOW_MS, defensePhase, type WaveDefenseView } from '../domain/waveDefense.ts'

export function WaveDefenseHud({ view: m, durationMs, allocationText, hitDetail, onFire }: {
  readonly view: WaveDefenseView
  readonly durationMs: number
  readonly allocationText: string
  readonly hitDetail: string
  readonly onFire: () => void
}) {
  const wave = { ...OCTOGONALS.waves[m.wavesResolved]!, durationMs }
  const shot = m.defenseShots?.[m.wavesResolved]
  const defense = defensePhase(m.phaseElapsedMs, shot)
  const windowOpen = m.phaseElapsedMs <= DEFENSE_WINDOW_MS
  const targetOpen = m.phaseElapsedMs <= DEFENSE_FIRE_END_MS
  return <div className="wave-defense-card" data-phase={defense} aria-label="Active wave defense">
          <div className="wave-defense-heading"><strong>WAVE {m.wavesResolved + 1} / 3</strong><span>{wave.approach}</span></div>
          <div className="wave-defense-result" role="status">
            <strong>{defense === 'approach' ? 'OCTOGONALS APPROACHING' : defense === 'targeting' ? 'TARGET LOCKED' :
              defense === 'queued' ? 'SHOT QUEUED · TRACKING' : defense === 'hit' ? 'DIRECT HIT · THREAT DEFLECTED' : 'MISSED · ALLOCATION HOLDS'}</strong>
            <span>{defense === 'hit' ? hitDetail :
              defense === 'miss' ? 'Your chosen allocation will resolve this wave.' :
                'One tap fires the tracking laser. Early taps are queued.'}</span>
          </div>
          <div className="wave-defense-window"><span>{targetOpen && shot == null ? 'FIRING WINDOW' : windowOpen ? 'DEFENSE SEQUENCE' : 'WAVE OUTCOME INCOMING'}</span>
            <span aria-hidden="true">{(Math.max(0, (targetOpen && shot == null ? DEFENSE_FIRE_END_MS : windowOpen ? DEFENSE_WINDOW_MS : wave.durationMs) - m.phaseElapsedMs) / 1000).toFixed(1)}s</span></div>
          <progress aria-label="Defense window" max={DEFENSE_WINDOW_MS} value={Math.max(0, DEFENSE_WINDOW_MS - m.phaseElapsedMs)} />
          <button className="wave-defense-fire" type="button" disabled={!targetOpen || shot != null} onClick={onFire}>
            <span aria-hidden="true">⌖</span> {shot != null ? defense === 'queued' ? 'DEFENSE QUEUED' : 'DEFENSE FIRED' : targetOpen ? 'FIRE DEFENSE' : 'TARGET ESCAPED'}
          </button>
          <p className="wave-allocation">{allocationText}</p>
        </div>
}
