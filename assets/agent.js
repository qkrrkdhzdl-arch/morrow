// The assistant.
//
// It is given six tools and nothing else. It cannot send Cypher: each tool is a
// statement this file already contains, so a bad completion can only choose a
// question, never write one. That is a deliberate limit — the graph is the
// user's real workload, and a model that can rewrite the query is a model that
// can quietly answer a different question.

const SYSTEM = `You are Morrow's planning assistant. Morrow holds one person's deadlines as a graph: each deadline NEEDS artifacts, and an artifact can serve several deadlines.

Rules:
- Ground every claim in a tool result. Never invent deadlines, dates, minutes or artifacts.
- When you mention a deadline or an artifact, use its title exactly as the tool returned it.
- Prefer naming the shared artifact that buys the most time.
- Be brief: at most six sentences unless asked for detail. No preamble.
- If the tools return nothing relevant, say so plainly.`;

export async function runAgent({ baseUrl, model, apiKey, history, tools, callTool, onAssistant, onTool, maxRounds = 6 }) {
  const messages = [{ role: "system", content: SYSTEM }, ...history];
  for (let round = 0; round < maxRounds; round += 1) {
    const response = await fetch(`${String(baseUrl).replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools, tool_choice: "auto", temperature: 0.2 }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`model call failed: ${response.status} ${body.slice(0, 300)}`);
    }
    const data = await response.json();
    const message = data && data.choices && data.choices[0] && data.choices[0].message;
    if (!message) throw new Error("model returned no message");
    messages.push(message);

    const calls = message.tool_calls || [];
    if (calls.length === 0) {
      const text = (message.content || "").trim();
      onAssistant(text);
      return { text, messages };
    }

    for (const call of calls) {
      const name = call.function && call.function.name;
      let args = {};
      try {
        args = JSON.parse((call.function && call.function.arguments) || "{}");
      } catch (err) {
        args = { _parse_error: String(err) };
      }
      onTool({ phase: "start", name, args });
      let result;
      try {
        result = await callTool(name, args);
      } catch (err) {
        result = { error: err && err.message ? err.message : String(err) };
      }
      onTool({ phase: "end", name, args, result });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 8000),
      });
    }
  }
  const fallback = "I stopped after six tool rounds without reaching an answer. Ask a narrower question and I will try again.";
  onAssistant(fallback);
  return { text: fallback, messages };
}
