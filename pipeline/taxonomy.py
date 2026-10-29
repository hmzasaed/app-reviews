"""Fixed issue taxonomy used for zero-shot classification and severity scoring."""

from dataclasses import dataclass


# Bump when categories or hypothesis wording change, so cached predictions are recomputed.
TAXONOMY_VERSION = "3"


@dataclass(frozen=True)
class Category:
    key: str
    label: str
    hypothesis: str  # phrase inserted into the zero-shot hypothesis template
    severity: float  # 0-1 base severity used by the prioritization engine


CATEGORIES: list[Category] = [
    Category("crash_stability", "Crashes and stability", "the app crashing, freezing or closing by itself", 0.90),
    Category("login_auth", "Login and authentication", "problems logging in, signing in or getting a verification code", 0.85),
    Category("payment_billing", "Payments and billing", "being charged money, billing or a refund", 1.00),
    Category("performance", "Performance", "the app being slow, laggy or draining the battery", 0.60),
    Category("functional_bug", "Broken functionality", "a button or feature that does not work or shows an error", 0.70),
    Category("connectivity", "Connectivity and sync", "network errors or content that does not load or sync", 0.70),
    Category("account_data", "Account and data", "a banned, suspended, disabled or deleted account, or lost data", 0.95),
    Category("ui_usability", "UI and usability", "a confusing or hard-to-use design", 0.40),
    Category("ads", "Ads", "too many or annoying advertisements", 0.40),
    Category("customer_support", "Customer support", "unhelpful or unresponsive customer support", 0.50),
    Category("feature_request", "Feature request", "a request to add a new feature", 0.25),
    Category("praise", "Praise", "praise for a good app", 0.0),
]

OTHER = Category("other", "Other / uncertain", "", 0.40)

BY_KEY: dict[str, Category] = {c.key: c for c in [*CATEGORIES, OTHER]}

# Categories that describe a reported problem (used to select clustering candidates).
PROBLEM_KEYS = {c.key for c in CATEGORIES if c.key not in {"praise", "feature_request"}} | {"other"}


def label_for(key: str | None) -> str | None:
    if key is None:
        return None
    return BY_KEY[key].label if key in BY_KEY else key


def severity_for(key: str | None) -> float:
    return BY_KEY.get(key or "other", OTHER).severity
