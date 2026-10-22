"""The catalog web app: one process, one thread. The event bus, and anything that subscribes to it, live in this process."""

import os

import psycopg
from flask import Flask
from waitress import serve

from catalog import events
from catalog.api import routes
from catalog.repo import PriceRepo


def create_app() -> Flask:
    app = Flask(__name__)
    conn = psycopg.connect(os.environ["CATALOG_DSN"])
    bus = events.EventBus()
    repo = PriceRepo(conn)
    app.extensions["event_bus"] = bus
    app.extensions["price_repo"] = repo
    app.register_blueprint(routes)
    return app


if __name__ == "__main__":
    # One thread: the connection, the bus, and the subscribers are not shared across threads.
    serve(create_app(), host="127.0.0.1", port=8080, threads=1)
