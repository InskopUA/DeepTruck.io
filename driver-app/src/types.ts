export type LoadStatus = 'pending'|'accepted'|'active'|'paused'|'completed'|'cancelled'|'declined'|'expired';
export type PickupDocument = {id:string;name:string;kind:'gate_pass'|'release_form';mimeType:string;size:number;openedAt:string|null};
export type PickupDocuments = {documents:PickupDocument[];status:'locked'|'available'|'closed';canOpen:boolean;unlockedAt:string|null;unlockMethod:'arrival'|'manual'|null};
export type Load = {
  id:string; title:string; dealerName:string; carrierName:string; carrierDot:string;
  driverName:string; driverPhone:string; status:LoadStatus; vehicles:string[];
  pickupAddress:string; deliveryAddress:string; plannedAt:string|null; expiresAt:string;
  acceptedAt:string|null; completedAt:string|null;
  pickupLocation?:{latitude:number;longitude:number;radiusMiles:1}|null;
  pickupDocuments?:PickupDocuments;
};
export type Point = {id:string;latitude:number;longitude:number;accuracy:number;capturedAt:string};
export type SharingControl = {enabled:boolean;userId:string;loads:{id:string;expiresAt:string}[]};
