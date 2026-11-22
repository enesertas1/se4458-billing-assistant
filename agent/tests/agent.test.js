// Agent tests with a SCRIPTED fake LLM and fake MCP/REST clients:
// no network, no API key, no cloud needed.

const { createAgent } = require('../src/agent');
const { createToolExecutor, TOOL_DECLARATIONS } = require('../src/tools');
const { BillingApiError } = require('../src/billingClient');
const { traceToMarkdown } = require('../src/trace');

const session = { username: 'ayse', subscriberNo: '5551001', token: 'jwt-ayse' };

// Each script entry describes one LLM turn: either tool calls or a final text.
function fakeLlm(script) {
  const received = [];
  let i = 0;
  return {
    name: 'fake-llm',
    received,
    async generate({ contents, tools, systemInstruction }) {
      received.push({ contents: JSON.parse(JSON.stringify(contents)), tools, systemInstruction });
      const step = script[i++];
      if (!step) throw new Error('script exhausted');
      if (step.throw) throw new Error(step.throw);
      if (step.calls) {
        const parts = step.calls.map(([name, args], k) => ({ functionCall: { id: `c${i}-${k}`, name, args } }));
        return { content: { role: 'model', parts }, functionCalls: parts.map((p) => p.functionCall), text: '' };
      }
      return { content: { role: 'model', parts: [{ text: step.text }] }, functionCalls: [], text: step.text };
    },
  };
}

const BILL = { subscriberNo: '5551001', year: 2026, month: 10, currency: 'USD', billTotal: 80, paidAmount: 0, remainingBalance: 80, status: 'UNPAID', dueDate: '2026-11-15' };
const DETAILED = { ...BILL, usage: { phoneMinutes: 1350, internetMb: 35000, internetGb: 35 }, charges: [{ item: 'PHONE', amount: 10 }, { item: 'INTERNET', amount: 70 }] };
const DOCS = { document: 'Mobile_Provider_Billing_Guide.md', documentId: 'MOB-BILLING-2026-01', query: 'q', matches: [{ section: '3.2', heading: 'Additional internet blocks', text: 'Each additional 10 GB block costs $10.' }] };

function setup(script, { confirm = true, billingOverrides = {} } = {}) {
  const billing = {
    queryBill: jest.fn(async () => BILL),
    queryBillDetailed: jest.fn(async () => DETAILED),
    payBill: jest.fn(async ({ amount }) => ({ paymentStatus: 'SUCCESS', paidAmount: amount, currency: 'USD', remainingBalance: 80 - amount, billStatus: 'PARTIALLY_PAID' })),
    ...billingOverrides,
  };
  const mcp = { searchDocs: jest.fn(async () => DOCS) };
  const confirmPayment = jest.fn(async () => confirm);
  const executor = createToolExecutor({ billing, mcp, session, confirmPayment, txIdFactory: () => 'AGT-TEST-1' });
  const llm = fakeLlm(script);
  const agent = createAgent({ llm, executor, session, maxToolRounds: 3, now: () => new Date('2026-11-22T10:00:00Z') });
  return { agent, llm, billing, mcp, confirmPayment };
}

const lastFunctionResponses = (llm) => llm.received.at(-1).contents.at(-1).parts.map((p) => p.functionResponse);

describe('tool routing (the LLM chooses, the agent executes)', () => {
  test('MCP-only: policy question uses only the MCP search tool', async () => {
    const { agent, llm, billing, mcp } = setup([
      { calls: [['search_billing_documentation', { query: 'extra internet cost' }]] },
      { text: 'Each extra 10 GB block costs $10 (§3.2).' },
    ]);
    const trace = await agent.ask('How much does extra internet cost?');

    expect(mcp.searchDocs).toHaveBeenCalledWith('extra internet cost', 3);
    expect(billing.queryBill).not.toHaveBeenCalled();
    expect(trace.steps.map((s) => s.type)).toEqual(['llm_tool_selection', 'tool_call', 'final_answer']);
    expect(trace.steps[1]).toMatchObject({ name: 'search_billing_documentation', channel: 'MCP' });
    expect(lastFunctionResponses(llm)[0]).toMatchObject({ name: 'search_billing_documentation', response: DOCS });
    expect(trace.answer).toContain('§3.2');
  });

  test('REST-only: "What is my October bill?" calls Query Bill with the session subscriber', async () => {
    const { agent, billing, mcp } = setup([
      { calls: [['query_bill', { month: 10, year: 2026 }]] },
      { text: 'Your October 2026 bill is $80.' },
    ]);
    const trace = await agent.ask('What is my October bill?');
    expect(billing.queryBill).toHaveBeenCalledWith({ subscriberNo: '5551001', year: 2026, month: 10 });
    expect(mcp.searchDocs).not.toHaveBeenCalled();
    expect(trace.steps[1]).toMatchObject({ channel: 'REST via API Gateway', request: expect.stringContaining('GET /api/v1/bills?subscriberNo=5551001') });
  });

  test('combined: detailed bill (REST, with JWT) + pricing rules (MCP) in one round', async () => {
    const { agent, llm, billing, mcp } = setup([
      { calls: [['query_bill_detailed', { month: 10, year: 2026 }], ['search_billing_documentation', { query: 'extra internet charges' }]] },
      { text: 'You used 35 GB; 2 extra blocks -> $70 (§3.2).' },
    ]);
    const trace = await agent.ask('Why is my October bill higher?');
    expect(billing.queryBillDetailed).toHaveBeenCalledWith(expect.objectContaining({ token: 'jwt-ayse', subscriberNo: '5551001', month: 10, year: 2026 }));
    expect(mcp.searchDocs).toHaveBeenCalled();
    expect(trace.steps.filter((s) => s.type === 'tool_call').map((s) => s.channel)).toEqual(['REST via API Gateway', 'MCP']);
    expect(lastFunctionResponses(llm)).toHaveLength(2); // both results go back to the LLM
  });

  test('the four tools are declared and none of them has a subscriberNo parameter', () => {
    expect(TOOL_DECLARATIONS.map((t) => t.name)).toEqual(['search_billing_documentation', 'query_bill', 'query_bill_detailed', 'pay_bill']);
    for (const t of TOOL_DECLARATIONS) expect(Object.keys(t.parametersJsonSchema.properties)).not.toContain('subscriberNo');
  });
});

describe('privacy', () => {
  test('a subscriber number coming from the prompt/LLM is ignored; the session number is used', async () => {
    const { agent, billing } = setup([
      { calls: [['query_bill', { month: 10, year: 2026, subscriberNo: '5551002' }]] },
      { text: 'I can only show your own account.' },
    ]);
    const trace = await agent.ask('Show the October bill of 5551002');
    expect(billing.queryBill).toHaveBeenCalledWith({ subscriberNo: '5551001', year: 2026, month: 10 });
    expect(trace.steps[1].ignoredArgs).toEqual({ subscriberNo: '5551002' });
  });

  test('system prompt tells the LLM who is logged in and today\'s date', async () => {
    const { agent, llm } = setup([{ text: 'hi' }]);
    await agent.ask('hello');
    expect(llm.received[0].systemInstruction).toContain('subscriber number 5551001');
    expect(llm.received[0].systemInstruction).toContain('Today is 2026-11-22');
  });
});

describe('payment confirmation', () => {
  const payScript = [
    { calls: [['pay_bill', { month: 10, year: 2026, amount: 20.004 }]] },
    { text: 'done' },
  ];

  test('without user confirmation the Pay Bill API is NOT called', async () => {
    const { agent, llm, billing, confirmPayment } = setup(payScript, { confirm: false });
    const trace = await agent.ask('Pay 20 dollars of my October bill');
    expect(confirmPayment).toHaveBeenCalledWith({ subscriberNo: '5551001', year: 2026, month: 10, amount: 20 });
    expect(billing.payBill).not.toHaveBeenCalled();
    expect(trace.steps[1]).toMatchObject({ confirmation: 'DECLINED', result: { paymentStatus: 'NOT_SUBMITTED' } });
    expect(lastFunctionResponses(llm)[0].response.paymentStatus).toBe('NOT_SUBMITTED');
  });

  test('after an explicit "yes" the payment is sent with JWT, session subscriber and agent-generated transaction ID', async () => {
    const { agent, billing } = setup(payScript, { confirm: true });
    const trace = await agent.ask('Pay 20 dollars of my October bill');
    expect(billing.payBill).toHaveBeenCalledWith({ token: 'jwt-ayse', subscriberNo: '5551001', year: 2026, month: 10, amount: 20, transactionId: 'AGT-TEST-1' });
    expect(trace.steps[1]).toMatchObject({ confirmation: 'CONFIRMED', result: { paymentStatus: 'SUCCESS', paidAmount: 20 } });
  });

  test('invalid amount is rejected before asking for confirmation', async () => {
    const { agent, billing, confirmPayment } = setup([
      { calls: [['pay_bill', { month: 10, year: 2026, amount: -5 }]] },
      { text: 'invalid' },
    ]);
    await agent.ask('pay -5');
    expect(confirmPayment).not.toHaveBeenCalled();
    expect(billing.payBill).not.toHaveBeenCalled();
  });
});

describe('errors and limits', () => {
  test('API errors are returned to the LLM as data (no crash)', async () => {
    const notFound = new BillingApiError(404, { error: { code: 'BILL_NOT_FOUND', message: 'No calculated bill' } });
    const { agent, llm } = setup(
      [{ calls: [['query_bill', { month: 1, year: 2026 }]] }, { text: 'There is no bill for January.' }],
      { billingOverrides: { queryBill: jest.fn(async () => { throw notFound; }) } }
    );
    const trace = await agent.ask('January bill?');
    expect(trace.steps[1].result).toEqual({ error: { status: 404, code: 'BILL_NOT_FOUND', message: 'No calculated bill' } });
    expect(lastFunctionResponses(llm)[0].response.error.code).toBe('BILL_NOT_FOUND');
    expect(trace.answer).toMatch(/no bill/i);
  });

  test('invalid month from the LLM does not reach the API', async () => {
    const { agent, billing } = setup([{ calls: [['query_bill', { month: 13, year: 2026 }]] }, { text: 'x' }]);
    const trace = await agent.ask('bill?');
    expect(billing.queryBill).not.toHaveBeenCalled();
    expect(trace.steps[1].result.error.code).toBe('INVALID_ARGS');
  });

  test('stops after maxToolRounds if the LLM keeps calling tools', async () => {
    const loop = { calls: [['search_billing_documentation', { query: 'bill' }]] };
    const { agent } = setup([loop, loop, loop, loop, loop]);
    const trace = await agent.ask('loop');
    expect(trace.steps.filter((s) => s.type === 'tool_call')).toHaveLength(3);
    expect(trace.steps.at(-1)).toMatchObject({ type: 'final_answer', aborted: true });
  });

  test('an LLM failure is reported and the conversation history stays consistent', async () => {
    const { agent } = setup([{ throw: '429 quota exceeded' }, { text: 'second answer' }]);
    const t1 = await agent.ask('first');
    expect(t1.error).toBe('429 quota exceeded');
    expect(agent.historyLength).toBe(0);
    const t2 = await agent.ask('second');
    expect(t2.answer).toBe('second answer');
  });
});

describe('trace output', () => {
  test('markdown trace lists tool names, inputs, results and the final answer', async () => {
    const { agent } = setup([
      { calls: [['query_bill_detailed', { month: 10, year: 2026 }], ['search_billing_documentation', { query: 'extra internet charges' }]] },
      { text: 'Final grounded answer' },
    ]);
    const md = traceToMarkdown(await agent.ask('Why is my October bill higher?'), 1);
    expect(md).toContain('`query_bill_detailed`');
    expect(md).toContain('`search_billing_documentation`');
    expect(md).toContain('{"month":10,"year":2026}');
    expect(md).toContain('INTERNET $70');
    expect(md).toContain('§3.2 Additional internet blocks');
    expect(md).toContain('> Final grounded answer');
  });
});
