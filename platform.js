/* ============================================================
   LifeCity · Plataforma (Firebase: usuarios + proyectos por usuario + licencias)
   - Login con Google o correo (login.html). Cada usuario tiene sus PROYECTOS en
     Firestore: users/{uid}/projects/{pid}. Cada proyecto guarda sus propiedades
     (lotes) y sus estudios de masas.
   - La app sigue trabajando sobre localStorage (claves por usuario + proyecto) y
     esta capa sincroniza con Firestore.
   - Plan free/pro en users/{uid}. Canje de licencia contra licenses/{code}.
   - Sin sesión Firebase => localStorage anónimo, plan 'free'.
   API:  await LifePlatform.ready;
         LifePlatform.isLogged()/userId()/email()/name()
         LifePlatform.projectsKey() / studiesKey()        // claves localStorage del proyecto activo
         LifePlatform.markDirty() | pushDebounced()       // avisar que cambió algo del proyecto
         await LifePlatform.pull() / push()
         LifePlatform.projects() / activeProject()
         await LifePlatform.createProject(name) / renameProject(id,name) / deleteProject(id) / switchProject(id)
         LifePlatform.plan() / isPro() / await refreshPlan() / await redeem(code)
         await LifePlatform.logout()
   ============================================================ */
(function () {
  var CFG = window.FIREBASE_CONFIG || {};
  var SDK = window.FIREBASE_SDK || 'https://www.gstatic.com/firebasejs/10.12.2/';
  var PROPS_BASE = 'cali_aec_props_v1';
  var STUDIES_BASE = 'cali_massing_studies';
  var SESSION_KEY = 'lifecity_session';
  var MAX_DOC = 900000; // Firestore admite 1 MiB por documento
  var ROOT = (function () { try { return new URL('.', document.currentScript.src).href; } catch (e) { return ''; } })();

  function session() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }
  var sess = session();
  var sessUid = (sess && sess.provider === 'firebase' && sess.uid) ? sess.uid : null;

  var state = { fb: null, user: null, plan: 'free', planExp: null, projects: [], active: null };
  var resolveReady;
  var readyP = new Promise(function (r) { resolveReady = r; });

  function uid() { return state.user ? state.user.uid : sessUid; }
  function activeKey() { return 'lifecity_active_project_' + uid(); }
  function activeId() {
    if (!uid()) return null;
    if (state.active) return state.active;
    try { return localStorage.getItem(activeKey()) || 'default'; } catch (e) { return 'default'; }
  }
  function suffix() { return uid() ? ('_' + uid() + '_' + activeId()) : ''; }
  function projectsKey() { return PROPS_BASE + suffix(); }
  function studiesKey() { return STUDIES_BASE + suffix(); }
  function dirtyKey() { return 'lifecity_dirty' + suffix(); }

  function readJSON(k, def) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v; } catch (e) { return def; } }
  function notify(msg) { try { window.dispatchEvent(new CustomEvent('lifeplatform-message', { detail: msg })); } catch (e) {} console.warn('[LifePlatform]', msg); }

  async function loadSdk() {
    var app = await import(SDK + 'firebase-app.js');
    var auth = await import(SDK + 'firebase-auth.js');
    var fs = await import(SDK + 'firebase-firestore.js');
    var a = app.getApps().length ? app.getApp() : app.initializeApp(CFG);
    return { authMod: auth, fs: fs, auth: auth.getAuth(a), db: fs.getFirestore(a) };
  }
  function firstUser(fb) {
    return new Promise(function (res) {
      var un = fb.authMod.onAuthStateChanged(fb.auth, function (u) { un(); res(u); });
    });
  }

  async function init() {
    try {
      if (CFG.apiKey && CFG.projectId) {
        state.fb = await loadSdk();
        state.user = await firstUser(state.fb);
        if (sessUid && (!state.user || state.user.uid !== sessUid)) {
          // La sesión local no coincide con Firebase: volver a entrar.
          try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
          if (ROOT) { location.replace(ROOT + 'login.html'); return; }
        }
        if (state.user) {
          await ensureProfile();
          await loadProjects();
          await pull();
        }
      }
    } catch (e) { console.warn('[LifePlatform] Firebase no disponible:', e.message); }
    var c = readJSON('cali_plan', null);
    if (c && !state.user) { state.plan = c.plan || 'free'; state.planExp = c.exp || null; }
    resolveReady(true);
  }

  // ---------- perfil y plan ----------
  function userRef() { return state.fb.fs.doc(state.fb.db, 'users', state.user.uid); }
  async function ensureProfile() {
    var fs = state.fb.fs, u = state.user;
    var profile = { name: u.displayName || u.email || '', email: u.email || '', photo: u.photoURL || '', lastLogin: fs.serverTimestamp() };
    var snap = await fs.getDoc(userRef());
    if (!snap.exists()) {
      await fs.setDoc(userRef(), Object.assign({ plan: 'free' }, profile));
      applyPlan({ plan: 'free' });
    } else {
      applyPlan(snap.data());
      fs.updateDoc(userRef(), profile).catch(function (e) { console.warn('[LifePlatform] perfil:', e.message); });
    }
  }
  function applyPlan(d) {
    state.plan = d.plan || 'free';
    state.planExp = null;
    if (d.planSince && d.planMonths) {
      var since = d.planSince.toDate ? d.planSince.toDate() : new Date(d.planSince);
      since.setMonth(since.getMonth() + Number(d.planMonths));
      state.planExp = since.toISOString();
    }
    try { localStorage.setItem('cali_plan', JSON.stringify({ plan: state.plan, exp: state.planExp })); } catch (e) {}
  }
  async function refreshPlan() {
    if (!state.fb || !state.user) return state.plan;
    try { var s = await state.fb.fs.getDoc(userRef()); if (s.exists()) applyPlan(s.data()); }
    catch (e) { console.warn('[LifePlatform] plan:', e.message); }
    return state.plan;
  }
  function isPro() {
    if (state.plan !== 'pro') return false;
    if (state.planExp && Date.now() > new Date(state.planExp).getTime()) return false;
    return true;
  }
  async function redeem(code) {
    if (!state.fb || !state.user) throw new Error('Inicia sesión para activar una licencia.');
    code = (code || '').trim();
    if (!code || code.indexOf('/') >= 0) throw new Error('Licencia inválida.');
    var fs = state.fb.fs, db = state.fb.db;
    var lic = fs.doc(db, 'licenses', code);
    var snap;
    try { snap = await fs.getDoc(lic); } catch (e) { throw new Error('Licencia inválida.'); }
    if (!snap.exists() || snap.data().usedBy) throw new Error('Licencia inválida o ya usada.');
    var d = snap.data();
    var b = fs.writeBatch(db);
    b.update(lic, { usedBy: state.user.uid, usedAt: fs.serverTimestamp() });
    b.update(userRef(), { plan: d.plan || 'pro', planMonths: d.months || 12, planSince: fs.serverTimestamp(), license: code });
    try { await b.commit(); } catch (e) { throw new Error('No se pudo activar la licencia: ' + e.message); }
    await refreshPlan();
    return true;
  }

  // ---------- proyectos ----------
  function projectsCol() { return state.fb.fs.collection(state.fb.db, 'users', state.user.uid, 'projects'); }
  async function loadProjects() {
    var fs = state.fb.fs;
    var snap = await fs.getDocs(fs.query(projectsCol(), fs.orderBy('updatedAt', 'desc')));
    state.projects = snap.docs.map(function (doc) {
      var d = doc.data();
      return { id: doc.id, name: d.name || 'Proyecto', updatedAt: d.updatedAt && d.updatedAt.toDate ? d.updatedAt.toDate().getTime() : Date.now(), properties: d.propertiesCount || 0, studies: d.studiesCount || 0 };
    });
    var wanted = null;
    try { wanted = localStorage.getItem(activeKey()); } catch (e) {}
    if (!state.projects.length) {
      // Primer ingreso: el primer proyecto se lleva lo que ya hubiera en este navegador.
      var sfx = '_' + state.user.uid + '_default';
      var props = readJSON(PROPS_BASE + sfx, null) || readJSON(PROPS_BASE, []);
      var studies = readJSON(STUDIES_BASE + sfx, null) || readJSON(STUDIES_BASE, {});
      var p = await createProject('Mi primer proyecto', { props: props, studies: studies, noSwitch: true });
      try { [PROPS_BASE + sfx, STUDIES_BASE + sfx, 'lifecity_dirty' + sfx].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
      wanted = p.id;
    }
    if (!wanted || !state.projects.some(function (p) { return p.id === wanted; })) wanted = state.projects[0].id;
    setActive(wanted);
  }
  function setActive(id) {
    state.active = id;
    try { localStorage.setItem(activeKey(), id); } catch (e) {}
  }
  function payload(props, studies) {
    var fs = state.fb.fs;
    var pj = JSON.stringify(props || []), sj = JSON.stringify(studies || {});
    if (pj.length + sj.length > MAX_DOC) throw new Error('el proyecto supera el tamaño máximo (~1 MB). Pasa algunos estudios a otro proyecto.');
    // Se guarda como texto JSON: Firestore no admite arreglos anidados (anillos de coordenadas).
    return { propertiesJson: pj, studiesJson: sj, propertiesCount: (props || []).length, studiesCount: Object.keys(studies || {}).length, updatedAt: fs.serverTimestamp() };
  }
  async function createProject(name, opts) {
    opts = opts || {};
    if (!state.fb || !state.user) throw new Error('Inicia sesión para crear proyectos.');
    var fs = state.fb.fs;
    name = String(name || '').trim().slice(0, 120) || 'Proyecto sin nombre';
    var data = Object.assign({ name: name, createdAt: fs.serverTimestamp() }, payload(opts.props, opts.studies));
    var ref = await fs.addDoc(projectsCol(), data);
    var p = { id: ref.id, name: name, updatedAt: Date.now(), properties: (opts.props || []).length, studies: Object.keys(opts.studies || {}).length };
    state.projects.unshift(p);
    if (!opts.noSwitch) await switchProject(ref.id);
    return p;
  }
  async function renameProject(id, name) {
    if (!state.fb || !state.user) return;
    name = String(name || '').trim().slice(0, 120);
    if (!name) return;
    var fs = state.fb.fs;
    await fs.updateDoc(fs.doc(projectsCol(), id), { name: name, updatedAt: fs.serverTimestamp() });
    state.projects.forEach(function (p) { if (p.id === id) p.name = name; });
  }
  async function deleteProject(id) {
    if (!state.fb || !state.user) return;
    var fs = state.fb.fs;
    await fs.deleteDoc(fs.doc(projectsCol(), id));
    var sfx = '_' + state.user.uid + '_' + id;
    try { [PROPS_BASE + sfx, STUDIES_BASE + sfx, 'lifecity_dirty' + sfx].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
    state.projects = state.projects.filter(function (p) { return p.id !== id; });
    if (state.active === id) {
      clearTimeout(pushT);
      if (state.projects.length) { setActive(state.projects[0].id); location.reload(); }
      else await createProject('Mi primer proyecto');
    }
  }
  async function switchProject(id) {
    clearTimeout(pushT);
    if (localStorage.getItem(dirtyKey())) await push();
    setActive(id);
    location.reload();
  }

  // ---------- sincronización ----------
  async function pull() {
    if (!state.fb || !state.user || !state.active) return;
    if (localStorage.getItem(dirtyKey())) { await push(); return; } // hay cambios locales sin subir
    try {
      var fs = state.fb.fs;
      var snap = await fs.getDoc(fs.doc(projectsCol(), state.active));
      if (!snap.exists()) return;
      var d = snap.data();
      localStorage.setItem(projectsKey(), d.propertiesJson || '[]');
      localStorage.setItem(studiesKey(), d.studiesJson || '{}');
    } catch (e) { console.warn('[LifePlatform] pull:', e.message); }
  }
  var pushT = null;
  async function push() {
    if (!state.fb || !state.user || !state.active) return;
    var dk = dirtyKey(), stamp = localStorage.getItem(dk);
    try {
      var fs = state.fb.fs;
      var props = readJSON(projectsKey(), []), studies = readJSON(studiesKey(), {});
      await fs.updateDoc(fs.doc(projectsCol(), state.active), payload(props, studies));
      if (localStorage.getItem(dk) === stamp) localStorage.removeItem(dk);
      state.projects.forEach(function (p) { if (p.id === state.active) { p.properties = props.length; p.studies = Object.keys(studies).length; p.updatedAt = Date.now(); } });
    } catch (e) { notify('No se pudo guardar el proyecto en la nube: ' + e.message); }
  }
  function markDirty() {
    if (!uid()) return;
    try { localStorage.setItem(dirtyKey(), String(Date.now())); } catch (e) {}
    clearTimeout(pushT);
    pushT = setTimeout(function () { readyP.then(push); }, 1200);
  }

  async function logout() {
    clearTimeout(pushT);
    try { if (uid() && localStorage.getItem(dirtyKey())) await push(); } catch (e) {}
    try { if (state.fb) await state.fb.authMod.signOut(state.fb.auth); } catch (e) {}
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  window.LifePlatform = {
    ready: readyP,
    isLogged: function () { return !!uid(); },
    userId: uid,
    email: function () { return state.user ? state.user.email : (sess && sess.email) || null; },
    name: function () { return state.user ? (state.user.displayName || state.user.email) : (sess && sess.name) || null; },
    projectsKey: projectsKey,
    studiesKey: studiesKey,
    pull: pull, push: push, pushDebounced: markDirty, markDirty: markDirty,
    projects: function () { return state.projects.slice(); },
    activeProject: function () { var id = activeId(); return state.projects.filter(function (p) { return p.id === id; })[0] || null; },
    createProject: createProject, renameProject: renameProject, deleteProject: deleteProject, switchProject: switchProject,
    plan: function () { return isPro() ? 'pro' : 'free'; },
    isPro: isPro, refreshPlan: refreshPlan, redeem: redeem,
    logout: logout
  };
  init();
})();
