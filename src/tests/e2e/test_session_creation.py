"""Test automatic session creation on page load"""

import pytest
from playwright.sync_api import Page, expect


def test_root_redirects_and_creates_session(page: Page):
    """Test that visiting root creates a session and navigates to /chat/<id>"""
    
    page.goto("http://localhost:5000/", wait_until="domcontentloaded")
    
    # Wait for client-side navigation to complete
    page.wait_for_url("**/chat/*", timeout=8000, wait_until="commit")
    
    # Verify we're on a session URL
    url = page.url
    assert "/chat/" in url
    assert len(url.split("/chat/")[1]) > 0  # There is an id after /chat/
    
    # Verify ChatView rendered correctly
    expect(page.get_by_placeholder("Type a message...")).to_be_visible()
    
    # Verify no errors in console
    errors = page.get_events("console").filter(lambda e: e.type == "error")
    assert len(errors) == 0


def test_chat_root_creates_session(page: Page):
    """Test that visiting /chat directly creates a session"""
    
    page.goto("http://localhost:5000/chat", wait_until="networkidle")
    
    # Wait for navigation to complete
    page.wait_for_url("**/chat/*", timeout=5000)
    
    # Verify we have a session id
    url = page.url
    session_id = url.split("/chat/")[1]
    assert len(session_id) > 5  # Valid uuid length
