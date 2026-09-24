import { WaveDefenseHud } from './WaveDefenseHud.tsx'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import type { FirstStrikeSnapshot } from '../domain/firstStrike.ts'
import { MONUMENT_KINDS, MONUMENTS, MONUMENT_ORDERS, MONUMENT_WORKER_KW, MONUMENT_REPAIR_WORK_MS,
  monumentAllocation, type MonumentKind, type MonumentOrder } from '../domain/territoryMonument.ts'
import { OCTOGONALS } from '../content/octogonals.ts'
import { canStartMonument } from '../simulation/territoryMonumentSimulation.ts'
import type { OutpostOperationsMetrics } from '../simulation/outpostOperations.ts'
import { DEFENSE_HULL_SAVED, defenseShotHits } from '../domain/waveDefense.ts'

export type MonumentAction = MonumentKind | MonumentOrder | 'repair' | 'fire'

// Short completed-state label; the selection card keeps the fuller benefit text.
const HELIOS_ONLINE_LABEL = 'HELIOS SPIRE ONLINE · +25% SOLAR OUTPUT'

function MonumentGlyph({ kind }: { readonly kind: MonumentKind }) {
  return <svg viewBox="0 0 48 48" aria-hidden="true" className="monument-glyph">
    {kind === 'HELIOS_SPIRE' ? <path d="M17 42 22 8 26 8 31 42ZM24 2v9M18 6h12" /> :
      kind === 'CRATER_CROWN' ? <path d="m5 19 6 9 8-15 5 12 7-12 6 15 6-9-5 20H10ZM12 40q12 6 24 0" /> :
      kind === 'BASTION_OBELISK' ? <path d="m17 38 3-29 4-5 5 5 3 29ZM17 23 7 42h34L32 23M20 20h9" /> :
      <path d="m15 4-9 9v14l9 9h18l9-9V13l-9-9ZM6 20h36M24 4v32M10 8l28 24M38 8 10 32M20 36l-4 8h16l-4-8" />}
  </svg>
}

export function TerritoryMonumentHud({ outpost, firstStrike, metrics, reveal, onAction, onClose, onReplay, onReset }: {
  readonly outpost: OutpostSnapshot
  readonly firstStrike: FirstStrikeSnapshot | null
  readonly metrics: OutpostOperationsMetrics
  readonly reveal: boolean
  readonly onAction: (action: MonumentAction) => void
  readonly onClose: () => void
  readonly onReplay: () => void
  readonly onReset: () => void
}) {
  const m = outpost.monument
  const spec = m ? MONUMENTS[m.kind] : null
  const allocation = m ? monumentAllocation(m) : null
  const wave = m && m.wavesResolved < 3 ? OCTOGONALS.waves[m.wavesResolved] : null
  const repair = m?.status === 'repairing'
  const progress = m ? repair ? m.repairWorkMs / MONUMENT_REPAIR_WORK_MS : m.workMs / MONUMENTS[m.kind].laborMs : 0
  const previousHit = m && m.wavesResolved > 0 && defenseShotHits(m.defenseShots?.[m.wavesResolved - 1])
  return <section className={`monument-panel${reveal ? ' monument-panel--reveal' : ''}`} data-status={m?.status ?? 'choices'} aria-label="Territory Monuments">
    <header className="monument-heading"><div><span>TERRITORY MONUMENTS</span><h1>{reveal ? 'YOUR MARK ON THE MOON' : spec?.title ?? 'LEAVE A PERMANENT MARK'}</h1></div>
      <button type="button" onClick={onClose} aria-label="Close Territory Monuments">×</button></header>
    {m === null ? <>
      <p>One monument. One territory. Three final defense waves.</p>
      <p className="monument-resources">{Math.floor(outpost.lunarOre)} ORE STORED · {metrics.energyGeneratedKw.toFixed(1)} kW SOLAR · 3 ROBOTS</p>
      <div className="monument-choices">{MONUMENT_KINDS.map(kind => {
        const choice = MONUMENTS[kind]
        return <button type="button" key={kind} disabled={!canStartMonument(outpost, kind, firstStrike)} onClick={() => onAction(kind)}>
          <MonumentGlyph kind={kind} /><span><strong>{choice.title}</strong><small>{choice.benefit}</small>
            <small className="monument-cost">{choice.ore} ore · {choice.laborMs / 1000 * MONUMENT_WORKER_KW} kW·s · {choice.laborMs / 1000} robot-seconds</small>
            </span>
        </button>
      })}</div>
      <p>Ore paid once. Labor shares your 3 robots at 2 kW each; defense reserves up to 6 kW more. Work needs an idle miner, completed module and siege work, and at least 6 kW solar. Construction and defense reduce mining.</p>
    </> : <>
      {reveal ? <p role="status">{m.kind === 'HELIOS_SPIRE' ? HELIOS_ONLINE_LABEL : `TERRITORY CLAIMED · ${spec!.benefit}`}</p> : <>
        <div className="monument-stats"><span>{repair ? 'REPAIR' : 'CONSTRUCTION'} {Math.floor(progress * 100)}%</span><span>HULL {m.health}% · {m.wavesResolved}/3 WAVES</span></div>
        <progress aria-label={repair ? 'Monument repair' : 'Monument construction'} value={progress} max={1} />
        {m.status !== 'complete' && m.status !== 'damaged' && m.status !== 'wave' ? <p className="monument-resources">
          {metrics.activeRobots} mining · {allocation!.builders} building · {allocation!.defenders} defending<br />
          {metrics.monumentAllocationKw.toFixed(1)} kW build + {metrics.defenseAllocationKw.toFixed(1)} kW defense · {metrics.productionPerMin.toFixed(1)} ore/min<br />
          {(m.workMs / 1000).toFixed(1)}/{spec!.laborMs / 1000} robot-seconds · {(m.workMs / 1000 * MONUMENT_WORKER_KW).toFixed(1)} kW·s used
        </p> : null}
        {m.status === 'constructing' ? <p role="status">Foundation rising. Octogonal survey ships are approaching.</p> : null}
        {m.wavesResolved > 0 && m.status !== 'wave' ? <p className="wave-outcome" data-testid="wave-outcome" role="status">
          WAVE {m.wavesResolved} RESOLVED · {previousHit ? `HIT · ${DEFENSE_HULL_SAVED} HULL SAVED` : 'MISSED · ALLOCATION HELD'} · HULL {m.health}%
        </p> : null}
        {m.status === 'command' && wave ? <div className="monument-command">
          <div className="monument-transmission"><span className="octogonal-seal" aria-hidden="true">8</span><div><strong>{OCTOGONALS.name}</strong><small>{OCTOGONALS.speaker}</small></div></div>
          <p className="monument-radio">“{wave.radio}”</p>
          <p role="status"><strong>WAVE {m.wavesResolved + 1} / 3 · {wave.name}</strong><br />APPROACH: {wave.approach}</p>
          <>
            <p>Choose an allocation, then tap FIRE DEFENSE to protect the hull. Attack waits for your order.</p>
            <div className="counterstrike-command__choices">{(Object.keys(MONUMENT_ORDERS) as MonumentOrder[]).map((order, index) => <button type="button" key={order} onClick={() => onAction(order)}>
              <span className="counterstrike-command__number">{index + 1}</span><span className="counterstrike-command__copy"><strong>{MONUMENT_ORDERS[order].title}</strong><small>{MONUMENT_ORDERS[order].detail}</small></span>
            </button>)}</div>
            {metrics.energyGeneratedKw < 10 ? <p className="monument-damage">Full defense needs 10 kW including base systems. Available: {metrics.energyGeneratedKw.toFixed(1)} kW. Partial power increases hull damage.</p> : null}
          </>
        </div> : null}
        {m.status === 'wave' && wave ? <WaveDefenseHud view={m} durationMs={wave.durationMs}
          allocationText={`${MONUMENT_ORDERS[m.orders[m.wavesResolved]!].title} · ${allocation!.builders} BUILD · ${allocation!.defenders} DEFEND · ${metrics.activeRobots} MINE`}
          hitDetail={`${DEFENSE_HULL_SAVED} hull damage prevented. Escorts breaking away.`} onFire={() => onAction('fire')} /> : null}
        {m.status === 'activating' ? <p role="status">3/3 WAVES CLEARED · Finishing powered construction.</p> : null}
        {m.status === 'damaged' || repair ? <>
          <p className="monument-damage" role="status">{repair ? 'REPAIRING MONUMENT' : 'DAMAGED · REPAIRABLE'}<br />−30% production · −15% solar energy · {m.oreLost.toFixed(0)} stored ore lost. Monument benefit offline.</p>
          <p className="monument-radio">“{OCTOGONALS.failure}”</p>
          {m.status === 'damaged' ? <><button type="button" disabled={!canStartMonument(outpost, m.kind, firstStrike, true)} onClick={() => onAction('repair')}>REPAIR MONUMENT · 20 ORE</button>
            <p>2 robots · 4 kW · 15s at full power (60 kW·s, 30 robot-seconds). Repairs this monument and its production penalty; earlier campaign damage remains. No further attacks.</p></> : null}
        </> : null}
        {m.status === 'complete' ? <>
          <p role="status">{m.kind === 'HELIOS_SPIRE' ? HELIOS_ONLINE_LABEL : <>TERRITORY CLAIMED · PERMANENT<br />{spec!.benefit}</>}</p>
          <p className="monument-radio">“{OCTOGONALS.victory}”</p>
          <button type="button" onClick={onReplay}>REPLAY ORBITAL REVEAL</button>
        </> : null}
      </>}
    </>}
    <footer><button type="button" onClick={onClose}>{m?.status === 'complete' ? 'RETURN TO ORBIT' : 'BACK TO OUTPOST'}</button><button type="button" onClick={onReset}>NEW GAME</button></footer>
  </section>
}
