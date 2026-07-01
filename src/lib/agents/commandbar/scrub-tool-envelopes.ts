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

const ENVELOPE_START_RE =
    /(```json\s*)?\{\s*"(?:type|name)"\s*:\s*"(?:function|function_call|tool_use|tool_call|browser_research|cf_crawl|[a-z_]{3,40})"/i;

// Track partial brace depth per message id across deltas.
type BufState = {
    inEnvelope: boolean;
    depth: number;
    inString: boolean;
    escape: boolean;
    fenced: boolean; // inside ```json fence
};

function newState(): BufState {
    return { inEnvelope: false, depth: 0, inString: false, escape: false, fenced: false };
}

/** Consume `text`, updating `state`, returning the sanitized text to emit. */
function scrubText(text: string, state: BufState): string {
    let out = "";
    let i = 0;
    while (i < text.length) {
        if (!state.inEnvelope) {
            // Look for the start of an envelope beginning at position i.
            const rest = text.slice(i);
            const m = rest.match(ENVELOPE_START_RE);
            if (!m || m.index === undefined) {
                out += rest;
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
                        .map((line) => rewriteSseLine(line, perId))
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

function rewriteSseLine(line: string, perId: Map<string, BufState>): string {
    if (!line.startsWith("data:")) return line;
    const payload = line.slice(5).trimStart();
    if (!payload || payload === "[DONE]") return line;
    let obj: any;
    try {
        obj = JSON.parse(payload);
    } catch {
        return line;
    }
    if (!obj || typeof obj !== "object") return line;
    if (obj.type !== "text-delta" || typeof obj.delta !== "string") return line;

    const id = typeof obj.id === "string" ? obj.id : "_default";
    const state = perId.get(id) ?? newState();
    const cleaned = scrubText(obj.delta, state);
    perId.set(id, state);
    if (cleaned === obj.delta) return line;
    obj.delta = cleaned;
    return `data: ${JSON.stringify(obj)}`;
}
