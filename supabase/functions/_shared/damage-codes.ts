// Common AIAG area/type/severity mappings cross-checked against Stellantis
// Vehicle Shipping Manual, December 2024, section 5.3 (page 34).
// Numeric identifiers are factual mappings, not OEM-specific claim rules.
export const DAMAGE_CATALOG_VERSION = 'aiag-common-2024-12-v1';
export const DAMAGE_REFERENCE = 'https://gsp.extra.chrysler.com/qlty/vsm/pdf/VSM%20-%20December%202024%20Final.pdf';
export type VehicleView = 'left'|'right'|'front'|'rear'|'top';
export type DamageArea = {id:string;label:string;code:string;group:'body'|'glass'|'mirror'|'wheel'|'tire';view:VehicleView};
export const DAMAGE_AREAS: DamageArea[] = [
  {id:'front-bumper',label:'Front bumper',code:'03',group:'body',view:'front'},
  {id:'rear-bumper',label:'Rear bumper',code:'04',group:'body',view:'rear'},
  {id:'left-front-door',label:'Left front door',code:'10',group:'body',view:'left'},
  {id:'left-rear-door',label:'Left rear door',code:'11',group:'body',view:'left'},
  {id:'right-front-door',label:'Right front door',code:'12',group:'body',view:'right'},
  {id:'right-rear-door',label:'Right rear door',code:'13',group:'body',view:'right'},
  {id:'left-front-window',label:'Left front window',code:'10',group:'glass',view:'left'},
  {id:'left-rear-window',label:'Left rear window',code:'11',group:'glass',view:'left'},
  {id:'right-front-window',label:'Right front window',code:'12',group:'glass',view:'right'},
  {id:'right-rear-window',label:'Right rear window',code:'13',group:'glass',view:'right'},
  {id:'left-front-fender',label:'Left front fender',code:'14',group:'body',view:'left'},
  {id:'left-rear-quarter',label:'Left rear quarter',code:'15',group:'body',view:'left'},
  {id:'right-front-fender',label:'Right front fender',code:'16',group:'body',view:'right'},
  {id:'right-rear-quarter',label:'Right rear quarter',code:'17',group:'body',view:'right'},
  {id:'windshield',label:'Windshield',code:'19',group:'glass',view:'front'},
  {id:'rear-glass',label:'Rear glass',code:'20',group:'glass',view:'rear'},
  {id:'hood',label:'Hood',code:'27',group:'body',view:'top'},
  {id:'left-mirror',label:'Left mirror',code:'30',group:'mirror',view:'left'},
  {id:'right-mirror',label:'Right mirror',code:'31',group:'mirror',view:'right'},
  {id:'left-rocker',label:'Left rocker / sill',code:'35',group:'body',view:'left'},
  {id:'right-rocker',label:'Right rocker / sill',code:'36',group:'body',view:'right'},
  {id:'roof',label:'Roof',code:'37',group:'body',view:'top'},
  {id:'trunk',label:'Trunk / liftgate',code:'52',group:'body',view:'rear'},
  {id:'left-front-tire',label:'Left front tire',code:'72',group:'tire',view:'left'},
  {id:'left-front-wheel',label:'Left front wheel',code:'73',group:'wheel',view:'left'},
  {id:'left-rear-tire',label:'Left rear tire',code:'74',group:'tire',view:'left'},
  {id:'left-rear-wheel',label:'Left rear wheel',code:'75',group:'wheel',view:'left'},
  {id:'right-rear-tire',label:'Right rear tire',code:'76',group:'tire',view:'right'},
  {id:'right-rear-wheel',label:'Right rear wheel',code:'77',group:'wheel',view:'right'},
  {id:'right-front-tire',label:'Right front tire',code:'78',group:'tire',view:'right'},
  {id:'right-front-wheel',label:'Right front wheel',code:'79',group:'wheel',view:'right'},
];
export const DAMAGE_TYPES = [
  {id:'scratch',label:'Scratch',code:'12',groups:['body','mirror','wheel']},
  {id:'dent-paint',label:'Dent + paint damage',code:'04',groups:['body','mirror','wheel']},
  {id:'dent',label:'Dent, paint intact',code:'14',groups:['body','mirror','wheel']},
  {id:'scuff',label:'Scuff',code:'09',groups:['body','mirror','wheel']},
  {id:'chip',label:'Paint chip',code:'05',groups:['body','mirror','wheel']},
  {id:'edge-chip',label:'Panel edge chip',code:'34',groups:['body']},
  {id:'bent',label:'Bent',code:'01',groups:['body','mirror','wheel']},
  {id:'cracked',label:'Cracked',code:'06',groups:['body','mirror','wheel']},
  {id:'gouged',label:'Gouge',code:'07',groups:['body','mirror','wheel']},
  {id:'cut',label:'Cut',code:'03',groups:['tire']},
  {id:'punctured',label:'Puncture',code:'11',groups:['tire']},
  {id:'missing',label:'Missing',code:'08',groups:['body','glass','mirror','wheel','tire'],fixedSeverity:6},
  {id:'glass-cracked',label:'Glass cracked',code:'20',groups:['glass','mirror']},
  {id:'glass-broken',label:'Glass broken',code:'21',groups:['glass','mirror'],fixedSeverity:6},
  {id:'glass-chipped',label:'Glass chip',code:'22',groups:['glass','mirror']},
  {id:'glass-scratched',label:'Glass scratch',code:'23',groups:['glass','mirror']},
] as const;
export const DAMAGE_SIZES = [
  {value:1,label:'Up to 1 in',hint:'Up to 2.5 cm'},
  {value:2,label:'Over 1–3 in',hint:'Over 2.5–7.6 cm'},
  {value:3,label:'Over 3–6 in',hint:'Over 7.6–15.2 cm'},
  {value:4,label:'Over 6–12 in',hint:'Over 15.2–30.5 cm'},
  {value:5,label:'Over 12 in',hint:'Over 30.5 cm'},
  {value:6,label:'Major damage',hint:'Missing or major damage'},
];
export type DamageInput = {id:string;areaId:string;typeId:string;severity:number};
export type DamageRecord = DamageInput & {code:string;areaLabel:string;typeLabel:string;sizeLabel:string};
export function damageOptions(areaId:string) {
  const area=DAMAGE_AREAS.find(a=>a.id===areaId);
  return area ? DAMAGE_TYPES.filter(t=>(t.groups as readonly string[]).includes(area.group)) : [];
}
export function damageRecord(raw:DamageInput): DamageRecord {
  if (!raw || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.id)) throw new Error('Invalid damage ID.');
  const area=DAMAGE_AREAS.find(a=>a.id===raw.areaId),type=damageOptions(raw.areaId).find(t=>t.id===raw.typeId);
  if(!area || !type)throw new Error('Choose a valid part and damage type.');
  const fixed='fixedSeverity' in type ? type.fixedSeverity : null;
  if(!Number.isInteger(raw.severity) || !DAMAGE_SIZES.some(s=>s.value===raw.severity) || (fixed && raw.severity!==fixed))throw new Error('Choose a valid damage size.');
  return {id:raw.id.toLowerCase(),areaId:area.id,typeId:type.id,severity:raw.severity,code:`${area.code}-${type.code}-${raw.severity}`,areaLabel:area.label,typeLabel:type.label,sizeLabel:fixed?'Missing / major':DAMAGE_SIZES.find(s=>s.value===raw.severity)!.label};
}
export function damageRecords(raw:unknown): DamageRecord[] {
  if(!Array.isArray(raw) || raw.length>40)throw new Error('Record no more than 40 damages.');
  const result=raw.map(value=>damageRecord(value));
  if(new Set(result.map(v=>v.id)).size!==result.length)throw new Error('Each damage must have a unique ID.');
  return result;
}
