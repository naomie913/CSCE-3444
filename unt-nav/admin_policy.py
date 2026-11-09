"""Campus administrator email policy and responsibilities."""
import re


UNT_STUDENT_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@my\.unt\.edu$", re.IGNORECASE)
UNT_ADMIN_EMAIL_RE = re.compile(r"^[A-Za-z]+\.[A-Za-z]+@unt\.edu$", re.IGNORECASE)
COMPANY_EMAIL_RE = re.compile(
    r"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
    r"@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$"
)
PERSONAL_EMAIL_DOMAINS = {
    "aol.com", "fastmail.com", "gmail.com", "googlemail.com", "gmx.com",
    "hotmail.com", "hotmail.co.uk", "icloud.com", "live.com", "live.co.uk",
    "mail.com", "me.com", "msn.com", "outlook.com", "outlook.co.uk",
    "pm.me", "proton.me", "protonmail.com", "yahoo.com", "yahoo.co.uk",
    "yandex.com",
}

ADMIN_RESPONSIBILITIES = (
    "Keep campus locations accurate, including buildings, offices, classrooms, entrances, and services.",
    "Mark construction zones, closed sidewalks, obstructed entrances, and temporary route changes.",
    "Maintain building hours, contact details, accessibility information, and nearby landmarks.",
    "Review application content to keep it accurate and useful.",
    "Resolve user reports by correcting issues, dismissing erroneous reports, or adding location details.",
    "Create, update, and cancel event listings linked to verified campus locations.",
)


def valid_login_email(email):
    return valid_student_email(email)


def valid_student_email(email):
    return bool(UNT_STUDENT_EMAIL_RE.fullmatch(email))


def valid_admin_email(email):
    return bool(UNT_ADMIN_EMAIL_RE.fullmatch(email))


def valid_account_email(email, role):
    if role == "admin":
        return valid_admin_email(email)
    if role == "student":
        return valid_student_email(email)
    if role == "organizer":
        return valid_company_email(email)
    return False


def valid_company_email(email):
    if not COMPANY_EMAIL_RE.fullmatch(email):
        return False
    domain = email.rsplit("@", 1)[1].lower()
    return (
        domain not in PERSONAL_EMAIL_DOMAINS
        and not any(domain.endswith("." + personal) for personal in PERSONAL_EMAIL_DOMAINS)
        and domain not in {"my.unt.edu", "unt.edu"}
        and not domain.endswith(".my.unt.edu")
        and not domain.endswith(".unt.edu")
    )
