import { describe, expect, it } from "vitest";
import { stripHallucinatedToolEnvelopeText, stripHallucinatedToolEnvelopes } from "./scrub-tool-envelopes";

async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return out;
}

function sse(obj: unknown) {
    return `data: ${JSON.stringify(obj)}\n\n`;
}

describe("stripHallucinatedToolEnvelopeText", () => {
    it("removes plain OpenAI-style function envelopes", () => {
        const input = `I found a candidate.\n\n{"type":"function","name":"dca_opportunities","parameters":{"focusToken":"SOL","drawdownThresholdPct":"3"}}`;
        expect(stripHallucinatedToolEnvelopeText(input)).toBe("I found a candidate.");
    });

    it("removes name-first tool envelopes", () => {
        const input = `{"name":"browser_research","parameters":{"query":"low-fee exchanges"}}\nDone.`;
        expect(stripHallucinatedToolEnvelopeText(input)).toBe("Done.");
    });
});

describe("stripHallucinatedToolEnvelopes", () => {
    it("removes envelopes split across text-delta events", async () => {
        const encoder = new TextEncoder();
        const upstream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode(sse({ type: "text-delta", id: "1", delta: "Identify opportunities.\n\n{" })));
                controller.enqueue(encoder.encode(sse({ type: "text-delta", id: "1", delta: "\"type\": \"function\", \"name\": \"dca_opportunities\", " })));
                controller.enqueue(encoder.encode(sse({ type: "text-delta", id: "1", delta: "\"parameters\": {\"focusToken\": \"SOL\", \"drawdownThresholdPct\": \"3\"}}" })));
                controller.enqueue(encoder.encode(sse({ type: "finish" })));
                controller.close();
            },
        });

        const output = await collect(stripHallucinatedToolEnvelopes(upstream));
        expect(output).toContain("Identify opportunities.");
        expect(output).not.toContain("dca_opportunities");
        expect(output).not.toContain("function");
    });
});