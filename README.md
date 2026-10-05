# userscript-lib

Shared plumbing for userscripts that keep a plain-text list in a GitHub
repo: read by every device via raw.github, written by devices with a
fine-grained PAT through the Contents API, one commit per change.

Used by `bow-killfile.gist` and `ennicen-guardian.gist`. Runs on
Tampermonkey, iOS Userscripts and webmacs.

## Use

    // @require https://raw.githubusercontent.com/toothbrush/userscript-lib.gist/v4/synced-list.js

    var file = new SyncedFile({ repo: "toothbrush/bow-killfile.gist", file: "killfile.txt",
                                cacheKey: "killfile_cache", tag: "bow" });
    file.load(function (text) { apply(parseLines(text)); });   // cached now, fresh later
    file.appendLine("name  # note", "killfile.txt: Add name", cb);
    file.removeLine("name", "killfile.txt: Remove name", cb);
    file.mutate("message", function (text) { return newText; }, cb);  // your own transform
    file.registerTokenMenu();
    if (file.canWrite()) { /* show mute buttons */ }

Storage: sync `GM_getValue` where a host has it, else the async
`GM.getValue` family (declare `@grant GM.getValue`, `GM.setValue`,
`GM.deleteValue`; iOS Userscripts has only those). `load` waits for
the async read; the token stays sync, so writes need sync storage.

Also exported: `gmGet`, `gmSet`, `gmDelete`, `gmXhr`, `registerMenu`,
`stripComment`, `parseLines`, `b64encode`, `b64decode`, `showToast`,
`hideToast`.

## no-hscroll.js

Vertical scrolling only, however wide the page gets: html clips
sideways, body is `overflow-x: clip`, `touch-action: pan-y` stops iOS
starting a horizontal pan (so no elastic bounce), and a scroll listener
snaps `scrollX` back to 0. Self-running; one line opts a script in:

    // @require https://raw.githubusercontent.com/toothbrush/userscript-lib.gist/v4/no-hscroll.js

Scrolling inside a wide `<pre>` or a carousel still works.

## Versioning

Hosts cache a `@require` by URL and iOS Userscripts never re-checks it.
Every change here is a new tag (`v2`, `v3`, …) and a bumped `@require`
line in each script, which the scripts' own auto-update then carries to
every device. Never move a tag.

## Probe

`require-probe.user.js` installs on any host and shows a banner on
https://example.com/ saying whether the `@require` landed, which storage
API exists, and whether GM XHR reached raw.github.
