from flask import Flask, abort, jsonify, request

from app.reports.monthly import monthly_totals

app = Flask(__name__)


@app.get("/reports/monthly")
def monthly():
    try:
        year = int(request.args["year"])
        month = int(request.args["month"])
    except (KeyError, ValueError):
        abort(400, "year and month must be integers")
    if not 1 <= month <= 12:
        abort(400, "month must be 1 to 12")
    return jsonify(monthly_totals(year, month))
