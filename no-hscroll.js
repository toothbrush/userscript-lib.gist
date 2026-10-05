/* no-hscroll.js — the page scrolls vertically only, whatever its width.
 *
 * Loaded with @require (tagged URL, see synced-list.js) and self-running,
 * so one line in a script's header is the whole opt-in:
 *   @require https://raw.githubusercontent.com/toothbrush/userscript-lib.gist/v4/no-hscroll.js
 *
 * Layers, since no single one holds on every host:
 *   1. html overflow-x hidden: the viewport clips sideways, still scrolls down.
 *   2. body overflow-x clip: no scroll container, so nothing to pan.
 *   3. html touch-action pan-y: iOS never starts a horizontal pan, so no
 *      elastic bounce either. pinch-zoom keeps zoom where it's understood.
 *   4. html overscroll-behavior-x none: no sideways overscroll on the root.
 *   5. a scroll listener that snaps scrollX back to 0, for anchors and
 *      scripts that scroll the window themselves.
 * Horizontal scrolling inside an element (a wide <pre>, a carousel) still
 * works: touch-action is judged against the nearest scroller, not the root.
 */

var NO_HSCROLL_VERSION = "1";

(function noHorizontalScroll() {
    var css =
        "html { overflow-x: hidden !important; " +
        "  touch-action: pan-y !important; touch-action: pan-y pinch-zoom !important; " +
        "  overscroll-behavior-x: none !important; }\n" +
        "body { overflow-x: clip !important; max-width: 100% !important; }";

    function addStyle() {
        if (document.getElementById("no-hscroll")) return;
        var style = document.createElement("style");
        style.id = "no-hscroll";
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    function pin() {
        if (window.scrollX || window.pageXOffset) window.scrollTo(0, window.scrollY || window.pageYOffset);
    }

    // document-start can run before <head> exists; wait for it if so.
    if (document.head) addStyle();
    else document.addEventListener("DOMContentLoaded", addStyle);
    window.addEventListener("scroll", pin, { passive: true });
    window.addEventListener("load", pin);
    pin();
})();
