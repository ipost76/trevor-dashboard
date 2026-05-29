import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { runPython } from "@/lib/api-helpers";
import { getAnthropicKey } from "@/lib/anthropic-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_OUTPUT_TOKENS = 800;
const USER_MESSAGE_MAX_CHARS = 4000;

const SYSTEM_PROMPT = `You are TREVOR's chat assistant. You answer the operator's questions about their crypto scalp trading system, signals, positions, calibration, and configuration.

Style:
- Direct. Lead with the answer. No preamble.
- When the operator asks about live state ("my positions", "last signal", etc.), say what you can confirm and what you cannot — never fabricate values.
- You do NOT have tool access in this surface. You can only reason from what the operator tells you in the conversation.
- Keep replies under 6 sentences unless the operator explicitly asks for depth.
- When uncertain, say so plainly.

Constraints:
- Never recommend auto-closing positions.
- Never recommend bypassing the killswitch.
- Never produce code unless asked.
- Capital cap removed (RM-07 P00, 2026-05-28) — bot trusts live HL accountValue. Margin mode is ISOLATED on all tickers. Per-ticker thresholds + killswitch are still inviolable; never suggest overriding those.`;

interface PostBody {
  session_id?: number | null;
  user_message: string;
}

interface BudgetSnapshot {
  used_tokens: number;
  budget_tokens: number;
  available_tokens: number;
  pct_used: number;
  blocked: boolean;
}

async function readBudget(): Promise<BudgetSnapshot> {
  const stdout = await runPython("query_chat_budget.py", []);
  return JSON.parse(stdout) as BudgetSnapshot;
}

async function persistUserMessage(sessionId: number | null, content: string): Promise<number> {
  const stdout = await runPython("write_chat_log.py", [
    "user_message",
    String(sessionId ?? 0),
    content,
  ]);
  const parsed = JSON.parse(stdout) as { ok: boolean; session_id: number };
  return parsed.session_id;
}

async function persistAssistantMessage(
  sessionId: number,
  content: string,
  tokensIn: number,
  tokensOut: number,
  model: string,
): Promise<void> {
  await runPython("write_chat_log.py", [
    "assistant_message",
    String(sessionId),
    content,
    String(tokensIn),
    String(tokensOut),
    model,
  ]);
}

function sseChunk(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseErrorResponse(payload: unknown): Response {
  return new Response(sseChunk("error", payload), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return new Response("bad body", { status: 400 });
  }

  const userMsg = (body.user_message ?? "").trim().slice(0, USER_MESSAGE_MAX_CHARS);
  if (!userMsg) {
    return new Response("empty message", { status: 400 });
  }

  // 1) Budget pre-gate (BEFORE constructing the SDK client).
  let budget: BudgetSnapshot;
  try {
    budget = await readBudget();
  } catch (err) {
    return sseErrorResponse({ error: "budget_read_failed", detail: String(err) });
  }
  if (budget.blocked) {
    return sseErrorResponse({
      error: "budget",
      available_tokens: budget.available_tokens,
      budget_tokens: budget.budget_tokens,
    });
  }

  // 2) API key (Node-side .env reader — see src/lib/anthropic-key.ts).
  const apiKey = getAnthropicKey();
  if (!apiKey) {
    return new Response("no api key", { status: 503 });
  }

  // 3) Persist user message synchronously so the session_id is known
  // before we open the Anthropic stream — the client gets it via the
  // first SSE event and can resume the session on subsequent turns.
  let resolvedSessionId: number;
  try {
    resolvedSessionId = await persistUserMessage(body.session_id ?? null, userMsg);
  } catch (err) {
    return sseErrorResponse({ error: "persist_user_failed", detail: String(err) });
  }

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (name: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(sseChunk(name, data)));
        } catch {
          // Controller may be closed if the client aborted; ignore.
        }
      };

      send("session", { session_id: resolvedSessionId });

      let collected = "";
      try {
        const resp = client.messages.stream({
          model: MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMsg }],
        });

        for await (const ev of resp) {
          if (
            ev.type === "content_block_delta" &&
            ev.delta &&
            ev.delta.type === "text_delta"
          ) {
            const piece = ev.delta.text ?? "";
            if (piece) {
              collected += piece;
              send("token", { text: piece });
            }
          }
        }

        const final = await resp.finalMessage();
        const tokensIn = final.usage?.input_tokens ?? 0;
        const tokensOut = final.usage?.output_tokens ?? 0;

        try {
          await persistAssistantMessage(
            resolvedSessionId,
            collected,
            tokensIn,
            tokensOut,
            MODEL,
          );
        } catch (err) {
          // Persist failure is non-fatal — the user already received the
          // tokens. Surface as a non-blocking warning so the UI can
          // optionally refresh budget without trusting our token counts.
          send("warn", { error: "persist_assistant_failed", detail: String(err) });
        }

        send("done", { tokens_in: tokensIn, tokens_out: tokensOut });
        controller.close();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        send("error", { error: msg });
        controller.close();
      }
    },
    cancel() {
      // Client aborted — nothing to clean up server-side; the partial
      // assistant text was never persisted.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
