"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import Image from "next/image";
import { Send } from "lucide-react";
import { useStorage, useMutation, useSelf, useOthers, useStatus } from "@/liveblocks.config";
import bubbleCrystal from "@/assets/chat/icon-bubble-crystal.png";
import sparkCrystal from "@/assets/chat/icon-spark-crystal.png";

type ChatMessage = { text: string; sender: string; timestamp: number };

function initialsOf(name?: string | null) {
    if (!name) return "··";
    return name
        .split(/[\s_-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("") || name.slice(0, 2).toUpperCase();
}

function colorFor(seed: string): string {
    // deterministic violet-leaning palette
    const palette = [
        "#7c3aed", // violet-600
        "#8b5cf6", // violet-500
        "#a78bfa", // violet-400
        "#6366f1", // indigo-500
        "#0ea5e9", // sky-500
        "#10b981", // emerald-500
        "#f59e0b", // amber-500
        "#ef4444", // rose-500
    ];
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
}

function formatTime(ts: number) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(a: number, b: number) {
    const da = new Date(a);
    const db = new Date(b);
    return (
        da.getFullYear() === db.getFullYear() &&
        da.getMonth() === db.getMonth() &&
        da.getDate() === db.getDate()
    );
}

function dayLabel(ts: number) {
    const d = new Date(ts);
    const today = new Date();
    const yest = new Date();
    yest.setDate(today.getDate() - 1);
    if (isSameDay(ts, today.getTime())) return "Today";
    if (isSameDay(ts, yest.getTime())) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export const CollaborativeChat = () => {
    const [message, setMessage] = useState("");
    const messages = useStorage((root) => root.chatMessages) as ChatMessage[] | null;
    const self = useSelf();
    const others = useOthers();
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const sendMessage = useMutation(({ storage }, text: string, sender: string) => {
        const chat = storage.get("chatMessages");
        chat.push({ text, sender, timestamp: Date.now() });
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages?.length]);

    const handleSend = () => {
        const text = message.trim();
        if (!text) return;
        sendMessage(text, self?.info?.name || "You");
        setMessage("");
        inputRef.current?.focus();
    };

    const meName = self?.info?.name || "You";
    const onlineCount = others.length + (self ? 1 : 0);

    // Group consecutive messages by sender + render day separators
    const grouped = useMemo(() => {
        const list = messages ?? [];
        const out: Array<
            | { kind: "day"; label: string; key: string }
            | {
                  kind: "group";
                  sender: string;
                  isMe: boolean;
                  items: ChatMessage[];
                  key: string;
              }
        > = [];
        let lastSender: string | null = null;
        let lastTs: number | null = null;
        list.forEach((m, i) => {
            const isMe = m.sender === meName;
            if (lastTs == null || !isSameDay(lastTs, m.timestamp)) {
                out.push({ kind: "day", label: dayLabel(m.timestamp), key: `d-${i}` });
                lastSender = null;
            }
            const last = out[out.length - 1];
            const sameAsPrev =
                last && last.kind === "group" && last.sender === m.sender && lastTs != null && m.timestamp - lastTs < 5 * 60_000;
            if (sameAsPrev && last.kind === "group") {
                last.items.push(m);
            } else {
                out.push({ kind: "group", sender: m.sender, isMe, items: [m], key: `g-${i}` });
            }
            lastSender = m.sender;
            lastTs = m.timestamp;
        });
        return out;
    }, [messages, meName]);

    return (
        <div className="flex h-[440px] flex-col overflow-hidden rounded-2xl border border-violet-100 bg-white">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-violet-100 px-4 py-3">
                <div className="flex items-center gap-2.5">
                    <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    <p className="text-sm font-semibold tracking-tight text-slate-900">Team chat</p>
                    <span className="text-xs text-slate-500">
                        · {onlineCount} {onlineCount === 1 ? "person" : "people"} online
                    </span>
                </div>
                {/* Presence avatars */}
                <div className="flex -space-x-1.5">
                    {others.slice(0, 4).map((p) => {
                        const name = p.info?.name || "Member";
                        const c = p.info?.color || colorFor(name);
                        return (
                            <span
                                key={p.connectionId}
                                title={name}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white"
                                style={{ backgroundColor: c }}
                            >
                                {initialsOf(name)}
                            </span>
                        );
                    })}
                    {others.length > 4 && (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-violet-100 text-[10px] font-semibold text-violet-700">
                            +{others.length - 4}
                        </span>
                    )}
                </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
                {(!messages || messages.length === 0) ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                        <Image
                            src={sparkCrystal}
                            alt=""
                            width={64}
                            height={64}
                            className="h-14 w-14"
                            loading="lazy"
                        />
                        <div>
                            <p className="text-sm font-semibold text-slate-900">Start the conversation</p>
                            <p className="mt-1 text-xs text-slate-500">
                                Drop a quick note for your team. Messages sync live across the room.
                            </p>
                        </div>
                    </div>
                ) : (
                    grouped.map((row) => {
                        if (row.kind === "day") {
                            return (
                                <div key={row.key} className="flex items-center gap-3 py-1">
                                    <div className="h-px flex-1 bg-violet-100" />
                                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                        {row.label}
                                    </span>
                                    <div className="h-px flex-1 bg-violet-100" />
                                </div>
                            );
                        }
                        const c = colorFor(row.sender);
                        const isMe = row.isMe;
                        return (
                            <div
                                key={row.key}
                                className={`flex items-end gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}
                            >
                                <span
                                    className="mb-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                                    style={{ backgroundColor: c }}
                                >
                                    {initialsOf(row.sender)}
                                </span>
                                <div className={`flex max-w-[75%] flex-col gap-1 ${isMe ? "items-end" : "items-start"}`}>
                                    <div className={`flex items-baseline gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                                        <span className="text-xs font-semibold text-slate-700">
                                            {isMe ? "You" : row.sender}
                                        </span>
                                        <span className="text-[10px] text-slate-400">
                                            {formatTime(row.items[row.items.length - 1].timestamp)}
                                        </span>
                                    </div>
                                    <div className={`flex flex-col gap-1 ${isMe ? "items-end" : "items-start"}`}>
                                        {row.items.map((m, i) => (
                                            <p
                                                key={i}
                                                className={[
                                                    "whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed",
                                                    isMe
                                                        ? "rounded-br-md bg-violet-600 text-white"
                                                        : "rounded-bl-md bg-violet-50 text-slate-800",
                                                ].join(" ")}
                                            >
                                                {m.text}
                                            </p>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Composer */}
            <div className="border-t border-violet-100 bg-white px-3 py-3">
                <div className="flex items-end gap-2 rounded-2xl border border-violet-200 bg-white px-3 py-2 focus-within:border-violet-500">
                    <Image
                        src={bubbleCrystal}
                        alt=""
                        width={20}
                        height={20}
                        className="mt-1.5 h-5 w-5 shrink-0"
                        loading="lazy"
                    />
                    <textarea
                        ref={inputRef}
                        rows={1}
                        placeholder={`Message your team as ${meName}…`}
                        className="flex-1 resize-none bg-transparent py-1 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                        value={message}
                        onChange={(e) => {
                            setMessage(e.target.value);
                            const el = e.currentTarget;
                            el.style.height = "auto";
                            el.style.height = Math.min(el.scrollHeight, 120) + "px";
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                    />
                    <button
                        type="button"
                        onClick={handleSend}
                        disabled={!message.trim()}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 transition hover:bg-violet-700 disabled:bg-violet-200"
                        aria-label="Send message"
                    >
                        <Image
                            src={sendCrystal}
                            alt=""
                            width={18}
                            height={18}
                            className="h-4 w-4"
                            loading="lazy"
                        />
                    </button>
                </div>
                <p className="mt-1.5 px-1 text-[10px] text-slate-400">
                    Enter to send · Shift + Enter for a new line
                </p>
            </div>
        </div>
    );
};
