export interface InterceptorPointerSample {
  readonly pointerId: number
  readonly clientX: number
  readonly clientY: number
  readonly isPrimary: boolean
}

export interface InterceptorFireGestureState {
  readonly activePointerId: number | null
  readonly startX: number
  readonly startY: number
  readonly cancelled: boolean
}

export interface InterceptorFireGestureResult {
  readonly state: InterceptorFireGestureState
  readonly shouldFire: boolean
}

export const INTERCEPTOR_FIRE_MOVEMENT_TOLERANCE_PX = 10

export const INITIAL_INTERCEPTOR_FIRE_GESTURE: InterceptorFireGestureState =
  Object.freeze({
    activePointerId: null,
    startX: 0,
    startY: 0,
    cancelled: false,
  })

export function beginInterceptorFireGesture(
  state: InterceptorFireGestureState,
  sample: InterceptorPointerSample,
): InterceptorFireGestureState {
  if (state.activePointerId !== null) {
    return { ...state, cancelled: true }
  }
  if (!sample.isPrimary) return state

  return {
    activePointerId: sample.pointerId,
    startX: sample.clientX,
    startY: sample.clientY,
    cancelled: false,
  }
}

export function moveInterceptorFireGesture(
  state: InterceptorFireGestureState,
  sample: InterceptorPointerSample,
): InterceptorFireGestureState {
  if (state.activePointerId !== sample.pointerId || state.cancelled) {
    return state
  }

  const moved =
    Math.hypot(sample.clientX - state.startX, sample.clientY - state.startY) >
    INTERCEPTOR_FIRE_MOVEMENT_TOLERANCE_PX

  return moved ? { ...state, cancelled: true } : state
}

export function endInterceptorFireGesture(
  state: InterceptorFireGestureState,
  sample: InterceptorPointerSample,
): InterceptorFireGestureResult {
  if (state.activePointerId !== sample.pointerId) {
    return { state, shouldFire: false }
  }

  const moved =
    Math.hypot(sample.clientX - state.startX, sample.clientY - state.startY) >
    INTERCEPTOR_FIRE_MOVEMENT_TOLERANCE_PX

  return {
    state: INITIAL_INTERCEPTOR_FIRE_GESTURE,
    shouldFire: !state.cancelled && !moved && sample.isPrimary,
  }
}

export function cancelInterceptorFireGesture(): InterceptorFireGestureState {
  return INITIAL_INTERCEPTOR_FIRE_GESTURE
}
