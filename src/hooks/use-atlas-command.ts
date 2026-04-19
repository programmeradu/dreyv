import { useSyncExternalStore } from "react";

type AtlasCommand = {
  tool_id: string;
  parameters: Record<string, any>;
  timestamp: number;
};

type CommandState = {
  lastCommand: AtlasCommand | null;
};

type DispatchCommand = Omit<AtlasCommand, "timestamp">;

let state: CommandState = { lastCommand: null };
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

function dispatch(command: DispatchCommand) {
  state = {
    lastCommand: {
      ...command,
      timestamp: Date.now(),
    },
  };
  emitChange();
}

export function useAtlasCommand() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    lastCommand: snapshot.lastCommand,
    dispatch,
  };
}
