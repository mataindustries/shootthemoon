let fixedSimulationNowMs: number | null = null

export function simulationNowMs(): number {
  return fixedSimulationNowMs ?? Date.now()
}

export function isSimulationTimePaused(): boolean {
  return fixedSimulationNowMs !== null
}

export function setSimulationTimePaused(
  paused: boolean,
  visualOffsetMs = 0,
): void {
  fixedSimulationNowMs = paused ? Date.now() + visualOffsetMs : null
}
