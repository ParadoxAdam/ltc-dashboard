from playwright.sync_api import Page, expect

BASE_URL = "http://127.0.0.1:5000"


def open_dashboard(page: Page):
    """Load the page and wait until the app has finished initialising.

    The dashboard fetches live prices before it wires up the tab buttons, so
    clicking a tab too early does nothing at all. The status banner changing
    from "Loading..." to price data is our signal that the app is ready.
    """
    page.goto(BASE_URL)
    expect(page.locator("#status-banner")).not_to_contain_text("Loading", timeout=15000)


def test_page_loads(page: Page):
    """The dashboard loads and shows all three tabs."""
    open_dashboard(page)
    expect(page.get_by_role("button", name="Dashboard")).to_be_visible()
    expect(page.get_by_role("button", name="50-Lot Tracker")).to_be_visible()
    expect(page.get_by_role("button", name="Exit Comparison")).to_be_visible()


def test_dashboard_panel_shown_by_default(page: Page):
    """The dashboard panel is the one visible when the page first loads."""
    open_dashboard(page)
    expect(page.locator("#panel-dashboard")).to_be_visible()
    expect(page.locator("#panel-tracker")).to_be_hidden()
    expect(page.locator("#panel-exit")).to_be_hidden()


def test_tracker_tab_switches_panel(page: Page):
    """Clicking the tracker tab shows the tracker panel and hides the others."""
    open_dashboard(page)
    page.get_by_role("button", name="50-Lot Tracker").click()
    expect(page.locator("#panel-tracker")).to_be_visible()
    expect(page.locator("#panel-dashboard")).to_be_hidden()


def test_exit_tab_switches_panel(page: Page):
    """Clicking the exit tab shows the exit panel and hides the others."""
    open_dashboard(page)
    page.get_by_role("button", name="Exit Comparison").click()
    expect(page.locator("#panel-exit")).to_be_visible()
    expect(page.locator("#panel-tracker")).to_be_hidden()


def test_live_price_loads(page: Page):
    """The status banner shows live LTC price data once loading completes."""
    open_dashboard(page)
    expect(page.locator("#status-banner")).to_contain_text("LTC")