// Gemini adapter (Google Gen AI SDK). The agent only depends on generate(), so tests can
// replace this with a scripted fake LLM and run without network or API key.

const { GoogleGenAI, FunctionCallingConfigMode } = require('@google/genai');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createGeminiLlm({ apiKey, model, apiVersion }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set (see agent/.env.example)');
  const ai = new GoogleGenAI({ apiKey, ...(apiVersion ? { httpOptions: { apiVersion } } : {}) });

  return {
    name: `gemini:${model}`,

    async generate({ systemInstruction, contents, tools }) {
      const request = {
        model,
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: tools }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        },
      };

      let response;
      for (let attempt = 0; ; attempt++) {
        try {
          response = await ai.models.generateContent(request);
          break;
        } catch (err) {
          const status = err.status ?? err.code;
          // 429 (rate limit) / 503 (overloaded) are common on the free tier -> short retry
          if ((status === 429 || status === 503) && attempt < 2) {
            await sleep(2000 * (attempt + 1));
            continue;
          }
          throw err;
        }
      }

      const content = response.candidates?.[0]?.content ?? { role: 'model', parts: [] };
      const parts = content.parts ?? [];
      return {
        // the raw model turn is kept in history as-is (it may carry thought signatures)
        content,
        functionCalls: parts.filter((p) => p.functionCall).map((p) => ({
          id: p.functionCall.id,
          name: p.functionCall.name,
          args: p.functionCall.args ?? {},
        })),
        text: parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim(),
        usage: response.usageMetadata
          ? { inputTokens: response.usageMetadata.promptTokenCount, outputTokens: response.usageMetadata.candidatesTokenCount }
          : undefined,
      };
    },
  };
}

module.exports = { createGeminiLlm };
