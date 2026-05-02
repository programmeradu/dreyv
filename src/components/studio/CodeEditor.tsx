"use client";

import React, { useEffect, useRef, useCallback } from "react";
import Editor from "@monaco-editor/react";

import { KEYSTONE_SDK_TYPES } from "@/generated/keystone-sdk-types";

const REACT_TYPES = `
declare module 'react' {
  export = React;
  export as namespace React;
}

declare namespace React {
  type ReactNode = string | number | boolean | null | undefined | ReactElement | ReactNode[];
  type ReactElement = { type: any; props: any; key: string | number | null };
  type FC<P = {}> = (props: P) => ReactNode;
  type PropsWithChildren<P = {}> = P & { children?: ReactNode };

  function useState<T>(initialState: T | (() => T)): [T, (newState: T | ((prev: T) => T)) => void];
  function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly any[]): T;
  function useMemo<T>(factory: () => T, deps: readonly any[]): T;
  function useRef<T>(initialValue: T | null): { current: T | null };
  function useContext<T>(context: React.Context<T>): T;
  function useReducer<R extends React.Reducer<any, any>>(reducer: R, initialState: any): [any, React.Dispatch<any>];

  function createElement(type: any, props?: any, ...children: any[]): ReactElement;
  function createContext<T>(defaultValue: T): Context<T>;
  function memo<T extends FC<any>>(component: T): T;
  function forwardRef<T, P>(render: (props: P, ref: React.Ref<T>) => ReactNode): FC<P>;
  function Fragment(props: { children?: ReactNode }): ReactNode;

  interface Context<T> { Provider: FC<{ value: T; children?: ReactNode }>; Consumer: FC<{ children: (value: T) => ReactNode }> }
  type Ref<T> = { current: T | null } | ((instance: T | null) => void);
  type Dispatch<A> = (value: A) => void;
  type Reducer<S, A> = (prevState: S, action: A) => S;
  type SetStateAction<S> = S | ((prevState: S) => S);
  type ChangeEvent<T = Element> = { target: T & { value: string; checked?: boolean } };
  type FormEvent<T = Element> = { preventDefault: () => void; target: T };
  type MouseEvent<T = Element> = { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number; target: T };
  type KeyboardEvent<T = Element> = { key: string; code: string; preventDefault: () => void; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };
  type CSSProperties = Record<string, string | number>;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
`;

const LUCIDE_TYPES = `
declare module 'lucide-react' {
  import { FC } from 'react';
  interface IconProps {
    size?: number | string;
    color?: string;
    strokeWidth?: number | string;
    className?: string;
    style?: React.CSSProperties;
  }
  // Common icons
  export const Activity: FC<IconProps>;
  export const AlertTriangle: FC<IconProps>;
  export const ArrowDown: FC<IconProps>;
  export const ArrowLeft: FC<IconProps>;
  export const ArrowRight: FC<IconProps>;
  export const ArrowUp: FC<IconProps>;
  export const ArrowUpDown: FC<IconProps>;
  export const BarChart3: FC<IconProps>;
  export const Box: FC<IconProps>;
  export const Check: FC<IconProps>;
  export const ChevronDown: FC<IconProps>;
  export const ChevronRight: FC<IconProps>;
  export const Clock: FC<IconProps>;
  export const Copy: FC<IconProps>;
  export const Cpu: FC<IconProps>;
  export const Database: FC<IconProps>;
  export const ExternalLink: FC<IconProps>;
  export const Eye: FC<IconProps>;
  export const Globe: FC<IconProps>;
  export const Hash: FC<IconProps>;
  export const Layers: FC<IconProps>;
  export const Loader2: FC<IconProps>;
  export const Lock: FC<IconProps>;
  export const RefreshCw: FC<IconProps>;
  export const Search: FC<IconProps>;
  export const Settings: FC<IconProps>;
  export const Shield: FC<IconProps>;
  export const Sparkles: FC<IconProps>;
  export const Terminal: FC<IconProps>;
  export const TrendingDown: FC<IconProps>;
  export const TrendingUp: FC<IconProps>;
  export const Wallet: FC<IconProps>;
  export const X: FC<IconProps>;
  export const Zap: FC<IconProps>;
  // Catch-all for unlisted icons
  const _default: Record<string, FC<IconProps>>;
  export default _default;
}
`;

// ─── Keystone Neon Theme ────────────────────────────────────────────

function defineKeystoneTheme(monaco: any) {
  monaco.editor.defineTheme("keystone-neon", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "94a3b8", fontStyle: "italic" },
      { token: "keyword", foreground: "7c3aed" },
      { token: "string", foreground: "0f766e" },
      { token: "number", foreground: "b45309" },
      { token: "type", foreground: "6d28d9" },
      { token: "function", foreground: "6d28d9" },
      { token: "variable", foreground: "0f172a" },
      { token: "constant", foreground: "1d4ed8" },
      { token: "tag", foreground: "be185d" },
      { token: "attribute.name", foreground: "7c3aed" },
      { token: "attribute.value", foreground: "0f766e" },
      { token: "delimiter", foreground: "475569" },
      { token: "delimiter.bracket", foreground: "7c3aed" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#0f172a",
      "editor.lineHighlightBackground": "#f5f3ff",
      "editor.selectionBackground": "#ddd6fe",
      "editor.inactiveSelectionBackground": "#ede9fe",
      "editorCursor.foreground": "#7c3aed",
      "editorLineNumber.foreground": "#cbd5e1",
      "editorLineNumber.activeForeground": "#7c3aed",
      "editorIndentGuide.background": "#f1f5f9",
      "editorIndentGuide.activeBackground": "#e9d5ff",
      "editor.selectionHighlightBackground": "#ede9fe",
      "editorBracketMatch.background": "#ede9fe",
      "editorBracketMatch.border": "#c4b5fd",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#e9d5ff",
      "editorSuggestWidget.background": "#ffffff",
      "editorSuggestWidget.border": "#e9d5ff",
      "editorSuggestWidget.selectedBackground": "#f5f3ff",
      "editorGutter.background": "#ffffff",
    },
  });
}

// ─── Ghost Cursor CSS (refined violet, no matrix rain) ─────────────

const GHOST_CURSOR_STYLES = `
.ghost-typed-line {
  background: linear-gradient(90deg, rgba(124, 58, 237, 0.07), rgba(124, 58, 237, 0));
  border-left: 2px solid rgba(124, 58, 237, 0.55);
  animation: ghost-line-reveal 0.45s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  opacity: 0;
}
@keyframes ghost-line-reveal {
  0% { opacity: 0; transform: translateX(-3px); }
  60% { opacity: 1; }
  100% { opacity: 1; transform: translateX(0); background: linear-gradient(90deg, rgba(124, 58, 237, 0.025), rgba(124, 58, 237, 0)); }
}
.ghost-cursor-after::after {
  content: '';
  display: inline-block;
  width: 2px;
  height: 16px;
  background: #7c3aed;
  box-shadow: 0 0 8px rgba(124, 58, 237, 0.55), 0 0 18px rgba(124, 58, 237, 0.25);
  animation: ghost-blink 0.85s ease-in-out infinite;
  vertical-align: text-bottom;
  margin-left: 1px;
  border-radius: 1px;
}
@keyframes ghost-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}
.ghost-text-inline {
  color: #7c3aed !important;
  animation: ghost-text-fade 1.1s ease-out forwards;
}
@keyframes ghost-text-fade {
  0% { color: #7c3aed; }
  100% { color: inherit; }
}
@keyframes dreyv-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}
@keyframes dreyv-pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.85); }
}
`;

// ─── Component ──────────────────────────────────────────────────────

interface CodeEditorProps {
  code: string;
  language: string;
  onChange: (value: string) => void;
  fileName: string;
  allFiles?: Record<string, { content: string }>;
  isGenerating?: boolean;
}

export function CodeEditor({ code, language, onChange, fileName, allFiles = {}, isGenerating = false }: CodeEditorProps) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const previousCodeRef = useRef<string>(code);
  const ghostDecorationsRef = useRef<string[]>([]);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorLineQueueRef = useRef<number[]>([]);
  const cursorColRef = useRef<number>(1);
  const isFirstMount = useRef(true);

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      onChange(value);
    }
  };

  // Ghost Cursor: character-level cursor walk with staggered line reveals
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    if (!editor || !monaco) return;

    if (!isGenerating) {
      if (ghostDecorationsRef.current.length > 0) {
        ghostDecorationsRef.current = editor.deltaDecorations(ghostDecorationsRef.current, []);
      }
      if (cursorTimerRef.current) {
        clearTimeout(cursorTimerRef.current);
        cursorTimerRef.current = null;
      }
      cursorLineQueueRef.current = [];
      previousCodeRef.current = code;
      return;
    }

    if (isFirstMount.current) {
      isFirstMount.current = false;
      previousCodeRef.current = code;
      return;
    }

    const oldCode = previousCodeRef.current;
    if (oldCode === code) return;

    const oldLines = oldCode.split("\n");
    const newLines = code.split("\n");

    const changedLineNumbers: number[] = [];
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (oldLines[i] !== newLines[i]) {
        changedLineNumbers.push(i + 1);
      }
    }

    if (changedLineNumbers.length === 0) {
      previousCodeRef.current = code;
      return;
    }

    // Build staggered decorations: each line gets an incremental animation-delay
    const LINE_REVEAL_DELAY_MS = 30;
    const decorations: Array<{ range: any; options: any }> = [];

    changedLineNumbers.forEach((lineNum, idx) => {
      decorations.push({
        range: new monaco.Range(lineNum, 1, lineNum, 1),
        options: {
          isWholeLine: true,
          className: "ghost-typed-line",
          inlineClassName: "ghost-text-inline",
          stickiness: 1,
        },
      });

      // Per-line stagger via inline style injection
      const styleId = `ghost-delay-${lineNum}`;
      if (!document.getElementById(styleId)) {
        const s = document.createElement("style");
        s.id = styleId;
        s.textContent = `.ghost-typed-line[data-line="${lineNum}"] { animation-delay: ${idx * LINE_REVEAL_DELAY_MS}ms; }`;
        document.head.appendChild(s);
        setTimeout(() => s.remove(), 2000);
      }
    });

    // Cursor animation: walk through changed lines character by character
    if (cursorTimerRef.current) {
      clearTimeout(cursorTimerRef.current);
    }
    cursorLineQueueRef.current = [...changedLineNumbers];
    cursorColRef.current = 1;

    const walkCursor = () => {
      const ed = editorRef.current;
      const mc = monacoRef.current;
      if (!ed || !mc || cursorLineQueueRef.current.length === 0) return;

      const currentLine = cursorLineQueueRef.current[0];
      const lineContent = newLines[currentLine - 1] || "";
      const col = cursorColRef.current;

      // Update cursor decoration at current position
      const cursorDec = [{
        range: new mc.Range(currentLine, col, currentLine, col),
        options: {
          isWholeLine: false,
          className: "",
          afterContentClassName: "ghost-cursor-after",
          stickiness: 1,
        },
      }];

      // Keep existing line decorations, update cursor position
      const lineDecos = cursorLineQueueRef.current.map((ln) => ({
        range: new mc.Range(ln, 1, ln, 1),
        options: { isWholeLine: true, className: "ghost-typed-line", stickiness: 1 },
      }));

      ghostDecorationsRef.current = ed.deltaDecorations(
        ghostDecorationsRef.current,
        [...lineDecos, ...cursorDec],
      );

      ed.revealLineInCenterIfOutsideViewport(currentLine);

      // Advance: walk columns then move to next line
      const CHARS_PER_TICK = 4;
      if (col + CHARS_PER_TICK < lineContent.length + 1) {
        cursorColRef.current = col + CHARS_PER_TICK;
        cursorTimerRef.current = setTimeout(walkCursor, 12);
      } else {
        cursorLineQueueRef.current.shift();
        cursorColRef.current = 1;
        if (cursorLineQueueRef.current.length > 0) {
          cursorTimerRef.current = setTimeout(walkCursor, 18);
        }
      }
    };

    // Apply initial decorations immediately, then start cursor walk
    ghostDecorationsRef.current = editor.deltaDecorations(
      ghostDecorationsRef.current,
      decorations,
    );

    cursorTimerRef.current = setTimeout(walkCursor, 30);
    previousCodeRef.current = code;
  }, [code, isGenerating]);

  // Cleanup cursor timer on unmount
  useEffect(() => {
    return () => {
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
    };
  }, []);

  return (
    <div className="flex-1 h-full relative">
      <style dangerouslySetInnerHTML={{ __html: GHOST_CURSOR_STYLES }} />

      {/* Matrix Rain Canvas Overlay */}
      <MatrixRain active={isGenerating} />

      {/* Agent Status Badge (corner) */}
      {isGenerating && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-2 px-3 py-1.5 bg-black/80 border border-[#36e27b]/40 rounded-full text-[#36e27b] text-[10px] font-mono tracking-widest uppercase shadow-[0_0_15px_rgba(54,226,123,0.2)] pointer-events-none">
          <span className="w-1.5 h-3 bg-[#36e27b] rounded-[1px] animate-pulse" />
          Agent Typing
        </div>
      )}

      <Editor
        height="100%"
        defaultLanguage="typescript"
        path={`file:///${fileName}`}
        value={code}
        onChange={handleEditorChange}
        theme="keystone-neon"
        beforeMount={(monaco) => {
          defineKeystoneTheme(monaco);
        }}
        onMount={(editor, monaco) => {
          editorRef.current = editor;
          monacoRef.current = monaco;

          // ─── TypeScript Compiler Options (strict) ────
          monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ESNext,
            allowNonTsExtensions: true,
            moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
            module: monaco.languages.typescript.ModuleKind.ESNext,
            noEmit: true,
            esModuleInterop: true,
            jsx: monaco.languages.typescript.JsxEmit.React,
            reactNamespace: "React",
            allowJs: true,
            strict: true,
            noImplicitAny: false,
            strictNullChecks: false,
            baseUrl: "file:///",
            paths: {
              "@keystone-os/sdk": ["file:///node_modules/@keystone-os/sdk/index.d.ts"],
              "./keystone": ["file:///node_modules/@keystone-os/sdk/index.d.ts"],
              "*": ["*"],
            },
          });

          monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false,
          });

          // ─── Inject Type Definitions ─────────────────
          monaco.languages.typescript.typescriptDefaults.addExtraLib(
            KEYSTONE_SDK_TYPES,
            "file:///node_modules/@keystone-os/sdk/index.d.ts"
          );

          monaco.languages.typescript.typescriptDefaults.addExtraLib(
            REACT_TYPES,
            "file:///node_modules/@types/react/index.d.ts"
          );

          monaco.languages.typescript.typescriptDefaults.addExtraLib(
            LUCIDE_TYPES,
            "file:///node_modules/@types/lucide-react/index.d.ts"
          );

          // ─── Cross-file Resolution ───────────────────
          Object.entries(allFiles).forEach(([name, file]) => {
            if (name === fileName) return;
            const path = `file:///${name}`;
            try {
              monaco.languages.typescript.typescriptDefaults.addExtraLib(file.content, path);
            } catch (e) {
              // Ignore duplicates
            }
          });
        }}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: "on",
          roundedSelection: true,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: "on",
          padding: { top: 12 },
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontLigatures: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          smoothScrolling: true,
          renderLineHighlight: "gutter",
          bracketPairColorization: { enabled: true },
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        }}
      />
    </div>
  );
}
