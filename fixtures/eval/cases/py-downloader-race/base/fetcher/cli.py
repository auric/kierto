import argparse
import logging
import sys
from pathlib import Path

from fetcher.download import download_all


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Download the URLs of a list file.")
    parser.add_argument("url_file", type=Path, help="a file with one URL per line")
    parser.add_argument("--dest", type=Path, default=Path("archive"))
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    urls = [line.strip() for line in args.url_file.read_text().splitlines() if line.strip()]
    args.dest.mkdir(parents=True, exist_ok=True)
    saved = download_all(urls, args.dest, args.timeout)
    print(f"saved {len(saved)} of {len(urls)} files")
    return 0 if len(saved) == len(urls) else 1


if __name__ == "__main__":
    sys.exit(main())
