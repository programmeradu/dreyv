/**
 * Strips hallucinated OpenAI/Harmony-style tool-call envelopes that some models
 * (notably llama-3.3 / Kimi via Groq) emit as *plain text* inside the assistant
 * reply instead of using the native tool-call channel.
 *
 * Patterns matched (case-insensitive, whitespace-tolerant):
 *   {"type":"function", "name":"...", "parameters": {...}}
 *   {"type":"function_call", ...}
 *   {"type":"tool_use", ...}
 *   {"name":"browser_research", "parameters": {...}}
 *   ```json {...tool envelope...} ```
 *
 * The transform operates on the AI SDK v5 UI-message SSE stream. Each SSE
 * `data:` line for `text-delta` events is rewritten so hallucinated envelopes
 * are dropped before reaching the CommandBar. A per-message-id buffer handles
 * envelopes split across chunks.
 */

const TOOL_NAME_PATTERN =
    String.raw`(?:browser_research|cf_crawl|dca_opportunities|yield_lookup|yield_deposit|yield_withdraw|risk_assessment|sentiment_analysis|protocol_research_brief|foresight_simulation|treasury_snapshot|rebalance|execute_dca|swap|execute_swap|stake|[a-z][a-z0-9]*_[a-z0-9_]{2,})`;

const ENVELOPE_START_RE = new RegExp(
    String.raw`(?:\x60\x60\x60json\s*)?\{\s*(?:` +
    String.raw`"type"\s*:\s*"(?:function|function_call|tool_use|tool_call)"` +
    String.raw`|"name"\s*:\s*"${TOOL_NAME_PATTERN}"` +
    String.raw`)`,
    "i",
);

const PARTIAL_ENVELOPE_TAIL_RE = new RegExp(
    String.raw`(?:\x60\x60\x60j(?:s(?:o(?:n)?)?)?\s*)?\{\s*(?:"(?:t(?:y(?:p(?:e)?)?)?|n(?:a(?:m(?:e)?)?)?)?"?\s*(?::\s*"?(?:function|function_call|tool_use|tool_call|${TOOL_NAME_PATTERN})?)?)?$`,
    "i",
);

// Track partial brace depth per message id across deltas.
type BufState = {
    inEnvelope: boolean;
    depth: number;
    inString: boolean;
    escape: boolean;
    fenced: boolean; // inside ```json fence
    pending: string;
};

function newState(): BufState {
    return { inEnvelope: false, depth: 0, inString: false, escape: false, fenced: false, pending: "" };
}

function lastPartialEnvelopeStart(text: string): number {
    const floor = Math.max(0, text.length - 512);
    const candidates: number[] = [];
    for (let i = text.indexOf("{", floor); i >= 0; i = text.indexOf("{", i + 1)) {
        candidates.push(i);
    }
    for (let i = text.toLowerCase().indexOf("```j", floor); i >= 0; i = text.toLowerCase().indexOf("```j", i + 1)) {
        candidates.push(i);
    }
    candidates.sort((a, b) => b - a);
    for (const idx of candidates) {
        if (PARTIAL_ENVELOPE_TAIL_RE.test(text.slice(idx))) return idx;
    }
    return -1;
}

/** Consume `text`, updating `state`, returning the sanitized text to emit. */
function scrubText(text: string, state: BufState): string {
    let out = "";
    let i = 0;
    if (!state.inEnvelope && state.pending) {
        text = state.pending + text;
        state.pending = "";
    }
    while (i < text.length) {
        if (!state.inEnvelope) {
            // Look for the start of an envelope beginning at position i.
            const rest = text.slice(i);
            const m = rest.match(ENVELOPE_START_RE);
            if (!m || m.index === undefined) {
                const partialIdx = lastPartialEnvelopeStart(rest);
                if (partialIdx >= 0) {
                    out += rest.slice(0, partialIdx);
                    state.pending = rest.slice(partialIdx);
                } else {
                    out += rest;
                }
                break;
            }
            out += rest.slice(0, m.index);
            i += m.index;
            state.inEnvelope = true;
            state.depth = 0;
            state.inString = false;
            state.escape = false;
            state.fenced = m[0].startsWith("```");
            // fall through — start consuming from the `{`
            const braceIdx = rest.indexOf("{", m.index);
            if (braceIdx < 0) {
                // marker without brace — bail, treat as passthrough to avoid data loss
                state.inEnvelope = false;
                out += rest.slice(m.index);
                break;
            }
            i = (i - m.index) + braceIdx; // absolute index of `{`
        }

        // Consume envelope characters, tracking brace depth and strings.
        while (i < text.length && state.inEnvelope) {
            const ch = text[i];
            if (state.escape) {
                state.escape = false;
            } else if (state.inString) {
                if (ch === "\\") state.escape = true;
                else if (ch === '"') state.inString = false;
            } else {
                if (ch === '"') state.inString = true;
                else if (ch === "{") state.depth++;
                else if (ch === "}") {
                    state.depth--;
                    if (state.depth <= 0) {
                        i++;
                        // Consume trailing ```   fence if we opened one.
                        if (state.fenced) {
                            const tail = text.slice(i).match(/^\s*```/);
                            if (tail) i += tail[0].length;
                        }
                        // Consume a single trailing newline for cleanliness.
                        if (text[i] === "\n") i++;
                        state.inEnvelope = false;
                        state.fenced = false;
                        break;
                    }
                }
            }
            i++;
        }
    }
    return out;
}

function flushPendingText(state: BufState): string {
    if (state.inEnvelope) {
        state.inEnvelope = false;
        state.depth = 0;
        state.inString = false;
        state.escape = false;
        state.fenced = false;
        state.pending = "";
        return "";
    }
    const pending = state.pending;
    state.pending = "";
    return pending && PARTIAL_ENVELOPE_TAIL_RE.test(pending) ? "" : pending;
}

/** Strip hallucinated tool-call envelopes from a complete text string. */
export function stripHallucinatedToolEnvelopeText(text: string): string {
    if (!text) return text;
    const state = newState();
    return (scrubText(text, state) + flushPendingText(state))
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd();
}

/**
 * Wrap an AI SDK v5 UI-message SSE ReadableStream so hallucinated tool-call
 * JSON envelopes are stripped from `text-delta` events.
 */
export function stripHallucinatedToolEnvelopes(
    upstream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const perId = new Map<string, BufState>();
    let carry = ""; // partial SSE line carried between chunks

    return new ReadableStream<Uint8Array>({
        async start(controller) {
            const reader = upstream.getReader();
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) {
                        if (carry) controller.enqueue(encoder.encode(carry));
                        controller.close();
                        return;
                    }
                    const chunk = carry + decoder.decode(value, { stream: true });
                    const lastNl = chunk.lastIndexOf("\n");
                    if (lastNl < 0) {
                        carry = chunk;
                        continue;
                    }
                    const complete = chunk.slice(0, lastNl + 1);
                    carry = chunk.slice(lastNl + 1);

                    const rewritten = complete
                        .split("\n")
                        .flatMap((line) => rewriteSseLine(line, perId))
                        .join("\n");
                    controller.enqueue(encoder.encode(rewritten));
                }
            } catch (err) {
                try { controller.error(err); } catch { /* noop */ }
            } finally {
                try { reader.releaseLock(); } catch { /* noop */ }
            }
        },
    });
}

function rewriteSseLine(line: string, perId: Map<string, BufState>): string[] {
    if (!line.startsWith("data:")) return [line];
    const payload = line.slice(5).trimStart();
    if (!payload || payload === "[DONE]") return [line];
    let obj: any;
    try {
        obj = JSON.parse(payload);
    } catch {
        return [line];
    }
    if (!obj || typeof obj !== "object") return [line];

    const id = typeof obj.id === "string" ? obj.id : "_default";
    const state = perId.get(id) ?? newState();
    const fields = ["delta", "text", "content", "textDelta"].filter((key) => typeof obj[key] === "string");
    const isTextEvent = typeof obj.type === "string" && /(?:^|-)text(?:-|$)|reasoning|thinking/i.test(obj.type);

    if (!isTextEvent || fields.length === 0) {
        if ((obj.type === "text-end" || obj.type === "finish" || obj.type === "finish-step") && state.pending) {
            const flushed = flushPendingText(state);
            perId.set(id, state);
            if (flushed) {
                return [`data: ${JSON.stringify({ type: "text-delta", id, delta: flushed })}`, line];
            }
        }
        return [line];
    }

    let changed = false;
    for (const field of fields) {
        const original = obj[field] as string;
        const cleaned = scrubText(original, state);
        if (cleaned !== original) {
            obj[field] = cleaned;
            changed = true;
        }
    }
    perId.set(id, state);
    if (!changed) return [line];
    return [`data: ${JSON.stringify(obj)}`];
}
