import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot, getDoc, collection, query, where, updateDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDl9Xk50H36NvAFt2Pn0mgdte3msUY5-ng",
  authDomain: "classmark-543a5.firebaseapp.com",
  projectId: "classmark-543a5",
  storageBucket: "classmark-543a5.firebasestorage.app",
  messagingSenderId: "155782877231",
  appId: "1:155782877231:web:0e7a2ee472e24db16db6da"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

window.APP = {
  sessions: {},      
  students: [],      
  section: '',       
  cr: null,          
  photo: null,       
  stream: null,      
};

const CR_DB = {
  'CR001': { section: 'BCA-A1', name: 'Arjun Mehta (CR)' },
  'CR002': { section: 'BCA-B1', name: 'Priya Singh (CR)' },
};

// Expose routing globally so HTML onclick works
window.goto = function(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0);
};

window.formatTime12 = function(time24) {
  if(!time24) return '';
  let [h, m] = time24.split(':');
  let ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
};

// ─── AUTHENTICATION (CR LOGIN) ─────────────────────────
window.adminLogin = async function() {
  const id   = document.getElementById('admin-id').value.trim().toUpperCase();
  const pass = document.getElementById('admin-pw').value;
  const crMeta = CR_DB[id];

  if (!crMeta) {
    showLoginErr('❌ Invalid CR ID.'); return;
  }
  if (!pass) {
    showLoginErr('❌ Please enter password.'); return;
  }

  // To keep the UI matching, we fake an email domain for the Firebase Auth based on their ID
  const fakeEmail = `${id.toLowerCase()}@cgc.com`; 

  try {
    const userCredential = await signInWithEmailAndPassword(auth, fakeEmail, pass);
    APP.cr = { id, uid: userCredential.user.uid, ...crMeta };
    
    document.getElementById('login-err').style.display = 'none';
    document.getElementById('d-cr-name').textContent   = crMeta.name;
    document.getElementById('d-cr-sec').textContent    = '📍 ' + crMeta.section;

    // Attach listeners for this CR's section
    listenToSession(APP.cr.section, true);
    listenToStudents(APP.cr.section);

    window.goto('p-dashboard');
  } catch (error) {
    console.error("Auth error", error);
    showLoginErr('❌ Wrong password or account not created yet.');
  }
};

window.adminLogout = function() {
  signOut(auth).then(() => {
    APP.cr = null;
    document.getElementById('admin-id').value = '';
    document.getElementById('admin-pw').value = '';
    window.goto('p-landing');
  });
};

function showLoginErr(msg) {
  const e = document.getElementById('login-err');
  e.style.display = 'block';
  e.textContent = msg;
}

// ─── FIREBASE REALTIME LISTENERS ────────────────────────
// Listens to global sessions (e.g. students viewing their section)
let unsubscribeSession = null;
function listenToSession(section, isCR = false) {
  if (unsubscribeSession) unsubscribeSession();
  
  unsubscribeSession = onSnapshot(doc(db, "sessions", section), (docSnap) => {
    if (docSnap.exists()) {
      APP.sessions[section] = docSnap.data();
    } else {
      APP.sessions[section] = { active: false };
    }
    
    // If Admin is logged in and viewing their section, sync the toggle UI
    if (isCR && APP.cr && APP.cr.section === section) {
      const sess = APP.sessions[section];
      document.getElementById('att-toggle').checked = !!sess.active;
      if (sess.active) {
        document.getElementById('session-start').value = sess.start || '';
        document.getElementById('session-end').value = sess.end || '';
        document.getElementById('session-lecture').value = sess.lectureId || '';
        
        document.getElementById('session-start').disabled = true;
        document.getElementById('session-end').disabled = true;
        document.getElementById('session-lecture').disabled = true;
        
        document.getElementById('tog-info').textContent = `🟢 Session scheduled from ${window.formatTime12(sess.start)} to ${window.formatTime12(sess.end)}`;
        document.getElementById('sw-off-lbl').style.color = 'var(--success)';
      } else {
        document.getElementById('session-start').disabled = false;
        document.getElementById('session-end').disabled = false;
        document.getElementById('session-lecture').disabled = false;
        document.getElementById('tog-info').textContent = 'Schedule or open the session for your section';
        document.getElementById('sw-off-lbl').style.color = 'var(--muted)';
      }
    }
  });
}

let unsubscribeStudents = null;
function listenToStudents(section) {
  if (unsubscribeStudents) unsubscribeStudents();
  
  const q = query(collection(db, "attendance"), where("section", "==", section));
  unsubscribeStudents = onSnapshot(q, (snapshot) => {
    APP.students = [];
    snapshot.forEach(doc => {
      APP.students.push({ id: doc.id, ...doc.data() });
    });
    // Sort students by time
    APP.students.sort((a,b) => a.timestamp - b.timestamp);
    if (APP.cr && APP.cr.section === section) {
      updateDash();
    }
  });
}

// Triggered when student selects a section in the dropdown
window.onSectionSelect = function() {
  const sec = document.getElementById('stu-section').value;
  if(sec) {
    listenToSession(sec, false);
  }
};

// Polling for UI update on Student Landing
setInterval(() => {
  const sec = document.getElementById('stu-section').value;
  const btn = document.getElementById('mark-btn');
  const dot = document.getElementById('live-dot');
  const txt = document.getElementById('live-text');
  
  let live = false;
  let textMsg = '';
  
  if (!sec) {
    textMsg = 'Select your section to see session status';
  } else {
    const sess = APP.sessions[sec];
    if (!sess || !sess.active) {
      textMsg = 'Waiting for your CR to start the session...';
    } else {
      const now = new Date();
      const currentHHMM = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
      
      if (currentHHMM < sess.start) {
        textMsg = `⏳ Session starts at ${window.formatTime12(sess.start)}`;
      } else if (currentHHMM > sess.end) {
        textMsg = `❌ Session ended at ${window.formatTime12(sess.end)}`;
      } else {
        live = true;
        textMsg = `🟢 Session LIVE (Closes ${window.formatTime12(sess.end)}) — mark yourself in!`;
      }
    }
  }

  btn.className = 'mark-btn ' + (live ? 'on' : 'off');
  btn.innerHTML = live ? '✓ Mark Attendance Now' : '🔒 Attendance Not Active';
  dot.className = 'dot' + (live ? ' live' : '');
  txt.textContent = textMsg;
}, 1500);

// ─── ADMIN TOGGLE SESSION ─────────────────────────────────
window.toggleSession = async function(cb) {
  if (!APP.cr) return;
  const sec = APP.cr.section;
  
  const startInp = document.getElementById('session-start');
  const endInp   = document.getElementById('session-end');
  const lecInp   = document.getElementById('session-lecture');
  const errP     = document.getElementById('time-err');

  if (cb.checked) {
    if (!startInp.value || !endInp.value || !lecInp.value.trim()) {
      cb.checked = false;
      errP.textContent = '⚠️ Please set Lecture ID, Start and End time.';
      errP.style.display = 'block';
      return;
    }
    if (startInp.value >= endInp.value) {
      cb.checked = false;
      errP.textContent = '⚠️ End time must be after Start time.';
      errP.style.display = 'block';
      return;
    }
    errP.style.display = 'none';

    // Save to Firestore
    await setDoc(doc(db, "sessions", sec), {
      active: true,
      lectureId: lecInp.value.trim().toUpperCase(),
      start: startInp.value,
      end: endInp.value,
      updatedBy: APP.cr.id,
      timestamp: Date.now()
    });
  } else {
    // Disable session
    await setDoc(doc(db, "sessions", sec), { active: false }, { merge: true });
  }
};

window.approve = async function(docId) {
  try {
    await updateDoc(doc(db, "attendance", docId), { status: 'approved' });
  } catch (e) {
    alert("Error approving attendance: " + e.message);
  }
};

window.manualEntry = async function() {
  if (!APP.cr) return;

  const name = document.getElementById('manual-name').value.trim();
  const roll = document.getElementById('manual-roll').value.trim();
  const lecId = document.getElementById('manual-lecture').value.trim().toUpperCase();

  if (!name || !roll || !lecId) {
    alert('⚠️ Please fill out the Name, Roll Number, and Lecture ID completely.');
    return;
  }

  const now = new Date();
  const today = now.toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'});
  
  // Create an initial-based placeholder image
  const canvas = document.createElement('canvas');
  canvas.width = 120; canvas.height = 120;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#162032';
  ctx.fillRect(0,0,120,120);
  ctx.fillStyle = '#3B82F6';
  ctx.font = 'bold 44px "Outfit", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const init = name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase();
  ctx.fillText(init || 'CR', 60, 60);
  const placeholderCam = canvas.toDataURL('image/jpeg');

  const entry = {
    name:      name + ' ✍️',
    roll,
    lectureId: lecId,
    section:   APP.cr.section,
    photo:     placeholderCam, // Storing placeholder directly as Base64 because it's tiny
    time:      now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}),
    date:      today,
    status:    'approved',
    timestamp: Date.now(),
    isManual:  true
  };

  const docIdStr = `${entry.roll}_${entry.date.replace(/\//g,'-')}_${entry.lectureId}`;
  
  try {
    // Unique doc ID prevents duplicates directly in database!
    const docRef = doc(db, "attendance", docIdStr);
    const snap = await getDoc(docRef);
    if(snap.exists()) {
      alert(`⚠️ ${name} (${roll}) is already marked present for Lecture ${lecId}.`);
      return;
    }
    await setDoc(docRef, entry);
    document.getElementById('manual-name').value = '';
    document.getElementById('manual-roll').value = '';
    alert(`✅ Successfully added override for ${name}.`);
  } catch (e) {
    alert("Error adding manual entry: " + e.message);
  }
};

function updateDash() {
  if (!APP.cr) return;
  const list = APP.students; // Already filtered by section via Firestore query
  const appr = list.filter(s => s.status === 'approved').length;
  const pend = list.filter(s => s.status === 'pending').length;
  const TOTAL = 60;

  document.getElementById('st-present').textContent = appr;
  document.getElementById('st-pending').textContent = pend;
  document.getElementById('st-absent').textContent  = Math.max(0, TOTAL - list.length);

  const tbody = document.getElementById('students-tbody');
  if (!list.length) {
    tbody.innerHTML = `<div class="empty-tbl"><span>🎓</span>No students have marked attendance yet.<br><small style="font-size:13px;color:var(--muted)">Enable the session above so students can check in.</small></div>`;
    return;
  }

  tbody.innerHTML = list.map(s => `
    <div class="tr-row">
      <div><img src="${s.photo}" class="stu-photo" alt="${s.name}"></div>
      <div>
        <div class="stu-name">${s.name}</div>
        <div class="stu-roll">${s.roll} &middot; ${s.time} &middot; <span style="color:var(--blue)">${s.lectureId}</span></div>
      </div>
      <div><span class="sec-chip">${s.section}</span></div>
      <div>
        <span class="badge ${s.status === 'approved' ? 'appr' : 'pend'}">
          ${s.status === 'approved' ? '✅ Approved' : '⏳ Pending'}
        </span>
      </div>
      <div>
        ${s.status === 'pending'
          ? `<button class="appr-btn" onclick="approve('${s.id}')">✓ Approve</button>`
          : `<button class="appr-btn done" disabled>Approved</button>`}
      </div>
    </div>
  `).join('');
}


// ─── STUDENT MARK ATTENDANCE ─────────────────────────────────

window.goMarkAttendance = function() {
  const sec = document.getElementById('stu-section').value;
  if (!sec) { alert('Please select your section first!'); return; }
  
  const sess = APP.sessions[sec];
  if (!sess || !sess.active) return;
  
  const now = new Date();
  const currentHHMM = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  
  if (currentHHMM < sess.start) {
    alert(`Attendance opens at ${window.formatTime12(sess.start)}`);
    return;
  }
  if (currentHHMM > sess.end) {
    alert(`Late Entry Blocked. Attendance closed at ${window.formatTime12(sess.end)}`);
    return;
  }

  APP.section = sec;
  document.getElementById('form-sec-tag').textContent = sec.replace('-',' – ');
  document.getElementById('stu-lecture').value = '';
  window.goto('p-student-form');
};

window.openCam = async function() {
  try {
    APP.stream = await navigator.mediaDevices.getUserMedia({ video:{facingMode:'user'}, audio:false });
    const vid = document.getElementById('cam-video');
    vid.srcObject = APP.stream;
    document.getElementById('cam-box').classList.add('streaming');
    document.getElementById('cam-empty').style.display   = 'none';
    document.getElementById('cam-snap').style.display    = 'none';
    document.getElementById('btn-open-cam').style.display = 'none';
    document.getElementById('btn-capture').style.display  = '';
  } catch(e) {
    alert('❌ Camera permission denied. Please allow camera access to mark attendance.');
  }
};

window.captureSnap = function() {
  const vid    = document.getElementById('cam-video');
  const canvas = document.getElementById('snap-canvas');
  const ctx = canvas.getContext('2d');
  ctx.drawImage(vid, 0, 0, 400, 300);
  
  const timestamp = new Date().toLocaleString('en-IN');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 275, 400, 25);
  ctx.fillStyle = '#ffffff';
  ctx.font = '13px "DM Sans", sans-serif';
  ctx.fillText('🔴 LIVE CAM · ' + timestamp, 10, 292);

  APP.photo = canvas.toDataURL('image/jpeg', 0.82);

  const snap = document.getElementById('cam-snap');
  snap.src = APP.photo;
  snap.style.display = 'block';
  vid.style.display  = 'none';

  if (APP.stream) APP.stream.getTracks().forEach(t => t.stop());

  document.getElementById('btn-capture').style.display = 'none';
  document.getElementById('btn-retake').style.display  = '';
};

window.retake = function() {
  APP.photo = null;
  document.getElementById('cam-snap').style.display   = 'none';
  document.getElementById('cam-video').style.display  = '';
  document.getElementById('btn-retake').style.display  = 'none';
  window.openCam();
};

window.submitAttendance = async function() {
  const btnSubmit = document.getElementById('btn-submit');
  
  const name = document.getElementById('stu-name').value.trim();
  const roll = document.getElementById('stu-roll').value.trim();
  const lecId = document.getElementById('stu-lecture').value.trim().toUpperCase();

  if (!name)       { alert('Please enter your full name!');     return; }
  if (!roll)       { alert('Please enter your roll number!');   return; }
  if (!lecId)      { alert('Please enter the Lecture ID!');     return; }
  if (!APP.photo)  { alert('Please capture your live photo!');  return; }

  const sess = APP.sessions[APP.section];
  if (!sess || !sess.active) {
    alert('Session is no longer active!');
    return;
  }

  if (lecId !== sess.lectureId) {
    alert('❌ Invalid Lecture ID! Please counter-check with your CR.');
    return;
  }

  const now = new Date();
  const currentHHMM = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  if (currentHHMM > sess.end) {
    alert(`Late Entry Blocked. Attendance closed at ${window.formatTime12(sess.end)}`);
    return;
  }

  const today = now.toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'});
  const docIdStr = `${roll}_${today.replace(/\//g,'-')}_${lecId}`;

  try {
    // 1. Check duplicate FIRST
    const docRef = doc(db, "attendance", docIdStr);
    const snap = await getDoc(docRef);
    if(snap.exists()) {
      alert('⚠️ Attendance already marked for this lecture.'); 
      return;
    }

    // Replace click handlers to prevent double click
    document.body.style.cursor = 'wait';
    
    // 2. Upload photo to Firebase Storage
    const photoRef = ref(storage, `attendance/${APP.section}/${docIdStr}.jpg`);
    await uploadString(photoRef, APP.photo, 'data_url');
    const photoUrl = await getDownloadURL(photoRef);

    // 3. Save entry to Firestore using download URL
    const entry = {
      name,
      roll,
      lectureId: lecId,
      section:   APP.section,
      photo:     photoUrl,
      time:      now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}),
      date:      today,
      status:    'pending',
      timestamp: Date.now()
    };

    await setDoc(docRef, entry);

    // Fill success receipt
    document.getElementById('s-name').textContent = name;
    document.getElementById('s-roll').textContent = roll;
    document.getElementById('s-sec').textContent  = APP.section;
    document.getElementById('s-time').textContent = entry.time;

    // Reset form
    document.getElementById('stu-name').value      = '';
    document.getElementById('stu-roll').value      = '';
    document.getElementById('cam-snap').style.display   = 'none';
    document.getElementById('cam-empty').style.display  = '';
    document.getElementById('cam-box').classList.remove('streaming');
    document.getElementById('btn-open-cam').style.display = '';
    document.getElementById('btn-capture').style.display  = 'none';
    document.getElementById('btn-retake').style.display   = 'none';
    APP.photo = null;

    document.body.style.cursor = 'default';
    window.goto('p-success');

  } catch (e) {
    document.body.style.cursor = 'default';
    alert("Error saving attendance: " + e.message);
  }
};

window.resetAndGoHome = function() {
  window.goto('p-landing');
  document.getElementById('stu-section').value = '';
};

window.downloadPDF = function() {
  if (!APP.cr) return;
  const sec  = APP.cr.section;
  const list = APP.students.filter(s => s.status === 'approved');
  const date = new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});
  const time = new Date().toLocaleTimeString('en-IN');

  const rows = list.length
    ? list.map((s,i) => `
        <tr>
          <td>${i+1}</td>
          <td>${s.roll}</td>
          <td>${s.name}</td>
          <td>${s.section}</td>
          <td>${s.time}</td>
          <td style="color:#16a34a;font-weight:700;">Present</td>
        </tr>`).join('')
    : `<tr><td colspan="6" style="text-align:center;color:#888;padding:20px;">No approved entries yet</td></tr>`;

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Attendance — ${sec} — ${date}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;padding:36px;color:#111;background:#fff}
    .hdr{text-align:center;padding-bottom:20px;border-bottom:3px solid #3B82F6;margin-bottom:26px}
    .hdr h1{font-size:22px;color:#0B1622;margin-bottom:6px}
    .hdr p{font-size:14px;color:#555}
    .meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:22px;font-size:13px;color:#444}
    .meta b{color:#0B1622}
    table{width:100%;border-collapse:collapse;font-size:14px}
    th{background:#0B1622;color:#fff;padding:11px 14px;text-align:left;font-size:12px;letter-spacing:0.5px}
    td{padding:10px 14px;border-bottom:1px solid #e8e8e8}
    tr:nth-child(even) td{background:#f7f7f7}
    .summary{margin-top:22px;font-size:14px;color:#333;padding:12px 16px;background:#f0f7f0;border-radius:6px;border-left:4px solid #16a34a}
    .sigs{display:flex;justify-content:space-between;margin-top:70px}
    .sig{border-top:1px solid #999;width:180px;text-align:center;padding-top:8px;font-size:12px;color:#555}
    .footer{margin-top:36px;text-align:center;font-size:11px;color:#aaa}
    .blue{color:#3B82F6;font-weight:700}
  </style>
  </head><body>
  <div class="hdr">
    <h1>📚 Chandigarh Group of Colleges, Landran</h1>
    <p>Attendance Sheet &nbsp;|&nbsp; <span class="blue">${sec}</span></p>
  </div>
  <div class="meta">
    <div><b>Date:</b> ${date}</div>
    <div><b>Time Generated:</b> ${time}</div>
    <div><b>Section:</b> ${sec}</div>
    <div><b>CR:</b> ${APP.cr.name}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Roll Number</th>
        <th>Student Name</th>
        <th>Section</th>
        <th>Time Marked</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="summary">
    <b>Summary:</b> &nbsp; Total Present (Approved): <b>${list.length}</b> &nbsp;|&nbsp; Total Students: <b>60</b> &nbsp;|&nbsp; Absent: <b>${60 - list.length}</b>
  </div>
  <div class="sigs">
    <div class="sig">CR Signature</div>
    <div class="sig">Faculty Signature</div>
    <div class="sig">HOD Signature</div>
  </div>
  <div class="footer">
    Generated by ClassMark &mdash; CGC Landran Smart Attendance System &nbsp;&middot;&nbsp; ${date}
  </div>
  </body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 600);
};
