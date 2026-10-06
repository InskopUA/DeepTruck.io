import type { Load, LoadStatus } from './types';

export type LocationAccess = { services: boolean; foreground: boolean; background: boolean; precise: boolean };
export type TrackingHealth = { enabled: boolean; queued: number; lastUpload: string | null; lastCapture: string | null; error: string | null };
export const initialHealth: TrackingHealth = { enabled: false, queued: 0, lastUpload: null, lastCapture: null, error: null };
export const initialAccess: LocationAccess = { services: true, foreground: false, background: false, precise: true };
export const closed = (status: LoadStatus) => ['completed', 'cancelled', 'declined', 'expired'].includes(status);
export const effectiveLoad = (load: Load, now: number): Load => !closed(load.status) && Date.parse(load.expiresAt) <= now ? { ...load, status: 'expired' } : load;
export const locationReady = (access: LocationAccess) => access.services && access.foreground && access.background;
export function loadPresentation(load: Load, health: TrackingHealth, access: LocationAccess, now: number) {
  if (load.status === 'pending') return { label: 'New invitation', tone: 'blue', action: 'Accept & start tracking' } as const;
  if (load.status === 'accepted') return { label: 'Ready to start', tone: 'neutral', action: 'Start tracking' } as const;
  if (load.status === 'paused') return { label: 'Paused', tone: 'amber', action: 'Resume tracking' } as const;
  if (closed(load.status)) return { label: { completed: 'Delivered', cancelled: 'Cancelled', declined: 'Declined', expired: 'Expired' }[load.status as 'completed' | 'cancelled' | 'declined' | 'expired'], tone: 'neutral', action: null } as const;
  if (!locationReady(access)) return { label: 'Location access needed', tone: 'amber', action: 'Enable location' } as const;
  if (!health.enabled) return { label: 'Tracking stopped', tone: 'amber', action: 'Resume tracking' } as const;
  if (health.queued > 0) return { label: 'Waiting for connection', tone: 'amber', action: 'Pause tracking' } as const;
  if (health.error) return { label: 'Location update issue', tone: 'amber', action: 'Resume tracking' } as const;
  if (!health.lastCapture) return { label: 'Waiting for GPS', tone: 'amber', action: 'Pause tracking' } as const;
  if (now - Date.parse(health.lastCapture) > 300000) return { label: 'Waiting for GPS update', tone: 'amber', action: 'Pause tracking' } as const;
  return { label: 'Sharing location', tone: 'green', action: 'Pause tracking' } as const;
}
export function updateAge(value: string | null, now: number) {
  if (!value) return 'Waiting for first update';
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60000));
  return minutes < 1 ? 'Updated just now' : `Updated ${minutes} min ago`;
}
