// The ops console's static page (手機登入 PR 2, 3): signs in with Google, asks the console's Apps
// Script for viewParts through doPost, and shows the whole page it answers; the page's own script
// (client.js) then runs with ConsoleRun standing in for the Apps Script page's run object. The pure
// functions below (session, request, parts) run in node for tests/console_web.test.js; the browser
// wiring at the end only runs where there is a document.
var Shell = (function () {
  var KEY = "console.session";
  // The session token is "v1|email|sub|expiry|signature" (backend/login.js); only the expiry is read
  // here, to avoid asking with a token that is already dead. The server checks all of it again.
  function readSession(store, now) {
    var token = "";
    try { token = String(store.getItem(KEY) || ""); } catch (e) { return null; }
    var p = token.split("|");
    if (p.length !== 5 || p[0] !== "v1" || !(Number(p[3]) > now)) { try { store.removeItem(KEY); } catch (e) {} return null; }
    return { token: token, email: p[1] };
  }
  function saveSession(store, token) { store.setItem(KEY, token); }
  function clearSession(store) { try { store.removeItem(KEY); } catch (e) {} }

  // text/plain keeps the POST "simple" (no CORS preflight), as the booking pages do.
  function request(action, token, args) {
    return { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
             body: JSON.stringify({ action: action, token: token, args: args }), credentials: "omit", redirect: "follow" };
  }
  // The sign-in call carries the Google ID token instead of a session token (console/src/app.js login_).
  function loginRequest(credential) {
    var r = request("login", "", []);
    r.body = JSON.stringify({ action: "login", credential: String(credential || "") });
    return r;
  }
  // What the server answered, or the reason it is not usable. "bad" = the session is gone: sign in again.
  function answer(text) {
    var r;
    try { r = JSON.parse(text); } catch (e) { return { bad: false, error: "回應不是 JSON" }; }
    if (r && r.ok) return { result: r.result };
    var msg = r && r.error ? String(r.error) : "失敗";
    return { bad: msg === "登入失敗或未登入", error: msg };
  }

  // Everything inside the server page's <main> except its own heading (this page has one) and scripts,
  // in page order. Scripts and inline handlers never come across: the page's behaviour is client.js,
  // cut from the same app.js, which wires the forms and buttons itself.
  function parts(doc) {
    var main = doc.querySelector("main");
    if (!main) return [];
    return [].slice.call(main.children).filter(function (n) { return !/^(h1|script)$/i.test(n.tagName); }).map(function (node) {
      var copy = node.cloneNode(true);
      [].slice.call(copy.querySelectorAll("script,iframe,object,embed")).forEach(function (x) { x.remove(); });
      [copy].concat([].slice.call(copy.querySelectorAll("*"))).forEach(function (x) {
        [].slice.call(x.attributes).forEach(function (a) {
          if (/^on/i.test(a.name) || (/^(href|src|action)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) x.removeAttribute(a.name);
        });
      });
      return copy;
    });
  }

  return { KEY: KEY, readSession: readSession, saveSession: saveSession, clearSession: clearSession,
           request: request, loginRequest: loginRequest, answer: answer, parts: parts };
})();

if (typeof module !== "undefined") module.exports = Shell;

// ---- browser wiring ---------------------------------------------------------------------------
if (typeof document !== "undefined" && typeof window !== "undefined" && window.CONSOLE_CONFIG) (function () {
  var cfg = window.CONSOLE_CONFIG, el = function (id) { return document.getElementById(id); };
  var store = window.localStorage;
  function say(text, cls) { var s = el("status"); s.textContent = text; s.className = cls || "muted"; }

  function signedOut(why) {
    Shell.clearSession(store);
    el("app").hidden = true; el("signin").hidden = false; el("session").hidden = true; el("who").textContent = "";
    el("root").textContent = "";
    if (why) say(why, "error");
  }
  // The Apps Script page's run object, for client.js: the same chain (withSuccessHandler / withFailureHandler / the call
  // by name), answered by a doPost fetch with the session token. The server names the allowed calls
  // (CALLS in app.js); anything else comes back as an error, so the name is not filtered here.
  function runner(ok, bad) {
    var base = { withSuccessHandler: function (f) { return runner(f, bad); }, withFailureHandler: function (f) { return runner(ok, f); } };
    return new Proxy(base, { get: function (t, name) {
      return t[name] || function (arg) { call(String(name), arg, ok, bad); };
    } });
  }
  function call(name, arg, ok, bad) {
    var s = Shell.readSession(store, Date.now()), gone = function () { signedOut("請重新登入"); bad(new Error("請重新登入")); };
    if (!s) return gone();
    fetch(cfg.api, Shell.request(name, s.token, arg))
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var a = Shell.answer(t);
        if (a.bad) return gone();
        if (a.error) return bad(new Error(a.error));
        ok(a.result);
      })
      .catch(function () { bad(new Error("連不上中控台，請稍後再試")); });
  }
  window.ConsoleRun = runner(function () {}, function () {});
  function show(nodes) {
    var root = el("root");
    root.textContent = "";
    nodes.forEach(function (n) { root.appendChild(document.importNode(n, true)); });
  }
  function load() {
    var s = Shell.readSession(store, Date.now());
    if (!s) return signedOut();
    el("signin").hidden = true; el("app").hidden = false; el("session").hidden = false; el("who").textContent = s.email;
    say("讀取中…");
    fetch(cfg.api, Shell.request("viewParts", s.token, []))
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var a = Shell.answer(t);
        if (a.bad) return signedOut("請重新登入");
        if (a.error) return say("讀取失敗：" + a.error, "error");
        show(Shell.parts(new DOMParser().parseFromString(a.result.html, "text/html")));
        say("");
        // Once per page load (signing in reloads the page), so its document-level listeners are added once.
        if (window.runConsoleClient) window.runConsoleClient();
      })
      .catch(function () { say("連不上中控台，請稍後再試", "error"); });
  }
  function onCredential(resp) {
    say("登入中…");
    fetch(cfg.api, Shell.loginRequest(resp.credential))
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var a = Shell.answer(t);
        if (a.error) return say(a.error === "登入失敗或未登入" ? "這個帳號不能登入" : a.error, "error");
        Shell.saveSession(store, a.result.token);
        window.location.reload();
      })
      .catch(function () { say("連不上中控台，請稍後再試", "error"); });
  }
  el("logout").addEventListener("click", function () { signedOut(); });
  window.addEventListener("load", function () {
    if (window.google && google.accounts && google.accounts.id && cfg.clientId) {
      google.accounts.id.initialize({ client_id: cfg.clientId, callback: onCredential, auto_select: false });
      google.accounts.id.renderButton(el("gbutton"), { theme: "outline", size: "large", text: "signin_with", locale: "zh-TW" });
    } else if (!cfg.clientId) say("尚未設定登入用戶端", "error");
    load();
  });
})();
