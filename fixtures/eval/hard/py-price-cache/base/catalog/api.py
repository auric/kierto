"""The HTTP routes of the catalog."""

from flask import Blueprint, current_app, jsonify, request

from catalog.validate import BadRequest, parse_skus

routes = Blueprint("catalog", __name__)


@routes.get("/prices")
def get_prices():
    try:
        skus = parse_skus(request.args.getlist("sku"))
    except BadRequest as e:
        return jsonify(error=str(e)), 400
    prices = current_app.extensions["price_repo"].get_many(skus)
    return jsonify({sku: {"amount": str(p.amount), "currency": p.currency} for sku, p in prices.items()})
