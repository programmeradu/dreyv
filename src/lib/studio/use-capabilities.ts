"use client";

import { useEffect, useState } from "react";

export interface StudioCapabilities {
    browserRendering: boolean;
    save: boolean;
    ship: boolean;
    arweave: boolean;
    testMode: "real" | "static-lint";
}

const DEFAULTS: StudioCapabilities = {
    browserRendering: false,
    save: false,
    ship: false,
    arweave: false,
    testMode: "static-lint",
};

export function useStudioCapabilities() {
    const [caps, setCaps] = useState<StudioCapabilities>(DEFAULTS);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/studio/capabilities", { cache: "no-store" })
            .then((r) => r.json())
            .then((data) => {
                if (!cancelled) {
                    setCaps({ ...DEFAULTS, ...data });
                    setLoaded(true);
                }
            })
            .catch(() => {
                if (!cancelled) setLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return { caps, loaded };
}
