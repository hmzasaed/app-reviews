"""Command-line entry point: run the whole pipeline without the API.

    python -m pipeline.cli init-db
    python -m pipeline.cli add "https://play.google.com/store/apps/details?id=com.example.app"
    python -m pipeline.cli sync com.example.app --max 1000 --since-days 90
    python -m pipeline.cli analyze com.example.app
    python -m pipeline.cli issues com.example.app
    python -m pipeline.cli export com.example.app --kind issues --format csv --out reports/issues.csv
    python -m pipeline.cli label-sample com.example.app --n 400
    python -m pipeline.cli evaluate reports/com.example.app_label_sample.csv
"""

import argparse
import csv
import json
import logging
import sys
from pathlib import Path

from database.models import App
from database.session import init_db, postgres_ddl, session_scope
from pipeline.evaluation import LABEL_COLUMNS, evaluate, sample_for_labeling
from pipeline.export import issue_rows, review_rows, to_csv, to_json
from pipeline.ingestion import parse_app_id, register_app
from pipeline.jobs import create_job, run_job


def _run(app_id: str, kind: str, params: dict) -> None:
    with session_scope() as session:
        if session.get(App, app_id) is None:
            sys.exit(f"App '{app_id}' is not registered. Run: python -m pipeline.cli add {app_id}")
        job_id = create_job(session, app_id, kind, params).id
    job = run_job(job_id)
    for key, value in (job.result or {}).items():
        if key != "priority_context":
            print(f"  {key}: {value}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="reviews", description="Play Store review analysis pipeline")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init-db", help="Create database tables")
    sub.add_parser("schema-sql", help="Print Postgres DDL (for the Supabase SQL editor)")

    add = sub.add_parser("add", help="Register an app by URL or package ID")
    add.add_argument("app")
    add.add_argument("--lang")
    add.add_argument("--country")

    sync = sub.add_parser("sync", help="Collect reviews")
    sync.add_argument("app")
    sync.add_argument("--max", type=int, default=1000, dest="max_reviews")
    sync.add_argument("--since-days", type=int)

    analyze = sub.add_parser("analyze", help="Run the AI analysis")
    analyze.add_argument("app")
    analyze.add_argument("--window-days", type=int)

    issues = sub.add_parser("issues", help="Print ranked issues")
    issues.add_argument("app")

    export = sub.add_parser("export", help="Export issues or reviews")
    export.add_argument("app")
    export.add_argument("--kind", choices=["issues", "reviews"], default="issues")
    export.add_argument("--format", choices=["csv", "json"], default="csv")
    export.add_argument("--out", type=Path)

    sample = sub.add_parser("label-sample", help="Export a stratified sample for human labelling")
    sample.add_argument("app")
    sample.add_argument("--n", type=int, default=400)
    sample.add_argument("--out", type=Path)

    evaluate_cmd = sub.add_parser("evaluate", help="Score predictions against a labelled sample CSV")
    evaluate_cmd.add_argument("labels", type=Path)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    if args.command == "init-db":
        init_db()
        print("Database tables are ready.")
        return
    if args.command == "schema-sql":
        print(postgres_ddl())
        return
    if args.command == "evaluate":
        with args.labels.open(encoding="utf-8-sig", newline="") as f:
            print(json.dumps(evaluate(list(csv.DictReader(f))), indent=2))
        return
    if args.command == "add":
        with session_scope() as session:
            app = register_app(session, args.app, args.lang, args.country)
            print(f"Registered {app.id}: {app.title} ({app.developer})")
        return

    app_id = parse_app_id(args.app)
    if args.command == "sync":
        _run(app_id, "sync", {"max_reviews": args.max_reviews, "since_days": args.since_days})
    elif args.command == "analyze":
        _run(app_id, "analyze", {"window_days": args.window_days})
    elif args.command == "issues":
        with session_scope() as session:
            for row in issue_rows(session, app_id):
                print(f"[{row['priority']:>8} {row['priority_score']:5.1f}] #{row['issue_id']} {row['title']} "
                      f"({row['review_count']} reviews, {row['trend']})")
    elif args.command == "export":
        with session_scope() as session:
            rows = issue_rows(session, app_id) if args.kind == "issues" else review_rows(session, app_id)
        content = to_csv(rows) if args.format == "csv" else to_json(rows)
        out = args.out or Path("reports") / f"{app_id}_{args.kind}.{args.format}"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(content, encoding="utf-8")
        print(f"Wrote {len(rows)} rows to {out}")
    elif args.command == "label-sample":
        with session_scope() as session:
            rows = sample_for_labeling(session, app_id, args.n)
        out = args.out or Path("reports") / f"{app_id}_label_sample.csv"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(to_csv(rows), encoding="utf-8")
        print(f"Wrote {len(rows)} reviews to {out}. Fill in {', '.join(LABEL_COLUMNS)}, then run: evaluate {out}")


if __name__ == "__main__":
    main()
