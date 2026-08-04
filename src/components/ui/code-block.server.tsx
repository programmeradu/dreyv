import { cn } from "@/lib/utils";

type CodeBlockProps = {
  children: string;
  language?: string;
  className?: string;
  wrap?: boolean;
  dense?: boolean;
};

export function CodeBlock({
  children,
  language,
  className,
  wrap = false,
  dense = false,
}: CodeBlockProps) {
  return (
    <div
      className={cn(
        "group relative rounded-2xl border border-violet-100 bg-slate-50/80",
        className
      )}
    >
      {language ? (
        <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {language}
          </span>
        </div>
      ) : null}
      <pre
        className={cn(
          "overflow-x-auto font-mono text-slate-800 leading-relaxed",
          dense ? "p-3 text-[11.5px]" : "p-4 sm:p-5 text-[12.5px]",
          wrap && "whitespace-pre-wrap break-all",
          language && "pt-1"
        )}
      >
        <code className="block">{children}</code>
      </pre>
    </div>
  );
}

export default CodeBlock;
