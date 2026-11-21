"""Read-only checks; never synthesize payments or change historical balances."""
from collections import defaultdict
import json

import models
from money import business_date, day_rows, record_business_date


def amount(value):
    if type(value) is int and value >= 0:
        return value
    if isinstance(value, str) and value.isascii() and value.isdigit():
        return int(value)
    return None


def tender_parts(transaction):
    total = amount(transaction.total)
    if total is None:
        return None
    try:
        rows = json.loads(transaction.payment_split_json or "[]")
    except (ValueError, TypeError):
        return None
    if not isinstance(rows, list):
        return None
    if rows:
        parts = defaultdict(int)
        for row in rows:
            if not isinstance(row, dict) or row.get("method") not in {"Cash", "UPI", "Card"} or amount(row.get("amount")) is None:
                return None
            parts[row["method"]] += amount(row["amount"])
        return dict(parts) if sum(parts.values()) == total and transaction.payment_method != "Credit" else None
    if transaction.payment_method in {"Cash", "UPI", "Card", "Credit"}:
        return {transaction.payment_method: total}
    return None


def reconcile_day(db, day=None):
    day = day or business_date()
    transactions = day_rows(db, models.Transaction, day)
    orders = [row for row in day_rows(db, models.FoodOnlyOrder, day) if not row.cancelled_at]
    errors, warnings = [], []
    breakdown = {"Cash": 0, "UPI": 0, "Card": 0, "Credit": 0}
    counter = {"Cash": 0, "UPI": 0, "Card": 0}
    ids = [row.id for row in transactions]
    payments, ledger = defaultdict(list), defaultdict(list)
    for row in db.query(models.Payment).filter(models.Payment.transaction_id.in_(ids)).all():
        payments[row.transaction_id].append(row)
    for row in db.query(models.CreditLedger).filter(models.CreditLedger.transaction_id.in_(ids)).all():
        ledger[row.transaction_id].append(row)
    strict = {(row.resource_kind, row.resource_id) for row in db.query(models.MutationReceipt).filter(
        models.MutationReceipt.resource_kind.in_(["transaction", "food_order"])).all()}

    def issue(code, kind, resource_id, message, *, warning=False):
        (warnings if warning else errors).append({"code": code, "resource": kind, "id": resource_id, "message": message})

    def check_items(raw, expected, kind, resource_id, required):
        try:
            rows = json.loads(raw or "[]")
            valid = isinstance(rows, list) and all(isinstance(row, dict) and amount(row.get("price")) is not None
                and type(row.get("qty")) is int and row["qty"] > 0 for row in rows)
            valid = valid and sum(amount(row["price"]) for row in rows) == expected
        except (ValueError, TypeError):
            valid = False
        if not valid:
            issue("food_lines_mismatch", kind, resource_id, "Saved food lines do not reconcile with the receipt.", warning=not required)

    for transaction in transactions:
        tid = transaction.id
        required = ("transaction", str(tid)) in strict
        values = [amount(getattr(transaction, name)) for name in ("total", "play_charge", "food_charge", "gst_amt")]
        if any(value is None for value in values):
            issue("invalid_receipt_amount", "transaction", tid, "Receipt amounts must be nonnegative whole rupees.")
        else:
            total, play, food, tax = values
            discount = play + food + tax - total
            if discount < 0 or (discount > 0 and required and not transaction.discount_reason):
                issue("receipt_components_mismatch", "transaction", tid, "Receipt components/discount do not reconcile.")
            check_items(transaction.food_json, food, "transaction", tid, required)
        parts = tender_parts(transaction)
        if parts is None:
            issue("invalid_tender", "transaction", tid, "Payment method or split amounts do not reconcile with the receipt.")
        else:
            for method, value in parts.items():
                breakdown[method] += value
        credit = transaction.payment_method == "Credit" or transaction.payment_status == "credit"
        if credit:
            rows = ledger[tid]
            if len(rows) != 1 or rows[0].entry_type != "debit" or rows[0].amount != transaction.total or rows[0].member_id != transaction.member_id:
                issue("credit_debit_mismatch", "transaction", tid, "Credit receipt needs one matching member debit.")
            if payments[tid] or transaction.payment_method != "Credit" or transaction.payment_status != "credit":
                issue("credit_marked_collected", "transaction", tid, "Member credit must not be recorded as collected payment.")
        else:
            rows = payments[tid]
            if not rows:
                issue("missing_payment", "transaction", tid, "Receipt has no payment-ledger coverage.", warning=not required)
            elif len(rows) != 1 or rows[0].amount != transaction.total or rows[0].method != transaction.payment_method:
                issue("payment_mismatch", "transaction", tid, "Payment ledger does not match its receipt.")
            if ledger[tid]:
                issue("unexpected_credit_debit", "transaction", tid, "Collected receipt also has a credit debit.")

    for order in orders:
        value = amount(order.total)
        if value is None or order.payment_method not in counter:
            issue("invalid_counter_payment", "food_order", order.id, "Counter receipt has an invalid amount or payment method.")
        else:
            counter[order.payment_method] += value
            breakdown[order.payment_method] += value
            check_items(order.items, value, "food_order", order.id, ("food_order", str(order.id)) in strict)

    # Debt is venue-wide, not just today's debits. An opening balance is never guessed.
    balances = defaultdict(int)
    for row in db.query(models.CreditLedger).order_by(models.CreditLedger.id).all():
        if row.entry_type != "debit" or amount(row.amount) is None:
            issue("invalid_credit_entry", "credit_ledger", row.id, "Credit ledger contains an unsupported entry.")
        else:
            balances[row.member_id] += row.amount
            if row.balance_after != balances[row.member_id]:
                issue("credit_running_balance_mismatch", "credit_ledger", row.id, "Saved running balance does not match preceding debits.")
    members = {row.customer_id: row for row in db.query(models.Member).all()}
    for member_id in set(balances) | {key for key, row in members.items() if row.current_balance}:
        member = members.get(member_id)
        if member is None or member.current_balance != balances[member_id]:
            issue("member_balance_mismatch", "member", member_id, "Member balance does not match the recorded credit ledger.")
    for model in (models.Payment, models.CreditLedger, models.ClosedSessionFrame):
        if db.query(model.id).outerjoin(models.Transaction, model.transaction_id == models.Transaction.id).filter(models.Transaction.id.is_(None)).first():
            issue("orphan_ledger", model.__tablename__, None, "A ledger entry has no receipt.")
    for model in (models.Transaction, models.FoodOnlyOrder):
        # Corrupt/undated money cannot silently disappear from every closing.
        for row in db.query(model).filter((model.ts.is_(None)) | (model.ts <= 0)).all():
            if (row.total or 0) and record_business_date(row) is None:
                issue("undated_receipt", model.__tablename__, row.id, "A receipt has no verifiable business date.")
    receipt_total = sum(row.total or 0 for row in transactions) + sum(row.total or 0 for row in orders)
    delta = receipt_total - sum(breakdown.values())
    if delta:
        issue("tender_total_mismatch", "business_day", day, "Payment breakdown does not equal recorded sales.")
    return {"date": day, "ok": not errors, "errors": errors, "warnings": warnings,
        "legacy_review_required": bool(warnings), "receipt_total": receipt_total,
        "collected_total": sum(breakdown[key] for key in ("Cash", "UPI", "Card")),
        "credit_total": breakdown["Credit"], "delta": delta, "payment_breakdown": breakdown,
        "counter_payment_breakdown": counter, "transactions_checked": len(transactions), "counter_orders_checked": len(orders)}
