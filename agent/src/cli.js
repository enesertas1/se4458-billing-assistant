#!/usr/bin/env node
// Terminal chat for the AI Billing Support Assistant.
//   npm start            (reads agent/.env)
// Commands: /help  /reset  /exit

const readline = require('readline');
const { loadConfig } = require('./config');
const { createBillingClient } = require('./billingClient');
const { connectMcp } = require('./mcpClient');
const { createGeminiLlm } = require('./llm');
const { createToolExecutor } = require('./tools');
const { createAgent } = require('./agent');
const { formatTraceForConsole, renderForTerminal, createTraceLogger, colors: c } = require('./trace');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Reads a line without echoing it (prints * per character). Works on Windows terminals too:
// readline is NOT used here; raw keypresses are read directly from stdin.
function readHidden(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    if (!stdin.isTTY) {
      // not a terminal (e.g. piped input): fall back to a normal line read
      const rl = readline.createInterface({ input: stdin });
      rl.once('line', (line) => { rl.close(); process.stdout.write('\n'); resolve(line); });
      return;
    }
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.removeListener('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); } // Ctrl+C
        if (ch === '\u007f' || ch === '\b') { // Backspace
          if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
          continue;
        }
        if (ch < ' ') continue; // ignore other control keys
        value += ch;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

function createPrompter() {
  let rl = null;
  const open = () => {
    if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    return rl;
  };
  const closeRl = () => { if (rl) { rl.close(); rl = null; } };
  return {
    ask: (q) => new Promise((resolve) => open().question(q, resolve)),
    async askHidden(q) {
      closeRl(); // readline must not touch stdin while we read the password
      return readHidden(q);
    },
    close: closeRl,
  };
}

// "Assistant is working... Xs" indicator. It can be paused while we ask the user something.
function createSpinner() {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let timer = null;
  let started = 0;
  let f = 0;
  const clearLine = () => process.stdout.write('\r' + ' '.repeat(60) + '\r');
  return {
    start() {
      if (timer) return;
      if (!started) started = Date.now();
      timer = setInterval(() => {
        const s = ((Date.now() - started) / 1000).toFixed(0);
        process.stdout.write(`\r${c.dim(`  ${frames[f++ % frames.length]} Assistant is working... ${s}s (please wait)`)}`);
      }, 120);
    },
    pause() {
      if (timer) { clearInterval(timer); timer = null; clearLine(); }
    },
    stop() {
      this.pause();
      started = 0;
    },
  };
}

async function main() {
  const cfg = loadConfig();
  const io = createPrompter();

  console.log(c.bold('\n  Mobile Provider – AI Billing Support Assistant'));
  console.log(c.dim(`  LLM: ${cfg.geminiModel} | REST (gateway): ${cfg.billingApiUrl}`));

  const llm = createGeminiLlm({ apiKey: cfg.geminiApiKey, model: cfg.geminiModel, apiVersion: cfg.geminiApiVersion });
  const billing = createBillingClient({ baseUrl: cfg.billingApiUrl, gatewayKey: cfg.gatewayKey });

  const mcp = await connectMcp(cfg);
  console.log(c.dim(`  MCP: ${mcp.label} | tools: ${mcp.tools.join(', ')}\n`));

  // ---- login: identity for every account-specific call comes from here ----
  let session;
  while (!session) {
    const username = process.env.AGENT_USERNAME || (await io.ask('  Username: '));
    const password = process.env.AGENT_PASSWORD || (await io.askHidden('  Password: '));
    try {
      const auth = await billing.login(username.trim(), password);
      if (auth.role !== 'SUBSCRIBER' || !auth.subscriberNo) {
        console.log(c.red('  Please log in with a subscriber account (e.g. ayse).'));
        continue;
      }
      session = { username: username.trim(), subscriberNo: auth.subscriberNo, token: auth.accessToken };
    } catch (err) {
      console.log(c.red(`  Login failed: ${err.message}`));
      if (err.code === 'NETWORK_ERROR') console.log(c.dim(`  Is the Billing API running at ${cfg.billingApiUrl}?`));
      if (process.env.AGENT_USERNAME) process.exit(1);
    }
  }
  console.log(c.green(`  Logged in as ${session.username} (subscriber ${session.subscriberNo}).`));

  const logger = createTraceLogger(cfg.logDir);
  console.log(c.dim(`  Tool traces are saved to ${logger.mdFile}`));
  console.log(c.dim('  Type your question, /reset for a new conversation, /exit to quit.\n'));

  const spinner = createSpinner();

  async function confirmPayment({ subscriberNo, year, month, amount }) {
    spinner.pause(); // the indicator must not overwrite the question
    console.log(c.yellow('  ┌─ PAYMENT CONFIRMATION ─────────────────────────'));
    console.log(c.yellow(`  │ Subscriber : ${subscriberNo}`));
    console.log(c.yellow(`  │ Period     : ${MONTHS[month - 1]} ${year}`));
    console.log(c.yellow(`  │ Amount     : ${amount.toFixed(2)} USD`));
    console.log(c.yellow('  └────────────────────────────────────────────────'));
    const answer = (await io.ask('  Confirm this payment? (yes/no): ')).trim().toLowerCase();
    spinner.start();
    return ['yes', 'y', 'evet', 'e'].includes(answer);
  }

  const executor = createToolExecutor({ billing, mcp, session, confirmPayment });
  const agent = createAgent({ llm, executor, session, maxToolRounds: cfg.maxToolRounds });

  for (;;) {
    const q = (await io.ask('You > ')).trim();
    if (!q) continue;
    if (q === '/exit' || q === '/quit') break;
    if (q === '/reset') { agent.reset(); console.log(c.dim('  (conversation cleared)\n')); continue; }
    if (q === '/help') { console.log(c.dim('  Examples: "How much does extra internet cost?", "What is my October bill?",\n  "Why is my October bill higher?", "Pay 20 dollars of my October bill"\n')); continue; }

    // live indicator so the user sees that the assistant is working (Gemini calls take a few seconds)
    spinner.start();
    let trace;
    try {
      trace = await agent.ask(q);
    } finally {
      spinner.stop();
    }
    console.log(formatTraceForConsole(trace));
    console.log(`${c.bold('Assistant >')} ${renderForTerminal(trace.answer)}\n`);
    logger.write(trace);
  }

  await mcp.close();
  io.close();
  console.log(c.dim(`Session log: ${logger.mdFile}`));
}

main().catch((err) => {
  console.error(c.red(`Fatal: ${err.message}`));
  process.exit(1);
});
