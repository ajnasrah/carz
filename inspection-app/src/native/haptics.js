import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { isNative } from './platform'

// Physical feedback for the two flows done one-handed while walking a lot or
// standing at a car: tapping damage onto the diagram, and confirming a scan.
// No-ops on web, so call sites don't need to branch.

export const tap = () => { if (isNative()) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}) }

export const bump = () => { if (isNative()) Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {}) }

export const success = () => {
  if (isNative()) Haptics.notification({ type: NotificationType.Success }).catch(() => {})
}

export const warn = () => {
  if (isNative()) Haptics.notification({ type: NotificationType.Warning }).catch(() => {})
}

export const fail = () => {
  if (isNative()) Haptics.notification({ type: NotificationType.Error }).catch(() => {})
}
