// Agent orchestrator:
//   user question -> LLM (tool selection) -> agent executes MCP / REST tools -> results back to LLM
//   -> ... (repeat while the LLM asks for tools) -> grounded final answer.
// Every step is recorded in a trace (tool names, inputs, results, final answer).

const { TOOL_DECLARATIONS } = require('./tools');
const { buildSystemPrompt } = require('./systemPrompt');

function createAgent({ llm, executor, session, maxToolRounds = 6, now = () => new Date() }) {
  let history = [];

  async function ask(question) {
    const trace = {
      question,
      model: llm.name,
      subscriberNo: session.subscriberNo,
      startedAt: now().toISOString(),
      steps: [],
      answer: null,
    };
    const checkpoint = history.length;
    history.push({ role: 'user', parts: [{ text: question }] });
    const systemInstruction = buildSystemPrompt({ session, today: now() });

    try {
      for (let round = 1; round <= maxToolRounds + 1; round++) {
        const tLlm = Date.now();
        const out = await llm.generate({ systemInstruction, contents: history, tools: TOOL_DECLARATIONS });
        const llmMs = Date.now() - tLlm;
        history.push(out.content);

        if (out.functionCalls.length === 0) {
          trace.answer = out.text || '(no answer)';
          trace.steps.push({ type: 'final_answer', round, text: trace.answer, usage: out.usage, durationMs: llmMs });
          return trace;
        }
        if (round > maxToolRounds) break;

        trace.steps.push({
          type: 'llm_tool_selection',
          round,
          tools: out.functionCalls.map((c) => ({ name: c.name, args: c.args })),
          usage: out.usage,
          durationMs: llmMs,
        });

        const responseParts = [];
        for (const call of out.functionCalls) {
          const t0 = Date.now();
          const exec = await executorRunSafe(call);
          trace.steps.push({
            type: 'tool_call',
            round,
            name: call.name,
            args: call.args,
            channel: exec.channel,
            request: exec.request,
            ...(exec.confirmation ? { confirmation: exec.confirmation } : {}),
            ...(exec.ignoredArgs ? { ignoredArgs: exec.ignoredArgs } : {}),
            result: exec.result,
            durationMs: Date.now() - t0,
          });
          responseParts.push({
            functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: exec.result },
          });
        }
        history.push({ role: 'user', parts: responseParts });
      }
      trace.answer = 'Sorry, I could not finish this request (too many tool steps). Please rephrase it.';
      trace.steps.push({ type: 'final_answer', text: trace.answer, aborted: true });
      return trace;
    } catch (err) {
      history = history.slice(0, checkpoint); // keep the conversation consistent for the next question
      trace.error = err.message;
      trace.answer = `LLM error: ${err.message}`;
      trace.steps.push({ type: 'error', message: err.message });
      return trace;
    }
  }

  async function executorRunSafe(call) {
    try {
      return await executor.run(call.name, call.args);
    } catch (err) {
      return { channel: '?', request: call.name, result: { error: { code: 'TOOL_FAILED', message: err.message } } };
    }
  }

  return {
    ask,
    reset() { history = []; },
    get historyLength() { return history.length; },
  };
}

module.exports = { createAgent };
