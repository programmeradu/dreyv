/**
 * Mobile scroll diagnostic — verifies the /app shell does not double-scroll
 * or clip on iOS Safari. Visit at /app/_mobile-scroll-test.
 *
 * What to check:
 *  - Only ONE scrollbar should appear (the page content), never the body.
 *  - The mobile top bar should remain visible while scrolling.
 *  - The bottom marker "✓ end of test" should be reachable, with the iOS
 *    Safari address bar collapsed AND expanded.
 */
"use client";

export default function MobileScrollTestPage() {
    const rows = Array.from({ length: 60 }, (_, i) => i + 1);
    return (
        <div className="relative z-10 w-full px-4 sm:px-6 py-6">
            <header className="mb-4">
                <p className="text-xs uppercase tracking-[0.18em] text-violet-600">Diagnostic</p>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">Mobile scroll test</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Scroll to the bottom. The mobile top bar should stay put, no horizontal scrollbar
                    should appear, and the page should not get clipped by the iOS address bar.
                </p>
            </header>

            <div className="rounded-2xl border border-violet-200 bg-white p-4 mb-4 text-sm text-slate-700">
                <p>Viewport height should fill exactly to the bottom of the visible area on iOS Safari.</p>
                <p className="mt-1 text-xs text-slate-500">If you see two scrollbars or content cut off, report it.</p>
            </div>

            <ul className="space-y-2">
                {rows.map((n) => (
                    <li
                        key={n}
                        className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground/80 flex items-center justify-between"
                    >
                        <span>Row {n}</span>
                        <span className="text-xs text-muted-foreground">{n}/{rows.length}</span>
                    </li>
                ))}
            </ul>

            <div className="mt-6 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-center text-sm font-medium text-violet-700">
                ✓ end of test — if you can read this in full on mobile, the shell is healthy.
            </div>
        </div>
    );
}
