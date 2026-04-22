import React from "react";

interface AdminMetricsPanelProps {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    status?: "healthy" | "warning" | "critical";
    className?: string;
    action?: React.ReactNode;
}

/**
 * Premium light admin panel — solid violet accents, white frosted card.
 * No gradients, no fuchsia.
 */
export function AdminMetricsPanel({
    title,
    icon,
    children,
    status = "healthy",
    className = "",
    action,
}: AdminMetricsPanelProps) {
    const statusPip = {
        healthy: "bg-violet-600",
        warning: "bg-amber-500",
        critical: "bg-rose-500",
    } as const;

    const statusLabel = {
        healthy: "Healthy",
        warning: "Watch",
        critical: "Critical",
    } as const;

    return (
        <div
            className={`relative rounded-3xl border border-violet-200/60 bg-white/85 backdrop-blur-md shadow-[0_20px_60px_-30px_rgba(124,58,237,0.18)] overflow-hidden flex flex-col ${className}`}
        >
            <div className="px-5 py-4 border-b border-violet-100 bg-violet-50/40 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-violet-100 border border-violet-200 text-violet-700 flex items-center justify-center">
                        {icon}
                    </div>
                    <div>
                        <h3 className="text-[13px] font-semibold tracking-tight text-slate-900">
                            {title}
                        </h3>
                        <div className="mt-0.5 flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${statusPip[status]} ${status !== "healthy" ? "animate-pulse" : ""}`} />
                            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                {statusLabel[status]}
                            </span>
                        </div>
                    </div>
                </div>
                {action && <div>{action}</div>}
            </div>

            <div className="p-5 flex-1 flex flex-col gap-4 bg-white/60 font-manrope">
                {children}
            </div>
        </div>
    );
}

export const MetricGrid = ({
    children,
    cols = 2,
}: {
    children: React.ReactNode;
    cols?: 1 | 2 | 3 | 4;
}) => {
    const gridCols = {
        1: "grid-cols-1",
        2: "grid-cols-1 sm:grid-cols-2",
        3: "grid-cols-1 sm:grid-cols-3",
        4: "grid-cols-2 sm:grid-cols-4",
    };
    return <div className={`grid ${gridCols[cols]} gap-3`}>{children}</div>;
};

export const BreakdownList = ({
    items,
    valueFormatter = (val: any) => val.toLocaleString(),
}: {
    items: { label: string; value: number; color?: string }[];
    valueFormatter?: (val: any) => string;
}) => {
    const total = items.reduce((sum, item) => sum + item.value, 0);

    if (total === 0) {
        return (
            <div className="text-center py-3 text-[11px] font-medium text-slate-400">
                No data yet
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {items.map((item, i) => {
                const percent = Math.round((item.value / total) * 100);
                return (
                    <div key={i} className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[11px] font-medium">
                            <span className="text-slate-600">{item.label}</span>
                            <span className="text-slate-900 font-semibold">{valueFormatter(item.value)}</span>
                        </div>
                        <div className="w-full h-1.5 bg-violet-100 rounded-full overflow-hidden">
                            <div
                                className="h-full rounded-full transition-all duration-700"
                                style={{
                                    width: `${percent}%`,
                                    backgroundColor: item.color || "#7c3aed",
                                }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
