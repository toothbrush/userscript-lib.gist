// ==UserScript==
// @name         require-probe
// @namespace    https://github.com/toothbrush/userscript-lib.gist
// @updateURL    https://raw.githubusercontent.com/toothbrush/userscript-lib.gist/main/require-probe.user.js
// @downloadURL  https://raw.githubusercontent.com/toothbrush/userscript-lib.gist/main/require-probe.user.js
// @version      0.4
// @description  Shows whether @require and GM XHR work on this host.
// @author       toothbrush
// @match        https://example.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      raw.githubusercontent.com
// @require      https://raw.githubusercontent.com/toothbrush/userscript-lib.gist/v4/synced-list.js
// @run-at       document-idle
// ==/UserScript==

/* Install this on each host and open https://example.com/. A banner at the
 * top says what worked: the @require landed, which storage API exists, and
 * whether the library's GM XHR reached raw.github. */

(function () {
    var banner = document.createElement("div");
    banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:10px 14px;" +
        "font:14px/1.4 sans-serif;color:#fff;background:#444;white-space:pre-wrap;";
    (document.body || document.documentElement).appendChild(banner);

    var host = (typeof GM_info !== "undefined" && GM_info.scriptHandler) || "unknown host";
    var storage = typeof GM_getValue === "function" ? "sync GM_getValue"
        : (typeof GM !== "undefined" && GM && GM.getValue) ? "async GM.getValue only" : "no storage";

    if (typeof SyncedFile !== "function") {
        banner.style.background = "#a00";
        banner.textContent = "@require FAILED on " + host + ": SyncedFile is missing";
        return;
    }
    banner.textContent = "@require OK on " + host + ": synced-list v" + SYNCED_LIST_VERSION +
        "; storage: " + storage + "; fetching killfile.txt…";

    var file = new SyncedFile({ repo: "toothbrush/bow-killfile.gist", file: "killfile.txt",
                                cacheKey: "probe_cache", tag: "probe" });
    file.onError = function (msg) {
        banner.style.background = "#a60";
        banner.textContent += "\nGM XHR FAILED: " + msg;
    };
    file.refresh(function (text) {
        banner.style.background = "#060";
        banner.textContent = "@require OK on " + host + ": synced-list v" + SYNCED_LIST_VERSION +
            "; storage: " + storage + "; GM XHR OK: killfile.txt has " + parseLines(text).length + " names";
        gmGetAsync("probe_cache_ts", 0, function (ts) {
            banner.textContent += ts ? "; cache round trip OK" : "; cache MISSING";
            if (!ts) banner.style.background = "#a60";
        });
        showToast("All good on " + host);
    }, true);
})();
