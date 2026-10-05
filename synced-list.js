/* synced-list.js — shared plumbing for userscripts that keep a plain-text
 * list in a GitHub repo: everyone reads it unauthenticated via raw.github,
 * devices with a fine-grained PAT write it through the Contents API, one
 * commit per change.
 *
 * Loaded with @require. Hosts cache a @require by URL (iOS Userscripts
 * never re-checks one), so always require a tagged URL:
 *   @require https://raw.githubusercontent.com/toothbrush/userscript-lib.gist/v2/synced-list.js
 * A change here is a new tag and a bumped @require in each script.
 *
 * Everything is a plain function or var so it lands in the script's scope
 * on every host (Tampermonkey sandbox, iOS Userscripts, webmacs).
 */

var SYNCED_LIST_VERSION = "2";
// On every element the library adds, so other scripts can skip them.
var SYNCED_UI_CLASS = "pixelfont-ignore";

/* ---------- GM API shims ----------
 * Hosts vary: iOS Userscripts has GM_xmlhttpRequest but only the async GM.*
 * storage and no menu. A missing storage API means "no cache on this device",
 * never a ReferenceError that kills the script. */

function gmGet(key, def) {
    try { if (typeof GM_getValue === "function") return GM_getValue(key, def); } catch (e) {}
    return def;
}
function gmSet(key, val) {
    try { if (typeof GM_setValue === "function") GM_setValue(key, val); } catch (e) {}
}
function gmDelete(key) {
    try { if (typeof GM_deleteValue === "function") GM_deleteValue(key); } catch (e) {}
}
function gmXhr(details) {
    if (typeof GM_xmlhttpRequest === "function") return GM_xmlhttpRequest(details);
    if (typeof GM !== "undefined" && GM && GM.xmlHttpRequest) return GM.xmlHttpRequest(details);
    return null; // no cross-origin transport; onload never fires
}
function registerMenu(label, fn) {
    if (typeof GM_registerMenuCommand === "function") GM_registerMenuCommand(label, fn);
}

/* ---------- text ---------- */

// UTF-8-safe base64. The Contents API ships bodies base64 with newlines
// every 60 chars; strip them before decoding.
function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64decode(b64) { return decodeURIComponent(escape(atob(b64.replace(/\n/g, "")))); }

// A comment is a whole line starting with # or follows whitespace, so a
// `tag#id` selector survives and `name  # note` loses the note.
function stripComment(raw) {
    if (/^\s*#/.test(raw)) return "";
    return raw.replace(/\s+#.*$/, "").trim();
}

// Every meaningful line, comments stripped, in order.
function parseLines(text) {
    return text.split("\n").map(stripComment).filter(Boolean);
}

/* ---------- toast with one optional action ---------- */

var syncedToastEl = null, syncedToastTimer = null;

function showToast(msg, actionLabel, actionFn) {
    if (!syncedToastEl) {
        syncedToastEl = document.createElement("div");
        syncedToastEl.classList.add(SYNCED_UI_CLASS);
        syncedToastEl.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);" +
            "z-index:2147483647;background:#222;color:#fff;padding:10px 14px;border-radius:6px;" +
            "font:14px/1.3 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);max-width:90vw;";
        (document.body || document.documentElement).appendChild(syncedToastEl);
    }
    syncedToastEl.textContent = msg + " ";
    if (actionLabel && actionFn) {
        var a = document.createElement("a");
        a.textContent = actionLabel;
        a.href = "javascript:void(0)";
        a.style.cssText = "color:#6cf;margin-left:8px;cursor:pointer;font-weight:bold;";
        a.addEventListener("click", function (e) { e.preventDefault(); hideToast(); actionFn(); });
        syncedToastEl.appendChild(a);
    }
    syncedToastEl.style.display = "block";
    clearTimeout(syncedToastTimer);
    syncedToastTimer = setTimeout(hideToast, 6000);
}

function hideToast() { if (syncedToastEl) syncedToastEl.style.display = "none"; }

/* ---------- SyncedFile ----------
 * new SyncedFile({repo: "owner/name", file: "killfile.txt", branch, ttlMs,
 *                 cacheKey, tokenKey, tag})
 * cacheKey and tokenKey default to the names the older scripts used, so
 * a device keeps its token and cache across the move to this library. */

function SyncedFile(opts) {
    this.repo = opts.repo;
    this.branch = opts.branch || "main";
    this.file = opts.file;
    this.tag = opts.tag || opts.file;
    this.ttlMs = opts.ttlMs || 5 * 60 * 1000;
    this.cacheKey = opts.cacheKey || "synced_cache";
    this.tokenKey = opts.tokenKey || "gh_gist_token";
    this.rawUrl = "https://raw.githubusercontent.com/" + this.repo + "/" + this.branch + "/" + this.file;
    this.apiUrl = "https://api.github.com/repos/" + this.repo + "/contents/" + this.file;
}

SyncedFile.prototype.log = function (msg) { console.log("[" + this.tag + "] " + msg); };
SyncedFile.prototype.warn = function (msg) { console.warn("[" + this.tag + "] " + msg); };

/* token: write capability lives on devices that hold one */
SyncedFile.prototype.token = function () { return gmGet(this.tokenKey, ""); };
SyncedFile.prototype.canWrite = function () { return !!this.token(); };

/* cache */
SyncedFile.prototype.cached = function () { return gmGet(this.cacheKey, ""); };
SyncedFile.prototype.cache = function (content) {
    gmSet(this.cacheKey, content);
    gmSet(this.cacheKey + "_ts", Date.now());
};
SyncedFile.prototype.stale = function () {
    return Date.now() - gmGet(this.cacheKey + "_ts", 0) >= this.ttlMs;
};

// apply(text) runs now with the cached text, so the page is right at once,
// and again when fresh text lands.
SyncedFile.prototype.load = function (apply) {
    apply(this.cached());
    this.refresh(apply, false);
};

// Fetch when stale, or always with force. apply(text) on success.
// raw.github caches ~5 min; a changing query param is a fresh CDN key.
SyncedFile.prototype.refresh = function (apply, force) {
    if (!force && !this.stale()) return;
    var self = this;
    var handle = gmXhr({
        method: "GET",
        url: this.rawUrl + "?t=" + Date.now(),
        onload: function (res) {
            self.log("fetch HTTP " + res.status + " (" + (res.responseText ? res.responseText.length : 0) + " bytes)");
            if (res.status >= 200 && res.status < 300) {
                self.cache(res.responseText);
                apply(res.responseText); // straight from the response: storage may be a no-op
            } else {
                self.warn("fetch non-2xx, not applied");
                if (self.onError) self.onError(self.file + " fetch failed (HTTP " + res.status + ")");
            }
        },
        onerror: function (res) {
            self.warn("fetch errored (status " + (res && res.status) + ", " + (res && res.error) + ")");
            if (self.onError) self.onError(self.file + " fetch errored: check @connect");
        },
        ontimeout: function () {
            self.warn("fetch timed out");
            if (self.onError) self.onError(self.file + " fetch timed out");
        },
    });
    if (!handle) {
        this.warn("no GM XHR on this host");
        if (this.onError) this.onError("no GM XHR: cannot fetch " + this.file);
    }
};

/* GitHub Contents API */
SyncedFile.prototype.api = function (method, body, cb) {
    // GETs are cached ~60s by GitHub; a read right after a write would hand
    // back a stale sha and content. Bust it. PUTs are never cached.
    var url = method === "GET" ? this.apiUrl + "?ref=" + this.branch + "&t=" + Date.now() : this.apiUrl;
    gmXhr({
        method: method,
        url: url,
        headers: {
            "Authorization": "Bearer " + this.token(),
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        data: body ? JSON.stringify(body) : undefined,
        onload: function (res) {
            if (res.status >= 200 && res.status < 300) {
                try { cb(null, JSON.parse(res.responseText)); }
                catch (e) { cb(new Error("bad JSON from GitHub")); }
            } else {
                var e = new Error("GitHub " + res.status);
                e.status = res.status;
                cb(e);
            }
        },
        onerror: function () { cb(new Error("network error")); },
    });
};

// GET content and sha, transform(text) -> new text or null to skip, PUT with
// a commit message. The sha guards against clobbering another device; a 409
// means it went stale, so re-GET and transform again, a few times.
var SYNCED_MUTATE_RETRIES = 4;
SyncedFile.prototype.mutate = function (message, transform, cb, attempt) {
    attempt = attempt || 0;
    var self = this;
    this.api("GET", null, function (err, file) {
        if (err) return cb(err);
        var content = file && file.content ? b64decode(file.content) : "";
        var newContent = transform(content);
        if (newContent === null) return cb(null);
        var body = { message: message, content: b64encode(newContent), branch: self.branch };
        if (file && file.sha) body.sha = file.sha; // omit only when creating the file
        self.api("PUT", body, function (err2) {
            if (err2) {
                if (err2.status === 409 && attempt < SYNCED_MUTATE_RETRIES) {
                    setTimeout(function () { self.mutate(message, transform, cb, attempt + 1); }, 250 * (attempt + 1));
                    return;
                }
                return cb(err2);
            }
            self.cache(newContent); // 2xx: what we sent is authoritative
            cb(null);
        });
    });
};

// Append a line unless its stripped form is already there.
SyncedFile.prototype.appendLine = function (line, message, cb) {
    var key = stripComment(line);
    this.mutate(message, function (content) {
        if (parseLines(content).indexOf(key) >= 0) return null;
        var lines = content.replace(/\n+$/, "").split("\n");
        if (lines.length === 1 && lines[0] === "") lines = [];
        lines.push(line);
        return lines.join("\n") + "\n";
    }, cb);
};

// Drop every line whose stripped form matches: a string, or a predicate.
SyncedFile.prototype.removeLine = function (match, message, cb) {
    var hit = typeof match === "function" ? match : function (s) { return s === match; };
    this.mutate(message, function (content) {
        return content.split("\n").filter(function (line) {
            var s = stripComment(line);
            return !(s && hit(s));
        }).join("\n");
    }, cb);
};

// Tampermonkey menu entry (webmacs: :userscript-menu) to enter or clear the
// PAT. Validated once at entry, never on page load. afterSave runs once a
// token checks out, afterClear when one is removed.
SyncedFile.prototype.registerTokenMenu = function (afterSave, afterClear) {
    var self = this;
    registerMenu("Set GitHub token…", function () {
        var t = prompt("Fine-grained PAT, scoped to this repo's Contents: read/write ONLY. Blank to clear:", self.token());
        if (t === null) return;
        var trimmed = t.trim();
        if (!trimmed) {
            gmDelete(self.tokenKey);
            if (afterClear) afterClear();
            alert("Token cleared. Write features hidden on this device.");
            return;
        }
        gmSet(self.tokenKey, trimmed);
        self.api("GET", null, function (err, file) {
            if (err) { alert("⚠ Token saved but validation failed: " + err.message); return; }
            alert(file && file.content ? "Token works. Reload to see write features."
                                       : "Token works, but '" + self.file + "' isn't in the repo yet — create it first.");
            if (afterSave) afterSave();
        });
    });
};
