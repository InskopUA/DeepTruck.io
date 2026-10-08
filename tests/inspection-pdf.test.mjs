import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import * as unpdf from 'unpdf';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {damageRecord,damageRecords,damageOptions,DAMAGE_AREAS} from '../supabase/functions/_shared/damage-codes.ts';
const require=createRequire(import.meta.url),{loadDriver}=require('./driver-module.cjs');
const {gatePassLayout,annotatedGatePass}=loadDriver('../supabase/functions/driver-tracking/inspection-pdf.ts',{'npm:pdf-lib@1.17.1':{PDFDocument,StandardFonts,...require('pdf-lib')},'npm:unpdf@1.8.1':unpdf,'npm:qrcode@1.5.4':QRCode,'./validation.ts':{HttpError:class extends Error{constructor(status,message){super(message);this.status=status;}}}});
const vin='4JGFF8KE5NA818644',url='https://www.deeptruck.io/i/AbCdEfGhIjKlMnOpQrStUv';
const record=(areaId='left-front-door',typeId='scratch',severity=3)=>damageRecord({id:randomUUID(),areaId,typeId,severity});
async function fixture({secondVin=false,terms=159}={}){
  const pdf=await PDFDocument.create(),page=pdf.addPage([612,792]),font=await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('ONSITE VEHICLE RELEASE',{x:30,y:720,font,size:16});page.drawText(vin.slice(0,9),{x:30,y:600,font,size:12});const bold=await pdf.embedFont(StandardFonts.HelveticaBold);page.drawText(vin.slice(9),{x:30+font.widthOfTextAtSize(vin.slice(0,9),12),y:600,font:bold,size:12});if(secondVin)page.drawText('4JGFF8KE5NA818645',{x:30,y:550,font,size:12});
  page.drawText('Subject to Manheim Terms & Conditions',{x:200,y:terms,font,size:7});page.drawText('ORIGINAL FOOTER',{x:30,y:15,font,size:10});
  const qr=await pdf.embedPng(await QRCode.toDataURL('https://auction.example/original-release',{margin:4,width:128}));page.drawImage(qr,{x:440,y:300,width:90,height:90});return pdf.save();
}
test('Damage catalog applies area/type/size mappings and rejects incompatible or fabricated codes',()=>{
  assert.equal(record().code,'10-12-3');assert.equal(record('windshield','glass-cracked',2).code,'19-20-2');assert.equal(record('right-front-wheel','scuff',1).code,'79-09-1');assert.equal(record('roof','missing',6).code,'37-08-6');
  assert.throws(()=>record('windshield','scratch'),/valid part/);assert.throws(()=>record('hood','glass-broken',6),/valid part/);assert.throws(()=>record('roof','missing',1),/valid damage size/);assert.throws(()=>record('hood','scratch',0),/size/);
  const d=record();assert.throws(()=>damageRecords([d,d]),/unique/);assert.throws(()=>damageRecords(Array.from({length:41},()=>record())),/40/);
  for(const area of DAMAGE_AREAS)assert.ok(damageOptions(area.id).length);
});
test('Gate pass keeps original QR/text and writes every code and a decodable photo QR in the blank area',async()=>{
  const original=await fixture(),layout=await gatePassLayout(original,'application/pdf');assert.equal(layout.sourceVin,undefined);assert.equal(layout.y,37);assert.equal(layout.height,110);
  for(const count of [0,1,4,40]){
    const damages=Array.from({length:count},()=>record());const bytes=await annotatedGatePass(original,'application/pdf',layout,damages,url,'2026-10-07T13:15:00Z');
    const text=await unpdf.extractText(new Uint8Array(bytes),{mergePages:true});assert.equal(text.totalPages,1);assert.ok(text.text.includes('ORIGINAL FOOTER'));assert.ok(text.text.includes('ONSITE VEHICLE RELEASE'));assert.ok(text.text.includes('RECORDED BY DRIVER'));assert.ok(text.text.includes(url.replace('https://','')));
    if(count)assert.equal(text.text.split('10-12-3').length-1,count);else assert.ok(text.text.includes('No visible damage observed'));
    const decoded=[];for(const image of await unpdf.extractImages(new Uint8Array(bytes),1)){
      const rgba=new Uint8ClampedArray(image.width*image.height*4);for(let p=0;p<image.width*image.height;p++){const c=p*image.channels;rgba[p*4]=image.data[c];rgba[p*4+1]=image.data[c+(image.channels===1?0:1)];rgba[p*4+2]=image.data[c+(image.channels===1?0:2)];rgba[p*4+3]=image.channels===4?image.data[c+3]:255;}
      const result=jsQR(rgba,image.width,image.height);if(result)decoded.push(result.data);
    }
    assert.ok(decoded.includes(url),'new photo QR decodes');assert.ok(decoded.includes('https://auction.example/original-release'),'original QR intact');
  }
  assert.ok(await gatePassLayout(await fixture({secondVin:true}),'application/pdf'),'no VIN matching or VIN-count restriction');
});
