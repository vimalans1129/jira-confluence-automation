import argparse


def compound_interest(principal: float, rate_percent: float, compounds_per_year: int, years: float) -> tuple[float, float]:
    """Return (final amount, interest earned)."""
    n = compounds_per_year
    amount = principal * (1 + rate_percent / 100 / n) ** (n * years)
    return amount, amount - principal


def main() -> None:
    parser = argparse.ArgumentParser(description="Calculate compound interest.")
    parser.add_argument("principal", type=float, help="Initial principal")
    parser.add_argument("rate", type=float, help="Annual interest rate in percent (e.g. 7.34)")
    parser.add_argument("compounds_per_year", type=int, help="Compounding periods per year (e.g. 12)")
    parser.add_argument("years", type=float, help="Total years (e.g. 8.5833 for 8 years 7 months)")
    args = parser.parse_args()

    if args.principal < 0 or args.years < 0:
        parser.error("principal and years must be non-negative")
    if args.compounds_per_year <= 0:
        parser.error("compounds_per_year must be a positive integer")

    amount, interest = compound_interest(args.principal, args.rate, args.compounds_per_year, args.years)
    print(f"Final amount:    {amount:,.2f}")
    print(f"Interest earned: {interest:,.2f}")


if __name__ == "__main__":
    main()
