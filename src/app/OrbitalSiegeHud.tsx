import type { OutpostSnapshot } from '../domain/outpost.ts'
import { PLATFORM_ORE_COST, PLATFORM_POWER_KW, SIEGE_COMMAND_END_MS, SIEGE_WAVE_TIMES, SIEGE_ORDERS, siegeAllocation, siegeIsActive, type SiegeOrder } from '../domain/orbitalSiege.ts'
import { canStartOrbitalSiege } from '../simulation/orbitalSiegeSimulation.ts'
import type { OutpostOperationsMetrics } from '../simulation/outpostOperations.ts'

export type SiegeAction = 'build' | 'repair' | SiegeOrder

export function OrbitalSiegeHud({ outpost, metrics, onAction }: {
  readonly outpost: OutpostSnapshot
  readonly metrics: OutpostOperationsMetrics
  readonly onAction: (action: SiegeAction) => void
}) {
  const siege = outpost.orbitalSiege
  if (siege === null && outpost.lunarOre < PLATFORM_ORE_COST) return null
  const active = siegeIsActive(siege)
  const allocation = siegeAllocation(siege)
  return (
    <section className="siege-panel" aria-label="Orbital Siege" data-siege-status={siege?.status ?? 'available'}>
      <header><span>ORBITAL SIEGE</span><strong>{siege === null ? 'ORBITAL PLATFORM' :
        siege.status === 'operational' ? 'ORBITAL CONTROL ACHIEVED' :
        siege.status === 'damaged' ? 'PLATFORM BREACHED · RECOVERABLE' :
        siege.status === 'repairing' ? 'REPAIRING PLATFORM' :
        siege.status === 'constructing' ? 'ASSEMBLING ABOVE OUTPOST' : 'INCOMING DRONE SWARM'}</strong></header>
      {siege === null ? <>
        <p className="siege-benefit">+20% ORE DELIVERY</p>
        <p className="siege-stats">{PLATFORM_ORE_COST} ORE · {PLATFORM_POWER_KW} kW · 2 ROBOTS</p>
        <details className="siege-detail">
          <summary>ASSEMBLY DETAILS</summary>
          <p>Orbital logistics relay. Reserves 2 of 3 robots and {PLATFORM_POWER_KW} kW for assembly. No defense reserve; remaining miner works at −25% ore delivery.</p>
        </details>
      </> : <>
        <div className="siege-progress"><span>{Math.round(siege.progress * 100)}% ASSEMBLED</span><span>HULL {siege.platformHealth}%</span></div>
        <progress aria-label="Platform assembly" value={siege.progress} max={1} />
        {active ? <p>{metrics.activeRobots} mining · {allocation.builders} building · {allocation.defenders} defending<br />{metrics.platformAllocationKw} kW platform + {metrics.defenseAllocationKw.toFixed(1)} kW defense · {metrics.miningAllocationKw.toFixed(1)} kW mining<br />Assembly delivery −25% · Defense reserve {allocation.readiness}/3 · {metrics.productionPerMin.toFixed(1)} ore/min</p> : null}
        {metrics.defenseAllocationKw < metrics.defenseDemandKw ? <p className="siege-damage">DEFENSE UNDERPOWERED · Interception weakened; more damage per wave.</p> : null}
        {siege.status === 'waves' ? <p role="status">{SIEGE_ORDERS[siege.order!].title} · {siege.wavesResolved}/3 WAVES RESOLVED<br />Wave {siege.wavesResolved + 1} in {Math.ceil((SIEGE_WAVE_TIMES[siege.wavesResolved]! - siege.elapsedMs) / 1000)}s</p> : null}
        {siege.outpostDamage > 0 ? <p className="siege-damage">OUTPOST DAMAGE · −{siege.outpostDamage}% PRODUCTION{siege.energyLoss > 0 ? ` · −${siege.energyLoss * 100}% ENERGY · ${siege.oreLost.toFixed(0)} ORE LOST` : ''}</p> : null}
        {siege.status === 'operational' ? <p role="status">3/3 WAVES CLEARED · +20% ORE DELIVERY ACTIVE</p> : null}
        {siege.status === 'damaged' ? <p role="status">3/3 WAVES ENDED · Logistics offline. Repair restores siege damage; ore losses remain.</p> : null}
      </>}
      {siege?.status === 'command' ? <div className="siege-command counterstrike-command">
        <p>After platform reservation: {Math.max(0, metrics.energyGeneratedKw - 8).toFixed(1)} kW available for defense. Full interception needs 6 kW.</p>
        <header role="alert"><span>INCOMING DRONE SWARM · THREE WAVES</span><strong>ISSUE ONE ORDER</strong></header>
        <div className="counterstrike-command__countdown" role="timer">{Math.ceil((SIEGE_COMMAND_END_MS - siege.elapsedMs) / 1000)}s · THEN AUTO: HARDEN PLATFORM</div>
        <div className="counterstrike-command__choices">{(Object.keys(SIEGE_ORDERS) as SiegeOrder[]).map((order, index) => <button key={order} type="button" onClick={() => onAction(order)}><span className="counterstrike-command__number">{index + 1}</span><span className="counterstrike-command__copy"><strong>{SIEGE_ORDERS[order].title}</strong><small>{SIEGE_ORDERS[order].detail}</small></span></button>)}</div>
      </div> : null}
      {!active ? <>
        {(siege?.status === 'damaged' || (siege?.outpostDamage ?? 0) > 0) ? <button type="button" disabled={!canStartOrbitalSiege(outpost, true)} onClick={() => onAction('repair')}>REPAIR PLATFORM · 20 ORE · 4 kW · 15s</button> : null}
        <button type="button" disabled={!canStartOrbitalSiege(outpost)} onClick={() => onAction('build')}>{siege === null ? 'BUILD ORBITAL PLATFORM' : 'REPLAY ORBITAL SIEGE'} · 60 ORE</button>
        {siege !== null ? <small>Paid replay retains existing siege damage.</small> : null}
        {!canStartOrbitalSiege(outpost) ? <small>Requires 60 ore, 8 kW solar capacity, idle miner and completed module work.</small> : null}
      </> : null}
    </section>
  )
}
