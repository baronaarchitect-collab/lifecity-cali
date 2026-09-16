/* LifeCity · guard de sesión.
   Incluir en <head> ANTES del resto: <script src="auth.js"></script>
   Redirige a login.html si no hay sesión válida. */
/* Acceso directo: NO exige login. Si hay sesión válida muestra el nombre;
   si no, entra como "Invitado". login.html sigue disponible de forma opcional. */
(function () {
  var KEY = 'lifecity_session';
  var s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
  if (s && s.exp && Date.now() > s.exp) { try { localStorage.removeItem(KEY); } catch (e) {} s = null; }
  window.LifeCityAuth = {
    user: function () { return s; },
    name: function () { return (s && (s.name || s.email)) || 'Invitado'; },
    loggedIn: function () { return !!s; },
    logout: function () {
      try { localStorage.setItem('lifecity_logout', '1'); } catch (e) {}
      var done = function () { try { localStorage.removeItem(KEY); } catch (e) {} (window.top || window).location.replace('../login.html'); };
      if (window.LifePlatform && window.LifePlatform.logout) window.LifePlatform.logout().then(done, done); else done();
    }
  };
})();
