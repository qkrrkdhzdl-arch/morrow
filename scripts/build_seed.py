#!/usr/bin/env python3
"""Generate seed/sample.json and seed/seed.cypher for Morrow.

One source of truth: the SAMPLE dict below. Two outputs:
  seed/sample.json   what the browser app loads (relative day offsets + vectors)
  seed/seed.cypher   the same graph as Cypher, with absolute dates, so the
                     Relate CLI can materialise store/morrow/ for inspection

Run: python3 scripts/build_seed.py [--today YYYY-MM-DD]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from embed import embed  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CAPACITY = 240  # working minutes a day the sample assumes

# due_in: days from "today". Negative means already overdue.
OBLIGATIONS = [
    dict(id="ob-invoice", title="October invoices", due_in=1, minutes=45, channel="admin",
         stake="$1,850 owed to me",
         brief="Send two invoices for October retainers and chase the one that is still unpaid."),
    dict(id="ob-policy-survey", title="Youth policy panel survey", due_in=2, minutes=45, channel="admin",
         stake="panel stipend",
         brief="A short survey for the youth policy panel I sit on. Answers are my own; no document needed."),
    dict(id="ob-ir-video", title="IR pitch video submission", due_in=3, minutes=180, channel="contest",
         stake="$2,000 first prize",
         brief="Record a three minute pitch video for the startup competition and upload it before the portal closes."),
    dict(id="ob-scholarship", title="Scholarship application", due_in=3, minutes=90, channel="grant",
         stake="$1,200 per semester",
         brief="Alumni scholarship form: one page resume, portfolio and a bank certificate for the payout account."),
    dict(id="ob-camp-a", title="Review campaign A (delivery)", due_in=3, minutes=60, channel="campaign",
         stake="product refund",
         brief="Write a review post for the delivered product, three photos minimum, link back to the campaign page."),
    dict(id="ob-launch", title="Product launch post", due_in=6, minutes=120, channel="launch",
         stake="first 100 users",
         brief="Publish the launch page and the launch post with six product shots and the new price table."),
    dict(id="ob-blog", title="Blog post, two pieces", due_in=6, minutes=150, channel="content",
         stake="search traffic",
         brief="Two posts I promised this month. One is already outlined, neither is written."),
    dict(id="ob-camp-b", title="Review campaign B (beauty)", due_in=7, minutes=60, channel="campaign",
         stake="product refund",
         brief="Review post for the beauty campaign, same photo requirements as campaign A."),
    dict(id="ob-contract", title="Renew the retainer contract", due_in=8, minutes=60, channel="client",
         stake="$1,100 monthly",
         brief="Send the renewed contract with the updated rate card and the same scope as this year."),
    dict(id="ob-camp-c", title="Review campaign C (food)", due_in=10, minutes=75, channel="campaign",
         stake="product refund",
         brief="Food campaign review; the platform wants a table shot and a short clip as well as photos."),
    dict(id="ob-grant-2", title="Startup grant, second round", due_in=11, minutes=240, channel="grant",
         stake="$8,000 grant",
         brief="Second round of the startup grant: application form, twelve page business plan, bank certificate, ID."),
    dict(id="ob-tax", title="VAT return", due_in=13, minutes=60, channel="admin",
         stake="penalty avoidance",
         brief="Quarterly VAT return. Needs the receipt folder sorted by month first."),
    dict(id="ob-talk", title="Conference talk slides", due_in=17, minutes=240, channel="talk",
         stake="speaker spot",
         brief="Twenty minute talk at the December meetup. Slides are not started; the pitch deck has most of the material."),
    dict(id="ob-proposal", title="Client proposal (B)", due_in=17, minutes=300, channel="client",
         stake="$6,000 project",
         brief="A proposal for the agency that asked for a quote: scope, price table, market context, two case studies."),
    dict(id="ob-deck", title="Investor deck update", due_in=21, minutes=180, channel="investor",
         stake="seed conversation",
         brief="Update the pitch deck for the meeting: new traction numbers and a cleaner market slide."),
    dict(id="ob-award", title="Design award entry", due_in=21, minutes=120, channel="contest",
         stake="award listing",
         brief="Award submission: portfolio PDF plus four product shots, plus a 200 word statement."),
    dict(id="ob-hackathon", title="Hackathon submission", due_in=24, minutes=600, channel="contest",
         stake="a Mac Studio",
         brief="The build I am doing this week: repository, README and a two minute demo of the working app."),
    dict(id="ob-newsletter", title="December newsletter", due_in=28, minutes=120, channel="content",
         stake="list retention",
         brief="Monthly newsletter built from the blog posts and the launch announcement."),
    dict(id="ob-portfolio", title="Portfolio refresh", due_in=30, minutes=180, channel="content",
         stake="better inbound",
         brief="Refresh the portfolio with this quarter's work, new headshot and the updated case studies."),
]

# status: ready | draft | missing
ARTIFACTS = [
    dict(id="art-ir-deck", title="Pitch deck v4", kind="doc", status="draft", minutes_left=90,
         text="Pitch deck: problem, market size, product demo, traction, team, financials, the ask. Fifteen slides, the market and traction slides are stale."),
    dict(id="art-ir-script", title="Pitch video script", kind="doc", status="draft", minutes_left=45,
         text="Three minute script for a recorded pitch: who I am, the problem, the product, the demo, the ask. Written for speaking out loud."),
    dict(id="art-ir-video", title="Recorded pitch video", kind="video", status="missing", minutes_left=120,
         text="Recorded screen and camera pitch video, subtitles burned in, uploaded to YouTube unlisted before the portal closes."),
    dict(id="art-resume", title="One page resume", kind="doc", status="ready", minutes_left=0,
         text="One page resume listing education, the three most relevant projects, skills and contact details."),
    dict(id="art-portfolio", title="Portfolio PDF v2", kind="doc", status="ready", minutes_left=0,
         text="Portfolio of six projects with problem, what I built, screenshots and outcome. Exported as a PDF under ten megabytes."),
    dict(id="art-bank-copy", title="Bank account certificate", kind="form", status="missing", minutes_left=20,
         text="A bank certificate proving the account holder name and account number, issued for a payout or a grant."),
    dict(id="art-id-copy", title="ID scan", kind="form", status="ready", minutes_left=0,
         text="Scanned identity document, both sides, readable, used with applications that verify the applicant."),
    dict(id="art-grant-form", title="Grant application form", kind="form", status="draft", minutes_left=60,
         text="The grant portal form: applicant details, project summary, budget table, attachments. The budget table is empty."),
    dict(id="art-bizplan", title="Business plan, 12 pages", kind="doc", status="draft", minutes_left=180,
         text="Twelve page business plan: problem, solution, market, business model, unit economics, roadmap, team, risks."),
    dict(id="art-market-data", title="Market size dataset", kind="data", status="ready", minutes_left=0,
         text="Market size figures with sources, growth rates and the competitor table, kept as a spreadsheet and a notes file."),
    dict(id="art-price-table", title="Rate card and price table", kind="data", status="ready", minutes_left=0,
         text="Rate card with three tiers, what each tier includes, hourly rate and the project minimum."),
    dict(id="art-proposal", title="Client proposal document", kind="doc", status="missing", minutes_left=210,
         text="A written proposal for an agency: scope, deliverables, timeline, price table, two case studies and market context."),
    dict(id="art-product-shots", title="Product photos, six angles", kind="photo", status="draft", minutes_left=60,
         text="Six product photos on a neutral background: front, back, detail, in use, packaging and scale."),
    dict(id="art-review-photos", title="Review photo set", kind="photo", status="missing", minutes_left=45,
         text="Photos for review campaigns: product in the box, product in use, and the required table shot. One set serves several campaigns."),
    dict(id="art-newsletter", title="Newsletter draft", kind="doc", status="draft", minutes_left=60,
         text="December newsletter draft: three short sections, one launch note, one project update, one link list."),
    dict(id="art-talk-slides", title="Talk slides", kind="doc", status="missing", minutes_left=180,
         text="Twenty minute conference talk: narrative, live demo, three slides of evidence and a closing ask."),
    dict(id="art-tax-records", title="Receipts and tax records", kind="data", status="missing", minutes_left=40,
         text="Receipts sorted by month, summed by category, with the quarterly totals ready to paste into the return."),
    dict(id="art-email-templates", title="Application email templates", kind="doc", status="ready", minutes_left=0,
         text="Short email bodies for applications: greeting, one paragraph of fit, attachment list and closing. Used by every submission."),
]

# obligation -> artifact, with the share of the artifact this obligation actually needs
NEEDS = [
    ("ob-invoice", "art-tax-records", 0.3), ("ob-invoice", "art-email-templates", 0.2),
    ("ob-ir-video", "art-ir-deck", 0.5), ("ob-ir-video", "art-ir-script", 0.5), ("ob-ir-video", "art-ir-video", 1.0),
    ("ob-scholarship", "art-resume", 1.0), ("ob-scholarship", "art-portfolio", 1.0), ("ob-scholarship", "art-bank-copy", 1.0),
    ("ob-camp-a", "art-review-photos", 0.4), ("ob-camp-a", "art-email-templates", 0.1),
    ("ob-launch", "art-product-shots", 1.0), ("ob-launch", "art-price-table", 0.3),
    ("ob-camp-b", "art-review-photos", 0.4),
    ("ob-contract", "art-price-table", 0.6), ("ob-contract", "art-email-templates", 0.1),
    ("ob-camp-c", "art-review-photos", 0.5),
    ("ob-grant-2", "art-grant-form", 1.0), ("ob-grant-2", "art-bizplan", 1.0),
    ("ob-grant-2", "art-bank-copy", 1.0), ("ob-grant-2", "art-id-copy", 1.0),
    ("ob-tax", "art-tax-records", 1.0),
    ("ob-talk", "art-talk-slides", 1.0), ("ob-talk", "art-ir-deck", 0.3),
    ("ob-proposal", "art-proposal", 1.0), ("ob-proposal", "art-price-table", 0.5), ("ob-proposal", "art-market-data", 0.3),
    ("ob-deck", "art-ir-deck", 1.0), ("ob-deck", "art-market-data", 0.5),
    ("ob-award", "art-portfolio", 0.6), ("ob-award", "art-product-shots", 0.5),
    ("ob-newsletter", "art-newsletter", 1.0),
    ("ob-portfolio", "art-portfolio", 1.0), ("ob-portfolio", "art-product-shots", 0.5),
]

# artifact -> artifact it is built from
DEPENDS = [
    ("art-ir-video", "art-ir-deck"),
    ("art-ir-video", "art-ir-script"),
    ("art-grant-form", "art-portfolio"),
    ("art-grant-form", "art-bank-copy"),
    ("art-bizplan", "art-market-data"),
    ("art-proposal", "art-price-table"),
    ("art-proposal", "art-market-data"),
    ("art-talk-slides", "art-ir-deck"),
    ("art-newsletter", "art-portfolio"),
    ("art-tax-records", "art-email-templates"),
]


def q(value) -> str:
    if isinstance(value, (int, float)):
        return repr(value)
    text = str(value).replace("\\", "\\\\").replace("'", "\\'")
    return f"'{text}'"


def build_cypher(today: dt.date) -> str:
    schema_path = os.path.join(ROOT, "cypher", "schema.cypher")
    with open(schema_path) as fh:
        schema = fh.read().rstrip()
    lines = [
        "// Morrow sample graph. Generated by scripts/build_seed.py — do not edit by hand.",
        f"// Snapshot date (day 0): {today.isoformat()}",
        "// Build: relate query -d store/morrow --snapshot-format json < seed/seed.cypher",
        "",
        schema,
        "",
    ]
    for ob in OBLIGATIONS:
        due = today + dt.timedelta(days=ob["due_in"])
        lines.append(
            "CREATE (:Obligation {"
            f"id: {q(ob['id'])}, title: {q(ob['title'])}, due: {q(due.isoformat())}, "
            f"minutes: {q(ob['minutes'])}, status: 'open', channel: {q(ob['channel'])}, "
            f"stake: {q(ob['stake'])}, brief: {q(ob['brief'])}"
            "});"
        )
    for art in ARTIFACTS:
        vec = embed(art["text"])
        lines.append(
            "CREATE (:Artifact {"
            f"id: {q(art['id'])}, title: {q(art['title'])}, kind: {q(art['kind'])}, "
            f"status: {q(art['status'])}, minutes_left: {q(art['minutes_left'])}, "
            f"text: {q(art['text'])}, vec: {json.dumps(vec)}"
            "});"
        )
    lines.append("")
    for ob, art, weight in NEEDS:
        lines.append(
            f"MATCH (o:Obligation {{id: {q(ob)}}}), (a:Artifact {{id: {q(art)}}}) "
            f"CREATE (o)-[:NEEDS {{weight: {weight}}}]->(a);"
        )
    for art, on in DEPENDS:
        lines.append(
            f"MATCH (a:Artifact {{id: {q(art)}}}), (b:Artifact {{id: {q(on)}}}) "
            f"CREATE (a)-[:DEPENDS_ON]->(b);"
        )
    lines.append(
        f"CREATE (:Meta {{id: 'meta', seeded_on: {q(today.isoformat())}, sample: true}});"
    )
    lines.append("")
    return "\n".join(lines)


def build_json() -> dict:
    artifacts = []
    for art in ARTIFACTS:
        item = dict(art)
        item["vec"] = embed(art["text"])
        artifacts.append(item)
    return {
        "version": 1,
        "capacity_minutes_per_day": CAPACITY,
        "obligations": OBLIGATIONS,
        "artifacts": artifacts,
        "needs": [dict(obligation=o, artifact=a, weight=w) for o, a, w in NEEDS],
        "depends": [dict(artifact=a, on=b) for a, b in DEPENDS],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default="2026-11-17")
    args = ap.parse_args()
    today = dt.date.fromisoformat(args.today)

    os.makedirs(os.path.join(ROOT, "seed"), exist_ok=True)
    with open(os.path.join(ROOT, "seed", "sample.json"), "w") as fh:
        json.dump(build_json(), fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    with open(os.path.join(ROOT, "seed", "seed.cypher"), "w") as fh:
        fh.write(build_cypher(today))
    print(f"wrote seed/sample.json and seed/seed.cypher ({len(OBLIGATIONS)} obligations, {len(ARTIFACTS)} artifacts)")


if __name__ == "__main__":
    main()
