import { describe, expect, it } from 'vitest'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { DEPOSIT_BLUEPRINTS, type OutpostSnapshot } from '../domain/outpost.ts'
import { advanceOutpost, commandMineDeposit, createInitialOutpost, getRobotKinematics } from '../simulation/outpostSimulation.ts'
import { advanceWorkerNavigation, capsuleServiceBay, createWorkerNavigation, planWorkerPath,
  workerObstacles, workerSegmentClear, WORKER_RADIUS_M } from './miningPresentation.ts'

const site = createLandingSite(createLunarLocation(.248, -.684, 18))
function fixture(deposit = DEPOSIT_BLUEPRINTS[0]!, module: OutpostSnapshot['module'] = null): OutpostSnapshot {
  return { ...createInitialOutpost(site, 0), module, extractor: { id: 'extractor-01', depositId: deposit.id,
    position: deposit.position, orientationRad: deposit.orientationRad, status: 'active',
    constructionStartedAtMs: 0, activationTimestampMs: 0, lastProductionAtMs: 0 } }
}
const moduleFor = (kind: 'REPAIR_GANTRY' | 'SOLAR_WING' | 'STORAGE_SILO') => ({ id: 'module-slot-01' as const,
  kind, status: 'active' as const, constructionStartedAtMs: 0, completionTimestampMs: 0, repairProgress: 0, lastRepairAtMs: 0 })
const separation = (a: {xM:number;zM:number}, b: {xM:number;zM:number}) => Math.hypot(a.xM-b.xM,a.zM-b.zM)

describe('capsule service docking and damaged worker navigation', () => {
  it('places the service berth close to the capsule with a collision-safe leg buffer', () => {
    const bay = capsuleServiceBay()
    const clearance = Math.hypot(bay.xM, bay.zM) - 3.65 - WORKER_RADIUS_M
    expect(clearance).toBeGreaterThan(.4)
    expect(clearance).toBeLessThan(.6)
  })

  for (const deposit of DEPOSIT_BLUEPRINTS) for (const kind of [null, 'REPAIR_GANTRY', 'SOLAR_WING', 'STORAGE_SILO'] as const) {
    it(`${deposit.id} / ${kind ?? 'bare'} avoids capsule, deposits, modules, couplers and crater throughout repair`, () => {
      const outpost = fixture(deposit, kind ? moduleFor(kind) : null)
      const nav = createWorkerNavigation(), tasks = [new Set<string>(),new Set<string>(),new Set<string>()]
      const epoch = 1_789_538_400_000
      advanceWorkerNavigation(nav,outpost,epoch,1,3,false)
      const intactObstacles=workerObstacles(outpost,false),damagedObstacles=workerObstacles(outpost,true)
      for (let i = 0; i <= 6000; i++) {
        const damaged = i >= 400 && i < 2200
        const repair = Math.max(0, Math.min(1,(i-600)/1600))
        const snapshot = outpost.module ? {...outpost,module:{...outpost.module,repairProgress:repair}} : outpost
        const previous = nav.workers.map(w=>({...w}))
        advanceWorkerNavigation(nav,snapshot,epoch+i*50, damaged ? .7+.3*repair : 1,3,damaged)
        const obstacles = damaged ? damagedObstacles : intactObstacles
        for (let j=0;j<3;j++) {
          const w=nav.workers[j]!
          expect([w.xM,w.zM,w.heading,w.wheelSpin].every(Number.isFinite)).toBe(true)
          expect(separation(w,previous[j]!)).toBeLessThanOrEqual(.12000001)
          expect(workerSegmentClear(previous[j]!,w,obstacles)).toBe(true)
          for(let k=j+1;k<3;k++) expect(separation(w,nav.workers[k]!)).toBeGreaterThan(WORKER_RADIUS_M*2)
          tasks[j]!.add(w.task)
          if(w.task==='servicing') expect(separation(w,capsuleServiceBay())).toBeLessThan(1e-8)
        }
      }
      expect(nav.workers.filter(w=>w.task==='servicing').length).toBeLessThanOrEqual(1)
      // All bots complete their work and return; no stalled target hidden by a
      // successful clearance check. Repair progress must not rebuild routes.
      for(const seen of tasks) expect([...seen].sort()).toEqual(['returning','servicing','traveling','working'])
      expect(nav.revision).toBe(3)
    })
  }

  it('preserves position across production changes, pause/resume, allocation and clock discontinuities', () => {
    const outpost=fixture(),nav=createWorkerNavigation(),epoch=1_789_538_400_000
    for(let i=0;i<50;i++) advanceWorkerNavigation(nav,outpost,epoch+i*50,1,1,false)
    const before=nav.workers.map(w=>({...w}))
    advanceWorkerNavigation(nav,outpost,epoch+2450, .17,3,true)
    expect(nav.workers.map(w=>[w.xM,w.zM])).toEqual(before.map(w=>[w.xM,w.zM]))
    for(const time of [epoch+2500,epoch+100000,epoch-2000,NaN,Infinity]) {
      const previous=nav.workers.map(w=>({...w}))
      advanceWorkerNavigation(nav,outpost,time,1,3,true)
      for(let j=0;j<3;j++) expect(separation(previous[j]!,nav.workers[j]!)).toBeLessThanOrEqual(.24000001)
    }
    const stopped=nav.workers.map(w=>[w.xM,w.zM])
    advanceWorkerNavigation(nav,outpost,epoch+100100,0,3,true)
    expect(nav.workers.map(w=>[w.xM,w.zM])).toEqual(stopped)
    expect(planWorkerPath({xM:NaN,zM:0},capsuleServiceBay(),[])).toEqual([])
    const invalid={...outpost,extractor:{...outpost.extractor!,position:{xM:NaN,zM:Infinity}}}
    for(let i=0;i<50;i++) advanceWorkerNavigation(nav,invalid,epoch+100200+i*50,1,3,true)
    expect(nav.workers.map(w=>[w.xM,w.zM])).toEqual(stopped)
    expect(nav.workers.every(w=>Number.isFinite(w.heading))).toBe(true)
  })
})

it('replans once for gantry construction and preserves the current position', () => {
  const outpost=fixture(), nav=createWorkerNavigation()
  for(let i=0;i<100;i++) advanceWorkerNavigation(nav,outpost,i*50,1,3,true)
  const before=nav.workers.map(w=>[w.xM,w.zM])
  const repairing={...outpost,module:moduleFor('REPAIR_GANTRY')}
  advanceWorkerNavigation(nav,repairing,4950,1,3,true)
  expect(nav.workers.map(w=>[w.xM,w.zM])).toEqual(before)
  const revision=nav.revision
  for(let i=100;i<2400;i++) advanceWorkerNavigation(nav,repairing,i*50,1,3,true)
  expect(nav.revision).toBe(revision)
  expect(nav.workers.some(w=>w.task==='working'||w.task==='returning')).toBe(true)
})

it('returns a single active bot to the capsule through damage and recovery', () => {
  const outpost=fixture(),nav=createWorkerNavigation()
  let visitedExtractor=false,returned=false
  for(let i=0;i<2400;i++) {
    advanceWorkerNavigation(nav,outpost,i*50,i<1200?.7:1,1,i<1200)
    const worker=nav.workers[0]!
    visitedExtractor ||= worker.task==='working'
    if(visitedExtractor && worker.task==='servicing') {
      expect(separation(worker,capsuleServiceBay())).toBeLessThan(1e-8)
      returned=true
    }
  }
  expect(returned).toBe(true)
})

it('keeps service traffic clear of the unchanged manually commanded miner', () => {
  for (const extractor of DEPOSIT_BLUEPRINTS) for (const deposit of DEPOSIT_BLUEPRINTS) {
    if(extractor.id===deposit.id) continue
    for(const commandAt of [1000,4000,8000,15000]) {
      const initial=fixture(extractor)
      let outpost: OutpostSnapshot={...initial,stage:'extractor-active',robot:{...initial.robot,state:'idle'}}
      const nav=createWorkerNavigation()
      for(let now=0;now<50000;now+=50) {
        if(now===commandAt) outpost=commandMineDeposit(outpost,deposit.id,now)
        outpost=advanceOutpost(outpost,now)
        advanceWorkerNavigation(nav,outpost,now,1,3,false)
        const miner=getRobotKinematics(outpost,now).position
        for(const worker of nav.workers) expect(separation(worker,miner),JSON.stringify({extractor:extractor.id,deposit:deposit.id,commandAt,now,task:worker.task,worker,miner})).toBeGreaterThan(WORKER_RADIUS_M+1.25*1.14)
      }
    }
  }
})
