export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function uuid(value: unknown, label = 'ID'): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400, `Invalid ${label}.`);
  return value;
}
export function text(value: unknown, label: string, max: number, required = true): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if ((required && !result) || result.length > max) throw new HttpError(400, `Please enter a valid ${label}.`);
  return result;
}
export function phone(value: unknown): string {
  let normalized = String(value || '').replace(/[\s().-]/g, '');
  if (/^\d{10}$/.test(normalized)) normalized = '+1' + normalized;
  if (/^1\d{10}$/.test(normalized)) normalized = '+' + normalized;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new HttpError(400, 'Enter the driver phone number with country code.');
  return normalized;
}
export function effectiveStatus(load: {status: string; expires_at: string}, now = Date.now()): string {
  return !['completed','cancelled','declined'].includes(load.status) && Date.parse(load.expires_at) <= now ? 'expired' : load.status;
}
export function createPayload(body: Record<string, unknown>, dealerName: string, now = Date.now()) {
  const expiry = Date.parse(String(body.expiresAt || ''));
  if (!Number.isFinite(expiry) || expiry <= now + 300000 || expiry > now + 30 * 86400000) throw new HttpError(400, 'Choose an expiry within the next 30 days.');
  const planned = body.plannedAt ? Date.parse(String(body.plannedAt)) : null;
  if (planned !== null && (!Number.isFinite(planned) || planned >= expiry)) throw new HttpError(400, 'Planned pickup must be before tracking expiry.');
  const vehicles = body.vehicles ?? [];
  if (!Array.isArray(vehicles) || vehicles.length > 50) throw new HttpError(400, 'Add no more than 50 vehicles.');
  return {
    dealer_name: text(dealerName,'dealer name',160), driver_name: text(body.driverName,'driver name',120),
    driver_phone: phone(body.driverPhone), title: text(body.title,'load name',160),
    pickup_address: text(body.pickupAddress,'pickup address',500,false), delivery_address: text(body.deliveryAddress,'delivery address',500,false),
    vehicles: vehicles.map(v => text(v,'vehicle description',160)),
    planned_at: planned === null ? null : new Date(planned).toISOString(), expires_at: new Date(expiry).toISOString()
  };
}
export function locationBatch(body: Record<string, unknown>) {
  if (!Array.isArray(body.points) || body.points.length < 1 || body.points.length > 100) throw new HttpError(400, 'Send between 1 and 100 location points.');
  return body.points.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new HttpError(400,'Invalid location.');
    const p = raw as Record<string, unknown>;
    for (const [key,min,max] of [['latitude',-90,90],['longitude',-180,180],['accuracy',0,10000]] as const) {
      if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new HttpError(400, `Invalid ${key}.`);
    }
    const timestamp = Date.parse(String(p.capturedAt || ''));
    if (!Number.isFinite(timestamp)) throw new HttpError(400,'Invalid location time.');
    return {id: uuid(p.id,'point ID'),latitude: p.latitude,longitude: p.longitude,accuracy: p.accuracy,captured_at: new Date(timestamp).toISOString()};
  });
}
