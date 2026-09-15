// The login autofill that runs inside a parts portal's page — see partsPortals.js.
// Pure, no app imports, so it runs under node:test (portalAutofill.test.mjs).

// The only hosts a saved login may ever be typed into. Checked INSIDE the page,
// so a redirect to anyone else's site gets nothing.
export const PORTAL_HOSTS = {
  partstech: ['partstech.com'],
  repairlink: ['repairlinkshop.com'],
}

// The script run in the portal's page. Pure string-building so it can be
// tested; see portalAutofill.test.mjs.
//
// Written for login forms we can't see ahead of time (PartsTech is a React app,
// RepairLink a plain server form), so it looks for what every login form has:
// a visible password box, and the text/email box before it. Values go in
// through the native setter plus input/change events, which is what makes a
// React-controlled input actually register them.
//
// It keeps watching (a login form can render late, or appear after a session
// times out mid-visit) but auto-submits at most twice per window, so a wrong
// saved password shows the portal's own error instead of looping.
export function autofillScript({ username, password, hosts }) {
  const cfg = JSON.stringify({ u: username, p: password, hosts })
  return `(function () {
  var C = ${cfg};
  var h = location.hostname;
  if (!C.hosts.some(function (d) { return h === d || h.slice(-(d.length + 1)) === '.' + d; })) return;
  if (window.__carzPortalFill) return;
  window.__carzPortalFill = true;
  // Counted in sessionStorage, not a variable: RepairLink's form posts and
  // reloads the page, which would reset a variable and loop on a bad password.
  var KEY = 'carzPortalSubmits';
  function submits() { try { return +(sessionStorage.getItem(KEY) || 0); } catch (e) { return 0; } }
  function vis(el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }
  function all(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)).filter(vis); }
  function put(el, v) {
    if (el.value === v) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function userBox(root, before) {
    var boxes = all(root, 'input[type=email],input[type=text],input:not([type])').filter(function (el) {
      return !before || (el.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    return boxes[boxes.length - 1];
  }
  function submit(root) {
    var n = submits();
    if (n >= 2) return;
    try { sessionStorage.setItem(KEY, String(n + 1)); } catch (e) { return; }
    setTimeout(function () {
      var btn = all(root, 'button[type=submit],input[type=submit]')[0] ||
        all(root, 'button').filter(function (b) { return /log\\s*in|sign\\s*in|continue|next/i.test(b.textContent || ''); })[0];
      if (btn) btn.click();
      else if (root.requestSubmit) root.requestSubmit();
    }, 400);
  }
  function tick() {
    var pw = all(document, 'input[type=password]')[0];
    // Signed in: no login form on screen. Reset the allowance so a session
    // that times out later in the visit can be signed back in.
    if (!pw && !/log-?in|sign-?in/i.test(location.pathname + location.hash)) {
      try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    }
    if (pw) {
      if (pw.value) return;
      var root = pw.form || document;
      var u = userBox(root, pw);
      if (u) put(u, C.u);
      put(pw, C.p);
      submit(pw.form || root);
      return;
    }
    // Username-first logins: one box on a login page, password on the next step.
    // Only on a page that says it's a login — never a lone search box elsewhere.
    if (!/log-?in|sign-?in/i.test(location.pathname + location.hash)) return;
    var only = all(document, 'input[type=email],input[type=text]');
    if (only.length === 1 && !only[0].value) {
      put(only[0], C.u);
      submit(only[0].form || document);
    }
  }
  tick();
  setInterval(tick, 1000);
})();`
}
