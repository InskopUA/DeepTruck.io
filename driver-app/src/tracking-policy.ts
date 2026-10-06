import type { Point, SharingControl } from './types';
export const MAX_QUEUED_POINTS=720;
export function canCollect(control:SharingControl|null,userId:string,now:number) {
  return Boolean(control?.enabled && control.userId===userId && control.loads.some(v=>Date.parse(v.expiresAt)>now));
}
export function validPoint(point:Point,now:number) {
  return Number.isFinite(point.latitude) && point.latitude>=-90 && point.latitude<=90 &&
    Number.isFinite(point.longitude) && point.longitude>=-180 && point.longitude<=180 &&
    Number.isFinite(point.accuracy) && point.accuracy>=0 && point.accuracy<=10000 &&
    Number.isFinite(Date.parse(point.capturedAt)) && Date.parse(point.capturedAt)<=now && Date.parse(point.capturedAt)>now-86400000;
}
