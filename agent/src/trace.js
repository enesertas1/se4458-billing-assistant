// Tool trace output: a compact view for the terminal and full JSON / Markdown files in agent/logs/.

const fs = require('fs');
const path = require('path');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// One-line human summary of a tool result.
function summarize(name, result) {
  if (!result) return '';
  if (result.error) return `ERROR ${result.error.status ?? ''} ${result.error.code}: ${result.error.message}`.trim();
  if (name === 'search_billing_documentation') {
    if (!result.matches?.length) return 'no matching sections';
    return result.matches.map((m) => `§${m.section} ${m.heading}`).join(' | ');
  }
  if (name === 'pay_bill') {
    if (result.paymentStatus !== 'SUCCESS') return `${result.paymentStatus}: ${result.reason || ''}`;
    return `SUCCESS paid ${result.paidAmount} ${result.currency}, remaining ${result.remainingBalance}, status ${result.billStatus}`;
  }
  let s = `total ${result.billTotal}, paid ${result.paidAmount}, remaining ${result.remainingBalance}, ${result.status}, due ${result.dueDate}`;
  if (result.usage) {
    s += ` | usage ${result.usage.phoneMinutes} min, ${result.usage.internetGb} GB`;
    s += ` | ${result.charges.map((x) => `${x.item} $${x.amount}`).join(', ')}`;
  }
  return s;
}

const secs = (ms) => (typeof ms === 'number' ? c.dim(` (LLM ${(ms / 1000).toFixed(1)} s)`) : '');

// The terminal does not render Markdown: turn **bold** into real bold and "* " bullets into "•".
function renderForTerminal(text) {
  return String(text)
    .replace(/\*\*(.+?)\*\*/g, (_, t) => c.bold(t))
    .replace(/^(\s*)[*-]\s+/gm, '$1• ');
}

function formatTraceForConsole(trace) {
  const lines = [c.dim('┌─ Tool trace ' + '─'.repeat(50))];
  let n = 0;
  for (const s of trace.steps) {
    n += 1;
    if (s.type === 'llm_tool_selection') {
      lines.push(c.dim('│ ') + c.magenta(`[${n}] LLM selected: `) + s.tools.map((t) => `${t.name}(${JSON.stringify(t.args)})`).join(', ') + secs(s.durationMs));
    } else if (s.type === 'tool_call') {
      const tag = s.channel === 'MCP' ? c.cyan('MCP') : c.yellow('REST via Gateway');
      lines.push(c.dim('│ ') + `[${n}] ${tag} ${s.request} ${c.dim(`(${s.durationMs} ms)`)}`);
      if (s.confirmation) lines.push(c.dim('│     ') + `confirmation: ${s.confirmation === 'CONFIRMED' ? c.green(s.confirmation) : c.red(s.confirmation)}`);
      if (s.ignoredArgs) lines.push(c.dim('│     ') + c.red(`ignored args from LLM: ${JSON.stringify(s.ignoredArgs)}`));
      lines.push(c.dim('│     → ') + summarize(s.name, s.result));
    } else if (s.type === 'final_answer') {
      lines.push(c.dim('│ ') + c.green(`[${n}] Final answer`) + c.dim(' (LLM, grounded on the tool results above)') + secs(s.durationMs));
    } else if (s.type === 'error') {
      lines.push(c.dim('│ ') + c.red(`[${n}] Error: ${s.message}`));
    }
  }
  lines.push(c.dim('└' + '─'.repeat(63)));
  return lines.join('\n');
}

function traceToMarkdown(trace, index) {
  const out = [`## ${index}. ${trace.question}`, '', `- Time: ${trace.startedAt}`, `- Model: ${trace.model}`, `- Subscriber (from login): ${trace.subscriberNo}`, ''];
  out.push('| Step | Type | Tool / channel | Input | Result |', '|---|---|---|---|---|');
  let n = 0;
  for (const s of trace.steps) {
    n += 1;
    if (s.type === 'llm_tool_selection') {
      out.push(`| ${n} | LLM tool selection | ${s.tools.map((t) => '`' + t.name + '`').join(', ')} | ${s.tools.map((t) => '`' + JSON.stringify(t.args) + '`').join(', ')} | |`);
    } else if (s.type === 'tool_call') {
      const conf = s.confirmation ? ` (confirmation: ${s.confirmation})` : '';
      out.push(`| ${n} | Tool call${conf} | \`${s.name}\` · ${s.channel} | \`${s.request.replace(/\|/g, '\\|')}\` | ${summarize(s.name, s.result).replace(/\|/g, '\\|')} |`);
    } else if (s.type === 'final_answer') {
      out.push(`| ${n} | Final answer | LLM | | see below |`);
    } else if (s.type === 'error') {
      out.push(`| ${n} | Error | | | ${s.message} |`);
    }
  }
  out.push('', '**Final answer:**', '', '> ' + String(trace.answer).replace(/\n/g, '\n> '), '');
  out.push('<details><summary>Raw tool results (JSON)</summary>', '', '```json', JSON.stringify(trace.steps.filter((s) => s.type === 'tool_call').map((s) => ({ name: s.name, args: s.args, request: s.request, result: s.result })), null, 2), '```', '</details>', '');
  return out.join('\n');
}

function createTraceLogger(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const mdFile = path.join(logDir, `session-${stamp}.md`);
  const jsonFile = path.join(logDir, `session-${stamp}.json`);
  const all = [];
  fs.writeFileSync(mdFile, `# Agent session ${stamp}\n\n`);
  return {
    mdFile,
    jsonFile,
    write(trace) {
      all.push(trace);
      fs.appendFileSync(mdFile, traceToMarkdown(trace, all.length) + '\n');
      fs.writeFileSync(jsonFile, JSON.stringify(all, null, 2));
    },
  };
}

module.exports = { formatTraceForConsole, renderForTerminal, traceToMarkdown, createTraceLogger, summarize, colors: c };
