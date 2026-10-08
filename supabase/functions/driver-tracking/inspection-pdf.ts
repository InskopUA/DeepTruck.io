import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from 'npm:pdf-lib@1.17.1';
import { extractTextItems } from 'npm:unpdf@1.8.1';
import QRCode from 'npm:qrcode@1.5.4';
import type { DamageRecord } from '../_shared/damage-codes.ts';
import { HttpError } from './validation.ts';

export type GatePassLayout = {page:number;x:number;y:number;width:number;height:number;image:boolean};
export async function gatePassLayout(bytes:Uint8Array,mime:string):Promise<GatePassLayout> {
  if(mime!=='application/pdf')return {page:0,x:32,y:32,width:548,height:116,image:true};
  try {
    const pdf=await PDFDocument.load(bytes);if(pdf.getPageCount()>10)throw new HttpError(400,'Use a gate pass for one vehicle, up to 10 pages.');
    const {items}=await extractTextItems(new Uint8Array(bytes));
    const pageRows: {y:number;height:number;text:string;end:number}[][]=[];
    for(const entries of items){
      const rows: {y:number;height:number;text:string;end:number}[]=[];
      for(const item of entries.filter(v=>v.str.trim()).sort((a,b)=>b.y-a.y || a.x-b.x)){
        let row=rows.find(v=>Math.abs(v.y-item.y)<2);if(!row){row={y:item.y,height:item.height,text:'',end:0};rows.push(row);}
        // Join physically adjacent glyph runs when locating template text.
        row.text+=(row.text && item.x-row.end>2 ? ' ' : '')+item.str;row.end=item.x+item.width;
      }
      pageRows.push(rows);
    }
    for(let page=0;page<items.length;page++){
      const p=pdf.getPage(page),{width,height}=p.getSize();if(p.getRotation().angle!==0)continue;
      const rows=pageRows[page];
      if(!rows.some(row=>/ONSITE VEHICLE RELEASE/i.test(row.text)))continue;
      const terms=rows.find(row=>/Subject to\s+Manheim\s+Terms/i.test(row.text));if(!terms)continue;
      const bottom=rows.filter(row=>row.y<terms.y-5),footerTop=Math.max(18,...bottom.map(row=>row.y+row.height));
      const y=footerTop+12,top=terms.y-12,boxHeight=top-y;
      if(boxHeight<88 || width<400 || height<500)continue;
      return {page,x:32,y,width:width-64,height:boxHeight,image:false};
    }
    throw new HttpError(400,'This gate pass has no suitable bottom notes area. Use the Manheim vehicle release template.');
  }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'Unable to read this gate pass. Upload an unlocked PDF, JPG or PNG.');}
}
export async function annotatedGatePass(bytes:Uint8Array,mime:string,layout:GatePassLayout,damages:DamageRecord[],galleryUrl:string,recordedAt:string):Promise<Uint8Array> {
  const pdf=layout.image?await PDFDocument.create():await PDFDocument.load(bytes);
  if(layout.image){
    const page=pdf.addPage([612,792]),image=mime==='image/png'?await pdf.embedPng(bytes):await pdf.embedJpg(bytes);
    const size=image.scaleToFit(548,580);page.drawImage(image,{x:(612-size.width)/2,y:180+(580-size.height)/2,width:size.width,height:size.height});
  }
  const page=pdf.getPage(layout.page),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),mono=await pdf.embedFont(StandardFonts.Courier);
  const {x,y,width,height}=layout,top=y+height,qrSize=Math.min(76,height-26),leftWidth=width-qrSize-18;
  const ink=rgb(.12,.17,.23),muted=rgb(.34,.39,.45);
  // Append content to the original page. Never cover original text/barcodes,
  // modify its existing links, or render the original PDF as a screenshot.
  page.drawLine({start:{x,y:top},end:{x:x+width,y:top},thickness:.6,color:rgb(.72,.76,.81)});
  page.drawText('PICKUP DAMAGE NOTES — RECORDED BY DRIVER',{x,y:top-12,size:8.5,font:bold,color:ink});
  page.drawText(`Recorded ${recordedAt.slice(0,16).replace('T',' ')} UTC`,{x,y:top-24,size:7,font,color:muted});
  let cursor=top-37;
  const detailedRows=Math.floor((height-61)/11);
  if(!damages.length)page.drawText('No visible damage observed by driver.',{x,y:cursor,size:8,font,color:ink});
  else if(damages.length<=detailedRows){
    for(const damage of damages){
      const label=`${damage.code}  ${damage.areaLabel} / ${damage.typeLabel} / ${damage.sizeLabel}`;
      let size=7.5;while(font.widthOfTextAtSize(label,size)>leftWidth && size>6.5)size-=.25;
      if(font.widthOfTextAtSize(label,size)>leftWidth)throw new HttpError(400,'Damage notes do not fit. Please review the record.');
      page.drawText(label,{x,y:cursor,size,font,color:ink});cursor-=11;
    }
  }else{
    // For larger inspections put every code on the gate pass, with complete
    // per-damage descriptions and photos behind the same stable QR link.
    let line='';
    for(const damage of damages){
      const next=line?line+'  '+damage.code:damage.code;
      if(mono.widthOfTextAtSize(next,7)>leftWidth){page.drawText(line,{x,y:cursor,size:7,font:mono,color:ink});cursor-=9;line=damage.code;}else line=next;
    }
    if(line){page.drawText(line,{x,y:cursor,size:7,font:mono,color:ink});cursor-=9;}
    if(cursor<y+20)throw new HttpError(400,'All damage codes must fit on the gate pass. Reduce duplicate entries or use a gate pass with more notes space.');
    page.drawText('Descriptions and photos: scan the QR code.',{x,y:cursor,size:7,font,color:muted});
  }
  const shortUrl=galleryUrl.replace(/^https:\/\//,'');
  page.drawText(shortUrl,{x,y:y+3,size:7,font,color:ink});
  const qr=await QRCode.toDataURL(galleryUrl,{errorCorrectionLevel:'M',margin:4,width:512});
  const png=await pdf.embedPng(qr);page.drawImage(png,{x:x+width-qrSize,y:top-qrSize-14,width:qrSize,height:qrSize});
  page.drawText('DAMAGE PHOTOS',{x:x+width-qrSize,y:top-qrSize-22,size:6.5,font:bold,color:muted});
  const link=pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[x,y,x+leftWidth,y+12],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(galleryUrl)}});
  const reference=pdf.context.register(link),annots=page.node.Annots();if(annots)annots.push(reference);else page.node.set(PDFName.of('Annots'),pdf.context.obj([reference]));
  return await pdf.save();
}
