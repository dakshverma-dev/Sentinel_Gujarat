// Editable, source-driven presentation. Run with the bundled pptxgenjs runtime.
const pptxgen = require('pptxgenjs');
const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Sentinel Gujarat';
pptx.subject = 'Gujarat Police video analytics pilot';
pptx.title = 'Sentinel Gujarat | An alert must earn its confidence';
pptx.lang = 'en-IN';

const S = pptx.ShapeType;
const C = {navy:'000000', deep:'44403B', teal:'0447FF', aqua:'F5F3F1', sky:'F5F3F1', white:'FDFCFC', ink:'000000', muted:'777169', amber:'FF4704', amberSoft:'FBEDE7', red:'AD3B17', redSoft:'FBE7DF', line:'EBE8E4', green:'44403B'};
const W = 13.333, H = 7.5;
function rect(slide,x,y,w,h,fill,r=0){ slide.addShape(r?S.roundRect:S.rect,{x,y,w,h,rectRadius:r,fill:{color:fill},line:{color:fill}}); }
function line(slide,x1,y1,x2,y2,color=C.line,width=1.2,dash){slide.addShape(S.line,{x:x1,y:y1,w:x2-x1,h:y2-y1,line:{color,width,dashType:dash}})}
function txt(slide,text,x,y,w,h,size=16,color=C.ink,bold=false,more={}){slide.addText(text,{x,y,w,h,fontFace:'Arial',fontSize:size,color,bold,margin:0,breakLine:false,fit:'shrink',valign:'mid',...more})}
function label(slide,text,x,y,w=4,color=C.teal){txt(slide,text.toUpperCase(),x,y,w,.24,10,color,true,{charSpacing:1.6})}
function base(dark=false,section='PILOT / 2026'){let s=pptx.addSlide();s.background={color:dark?C.navy:C.white};label(s,section,.57,.34,7,dark?C.teal:C.green);txt(s,'SENTINEL / GUJARAT',10.03,.34,2.74,.24,10,dark?'C8C2BC':C.muted,true,{align:'right',charSpacing:1.2});line(s,.57,7.12,12.75,7.12,dark?'44403B':C.line,.8);txt(s,String(pptx._slides.length).padStart(2,'0'),12.37,7.16,.38,.16,9,dark?'B4ABA3':C.muted,false,{align:'right'});return s}
function title(s,t,sub,dark=false){txt(s,t,.57,.83,11.9,.7,32,dark?C.white:C.navy,false);if(sub)txt(s,sub,.59,1.61,11.9,.42,15,dark?'BDB6AF':C.muted)}
function card(s,x,y,w,h,heading,body,accent=C.teal){rect(s,x,y,w,h,C.white,.12);rect(s,x+.2,y+.22,.1,.1,accent,.05);txt(s,heading,x+.38,y+.18,w-.58,.38,17,C.navy,true);txt(s,body,x+.25,y+.69,w-.5,h-.85,13,C.muted,false,{valign:'top',breakLine:false})}
function chip(s,text,x,y,w,fill=C.aqua,color=C.green){rect(s,x,y,w,.36,fill,.1);txt(s,text,x+.12,y+.05,w-.24,.25,10,color,true)}
function notes(s,n){s.addNotes(n)}

// 1: Cover
{
 let s=base(true,'SOLUTION PRESENTATION');
 rect(s,8.5,1.65,3.65,3.65,C.deep,.28);rect(s,9.14,2.28,2.34,2.34,'44403B',.2);
 s.addShape(S.arc,{x:9.4,y:2.55,w:1.8,h:1.8,adjustPoint:.3,rotate:36,fill:{color:C.deep,transparency:100},line:{color:C.teal,width:3}});
 rect(s,10.05,3.2,.55,.55,C.teal,.26);line(s,8.07,3.47,9.08,3.47,C.teal,2);line(s,11.48,3.47,12.4,3.47,C.teal,2);
 txt(s,'Every alert earns\nits confidence.',.58,1.54,7.34,2.1,43,C.white,true,{breakLine:false});
 txt(s,'A working single-host pilot for camera onboarding, vehicle and plate analysis, governed face matching, route plausibility, and reviewable evidence.',.61,4.08,6.9,1.08,18,'C6DCDF',false,{valign:'top'});
 chip(s,'RUNNABLE PILOT',.61,5.77,1.85,'302D2A','8EE1D3');chip(s,'HONEST EVIDENCE',2.62,5.77,2.11,'302D2A','8EE1D3');
 notes(s,'Lead with the decision quality thesis. The product is runnable locally; live detector inference needs Docker Desktop and a permitted feed. Synthetic scenario data is labelled throughout.');
}
// 2: Problem
{
 let s=base(false,'01 / PROBLEM');title(s,'The camera estate is a decision problem','A useful system must turn heterogeneous streams into defensible operator actions.');
 rect(s,.57,2.22,4.1,3.7,C.navy,.14);txt(s,'80,000+',.86,2.58,3.45,1.1,53,C.white,true);txt(s,'camera scale in the brief',.86,3.76,3.4,.44,17,'C9DFE1');txt(s,'~160 Gbit/s',.86,4.72,3.4,.57,27,C.teal,true);txt(s,'at 2 Mbit/s each, before overhead',.86,5.33,3.46,.35,12,'C2BAB4');
 card(s,5.04,2.22,3.38,1.67,'Fragmented sources','Different departments, protocols, and vendors hide context.');
 card(s,8.62,2.22,3.98,1.67,'Uncertain reads','Single-frame OCR can turn a weak crop into a confident claim.',C.amber);
 card(s,5.04,4.13,3.38,1.78,'Alert fatigue','Matches need context, an explicit review path, and provenance.',C.amber);
 card(s,8.62,4.13,3.98,1.78,'Cost of central video','Continuous backhaul is the wrong unit of scale; move metadata.');
 notes(s,'80,000 is from the supplied plan, not measured capacity. Bandwidth arithmetic assumes every camera sends 2 Mbit/s continuously.');
}
// 3: model
{
 let s=base(false,'02 / ARCHITECTURE CHOICE');title(s,'Hybrid by design','One registry and operations view; analysis can move to district or site edge.');
 const boxes=[['CAMERA & NVR','RTSP / RTMP / HLS / file'],['EDGE ADAPTER','MediaMTX + frame decode'],['REGIONAL EVENTS','Tracks, plates, face matches'],['COMMAND VIEW','Review, search, export']];
 boxes.forEach((b,i)=>{let x=.62+i*3.12;rect(s,x,2.48,2.7,1.73,i===3?C.navy:C.sky,.14);label(s,b[0],x+.2,2.72,2.3,i===3?C.teal:C.green);txt(s,b[1],x+.2,3.07,2.3,.7,17,i===3?C.white:C.navy,true);if(i<3){txt(s,'→',x+2.78,3.03,.28,.38,25,C.teal,true)}});
 rect(s,.62,4.7,12.08,1.1,C.aqua,.13);txt(s,'Current pilot',.87,4.93,2.2,.35,18,C.navy,true);txt(s,'Single host: FastAPI + PostgreSQL + detector worker + MediaMTX + React',3.07,4.93,9.25,.36,17,C.ink);
 txt(s,'Reference Models 1–5 require the official portal brief for an accurate side-by-side mapping.',.63,6.12,12.0,.43,13,C.muted);
 notes(s,'The supplied PDF suggests a hybrid model but is not the official portal. Do not claim a precise comparison against all reference models until portal access is provided.');
}
// 4: innovations
{
 let s=base(true,'03 / DIFFERENTIATORS');title(s,'Three mechanisms that reinforce each other','Each keeps weak evidence visible instead of silently upgrading it.',true);
 const d=[['01','Camera Passport','URL or footage onboarding; codec, fps and resolution probed; named department and map point.'],['02','Route gate','Cross-camera candidates show distance, time gap and implied speed. Impossible jumps enter review.'],['03','Governed FRS','Enrollment needs authority, expiry, admin entry and separate reviewer approval. Unmatched embeddings are discarded.']];
 d.forEach((a,i)=>{let x=.61+i*4.17;rect(s,x,2.42,3.83,3.5,'292723',.15);txt(s,a[0],x+.25,2.66,.74,.7,32,C.teal,true);txt(s,a[1],x+.25,3.52,3.3,.43,21,C.white,true);txt(s,a[2],x+.25,4.14,3.28,1.38,15,'D8D2CB',false,{valign:'top'})});
 notes(s,'Describe these as implemented mechanisms. An uploaded public traffic sample is available for ingest; the live worker path was not executed because Docker Desktop engine was unavailable.');
}
// 5: architecture
{
 let s=base(false,'04 / IMPLEMENTED SYSTEM');title(s,'The working path','A camera becomes a normalized record; a track becomes a reviewable decision.');
 const xs=[.6,3.08,5.55,8.03,10.5];
 [['FEED','URL / video'],['DETECT','YOLO + ByteTrack'],['READ','OCR consensus'],['MATCH','watchlist + gate'],['ACT','alert + export']].forEach((b,i)=>{rect(s,xs[i],2.35,2.18,1.6,i===4?C.navy:C.sky,.12);label(s,b[0],xs[i]+.18,2.59,1.86,i===4?C.teal:C.green);txt(s,b[1],xs[i]+.18,2.97,1.85,.56,16,i===4?C.white:C.navy,true);if(i<4)txt(s,'→',xs[i]+2.22,2.93,.23,.35,23,C.teal,true)});
 rect(s,1.43,4.55,4.68,1.35,C.aqua,.13);txt(s,'DATA PLANE',1.67,4.78,2.3,.28,12,C.green,true);txt(s,'MediaMTX + detector worker',1.67,5.17,4.1,.42,20,C.navy,true);
 rect(s,7.18,4.55,4.68,1.35,C.sky,.13);txt(s,'DECISION PLANE',7.42,4.78,2.8,.28,12,C.green,true);txt(s,'FastAPI + audit + React',7.42,5.17,4.05,.42,20,C.navy,true);
 notes(s,'The current worker samples every third frame. Events are sent to FastAPI. MediaMTX supplies browser playback for compatible codecs.');
}
// 6: workflow
{
 let s=base(false,'05 / END-TO-END WORKFLOW');title(s,'One vehicle, six accountable steps','The operator can see where the automated chain became uncertain.');
 let steps=[['01','Onboard','Camera Passport'],['02','Track','ByteTrack ID'],['03','Read','Top 3 OCR votes'],['04','Correlate','Authority + expiry'],['05','Gate','Distance ÷ time'],['06','Review','Note + evidence']];
 steps.forEach((a,i)=>{let col=i%3,row=Math.floor(i/3),x=.62+col*4.17,y=2.2+row*2.12;rect(s,x,y,3.82,1.73,row?C.sky:C.navy,.13);txt(s,a[0],x+.18,y+.18,.58,.5,21,row?C.green:C.teal,true);txt(s,a[1],x+.85,y+.16,2.62,.45,22,row?C.navy:C.white,true);txt(s,a[2],x+.85,y+.83,2.59,.37,15,row?C.muted:'BFD5D9')});
 notes(s,'Read status can be confirmed, low confidence, or unreadable. The gate is a conservative Haversine/detour approximation, not a road route.');
}
// 7: analytics
{
 let s=base(false,'06 / AI ANALYTICS');title(s,'What the model actually does','No accuracy number is claimed until labelled camera footage is tested.');
 rect(s,.63,2.24,5.75,3.76,C.navy,.14);label(s,'RUNNABLE ANALYTICS',.9,2.5,4.9);txt(s,'Vehicles → tracks → candidate plate crops → OCR → one observation per track',.91,2.97,5.12,1.65,24,C.white,true,{valign:'top'});chip(s,'LOW-CONFIDENCE KEPT',.91,5.31,2.62,'302D2A','8EE1D3');
 card(s,6.71,2.24,5.95,1.7,'Optional approved face match','YuNet + SFace only compare to approved, unexpired entries.');
 card(s,6.71,4.16,5.95,1.83,'Future model work','Indian plate detector, labelled recall/read-rate study, and the brief’s remaining event analytics.',C.amber);
 notes(s,'Vehicle model is YOLO11n. Optional plate YOLO weights can be supplied. Baseline plate proposals use contours with Tesseract. Do not claim six event types are implemented.');
}
// 8: matching
{
 let s=base(true,'07 / WATCHLIST + ALERTS');title(s,'A hit is a structured claim','Identity, authority, expiry, confidence and route context travel together.',true);
 const blocks=[['MATCH','Exact plate / fuzzy plate / approved face'],['GATE','Plausible / impossible / insufficient history'],['TRIAGE','P1 action / human review / reject from action'],['EVIDENCE','Snapshot hash / model / audit digest']];
 blocks.forEach((b,i)=>{let x=.62+(i%2)*6.14,y=2.27+Math.floor(i/2)*2.0;rect(s,x,y,5.76,1.62,'292723',.14);label(s,b[0],x+.28,y+.26,5.1);txt(s,b[1],x+.28,y+.75,5.05,.58,18,C.white,true)});
 notes(s,'The local deterministic score stays in code. No Jev API or external triage model is presented as implemented.');
}
// 9: proof
{
 let s=base(false,'08 / PRODUCT PROOF');title(s,'The impossible jump goes to review','One deterministic synthetic run; scenario counts are not field metrics.');
 rect(s,.63,2.2,7.22,3.93,C.navy,.16);label(s,'ALERT CARD / DEMO',.95,2.49,5);txt(s,'GJ01AB1234',.95,3.07,5.32,.7,36,C.white,true);chip(s,'GATE REJECTED',.95,4.01,2.17,C.redSoft,C.red);txt(s,'Sarkhej Junction · stolen',.95,4.58,5.6,.45,19,'D8D2CB');txt(s,'Impossible travel in 8 seconds → review queue',.95,5.31,6.35,.38,15,C.teal,true);
 [['09','tracks'],['07','matched alerts'],['02','rejected routes']].forEach((a,i)=>{let y=2.2+i*1.35;rect(s,8.18,y,4.49,1.14,i===2?C.amberSoft:C.sky,.12);txt(s,a[0],8.42,y+.16,1.24,.66,31,i===2?C.red:C.navy,true);txt(s,a[1],9.65,y+.27,2.69,.41,17,C.ink,true)});
 txt(s,'These are scenario counts, not measured field accuracy or false-alert reduction.',.67,6.43,11.96,.35,12,C.muted);
 notes(s,'One run creates nine synthetic tracks, seven alerts and two route rejections. This is integration proof only. The camera-wall Delhi replay clips are visual placeholders, not the source of Ahmedabad event records. No government feed or owned footage was available.');
}
// 10 tech
{
 let s=base(false,'09 / TECHNOLOGY');title(s,'Self-hostable core, explicit licensing','The video and decision path can run on a local machine.');
 let rows=[['Stream','MediaMTX','MIT; localhost-bound pilot'],['Analytics','YOLO11n + ByteTrack','Ultralytics AGPL / commercial option'],['OCR + face','Tesseract + OpenCV Zoo','Model and data rights to verify'],['Data + API','PostgreSQL/PostGIS + FastAPI','Local storage, JWT roles'],['Console','React + Vite','OpenStreetMap tiles online']];
 rows.forEach((r,i)=>{let y=2.14+i*.75;rect(s,.65,y,12.01,.61,i%2?C.white:C.sky,.04);txt(s,r[0],.87,y+.1,2.18,.4,15,C.navy,true);txt(s,r[1],3.1,y+.1,4.23,.4,15,C.ink,true);txt(s,r[2],7.36,y+.1,4.93,.4,14,C.muted)});
 txt(s,'Compose defines a reproducible local pilot. Docker engine was unavailable during this verification.',.66,6.29,12.0,.4,12,C.muted);
 notes(s,'Do not claim production license clearance. The README names the model caveats and optional Indian plate weights.');
}
// 11 scale
{
 let s=base(true,'10 / SCALING DESIGN');title(s,'Move events, not every frame','A state deployment is an architecture proposal, not a benchmark result.',true);
 txt(s,'160',.72,2.37,3.4,1.35,74,C.white,true);txt(s,'Gbit/s',.76,3.68,3.28,.65,29,C.teal,true);txt(s,'80,000 × 2 Mbit/s, continuous central backhaul',.76,4.55,3.53,1.15,17,'D8D2CB');
 const s2=[['SITE / DISTRICT','Ingest, analytics, short video retention'],['REGION','Replayable metadata bus, routing and storage'],['STATE','Federated registry, search and command view']];
 s2.forEach((a,i)=>{let y=2.31+i*1.38;rect(s,5.0,y,7.6,1.16,'292723',.12);label(s,a[0],5.3,y+.17,2.7);txt(s,a[1],8.09,y+.23,4.08,.69,17,C.white,true)});
 notes(s,'Production requirements include durable event bus, PostGIS indexing, GPU sizing, credential rotation, clock-health checks, object storage, and SSO. None was load tested.');
}
// 12 trust
{
 let s=base(false,'11 / GOVERNANCE');title(s,'Built for accountable operators','Each decision can be inspected, reversed, and attributed.');
 const a=[['Role gates','Operator, administrator and independent face reviewer.'],['Two-person face approval','Authority and expiry attached before a face entry becomes active.'],['Audit chain','Each material action includes prior digest; verifier locates tampering.'],['Evidence packet','PDF includes source label, model, snapshot digest, audit digest.']];
 a.forEach((x,i)=>{let col=i%2,row=Math.floor(i/2),px=.64+col*6.12,py=2.2+row*2.02;rect(s,px,py,5.75,1.71,i===3?C.aqua:C.sky,.12);txt(s,x[0],px+.23,py+.19,5.24,.39,20,C.navy,true);txt(s,x[1],px+.23,py+.76,5.16,.67,15,C.muted,false,{valign:'top'})});
 txt(s,'Pilot caveat: localhost network boundary; no external audit anchor or signed forensic seal.',.64,6.41,11.88,.35,12,C.muted);
 notes(s,'The pilot has not been independently security audited. Native media URLs carry a JWT query parameter for local preview; protect gateway and media routes before network deployment.');
}
// 13 rollout
{
 let s=base(false,'12 / DEPLOYMENT PATH');title(s,'From pilot to department trial','A useful trial starts with authorized sources and labelled evaluation clips.');
 const stages=[['NOW','Local pilot','Synthetic scenario and public ingest clip.'],['NEXT','Department trial','2–3 departments; approved feeds, GPS, clocks, watchlists.'],['THEN','District scale','Edge workers, durable bus, retention and SSO.'],['LATER','State scale','Partitioned search, capacity tests, operating model.']];
 stages.forEach((a,i)=>{let x=.64+i*3.1;rect(s,x,2.53,2.76,3.15,i===0?C.navy:C.sky,.13);label(s,a[0],x+.19,2.75,2.4,i===0?C.teal:C.green);txt(s,a[1],x+.19,3.27,2.38,.62,21,i===0?C.white:C.navy,true);txt(s,a[2],x+.19,4.15,2.35,1.1,14,i===0?'D8D2CB':C.muted,false,{valign:'top'});if(i<3)txt(s,'→',x+2.8,3.78,.27,.37,23,C.teal,true)});
 notes(s,'Required department inputs: inventory, GPS, protocol, VMS/API access, NAT/VPN/bandwidth, NTP, watchlist legal authority, retention, export policy and named approvers.');
}
// 14 impact and truth
{
 let s=base(true,'13 / EVIDENCE + NEXT GATE');title(s,'Prove impact with the next real feed','The product is ready to evaluate; field performance remains unmeasured.',true);
 rect(s,.65,2.23,6.0,3.83,'292723',.15);label(s,'VERIFIED IN THIS BUILD',.94,2.51,5.38);txt(s,'• API integration tests pass\n• Frontend production build passes\n• Camera upload and playback checked\n• Scenario alerts, route and exports checked\n• Face model loading checked',.94,3.03,5.28,2.5,18,C.white,false,{valign:'top',breakLine:false});
 rect(s,6.91,2.23,5.75,3.83,'292723',.15);label(s,'MEASURE ON AUTHORIZED FOOTAGE',7.21,2.51,5.05,C.amber);txt(s,'• Exact plate read rate\n• Vehicle recall\n• False alerts before / after gate\n• p50 / p95 frame-to-alert latency\n• Clock and camera health',7.21,3.03,4.99,2.5,18,C.white,false,{valign:'top',breakLine:false});
 txt(s,'Submission status and portal eligibility require organizer confirmation; public notice lists 15 Sep 2026 as the original deadline.',.67,6.4,11.94,.38,12,'C2BAB4');
 notes(s,'Do not present a synthetic run as a government feed demo or as measured field impact. Ask organizer whether the round is open.');
}

pptx.writeFile({fileName:'docs/Sentinel_Gujarat_Solution_Deck.pptx'});

