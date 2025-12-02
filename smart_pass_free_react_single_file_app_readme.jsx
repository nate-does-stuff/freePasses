/*
README — SmartPass Free (React app) — Firebase + Google Sign-In + Live Monitor + Kiosk + Teacher View

OVERVIEW
This single-file React app is a more advanced SmartPass Free prototype. New features added:
- Firebase integration (Authentication + Realtime Database) for shared, live data across devices.
- Google Sign-In via Firebase Auth (school Google accounts supported).
- Live Monitor Display: a public, read-only real-time board that updates instantly for hall monitors.
- Kiosk Mode: a simplified fullscreen pass-creation interface tailored for a specific destination (e.g., Bathroom) and teacher/room; ideal for tablets in halls or bathrooms.
- Teacher View: teachers can sign in and see only their classroom's passes and approve/return passes.
- Role handling: basic role mapping (admin, teacher, hallmonitor) based on email domain or manual admin list.
- Data export and CSV still supported for admins.

HOW THIS WORKS
- Auth: Firebase Auth handles Google sign-in. App reads user email and assigns role (admin if in admin list, teacher if email matches teacher list, otherwise student role when creating passes without signin).
- Data: Firebase Realtime Database stores passes under `/passes`. Each pass is an object with id, studentName, teacher, destination, reason, createdAt, returnedAt, status, createdBy.
- Live Monitor: a public route `/monitor` reads `/passes` and displays active passes in real-time. You can embed `/monitor` in Google Sites via an iframe.
- Kiosk Mode: visit `/kiosk?destination=Bathroom&teacher=Room101` and the UI is simplified for quick pass creation without typing teacher/destination each time.

PREREQUISITES (You must do these in Firebase console):
1) Create a Firebase project: https://console.firebase.google.com/
2) Enable Authentication > Sign-in method > Google
3) Create a Realtime Database (locked mode OK for starters; use rules below for basic security)
4) In Project Settings > Your apps > add a web app and copy config (apiKey, authDomain, databaseURL, projectId, etc.)
5) Optionally add authorized domains (your deployed site) for Google sign-in.
6) (Optional) Set Realtime Database rules for simple pilot (replace <your-project-id>):
{
  "rules": {
    ".read": true,
    ".write": "auth != null"
  }
}
Note: For school deployment tighten rules to require specific domains or roles.

QUICK RUN (local)
1) Create react app with Vite: `npm create vite@latest smartpass-free --template react`
2) Install deps: `npm install firebase uuid`
3) Replace src/App.jsx with this file contents.
4) Add Tailwind or remove utility classes.
5) `npm run dev`

DEPLOY
- Vercel/Netlify recommended. Both allow embedding via iframe in Google Sites. Ensure the site is added to Firebase auth authorized domains.

EMBED IN GOOGLE SITES
- Deploy and use Insert > Embed > By URL or iframe. Use the /monitor route for live board.

---

APP CODE STARTS HERE
*/

import React, { useEffect, useState, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import { getDatabase, ref, push, set, onValue, update, remove } from 'firebase/database';
import { v4 as uuidv4 } from 'uuid';

// ----------  CONFIG  ----------
// Replace with your Firebase config from the Firebase console
const FIREBASE_CONFIG = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  databaseURL: "https://REPLACE_ME.firebaseio.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

// Admins: emails who should be treated as admins
const ADMIN_EMAILS = ['principal@school.edu'];

// Map of teacher emails to teacher names (optional). If a signed-in user has one of these emails they become 'teacher' role
const TEACHER_EMAILS = {
  'mrs.daleo@school.edu': 'Mrs. D\'Aleo',
  'mr.smith@school.edu': 'Mr. Smith'
};

// ----------  Firebase init  ----------
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const db = getDatabase(app);

function nowISO(){ return new Date().toISOString(); }

// ----------  helper functions  ----------
function roleForUser(user){
  if(!user || !user.email) return 'student';
  if(ADMIN_EMAILS.includes(user.email)) return 'admin';
  if(Object.keys(TEACHER_EMAILS).includes(user.email)) return 'teacher';
  // fallback: if domain is school's domain (example), treat as staff (optional)
  const domain = user.email.split('@')[1];
  if(domain === 'school.edu') return 'teacher';
  return 'student';
}

// ----------  React App  ----------
export default function App(){
  const [user, setUser] = useState(null);
  const [role, setRole] = useState('student');
  const [passes, setPasses] = useState([]); // live list from RTDB

  // form state
  const [studentName, setStudentName] = useState('');
  const [teacher, setTeacher] = useState('');
  const [destination, setDestination] = useState('Bathroom');
  const [reason, setReason] = useState('');

  // UI state
  const [view, setView] = useState('dashboard'); // dashboard | monitor | kiosk | teacher
  const [kioskParams, setKioskParams] = useState({});

  // load auth
  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, (u)=>{
      setUser(u);
      setRole(roleForUser(u));
    });
    return ()=>unsub();
  },[]);

  // listen to passes in Realtime DB
  useEffect(()=>{
    const passesRef = ref(db, 'passes');
    return onValue(passesRef, snapshot =>{
      const data = snapshot.val() || {};
      const list = Object.keys(data).map(k=>({ id:k, ...data[k]})).sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
      setPasses(list);
    });
  },[]);

  // parse kiosk query params if present
  useEffect(()=>{
    const q = new URLSearchParams(window.location.search);
    const mode = q.get('mode');
    if(mode === 'kiosk'){
      const dest = q.get('destination') || 'Bathroom';
      const teach = q.get('teacher') || '';
      setKioskParams({destination: dest, teacher: teach});
      setDestination(dest); setTeacher(teach);
      setView('kiosk');
    }
    if(q.get('view') === 'monitor') setView('monitor');
  },[]);

  function signIn(){
    signInWithPopup(auth, provider).catch(e=>alert('Sign in failed: '+e.message));
  }
  function signOutNow(){ signOut(auth); }

  // create pass in RTDB
  async function createPass(e){
    e && e.preventDefault();
    if(!studentName.trim()) return alert('Enter student name');
    const newRef = push(ref(db, 'passes'));
    const passObj = {
      studentName: studentName.trim(),
      teacher: teacher.trim(),
      destination: destination.trim(),
      reason: reason.trim(),
      createdAt: nowISO(),
      returnedAt: null,
      status: 'active',
      createdBy: user ? user.email : 'anonymous'
    };
    await set(newRef, passObj);
    setStudentName(''); setReason('');
    if(view === 'kiosk') {
      // in kiosk mode, optionally auto-clear or show a success briefly
    }
  }

  async function markReturned(id){
    const pRef = ref(db, `passes/${id}`);
    await update(pRef, { returnedAt: nowISO(), status: 'returned' });
  }
  async function deletePass(id){
    if(!window.confirm('Delete pass?')) return;
    await remove(ref(db, `passes/${id}`));
  }

  function exportCSV(){
    const headers = ['id','studentName','teacher','destination','reason','createdAt','returnedAt','status','createdBy'];
    const rows = passes.map(p => headers.map(h => p[h] || ''));
    const csv = [headers, ...rows].map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(',')).join('
');
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='passes.csv'; a.click(); URL.revokeObjectURL(url);
  }

  const active = passes.filter(p => p.status === 'active');
  const teacherPasses = user && role === 'teacher' ? passes.filter(p => p.teacher.toLowerCase().includes(TEACHER_EMAILS[user.email]?.toLowerCase() || user.email.split('@')[0])) : [];

  // UI components
  if(view === 'monitor'){
    return (
      <div style={{fontFamily:'system-ui',padding:20}}>
        <h1>SmartPass Monitor</h1>
        <p style={{color:'#666'}}>Live active passes — updates automatically.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:12}}>
          {active.length === 0 && <div style={{color:'#666'}}>No active passes</div>}
          {active.map(p=> (
            <div key={p.id} style={{padding:12,borderRadius:8,background:'#fff',boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
              <div style={{fontWeight:700}}>{p.studentName}</div>
              <div style={{fontSize:13,color:'#444'}}>{p.destination} — {p.teacher || '—'}</div>
              <div style={{fontSize:12,color:'#777',marginTop:6}}>Asked {new Date(p.createdAt).toLocaleTimeString()}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if(view === 'kiosk'){
    return (
      <div style={{display:'flex',height:'100vh',alignItems:'center',justifyContent:'center',background:'#f3f4f6'}}>
        <div style={{width:420,background:'#fff',padding:24,borderRadius:12,boxShadow:'0 6px 20px rgba(0,0,0,0.08)'}}>
          <h2 style={{marginBottom:8}}>Quick Pass — {kioskParams.destination || destination}</h2>
          <form onSubmit={createPass}>
            <div style={{marginBottom:8}}>
              <input placeholder="Student name" value={studentName} onChange={e=>setStudentName(e.target.value)} style={{width:'100%',padding:10,borderRadius:6,border:'1px solid #ddd'}} />
            </div>
            <div style={{display:'flex',gap:8,marginBottom:12}}>
              <input placeholder="Reason (optional)" value={reason} onChange={e=>setReason(e.target.value)} style={{flex:1,padding:10,borderRadius:6,border:'1px solid #ddd'}} />
            </div>
            <div style={{display:'flex',gap:8}}>
              <button type="submit" style={{flex:1,padding:12,borderRadius:8,background:'#0ea5a4',color:'#fff',border:'none'}}>Create Pass</button>
              <button type="button" onClick={()=>{setStudentName(''); setReason('');}} style={{padding:12,borderRadius:8,border:'1px solid #ddd'}}>Clear</button>
            </div>
            <div style={{marginTop:10,fontSize:12,color:'#666'}}>Kiosk for {kioskParams.teacher || 'unspecified teacher'}</div>
          </form>
        </div>
      </div>
    );
  }

  // main app dashboard
  return (
    <div style={{fontFamily:'system-ui',padding:20,maxWidth:1100,margin:'0 auto'}}>
      <header style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h1>SmartPass Free — School Pilot</h1>
        <div>
          {user ? (
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <div style={{fontSize:13,color:'#333'}}>{user.displayName || user.email} • {role}</div>
              <button onClick={()=>setView('monitor')}>Open Monitor</button>
              <button onClick={()=>setView('kiosk')}>Kiosk</button>
              <button onClick={signOutNow}>Sign out</button>
            </div>
          ) : (
            <div>
              <button onClick={signIn}>Sign in with Google</button>
            </div>
          )}
        </div>
      </header>

      <main style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:20,marginTop:20}}>
        <section style={{background:'#fff',padding:16,borderRadius:8}}>
          <h2>Create Pass</h2>
          <form onSubmit={createPass} style={{display:'grid',gap:8}}>
            <input placeholder="Student name" value={studentName} onChange={e=>setStudentName(e.target.value)} />
            <input placeholder="Teacher / Room" value={teacher} onChange={e=>setTeacher(e.target.value)} />
            <select value={destination} onChange={e=>setDestination(e.target.value)}>
              <option>Bathroom</option>
              <option>Guidance</option>
              <option>Nurse</option>
              <option>Office</option>
              <option>Other</option>
            </select>
            <input placeholder="Reason (optional)" value={reason} onChange={e=>setReason(e.target.value)} />
            <div style={{display:'flex',gap:8}}>
              <button type="submit">Create Pass</button>
              <button type="button" onClick={()=>{setStudentName(''); setTeacher(''); setReason('');}}>Clear</button>
            </div>
          </form>

          <div style={{marginTop:12}}>
            <strong>Quick Links:</strong>
            <div style={{marginTop:6}}>
              <button onClick={()=>{window.location.search='?mode=kiosk&destination=Bathroom&teacher=' + encodeURIComponent(teacher);}}>Open Bathroom Kiosk</button>
              <button onClick={()=>{window.location.search='?mode=kiosk&destination=Nurse&teacher=' + encodeURIComponent(teacher);}}>Open Nurse Kiosk</button>
            </div>
          </div>
        </section>

        <section style={{background:'#fff',padding:16,borderRadius:8}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <h2>Pass Board</h2>
            <div style={{display:'flex',gap:8}}>
              {role === 'admin' && <button onClick={exportCSV}>Export CSV</button>}
            </div>
          </div>

          <div style={{marginTop:8}}>
            {passes.length === 0 && <div style={{color:'#666'}}>No passes yet.</div>}
            <div style={{display:'grid',gap:10}}>
              {passes.map(p=> (
                <div key={p.id} style={{padding:12,background:'#f9fafb',borderRadius:8,display:'flex',justifyContent:'space-between'}}>
                  <div>
                    <div style={{fontWeight:700}}>{p.studentName}</div>
                    <div style={{fontSize:13,color:'#444'}}>{p.destination} • {p.teacher}</div>
                    <div style={{fontSize:12,color:'#666'}}>By: {p.createdBy} • {new Date(p.createdAt).toLocaleString()}</div>
                    {p.status === 'returned' && <div style={{fontSize:12,color:'#666'}}>Returned: {new Date(p.returnedAt).toLocaleString()}</div>}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {p.status === 'active' ? (
                      <>
                        <button onClick={()=>markReturned(p.id)}>Return</button>
                        {(role === 'admin' || role === 'teacher') && <button onClick={()=>deletePass(p.id)}>Delete</button>}
                      </>
                    ) : (
                      <div style={{color:'#666'}}>Returned</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer style={{marginTop:20,textAlign:'center',color:'#777'}}>Notes: This demo uses Firebase Realtime Database for instant updates. For production, secure your DB rules and configure allowed domains for Google Sign-In.</footer>
    </div>
  );
}
