export type LoadStatus = 'pending'|'accepted'|'active'|'paused'|'completed'|'cancelled'|'declined'|'expired';
export type Load = {
  id:string; title:string; dealerName:string; carrierName:string; carrierDot:string;
  driverName:string; driverPhone:string; status:LoadStatus; vehicles:string[];
  pickupAddress:string; deliveryAddress:string; plannedAt:string|null; expiresAt:string;
  acceptedAt:string|null; completedAt:string|null;
};
export type Point = {id:string;latitude:number;longitude:number;accuracy:number;capturedAt:string};
export type SharingControl = {enabled:boolean;userId:string;loads:{id:string;expiresAt:string}[]};
