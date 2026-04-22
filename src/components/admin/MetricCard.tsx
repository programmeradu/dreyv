import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface MetricCardProps {
    title: string;
    value: string | number;
    trend?: {
        value: number;
        prefix?: string;
        suffix?: string;
        inverted?: boolean; // If true, down is good (violet), up is bad (rose)
        subtext?: string;
    };
    icon?: React.ReactNode;
    /** Tailwind text color class for the headline value. Default: violet-700. */
    colorClass?: string;
    formatter?: (val: any) => string;
}

/**
 * Premium light metric card — white frosted, violet accents, no gradients.
 */
export function MetricCard({
    title,
    value,
    trend,
    icon,
    colorClass = "text-violet-700",
    formatter,
}: MetricCardProps) {
    const displayValue = formatter ? formatter(value) : value.toLocaleString();

    let trendColor = "text-slate-500";
    let trendBg = "bg-slate-100 text-slate-600";
    let TrendIcon = Minus;
    if (trend) {
        if (trend.value > 0) {
            const positive = !trend.inverted;
            trendColor = positive ? "text-violet-700" : "text-rose-600";
            trendBg = positive
                ? "bg-violet-50 text-violet-700 border border-violet-100"
                : "bg-rose-50 text-rose-700 border border-rose-100";
            TrendIcon = TrendingUp;
        } else if (trend.value < 0) {
            const positive = !!trend.inverted;
            trendColor = positive ? "text-violet-700" : "text-rose-600";
            trendBg = positive
                ? "bg-violet-50 text-violet-700 border border-violet-100"
                : "bg-rose-50 text-rose-700 border border-rose-100";
            TrendIcon = TrendingDown;
        }
    }

    return (
        <div className="relative rounded-2xl border border-violet-100 bg-white p-4 flex flex-col justify-between overflow-hidden shadow-[0_10px_40px_-25px_rgba(124,58,237,0.18)] hover:border-violet-300 transition-colors">
            <div className="flex items-center justify-between mb-3 relative z-10">
                <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 truncate pr-2">
                    {title}
                </span>
                {icon && <div className={`${colorClass} opacity-90`}>{icon}</div>}
            </div>

            <div className="relative z-10">
                <div className={`text-2xl sm:text-3xl font-semibold tracking-tight ${colorClass} truncate`}>
                    {displayValue}
                </div>

                {trend ? (
                    <div className="flex items-center gap-2 mt-2">
                        <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${trendBg}`}
                        >
                            <TrendIcon size={11} strokeWidth={2.5} className={trendColor} />
                            <span>
                                {trend.prefix}
                                {Math.abs(trend.value)}
                                {trend.suffix}
                            </span>
                        </span>
                        {trend.subtext && (
                            <span className="text-[10px] font-medium text-slate-500">
                                {trend.subtext}
                            </span>
                        )}
                    </div>
                ) : (
                    <div className="h-5 mt-2" />
                )}
            </div>
        </div>
    );
}
