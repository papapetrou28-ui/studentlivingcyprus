// Browser module; import with <script type="module"> after setting config.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cfg = window.SLC_SUPABASE_CONFIG || {};
export const supabase = cfg.url && cfg.publishableKey
  ? createClient(cfg.url, cfg.publishableKey)
  : null;
export async function signUp({email,password,displayName,role}) {
 if (!supabase) throw new Error('Supabase is not configured.');
 if (!['student','landlord'].includes(role)) throw new Error('Invalid account type');
 const {data,error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin+window.location.pathname,data:{display_name:displayName,role}}});
 if(error) throw error;
 // Email confirmation may be required. Profile creation happens on first authenticated session.
 if(data.session) await ensureProfile(displayName,role);
 return data;
}
export async function signIn(email,password) {
 if(!supabase) throw new Error('Supabase is not configured.');
 const {data,error}=await supabase.auth.signInWithPassword({email,password});
 if(error) throw error;
 await ensureProfile();
 return data;
}
export async function signOut() {
 if(!supabase) return;
 const {error}=await supabase.auth.signOut();
 if(error) throw error;
}
export async function ensureProfile(displayName='',role='student') {
 const {data:{user},error:authError}=await supabase.auth.getUser();
 if(authError) throw authError;
 if(!user) return null;
 const {data:existing,error:readError}=await supabase.from('profiles').select('*').eq('id',user.id).maybeSingle();
 if(readError) throw readError;
 if(existing) return existing;
 const metadata=user.user_metadata||{};
 const record={id:user.id,display_name:String(displayName||metadata.display_name||'').slice(0,100),role:['student','landlord'].includes(metadata.role)?metadata.role:role};
 const {data,error}=await supabase.from('profiles').insert(record).select().single();
 if(error) throw error;
 return data;
}
export async function currentAccount(){
 if(!supabase) return null;
 const {data:{user}}=await supabase.auth.getUser();
 if(!user) return null;
 const profile=await ensureProfile();
 return {user,profile};
}
export async function myProperties(){
 const account=await currentAccount();
 if(!account) throw new Error('Please sign in');
 const {data,error}=await supabase.from('properties').select('*').eq('owner_id',account.user.id).order('created_at',{ascending:false});
 if(error) throw error;
 return data;
}
export async function publishedProperties(){
 if(!supabase) throw new Error('Supabase is not configured');
 const {data,error}=await supabase.from('properties').select('*').eq('status','published').order('created_at',{ascending:false});
 if(error) throw error;
 return data;
}
export async function createProperty(input){
 const account=await currentAccount();
 if(account?.profile?.role!=='landlord') throw new Error('Landlord account required');
 const {data,error}=await supabase.from('properties').insert({
 owner_id:account.user.id,title:input.title,type:input.type,area:input.area,
 rent:input.rent,beds:input.beds||0,deposit:input.deposit||0,bills:input.bills||0,
 description:input.description||'',status:'pending'
 }).select().single();
 if(error) throw error;
 return data;
}
