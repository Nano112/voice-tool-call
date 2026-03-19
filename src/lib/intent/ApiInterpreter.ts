import type { IntentInput } from "../types";
import type { IntentInterpreter } from "./types";
import { parseToolCallResponse } from "./types";

export function createApiInterpreter(apiUrl: string, apiKey: string): IntentInterpreter {
  return async (input: IntentInput) => {
    const toolDescriptions = input.tools
      .map((t) => {
        const params = Object.entries(t.parameters).map(([k, v]) => `${k}: ${v}`).join(", ");
        return `  ${t.name}(${params}) — ${t.description}`;
      })
      .join("\n");

    const contextStr = Object.entries(input.context)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join("\n");

    const prompt = `You are a tool-calling system.\n\nTOOLS:\n${toolDescriptions}\n\nCONTEXT:\n${contextStr}\n\nUSER COMMAND: "${input.text}"\n\nReturn JSON only: { "tool": "...", "arguments": { ... } }`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 256,
      }),
    });

    if (!response.ok) throw new Error(`LLM API error: ${response.status}`);
    const data = await response.json();
    return parseToolCallResponse(data.choices[0].message.content.trim());
  };
}
