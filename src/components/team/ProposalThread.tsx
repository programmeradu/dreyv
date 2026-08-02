"use client";

import { useState } from "react";
import { LiveList, LiveObject } from "@liveblocks/client";
import {
    useStorage,
    useMutation,
    useSelf,
    useBroadcastEvent,
    type ProposalComment,
} from "@/liveblocks.config";
import { MessageSquare, Send } from "lucide-react";

type Props = {
    vaultAddress: string;
    transactionIndex: number;
};

/**
 * Liveblocks-backed comment thread pinned to a single proposal.
 * Stored in `proposalThreads[`${vault}:${idx}`]` so threads persist
 * across reloads and are visible to every team member in the room.
 */
export function ProposalThread({ vaultAddress, transactionIndex }: Props) {
    const key = `${vaultAddress}:${transactionIndex}`;
    const broadcast = useBroadcastEvent();
    const self = useSelf();
    const [draft, setDraft] = useState("");
    const [open, setOpen] = useState(false);

    // Read the comments list for this proposal (snapshot; re-renders on change).
    const comments = useStorage((root) => {
        const map = root.proposalThreads as unknown;
        if (!map) return [];
        if (map instanceof Map) return (map.get(key) as ProposalComment[] | undefined) ?? [];
        const rec = map as Record<string, ProposalComment[] | undefined>;
        return rec[key] ?? [];
    }) as ProposalComment[] | null;


    const addComment = useMutation(({ storage }, text: string) => {
        const map = storage.get("proposalThreads");
        if (!map) return;
        let list = map.get(key);
        if (!list) {
            list = new LiveList<LiveObject<ProposalComment>>([]);
            map.set(key, list);
        }
        const me = self;
        const senderShort = me?.info?.name || "anon";
        list.push(
            new LiveObject<ProposalComment>({
                id: crypto.randomUUID(),
                text,
                sender: senderShort,
                senderName: me?.info?.name,
                timestamp: Date.now(),
            }),
        );
    }, [key, self]);

    const submit = () => {
        const text = draft.trim();
        if (!text) return;
        addComment(text);
        broadcast({
            type: "PROPOSAL_COMMENT",
            payload: { proposalId: transactionIndex, sender: self?.info?.name || "anon" },
        });
        setDraft("");
    };

    const count = comments?.length ?? 0;

    return (
        <div className="mt-3 border-t border-violet-100 pt-3">
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-700 hover:text-violet-900"
            >
                <MessageSquare className="h-3 w-3" />
                {count === 0 ? "Discuss" : `${count} comment${count === 1 ? "" : "s"}`}
                <span className="ml-1 text-slate-400">{open ? "▾" : "▸"}</span>
            </button>

            {open && (
                <div className="mt-2 space-y-2">
                    <div className="max-h-[180px] space-y-2 overflow-y-auto rounded-lg bg-violet-50/40 p-2">
                        {count === 0 ? (
                            <p className="px-2 py-3 text-center text-xs text-slate-500">
                                No comments yet. Start the conversation.
                            </p>
                        ) : (
                            comments!.map((c) => (
                                <div key={c.id} className="rounded-md bg-white px-2.5 py-1.5 text-xs">
                                    <div className="flex items-baseline justify-between">
                                        <span className="font-semibold text-violet-700">{c.senderName || c.sender}</span>
                                        <span className="text-[10px] text-slate-400">
                                            {new Date(c.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                        </span>
                                    </div>
                                    <p className="mt-0.5 text-slate-700">{c.text}</p>
                                </div>
                            ))
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    submit();
                                }
                            }}
                            placeholder="Add a comment…"
                            className="flex-1 rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none"
                        />
                        <button
                            onClick={submit}
                            disabled={!draft.trim()}
                            className="rounded-md bg-violet-600 p-1.5 text-white transition hover:bg-violet-700 disabled:opacity-40"
                        >
                            <Send className="h-3 w-3" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
