- Calculate compound interest with `tools/compound_interest.py` instead of computing by hand or in your head.
- **When to use**:
  + The user asks for compound interest, future value, final amount, or interest earned on a principal at a fixed annual rate.
  + Not for simple interest, regular contributions/withdrawals, variable rates, or loan amortization — the tool does not support them; say so.
- **Invocation**:
  + `python tools/compound_interest.py <principal> <rate> <compounds_per_year> <years>`
  + `principal`: float ≥ 0, initial amount (no currency symbol or thousands separators).
  + `rate`: float, annual rate in **percent** (7.34 means 7.34%, not 0.0734).
  + `compounds_per_year`: positive integer (12 monthly, 4 quarterly, 2 semi-annual, 1 annual, 365 daily).
  + `years`: float ≥ 0, total time in years. Convert months to a fraction, e.g. 8 years 7 months → `(103/12)` or `8.583333`. Pass the full-precision value, not a rounded one.
  + PowerShell example: `python tools\compound_interest.py 15847 7.34 12 (103/12)`
  + Invalid input (negative principal/years, non-positive compounds) exits with an argparse error; fix the arguments and rerun.
- **Output** (stdout, two lines, rounded to 2 decimals with thousands separators):
  + `Final amount:    29,697.95`
  + `Interest earned: 13,850.95`
- **Presenting results**:
  + Restate the inputs briefly (principal, rate, compounding frequency, term in the user's own units).
  + Show **final amount** and **total interest earned** in bold, using the user's currency symbol.
  + Report the script's numbers verbatim; do not recompute or re-round them.
  + Mention the formula `A = P(1 + r/n)^(n·t)` only if the user asks how it was computed.
  + Keep it concise; state any assumption made (e.g. months converted to fractional years).
- **Constraints**:
  + Always run the tool; never present hand-calculated figures as the result.
  + Do not modify `tools/compound_interest.py` as part of a calculation request.
