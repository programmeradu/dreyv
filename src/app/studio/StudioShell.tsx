"use client";

import * as React from "react";
import MediaStudioClient from "@/app/app/studio/media/MediaStudioClient";
import StudioPasswordGate from "./StudioPasswordGate";

export default function StudioShell({ unlocked }: { unlocked: boolean }) {
  const [isUnlocked, setIsUnlocked] = React.useState(unlocked);

  if (!isUnlocked) {
    return <StudioPasswordGate onUnlocked={() => setIsUnlocked(true)} />;
  }

  return <MediaStudioClient />;
}
