import type { ConceptSource } from "../types";

const category = "Balance sheet" as const;

export const balanceSheet: ConceptSource[] = [
  {
    slug: "assets",
    term: "Assets",
    category,
    level: "beginner",
    metrics: ["assets"],
    oneLiner: "Everything the company owns that has value — cash, inventory, buildings, patents.",
    body: `Assets are the resources the business controls: cash in the bank, money customers owe it, inventory on shelves, factories, equipment, and intangibles like patents and acquired brands.

They are conventionally split into **current** assets, expected to convert to cash within a year, and **non-current** ones that will not.

The balance sheet records assets at historical cost less depreciation, not at what they would fetch today. A building bought in 1970 sits at a fraction of its market value, and a brand built internally over decades may not appear at all. This is why [book value](/learn/book-value) understates some companies badly.`,
  },
  {
    slug: "liabilities",
    term: "Liabilities",
    category,
    level: "beginner",
    metrics: ["liabilities"],
    oneLiner: "Everything the company owes — loans, unpaid bills, obligations to customers.",
    body: `Liabilities are claims against the company: bank loans and bonds, money owed to suppliers, wages not yet paid, taxes due, and money taken from customers for services not yet delivered.

Like assets they split into current (due within a year) and non-current.

Not all liabilities are equally worrying. Deferred revenue — cash collected up front for a subscription not yet delivered — is technically a liability but is usually a sign of a healthy business. Interest-bearing [debt](/learn/debt) is the line that carries real risk.`,
  },
  {
    slug: "shareholders-equity",
    term: "Shareholders' equity",
    aliases: ["equity", "net assets"],
    category,
    level: "beginner",
    requires: ["assets", "liabilities"],
    oneLiner: "What would be left for shareholders if every asset were sold and every debt repaid.",
    body: `    equity = assets − liabilities

This identity is why it is called a balance sheet: the two sides must balance by construction.

Equity is the shareholders' residual claim. They are last in line — creditors are paid first — which is the precise sense in which equity is riskier than debt.

Equity can be negative, and that is not always alarming. A company that has borrowed to buy back large amounts of stock can show negative equity while generating substantial cash. It is a signal to look closer, not a verdict.`,
  },
  {
    slug: "book-value",
    term: "Book value",
    category,
    level: "intermediate",
    requires: ["shareholders-equity"],
    metrics: ["book_value"],
    oneLiner: "The accounting value of the company's net assets — equity as recorded on the balance sheet.",
    body: `Book value is [shareholders' equity](/learn/shareholders-equity) viewed as a valuation input, and it feeds [price-to-book](/learn/price-to-book).

Its reliability depends entirely on the industry. For a bank, whose assets are financial instruments carried near fair value, book value means something close to what it says. For a software company whose value is code and customer relationships that never touched the balance sheet, it is nearly fictional.

Treat a low price-to-book as a question — why does the market disagree with the accountants? — rather than an answer.`,
  },
  {
    slug: "debt",
    term: "Debt",
    aliases: ["borrowings", "leverage"],
    category,
    level: "beginner",
    requires: ["liabilities"],
    oneLiner: "Money the company has borrowed and must repay with interest.",
    body: `Debt is the subset of [liabilities](/learn/liabilities) that carries interest and a repayment schedule: bank loans, bonds, credit facilities.

It is not inherently bad. Borrowing at 4% to earn 15% is straightforwardly good business, and debt is cheaper than equity because lenders take less risk.

What makes debt dangerous is that its obligations are fixed while revenue is not. A company with heavy debt and a bad year has no flexibility — the interest is due regardless. The relevant question is never "how much debt" in isolation but how it compares to the cash the business reliably generates. See [debt-to-equity](/learn/debt-to-equity).`,
  },
  {
    slug: "cash-and-equivalents",
    term: "Cash and equivalents",
    aliases: ["cash"],
    category,
    level: "beginner",
    requires: ["assets"],
    metrics: ["cash"],
    oneLiner: "Money in the bank plus very short-term investments that can be converted immediately.",
    body: `This line covers actual cash plus instruments safe and liquid enough to count as cash — treasury bills, money market funds, short-term deposits.

Cash is what lets a company survive a bad year, fund an acquisition, or ignore a credit market that has closed. Comparing it against [debt](/learn/debt) gives the *net* cash position, which is more meaningful than either alone.

Large cash balances are not automatically good. Cash sitting idle earns little, and a company hoarding it without a plan is arguably failing to allocate capital. That is part of what [enterprise value](/learn/enterprise-value) adjusts for.`,
  },
  {
    slug: "current-ratio",
    term: "Current ratio",
    category,
    level: "intermediate",
    requires: ["assets", "liabilities"],
    metrics: ["current_ratio"],
    oneLiner:
      "Current assets divided by current liabilities — whether short-term obligations are covered.",
    body: `    current ratio = current assets ÷ current liabilities

Above 1 means the company has more resources converting to cash within a year than bills falling due in that year.

It is a crude solvency check. Around 1.5 to 3 is generally comfortable; below 1 warrants attention, though some businesses run there permanently and healthily — supermarkets collect from customers instantly and pay suppliers slowly, so a low current ratio is normal for them.

A very high ratio is not a straightforward positive either; it can mean inventory that will not sell.`,
  },
  {
    slug: "debt-to-equity",
    term: "Debt-to-equity",
    category,
    level: "intermediate",
    requires: ["debt", "shareholders-equity"],
    metrics: ["debt_to_equity"],
    oneLiner: "Total debt divided by shareholders' equity — how leveraged the company is.",
    body: `    debt-to-equity = total debt ÷ shareholders' equity

A ratio of 0.5 means fifty cents of debt for every dollar of equity.

What counts as high is entirely industry-dependent. Utilities and property companies carry heavy debt against stable, predictable cash flows and that is fine. A cyclical manufacturer with the same ratio is in a much more precarious position, because its revenue can halve while its interest cannot.

The ratio also becomes uninterpretable when equity is small or negative, which happens routinely after large buybacks. In those cases compare debt to [free cash flow](/learn/free-cash-flow) instead.`,
  },
];
