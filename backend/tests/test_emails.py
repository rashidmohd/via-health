"""Branded system emails (ADR 0017)."""

import pytest

from app.domain.email_layout import branded_html
from app.domain.login_email import login_code_email, recovery_check_email


@pytest.mark.parametrize("language", ["de", "en"])
def test_login_email_has_text_and_branded_html(language: str) -> None:
    content = login_code_email("123456", language)  # type: ignore[arg-type]
    assert "123456" in content.subject and "123456" in content.text
    assert "123456" in content.html
    assert f'lang="{language}"' in content.html
    assert 'src="http' in content.html and "/email/sessio-logo.png" in content.html
    assert 'alt="Sessio"' in content.html
    assert ".svg" not in content.html  # email clients do not show SVG
    # Same font as the UI, from our own origin — never Google Fonts.
    assert "@font-face{font-family:'Inter'" in content.html
    assert "/email/inter-latin.woff2" in content.html
    assert "googleapis" not in content.html


@pytest.mark.parametrize("language", ["de", "en"])
def test_recovery_email_has_the_code_only(language: str) -> None:
    content = recovery_check_email("AB12-CD34", language)  # type: ignore[arg-type]
    assert "AB12-CD34" in content.text and "AB12-CD34" in content.html
    assert "AB12-CD34" not in content.subject


def test_layout_escapes_text() -> None:
    html = branded_html(
        language="en", heading="<x>", code="<script>", before=["a & b"], after=[], footer="f"
    )
    assert "<script>" not in html and "&lt;script&gt;" in html
    assert "a &amp; b" in html
