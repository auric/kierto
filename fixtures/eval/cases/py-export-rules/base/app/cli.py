import argparse
import csv
import sys

from app.db import query


def export(out_path: str) -> int:
    rows = query("SELECT id, email FROM accounts WHERE deleted_at IS NULL ORDER BY id")
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "email"])
        writer.writerows((r["id"], r["email"]) for r in rows)
    return len(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="accounts")
    sub = parser.add_subparsers(dest="command", required=True)
    export_cmd = sub.add_parser("export", help="write the active accounts to a CSV file")
    export_cmd.add_argument("--out", required=True, help="the CSV file to write")
    args = parser.parse_args(argv)
    if args.command == "export":
        print(f"exported {export(args.out)} accounts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
