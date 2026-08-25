const MULTI_TOUCH_COOLDOWN_MS = 350

export interface TouchSelectionGate {
  readonly activePointerIds: Set<number>
  multiTouchGesture: boolean
  blockedUntilMs: number
}

export function createTouchSelectionGate(): TouchSelectionGate {
  return {
    activePointerIds: new Set<number>(),
    multiTouchGesture: false,
    blockedUntilMs: 0,
  }
}

export function beginTouch(
  gate: TouchSelectionGate,
  pointerId: number,
): void {
  gate.activePointerIds.add(pointerId)

  if (gate.activePointerIds.size > 1) {
    gate.multiTouchGesture = true
    gate.blockedUntilMs = Number.POSITIVE_INFINITY
  }
}

export function endTouch(
  gate: TouchSelectionGate,
  pointerId: number,
  nowMs: number,
): void {
  gate.activePointerIds.delete(pointerId)

  if (gate.activePointerIds.size !== 0) {
    return
  }

  if (gate.multiTouchGesture) {
    gate.blockedUntilMs = nowMs + MULTI_TOUCH_COOLDOWN_MS
  }

  gate.multiTouchGesture = false
}

export function resetTouchSelectionGate(gate: TouchSelectionGate): void {
  gate.activePointerIds.clear()
  gate.multiTouchGesture = false
  gate.blockedUntilMs = 0
}

export function canSelectWithTouchGate(
  gate: TouchSelectionGate,
  nowMs: number,
): boolean {
  return nowMs >= gate.blockedUntilMs
}
