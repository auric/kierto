from decimal import Decimal

import pytest

from ledger import importer, settings


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def executemany(self, sql, rows):
        self.conn.inserted.append((sql, list(rows)))


class FakeConn:
    def __init__(self):
        self.inserted = []
        self.commits = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1


@pytest.fixture
def folders(tmp_path, monkeypatch):
    for name in ("inbox", "done"):
        (tmp_path / name).mkdir()
    monkeypatch.setattr(settings, "DONE_DIR", tmp_path / "done")
    return tmp_path


def test_imports_rows_and_moves_the_file(folders):
    path = folders / "inbox" / "b1.csv.123.part"
    path.write_text("acc-1,10.50,2026-01-02\nacc-2,-3.00,2026-01-02\n", encoding="utf-8")
    conn = FakeConn()
    assert importer.import_file(path, conn) == 2
    sql, rows = conn.inserted[0]
    assert "ledger_eur" in sql
    assert rows == [("b1", "acc-1", Decimal("10.50"), "2026-01-02"), ("b1", "acc-2", Decimal("-3.00"), "2026-01-02")]
    assert conn.commits == 1
    assert (folders / "done" / "b1.csv").exists()


def test_rejects_a_bad_amount(folders):
    path = folders / "inbox" / "b2.csv.123.part"
    path.write_text("acc-1,ten,2026-01-02\n", encoding="utf-8")
    with pytest.raises(importer.ImportRejected, match="line 1: bad amount"):
        importer.import_file(path, FakeConn())
