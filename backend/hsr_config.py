APP_NAME = "HSR Snooker Cafe BMS"
CSV_PREFIX = "hsr_snooker_cafe"

TABLE_RATES = {
    "t1": 320,
    "t2": 320,
    "t3": 270,
    "t4": 270,
    "t5": 170,
}

TABLE_RATE_FIELDS = {
    "t1": "wr",
    "t2": "wr",
    "t3": "sr",
    "t4": "sr",
    "t5": "pr",
}

TABLE_LABELS = {
    "t1": "Wiraka",
    "t2": "Wiraka",
    "t3": "English",
    "t4": "English",
    "t5": "Pool",
}

TABLES = [
    {
        "id": table_id,
        "type": "POOL" if table_id == "t5" else "SNOOKER",
        "label": label,
        "num": int(table_id[1:]),
    }
    for table_id, label in TABLE_LABELS.items()
]

SNOOKER_TABLES = {"T1", "T2", "T3", "T4"}
POOL_TABLES = {"T5"}

MENU_ITEMS = [
    ("Veg Nuggets", 50, "Veg Snacks"),
    ("Veg Cutlet", 50, "Veg Snacks"),
    ("Veg Spring Roll", 60, "Veg Snacks"),
    ("Onion Rings", 70, "Veg Snacks"),
    ("Veg Fingers", 50, "Veg Snacks"),
    ("Chilli Garlic Potato Bites", 60, "Veg Snacks"),
    ("Punjabi Samosa", 25, "Veg Snacks"),
    ("French Fries", 60, "Veg Snacks"),
    ("Peri Peri French Fries", 70, "Veg Snacks"),
    ("Chicken Samosa", 60, "Non Veg Snacks"),
    ("Chicken Nuggets", 65, "Non Veg Snacks"),
    ("Chicken Cutlet", 75, "Non Veg Snacks"),
    ("Chicken Spring Roll", 80, "Non Veg Snacks"),
    ("Chicken Fingers", 60, "Non Veg Snacks"),
    ("Chicken Pop Corn", 90, "Non Veg Snacks"),
    ("Single Egg Omelette", 30, "Egg"),
    ("Double Egg Omelette", 50, "Egg"),
    ("Double Egg Bread Omelette", 60, "Egg"),
    ("Boiled Egg", 40, "Egg"),
    ("Bulls Eye", 25, "Egg"),
    ("Plain Maggie", 50, "Maggie"),
    ("Double Egg Maggie", 80, "Maggie"),
    ("Cheese Maggie", 70, "Maggie"),
    ("Coffee", 25, "Hot Beverages"),
    ("Tea", 25, "Hot Beverages"),
    ("Ginger Tea", 25, "Hot Beverages"),
    ("Elaichi Tea", 25, "Hot Beverages"),
    ("Lemon Tea", 25, "Hot Beverages"),
    ("Cool Drinks 200ml", 20, "Cold Beverages"),
    ("Golli Soda", 40, "Cold Beverages"),
    ("Scoop Ice Cream", 50, "Cold Beverages"),
    ("Cigarettes", 0, "Cigarettes"),
]


def rate_for_table(table_id: str, fallback: int = 0, rates=None) -> int:
    normalized = (table_id or "").lower()
    field = TABLE_RATE_FIELDS.get(normalized)
    if rates is not None and field:
        value = rates.get(field) if isinstance(rates, dict) else getattr(rates, field, None)
        if value is not None:
            return value
    return TABLE_RATES.get(normalized, fallback)
