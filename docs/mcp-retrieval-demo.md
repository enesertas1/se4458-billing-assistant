# MCP retrieval tests

Transport: stdio (local process)  
Date: 2026-11-22T19:23:09.073Z

Tools exposed by the server: `search_billing_documentation`

## Test 1: `search_billing_documentation("How much does extra internet cost?")`

| # | Section | Heading | Score |
|---|---|---|---|
| 1 | 8.1 | What is the cost of extra internet? | 83.94 |
| 2 | 3.1 | Included internet allowance | 35.08 |
| 3 | 3.2 | Additional internet blocks | 31.49 |

Top passage (Section 8.1):

> Each additional 10 GB block beyond 20 GB costs $10. Partially used blocks are rounded up. See Section 3.2.

## Test 2: `search_billing_documentation("Can I pay only part of my bill?")`

| # | Section | Heading | Score |
|---|---|---|---|
| 1 | 8.3 | Can I pay only part of my bill? | 145.96 |
| 2 | 5.1 | Full and partial payments | 75.03 |
| 3 | 5.3 | Payment result | 29.9 |

Top passage (Section 8.3):

> Yes. The unpaid remainder stays outstanding, and the bill is not fully paid until the balance reaches zero. See Section 5.1.

## Test 3: `search_billing_documentation("How do I dispute a charge?")`

| # | Section | Heading | Score |
|---|---|---|---|
| 1 | 8.4 | How can I dispute a charge? | 40.98 |
| 2 | 7.1 | Dispute window | 17.28 |
| 3 | 7.2 | Information required | 6.78 |

Top passage (Section 8.4):

> Submit the billing period, disputed amount, and explanation within 15 days of bill issuance. See Section 7.

