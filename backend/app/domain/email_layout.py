"""Branded HTML for system emails (ADR 0017). Table layout with inline styles, because email
clients ignore most CSS. The logo is a PNG served by the web app at a fixed path (no SVG: Gmail
and Outlook do not show it). Every email also has a plain-text part."""

from html import escape

from app.core.config import get_settings

LOGO_PATH = "/email/sessio-logo.png"
LOGO_WIDTH, LOGO_HEIGHT = 160, 35  # the PNG is 320 x 69, for sharp display on retina screens

BG = "#FAFAF6"
SURFACE = "#FFFFFF"
BORDER = "#E6E6DE"
TEXT = "#2B2A26"
MUTED = "#6B6A63"
CODE_BG = "#F6F7F0"  # olive-50
CODE_TEXT = "#5C6B37"  # olive-700, AA on olive-50
FONT = "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"


def logo_url() -> str:
    return get_settings().web_origin.rstrip("/") + LOGO_PATH


def _paragraph(text: str, *, muted: bool = False) -> str:
    color, size = (MUTED, 13) if muted else (TEXT, 15)
    return (
        f'<p style="margin:0 0 16px;font-family:{FONT};font-size:{size}px;line-height:1.55;'
        f'color:{color};">{escape(text)}</p>'
    )


def branded_html(
    *,
    language: str,
    heading: str,
    code: str,
    before: list[str],
    after: list[str],
    footer: str,
) -> str:
    """One heading, the code in a box, short paragraphs around it. All text is escaped."""
    code_box = (
        f'<p style="margin:8px 0 24px;padding:16px 20px;background:{CODE_BG};border-radius:10px;'
        f"font-family:{MONO};font-size:28px;font-weight:600;letter-spacing:4px;"
        f'color:{CODE_TEXT};text-align:center;">{escape(code)}</p>'
    )
    body = "".join(_paragraph(p) for p in before) + code_box + "".join(_paragraph(p) for p in after)
    return f"""<!doctype html>
<html lang="{escape(language)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>{escape(heading)}</title></head>
<body style="margin:0;padding:0;background:{BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{BG};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td style="padding:0 4px 20px;">
<img src="{escape(logo_url())}" width="{LOGO_WIDTH}" height="{LOGO_HEIGHT}" alt="Sessio"
 style="display:block;border:0;width:{LOGO_WIDTH}px;height:{LOGO_HEIGHT}px;">
</td></tr>
<tr><td style="background:{SURFACE};border:1px solid {BORDER};border-radius:14px;
 padding:32px 28px;">
<h1 style="margin:0 0 16px;font-family:{FONT};font-size:20px;font-weight:600;
 color:{TEXT};">{escape(heading)}</h1>
{body}
</td></tr>
<tr><td style="padding:16px 4px 0;font-family:{FONT};font-size:12px;line-height:1.5;
 color:{MUTED};">{escape(footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
"""
