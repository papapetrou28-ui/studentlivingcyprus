import {supabase,currentAccount,createProperty,publishedProperties,myProperties} from './supabase.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'€'+Number(n||0).toLocaleString('en-IE',{maximumFractionDigits:2});
let publicListings=[],ownedListings=[],userId=null,ready=false;
const status=document.createElement('p');status.className='note';status.id='propertyStatus';
const listingForm=$('listingForm');
listingForm.parentElement.insertBefore(status,listingForm);
const notice=document.createElement('p');notice.className='note';notice.textContent='Listings are submitted for review. Only approved properties appear publicly. Contact details are not displayed until a safe enquiry system is available.';
listingForm.parentElement.insertBefore(notice,listingForm);
const button=listingForm.querySelector('button[type="submit"]');
if(button)button.textContent='Submit listing for approval';
function card(p,owned=false){
 const icon=p.type==='Studio'?'🛋️':p.type==='Room'?'🛏️':'🏡';
 return '<article class="card"><div class="photo">'+icon+'</div><div class="card-content"><span class="pill">'+esc(p.type)+'</span> '+(owned?'<span class="badge">'+esc(p.status)+'</span>':'')+'<h3>'+esc(p.title)+'</h3><p class="meta">📍 '+esc(p.area)+' · '+Number(p.beds||0)+' bedrooms</p><div class="price">'+money(p.rent)+'<span class="meta"> / month</span></div><p class="meta">Deposit: '+money(p.deposit)+' · Est. bills: '+money(p.bills)+'/mo</p><p>'+esc(p.description||'')+'</p><div class="card-foot"><button class="btn secondary" data-property-detail="'+esc(p.id)+'">View details</button>'+(owned?'<button class="small-btn" data-property-delete="'+esc(p.id)+'">Delete</button>':'')+'</div></div></article>';
}
function render(){
 if(!ready)return;
 const q=String($('q')?.value||'').trim().toLowerCase(),type=$('typeFilter')?.value||'',max=Number($('priceFilter')?.value||Infinity);
 const found=publicListings.filter(p=>(p.title+' '+p.area).toLowerCase().includes(q)&&(!type||p.type===type)&&Number(p.rent)<=max);
 $('allListings').innerHTML=found.map(p=>card(p)).join('')||'<div class="empty wide">No approved listings match your filters yet.</div>';
 $('homeListings').innerHTML=publicListings.slice(0,3).map(p=>card(p)).join('')||'<div class="empty wide">Approved properties will appear here.</div>';
 $('myListings').innerHTML=ownedListings.map(p=>card(p,true)).join('')||'<div class="empty wide">No submitted listings yet.</div>';
}
async function refresh(){
 if(!supabase){status.textContent='Supabase is not configured.';return;}
 try{
  const account=await currentAccount();userId=account?.user?.id||null;
  publicListings=await publishedProperties();
  ownedListings=account?await myProperties():[];
  ready=true;render();
  status.textContent=account?.profile?.role==='landlord'?'Signed in as landlord. Your submissions remain pending until an administrator approves them.':'Sign in with a landlord account below before submitting a property.';
  if(button)button.disabled=account?.profile?.role!=='landlord';
 }catch(err){status.textContent='Could not load properties: '+err.message;}
}
listingForm.addEventListener('submit',async e=>{
 e.preventDefault();e.stopImmediatePropagation();
 if(!supabase){status.textContent='Supabase not configured';return;}
 if(button)button.disabled=true;
 try{
  const f=new FormData(listingForm);
  await createProperty({
   title:String(f.get('title')||'').trim(),type:String(f.get('type')||''),
   area:String(f.get('area')||'').trim(),rent:Number(f.get('rent')),
   beds:Number(f.get('beds')||0),deposit:Number(f.get('deposit')||0),
   bills:Number(f.get('bills')||0),description:String(f.get('description')||'').trim()
  });
  listingForm.reset();await refresh();status.textContent='Property submitted successfully. It is pending administrator approval.';
 }catch(err){status.textContent='Submission failed: '+err.message;}
 finally{if(button)button.disabled=false;}
},true);
document.addEventListener('click',async e=>{
 const detail=e.target.closest('[data-property-detail]');
 if(detail){
  const p=[...ownedListings,...publicListings].find(x=>x.id===detail.dataset.propertyDetail);
  if(p)alert(p.title+'\n'+p.area+'\nRent: '+money(p.rent)+'/month\nStatus: '+p.status+'\n\n'+(p.description||''));
 }
 const del=e.target.closest('[data-property-delete]');
 if(del){
  const p=ownedListings.find(x=>x.id===del.dataset.propertyDelete);
  if(!p||p.owner_id!==userId||!confirm('Delete your property listing?'))return;
  const {error}=await supabase.from('properties').delete().eq('id',p.id).eq('owner_id',userId);
  if(error)status.textContent='Delete failed: '+error.message;else await refresh();
 }
});
window.renderListings=render;
supabase?.auth.onAuthStateChange(()=>{setTimeout(refresh,0)});
refresh();
